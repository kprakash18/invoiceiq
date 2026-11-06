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

/**
 * Coordinates the complete invoice processing workflow.
 *
 * Extraction is handled by the Python service.
 * Financial decisions are handled by the deterministic decision engine.
 */
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

        let allocationResult = {
            status: "SKIPPED",
            message: "PO allocation was not attempted.",
        };

        // 4. Only ordinary invoices go through PO allocation.
        if (data.documentType === "INVOICE") {
            const validationPassed =
                processed.validation?.success === true &&
                (processed.validation.results ?? []).length === 0;

            // 5. Do not allocate invoices with validation issues
            // or incomplete line-item persistence.
            if (validationPassed && persistence.lineItemsPersisted) {
                // 6. Identify the vendor.
                const vendorMatch = await matchVendor({
                    vendorName: data.vendor?.name,
                    gstin: data.vendor?.gstin,
                });

                if (vendorMatch.status === "MATCHED") {
                    // Persist the identified vendor on the invoice.
                    await prisma.invoice.update({
                        where: { id: invoiceId },
                        data: {
                            vendorId: vendorMatch.vendor.id,
                        },
                    });

                    // 7. Check for business-level duplicates.
                    const duplicate = await detectDuplicateInvoice({
                        vendorId: vendorMatch.vendor.id,
                        invoiceNumber: data.invoiceNumber,
                        excludeInvoiceId: invoiceId,
                    });

                    // 8. Match the PO only when the invoice
                    // is not a duplicate.
                    if (!duplicate.isDuplicate) {
                        const poMatch = await matchPurchaseOrder({
                            vendorId: vendorMatch.vendor.id,
                            poNumber: data.poNumber,
                            invoiceDate: data.invoiceDate,
                        });

                        // 9. Verify currency before allocation.
                        const currencyMatches =
                            data.currencyStatus === "IDENTIFIED" &&
                            data.currencyCode &&
                            poMatch.status === "MATCHED" &&
                            data.currencyCode ===
                                poMatch.purchaseOrder.currency;

                        // 10. Persist allocations only after
                        // all prerequisites have passed.
                        if (currencyMatches) {
                            allocationResult =
                                await persistPOAllocations({
                                    invoiceId,
                                    purchaseOrderId:
                                        poMatch.purchaseOrder.id,
                                    taxTreatment: data.taxTreatment,
                                });
                        } else {
                            allocationResult = {
                                status: "SKIPPED",
                                message:
                                    "PO matching or currency verification failed.",
                            };
                        }
                    } else {
                        allocationResult = {
                            status: "SKIPPED",
                            message: "Possible duplicate invoice detected.",
                        };
                    }
                } else {
                    allocationResult = {
                        status: "SKIPPED",
                        message: "Vendor could not be matched.",
                    };
                }
            } else {
                allocationResult = {
                    status: "SKIPPED",
                    message:
                        "Validation issues or incomplete line items prevented allocation.",
                };
            }
        } else {
            allocationResult = {
                status: "SKIPPED",
                message: `PO allocation is not performed for ${data.documentType ?? "UNKNOWN"} documents.`,
            };
        }

        // 11. Persist allocation outcome without overwriting
        // the existing normalized extraction data.
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
                        requiresReview: allocationResult.requiresReview ?? false,
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