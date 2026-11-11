import { deriveAllocationBasis } from "./po-allocation.service.js";
import prisma from "../config/prisma.js";
import { Prisma } from "@prisma/client";

import { evaluateInvoiceDecision } from "./decision-engine.service.js";
import { detectDuplicateInvoice } from "./duplicate-detection.service.js";
import { matchVendor } from "./vendor-matching.service.js";
import { matchPurchaseOrder } from "./po-matching.service.js";

const PO_MATCH_REASON_BY_STATUS = {
    PO_NOT_PROVIDED: "PO_NUMBER_MISSING",
    NOT_FOUND: "PO_NOT_REGISTERED",
    AMBIGUOUS: "MULTIPLE_PO_MATCHES",
    VENDOR_MISMATCH: "PO_VENDOR_MISMATCH",
    EXPIRED: "PO_EXPIRED",
    INSUFFICIENT_INFORMATION: "VENDOR_ID_MISSING",
};

function getStage(processingRun, name) {
    return processingRun.stages.find((stage) => stage.name === name);
}

function getStageMetadata(stage) {
    return stage?.metadata && typeof stage.metadata === "object"
        ? stage.metadata
        : {};
}

function reasonForPersistedPOMatch(metadata, message) {
    if (metadata.reason) {
        return metadata.reason;
    }

    if (metadata.result === "NOT_ELIGIBLE") {
        if (message?.includes("earlier than the purchase order issue date")) {
            return "INVOICE_BEFORE_PO_ISSUE_DATE";
        }

        return "PO_STATUS_NOT_ELIGIBLE";
    }

    return (
        PO_MATCH_REASON_BY_STATUS[metadata.result] ??
        `PO_${metadata.result ?? "UNKNOWN"}`
    );
}

async function reconstructPOMatchFromStage({
    poMatchingStage,
    vendorMatch,
    normalizedData,
    invoice,
}) {
    if (vendorMatch.status !== "MATCHED") {
        return {
            status: "INSUFFICIENT_INFORMATION",
            reason: "VENDOR_ID_MISSING",
            message: "Vendor must be identified before PO matching.",
            purchaseOrder: null,
        };
    }

    const metadata = getStageMetadata(poMatchingStage);

    if (!metadata.result) {
        return matchPurchaseOrder({
            vendorId: vendorMatch.vendor.id,
            poNumber: normalizedData.poNumber,
            invoiceDate: invoice.invoiceDate,
        });
    }

    if (metadata.result !== "MATCHED") {
        return {
            status: metadata.result,
            reason: reasonForPersistedPOMatch(
                metadata,
                poMatchingStage?.message
            ),
            message:
                poMatchingStage?.message ??
                "Purchase order could not be reliably matched.",
            purchaseOrder: null,
        };
    }

    if (!metadata.purchaseOrderId) {
        return {
            status: "NOT_FOUND",
            reason: "PO_NOT_REGISTERED",
            message: "The originally matched purchase order is missing.",
            purchaseOrder: null,
        };
    }

    const purchaseOrder = await prisma.purchaseOrder.findUnique({
        where: { id: metadata.purchaseOrderId },
        include: {
            vendor: {
                select: {
                    id: true,
                    name: true,
                },
            },
            items: true,
        },
    });

    if (!purchaseOrder) {
        return {
            status: "NOT_FOUND",
            reason: "PO_NOT_REGISTERED",
            message: "The originally matched purchase order no longer exists.",
            purchaseOrder: null,
        };
    }

    if (purchaseOrder.vendorId !== vendorMatch.vendor.id) {
        return {
            status: "VENDOR_MISMATCH",
            reason: "PO_VENDOR_MISMATCH",
            message: "The originally matched purchase order belongs to a different vendor.",
            purchaseOrder,
        };
    }

    return {
        status: "MATCHED",
        reason: metadata.reason ?? "EXACT_PO_NUMBER_MATCH",
        message:
            poMatchingStage?.message ??
            "Purchase order successfully matched to the invoice vendor.",
        purchaseOrder,
    };
}

export function verifyAllocationIntegrity({
    invoice,
    purchaseOrderId,
    taxTreatment,
}) {
    if (!invoice.items.length || !invoice.allocations.length) {
        return {
            valid: false,
            message: "Invoice lines or PO allocations are missing.",
        };
    }

    const allocatedByInvoiceLine = new Map();

    for (const allocation of invoice.allocations) {
        if (
            allocation.invoiceId !== invoice.id ||
            allocation.purchaseOrderId !== purchaseOrderId ||
            allocation.invoiceLineItem.invoiceId !== invoice.id ||
            allocation.poLineItem.poId !== purchaseOrderId
        ) {
            return {
                valid: false,
                message:
                    "An allocation references an unrelated invoice or PO line.",
            };
        }

        const quantity = allocation.allocatedQuantity;
        const amount = allocation.allocatedAmount;

        if (
            !quantity.isFinite() ||
            !amount.isFinite() ||
            !quantity.greaterThan(0) ||
            !amount.greaterThan(0)
        ) {
            return {
                valid: false,
                message:
                    "An allocation contains an invalid quantity or amount.",
            };
        }

        const lineId = allocation.invoiceLineItemId;
        const existing = allocatedByInvoiceLine.get(lineId);

        if (existing) {
            existing.quantity = existing.quantity.plus(quantity);
            existing.amount = existing.amount.plus(amount);
        } else {
            allocatedByInvoiceLine.set(lineId, {
                quantity,
                amount,
            });
        }
    }

    for (const item of invoice.items) {
        const allocated = allocatedByInvoiceLine.get(item.id);

        if (!allocated) {
            return {
                valid: false,
                message: `Invoice line "${item.description}" has no allocation.`,
            };
        }

        const allocationBasis = deriveAllocationBasis(
            item,
            taxTreatment
        );

        if (!allocationBasis.success) {
            return {
                valid: false,
                message: `Invoice line "${item.description}" has invalid tax values: ${allocationBasis.message}`,
            };
        }

        if (
            !allocated.quantity.equals(item.quantity) ||
            !allocated.amount.equals(
                allocationBasis.lineAmount.toDecimalPlaces(
                    2,
                    Prisma.Decimal.ROUND_HALF_UP
                )
            )
        ) {
            return {
                valid: false,
                message: `Allocations do not fully match invoice line "${item.description}".`,
            };
        }
    }

    return {
        valid: true,
        message: "All invoice lines have valid, complete PO allocations.",
    };
}

export async function finalizeInvoiceDecision({
    invoiceId,
    processingRunId,
}) {
    if (!invoiceId) {
        return {
            success: false,
            status: "INVALID_INPUT",
            message: "Invoice ID is required.",
        };
    }

    try {
        // 1. Load invoice and persisted line items/allocations.
        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: {
                items: true,
                allocations: {
                    include: {
                        invoiceLineItem: true,
                        poLineItem: true,
                    },
                },
            },
        });

        if (!invoice) {
            return {
                success: false,
                status: "INVOICE_NOT_FOUND",
                message: "Invoice does not exist.",
            };
        }

        // 2. Load the exact processing run.
        const processingRun = processingRunId
            ? await prisma.processingRun.findUnique({
                  where: { id: processingRunId },
                  include: {
                      stages: true,
                      validations: true,
                      decision: true,
                  },
              })
            : await prisma.processingRun.findFirst({
                  where: { invoiceId },
                  orderBy: { attempt: "desc" },
                  include: {
                      stages: true,
                      validations: true,
                      decision: true,
                  },
              });

        if (!processingRun || processingRun.invoiceId !== invoiceId) {
            return {
                success: false,
                status: "PROCESSING_RUN_NOT_FOUND",
                message: "Processing run does not exist for this invoice.",
            };
        }

        // 3. Return an existing decision instead of creating another.
        if (processingRun.decision) {
            return {
                success: true,
                status: "DECISION_ALREADY_RECORDED",
                decision: processingRun.decision,
            };
        }

        if (processingRun.status !== "IN_PROGRESS") {
            return {
                success: false,
                status: "PROCESSING_RUN_NOT_ACTIVE",
                message: "The processing run is not active.",
            };
        }

        const stageStatus = (name) =>
            getStage(processingRun, name)?.status;

        // 4. Reconstruct validation from persisted database records.
        const validation = {
            success: stageStatus("VALIDATION") === "COMPLETED",
            results: processingRun.validations.map((issue) => ({
                code: issue.ruleCode,
                field: issue.field,
                severity: issue.severity,
                message: issue.message,
                observed_value: issue.actualValue,
            })),
        };

        const extraction = {
            success: stageStatus("PDF_EXTRACTION") === "COMPLETED",
        };

        // 5. Read saved normalized extraction and allocation outcome.
        const normalizedData = processingRun.normalizedData;

        if (!normalizedData || typeof normalizedData !== "object") {
            return {
                success: false,
                status: "NORMALIZED_DATA_MISSING",
                message: "Persisted normalized invoice data is missing.",
            };
        }

        const persistedAllocation = normalizedData.allocationResult;

        // 6. Recheck vendor matching.
        const vendorMatch = await matchVendor({
            vendorName: normalizedData.vendor?.name,
            gstin: normalizedData.vendor?.gstin,
        });

        // 7. Recheck duplicate detection.
        const duplicate =
            vendorMatch.status === "MATCHED"
                ? await detectDuplicateInvoice({
                      vendorId: vendorMatch.vendor.id,
                      invoiceNumber: invoice.invoiceNumber,
                      excludeInvoiceId: invoiceId,
                  })
                : {
                      isDuplicate: false,
                      reason: "INSUFFICIENT_INFORMATION",
                      message:
                          "Vendor could not be identified for duplicate detection.",
                  };

        // 8. Reconstruct the original PO match from the persisted stage.
        // A PO can become CLOSED after allocation, so finalization must not
        // re-run the initial eligibility check against the current status.
        const poMatch = await reconstructPOMatchFromStage({
            poMatchingStage: getStage(processingRun, "PO_MATCHING"),
            vendorMatch,
            normalizedData,
            invoice,
        });

        // 9. Verify currency explicitly.
        let currencyMatch = {
            status: "UNKNOWN",
            message: "Currency could not be verified.",
        };

        if (normalizedData.currencyStatus !== "IDENTIFIED") {
            currencyMatch = {
                status: "UNIDENTIFIED",
                message: "Invoice currency is missing or ambiguous.",
            };
        } else if (poMatch.status === "MATCHED") {
            const invoiceCurrency = invoice.currency;
            const poCurrency = poMatch.purchaseOrder.currency;

            currencyMatch =
                invoiceCurrency === poCurrency
                    ? {
                          status: "MATCHED",
                          message: `Invoice and purchase order both use ${invoiceCurrency}.`,
                      }
                    : {
                          status: "MISMATCH",
                          message: `Invoice currency (${invoiceCurrency}) differs from PO currency (${poCurrency}).`,
                      };
        }

        // 10. Verify persisted allocations without creating new ones.
        const allocationIntegrity = verifyAllocationIntegrity({
            invoice,
            purchaseOrderId: poMatch.purchaseOrder?.id,
            taxTreatment: normalizedData.taxTreatment,
        });

        const allocationIsValid =
            invoice.poId === poMatch.purchaseOrder?.id &&
            allocationIntegrity.valid;

       const allocation = allocationIsValid
    ? {
          status: persistedAllocation?.requiresReview
              ? "NEEDS_REVIEW"
              : "ALLOCATED",
          message:
              persistedAllocation?.message ??
              allocationIntegrity.message,
          issues: Array.isArray(persistedAllocation?.issues)
              ? persistedAllocation.issues
              : [],
      }
    : {
          status: "NEEDS_REVIEW",
          message:
              persistedAllocation?.message ??
              allocationIntegrity.message,
          issues: Array.isArray(persistedAllocation?.issues)
              ? persistedAllocation.issues
              : [],
      };

        // 11. Evaluate the deterministic decision.
        const decision = evaluateInvoiceDecision({
            extraction,
            validation,
            duplicate,
            vendorMatch,
            poMatch,
            currencyMatch,
            allocation,
            documentType: normalizedData.documentType ?? "UNKNOWN",
        });

        // Technical failures do not create financial decisions.
        if (decision.technicalFailure) {
            return {
                success: false,
                status: "TECHNICAL_FAILURE",
                decision,
            };
        }

        // 12. Persist decision and update statuses atomically.
        const result = await prisma.$transaction(
            async (tx) => {
                const existingDecision =
                    await tx.decision.findUnique({
                        where: {
                            processingRunId: processingRun.id,
                        },
                    });

                if (existingDecision) {
                    return {
                        success: true,
                        status: "DECISION_ALREADY_RECORDED",
                        decision: existingDecision,
                    };
                }

                const currentInvoice =
                    await tx.invoice.findUnique({
                        where: { id: invoiceId },
                        select: {
                            id: true,
                            status: true,
                            poId: true,
                        },
                    });

                if (
                    !currentInvoice ||
                    currentInvoice.status !== "PROCESSING" ||
                    currentInvoice.poId !== invoice.poId
                ) {
                    throw new Error(
                        "Invoice state changed during decision evaluation."
                    );
                }

                const currentAllocationCount =
                    await tx.pOAllocation.count({
                        where: { invoiceId },
                    });

                if (
                    currentAllocationCount !== invoice.allocations.length
                ) {
                    throw new Error(
                        "Allocation records changed during decision evaluation."
                    );
                }

                const savedDecision = await tx.decision.create({
                    data: {
                        processingRunId: processingRun.id,
                        outcome: decision.outcome,
                        reason: decision.reason,
                        explanation: decision.explanation,
                        policyVersion: decision.policyVersion,
                    },
                });

                await tx.invoice.update({
                    where: { id: invoiceId },
                    data: {
                        status: decision.outcome,
                    },
                });

                await tx.processingRun.update({
                    where: { id: processingRun.id },
                    data: {
                        status: "COMPLETED",
                        completedAt: new Date(),
                    },
                });

                await tx.processingStage.upsert({
                    where: {
                        processingRunId_name: {
                            processingRunId: processingRun.id,
                            name: "DECISION",
                        },
                    },
                    create: {
                        processingRunId: processingRun.id,
                        name: "DECISION",
                        status: "COMPLETED",
                        startedAt: new Date(),
                        completedAt: new Date(),
                        message: decision.explanation,
                    },
                    update: {
                        status: "COMPLETED",
                        completedAt: new Date(),
                        message: decision.explanation,
                    },
                });

                return {
                    success: true,
                    status: "DECISION_RECORDED",
                    decision: savedDecision,
                };
            },
            {
                isolationLevel: "Serializable",
            }
        );

        return result;
    } catch (error) {
        console.error("Invoice decision failed:", error);

        return {
            success: false,
            status: "DECISION_PERSISTENCE_FAILED",
            message: error.message,
        };
    }
}
