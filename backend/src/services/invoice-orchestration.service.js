
import { prisma } from "../config/prisma.js";

import {
    processInvoiceFile,
    persistInvoiceExtraction,
} from "./invoice-processing.service.js";

import { matchVendor } from "./vendor-matching.service.js";
import { detectDuplicateInvoice } from "./duplicate-detection.service.js";
import { matchPurchaseOrder } from "./po-matching.service.js";
import { persistPOAllocations } from "./po-allocation.service.js";
import { finalizeInvoiceDecision } from "./invoice-decision.service.js";

async function recordProcessingStage({
    processingRunId,
    name,
    status,
    message,
    metadata = {},
    startedAt = new Date(),
    completedAt = new Date(),
}) {
    await prisma.processingStage.upsert({
        where: {
            processingRunId_name: {
                processingRunId,
                name,
            },
        },
        create: {
            processingRunId,
            name,
            status,
            message,
            metadata,
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        update: {
            status,
            message,
            metadata,
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
        },
    });
}

async function markTechnicalFailure({
    invoiceId,
    processingRunId = null,
    error,
}) {
    try {
        await prisma.$transaction(async (tx) => {
            if (processingRunId) {
                await tx.processingRun.updateMany({
                    where: {
                        id: processingRunId,
                        status: "IN_PROGRESS",
                    },
                    data: {
                        status: "FAILED",
                        completedAt: new Date(),
                        error: String(error),
                    },
                });

                await tx.processingStage.create({
                    data: {
                        processingRunId,
                        name: "ORCHESTRATION",
                        status: "FAILED",
                        startedAt: new Date(),
                        completedAt: new Date(),
                        message: "Invoice orchestration failed.",
                        error: String(error),
                    },
                });
            }

            await tx.invoice.updateMany({
                where: {
                    id: invoiceId,
                    status: {
                        in: ["UPLOADED", "PROCESSING"],
                    },
                },
                data: {
                    status: "FAILED",
                },
            });
        });
    } catch (failureError) {
        console.error(
            "Could not persist technical failure:",
            failureError
        );
    }
}

export async function orchestrateInvoiceProcessing({ invoiceId }) {
    if (!invoiceId) {
        return {
            success: false,
            status: "INVALID_INPUT",
            message: "Invoice ID is required.",
        };
    }

    let processingRunId = null;

    try {
        // 1. Load the uploaded invoice.
        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            select: {
                id: true,
                filePath: true,
                status: true,
            },
        });

        if (!invoice) {
            return {
                success: false,
                status: "INVOICE_NOT_FOUND",
                message: "Invoice does not exist.",
            };
        }

        if (invoice.status !== "UPLOADED") {
            return {
                success: false,
                status: "INVALID_INVOICE_STATUS",
                message: `Invoice cannot be processed from status ${invoice.status}.`,
            };
        }

        // 2. Extract and normalize the PDF.
        const processed = await processInvoiceFile(invoice.filePath);

        if (!processed.success) {
            await markTechnicalFailure({
                invoiceId,
                error: processed.error,
            });

            return {
                success: false,
                status: "EXTRACTION_FAILED",
                stage: processed.stage,
                message: processed.error,
            };
        }

        // 3. Persist extraction and create ProcessingRun.
        const persistence = await persistInvoiceExtraction({
            invoiceId,
            processed,
        });

        if (!persistence.success) {
            if (persistence.status === "PERSISTENCE_FAILED") {
                await markTechnicalFailure({
                    invoiceId,
                    error: persistence.message,
                });
            }

            return {
                success: false,
                status: persistence.status,
                message: persistence.message,
            };
        }

        processingRunId = persistence.processingRun.id;

        const data = processed.data;

        const skippedAllocation = (message) => ({
            status: "SKIPPED",
            message,
        });

        let allocationResult = skippedAllocation(
            "PO allocation was not attempted."
        );

        const skippedStage = async (name, message, metadata = {}) => {
            const now = new Date();

            await recordProcessingStage({
                processingRunId,
                name,
                status: "SKIPPED",
                message,
                metadata,
                startedAt: now,
                completedAt: now,
            });
        };

        // 4. Only ordinary invoices go through PO allocation.
        if (data.documentType === "INVOICE") {
            const blockingValidationIssues = (
                processed.validation?.results ?? []
            ).filter(
                (issue) =>
                    issue.severity !== "INFO" &&
                    issue.severity !== "WARNING"
            );

            const validationPassed =
                processed.validation?.success === true &&
                blockingValidationIssues.length === 0;

            if (validationPassed && persistence.lineItemsPersisted) {
                // 5. Vendor matching.
                const vendorStartedAt = new Date();

                const vendorMatch = await matchVendor({
                    vendorName: data.vendor?.name,
                    gstin: data.vendor?.gstin,
                });

                if (vendorMatch.status === "MATCHED") {
                    await prisma.invoice.update({
                        where: { id: invoiceId },
                        data: {
                            vendorId: vendorMatch.vendor.id,
                        },
                    });
                }

                await recordProcessingStage({
                    processingRunId,
                    name: "VENDOR_MATCHING",
                    status: "COMPLETED",
                    message:
                        vendorMatch.message ??
                        "Vendor matching completed.",
                    metadata: {
                        result: vendorMatch.status,
                        vendorId: vendorMatch.vendor?.id ?? null,
                        vendorName: vendorMatch.vendor?.name ?? null,
                        reason: vendorMatch.reason ?? null,
                    },
                    startedAt: vendorStartedAt,
                });

                if (vendorMatch.status === "MATCHED") {
                    // 6. Duplicate detection.
                    const duplicateStartedAt = new Date();

                    const duplicate = await detectDuplicateInvoice({
                        vendorId: vendorMatch.vendor.id,
                        invoiceNumber: data.invoiceNumber,
                        excludeInvoiceId: invoiceId,
                    });

                    await recordProcessingStage({
                        processingRunId,
                        name: "DUPLICATE_CHECK",
                        status: "COMPLETED",
                        message:
                            duplicate.message ??
                            "Duplicate check completed.",
                        metadata: {
                            isDuplicate: duplicate.isDuplicate,
                            result: duplicate.reason ?? null,
                        },
                        startedAt: duplicateStartedAt,
                    });

                    if (!duplicate.isDuplicate) {
                        // 7. Purchase order matching.
                        const poStartedAt = new Date();

                        const poMatch = await matchPurchaseOrder({
                            vendorId: vendorMatch.vendor.id,
                            poNumber: data.poNumber,
                            invoiceDate: data.invoiceDate,
                        });

                        // 8. Persist matched PO independently of allocation.
                        if (
                            poMatch.status === "MATCHED" &&
                            poMatch.purchaseOrder?.id
                        ) {
                            await prisma.invoice.update({
                                where: { id: invoiceId },
                                data: {
                                    poId: poMatch.purchaseOrder.id,
                                },
                            });
                        }

                        // 9. Currency verification.
                        const currencyMatches =
                            data.currencyStatus === "IDENTIFIED" &&
                            data.currencyCode &&
                            poMatch.status === "MATCHED" &&
                            data.currencyCode ===
                                poMatch.purchaseOrder.currency;

                        await recordProcessingStage({
                            processingRunId,
                            name: "PO_MATCHING",
                            status: "COMPLETED",
                            message:
                                poMatch.message ??
                                "PO matching completed.",
                            metadata: {
                                result: poMatch.status,
                                purchaseOrderId:
                                    poMatch.purchaseOrder?.id ?? null,
                                currencyMatches: Boolean(currencyMatches),
                                invoiceCurrency:
                                    data.currencyCode ?? null,
                                poCurrency:
                                    poMatch.purchaseOrder?.currency ?? null,
                            },
                            startedAt: poStartedAt,
                        });

                        // 10. Persist allocations only after prerequisites pass.
                        if (currencyMatches) {
                            const allocationStartedAt = new Date();

                            allocationResult = await persistPOAllocations({
                                invoiceId,
                                purchaseOrderId:
                                    poMatch.purchaseOrder.id,
                                taxTreatment: data.taxTreatment,
                                documentType: data.documentType,
                            });

                            await recordProcessingStage({
                                processingRunId,
                                name: "PO_ALLOCATION",
                                status: "COMPLETED",
                                message:
                                    allocationResult.message ??
                                    "PO allocation completed.",
                                metadata: {
                                    result: allocationResult.status,
                                    requiresReview:
                                        allocationResult.requiresReview ??
                                        false,
                                    allocationCount:
                                        allocationResult.allocationCount ??
                                        0,
                                    issues: allocationResult.issues ?? [],
                                },
                                startedAt: allocationStartedAt,
                            });
                        } else {
                            allocationResult = skippedAllocation(
                                "PO matching or currency verification failed."
                            );

                            await skippedStage(
                                "PO_ALLOCATION",
                                allocationResult.message,
                                {
                                    poMatchStatus: poMatch.status,
                                    currencyStatus: data.currencyStatus,
                                }
                            );
                        }
                    } else {
                        allocationResult = skippedAllocation(
                            "Possible duplicate invoice detected."
                        );

                        await skippedStage(
                            "PO_MATCHING",
                            "PO matching was skipped because a possible duplicate was detected."
                        );

                        await skippedStage(
                            "PO_ALLOCATION",
                            allocationResult.message
                        );
                    }
                } else {
                    allocationResult = skippedAllocation(
                        "Vendor could not be matched."
                    );

                    await skippedStage(
                        "DUPLICATE_CHECK",
                        "Duplicate detection requires a matched vendor."
                    );

                    await skippedStage(
                        "PO_MATCHING",
                        "PO matching requires a matched vendor."
                    );

                    await skippedStage(
                        "PO_ALLOCATION",
                        allocationResult.message
                    );
                }
            } else {
                allocationResult = skippedAllocation(
                    "Validation issues or incomplete line items prevented allocation."
                );

                await skippedStage(
                    "VENDOR_MATCHING",
                    "Vendor matching was skipped because validation failed or line items were not persisted."
                );

                await skippedStage(
                    "DUPLICATE_CHECK",
                    "Duplicate detection requires a matched vendor."
                );

                await skippedStage(
                    "PO_MATCHING",
                    "PO matching prerequisites were not satisfied."
                );

                await skippedStage(
                    "PO_ALLOCATION",
                    allocationResult.message
                );
            }
        } else {
            allocationResult = skippedAllocation(
                `PO allocation is not performed for ${data.documentType ?? "UNKNOWN"} documents.`
            );

            await skippedStage(
                "VENDOR_MATCHING",
                "Not applicable to this document type."
            );

            await skippedStage(
                "DUPLICATE_CHECK",
                "Not applicable to this document type."
            );

            await skippedStage(
                "PO_MATCHING",
                "Not applicable to this document type."
            );

            await skippedStage(
                "PO_ALLOCATION",
                allocationResult.message
            );
        }

        // 11. Persist allocation outcome without overwriting extraction data.
        const currentRun = await prisma.processingRun.findUnique({
            where: { id: processingRunId },
            select: {
                normalizedData: true,
            },
        });

        if (!currentRun) {
            throw new Error(
                "Processing run disappeared before allocation result could be saved."
            );
        }

        await prisma.processingRun.update({
            where: { id: processingRunId },
            data: {
                normalizedData: {
                    ...(currentRun.normalizedData ?? {}),
                    allocationResult: {
                        status: allocationResult.status,
                        requiresReview:
                            allocationResult.requiresReview ?? false,
                        issues: allocationResult.issues ?? [],
                        message: allocationResult.message ?? null,
                    },
                },
            },
        });

        // 12. Recheck persisted data and record the decision.
        const finalization = await finalizeInvoiceDecision({
            invoiceId,
            processingRunId,
        });

        return {
            success: finalization.success,
            status: finalization.status,
            invoiceId,
            processingRunId,
            extraction: {
                success: true,
                method: processed.extractionMethod,
            },
            persistence: {
                success: true,
                status: persistence.status,
                lineItemsPersisted: persistence.lineItemsPersisted,
            },
            allocation: allocationResult,
            decision: finalization.decision ?? null,
            message: finalization.message ?? null,
        };
    } catch (error) {
        console.error("Invoice orchestration failed:", error);

        await markTechnicalFailure({
            invoiceId,
            processingRunId,
            error: error.message,
        });

        return {
            success: false,
            status: "ORCHESTRATION_FAILED",
            invoiceId,
            processingRunId,
            message: error.message,
        };
    }
}
