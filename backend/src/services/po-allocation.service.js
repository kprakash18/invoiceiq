
import { prisma } from "../config/prisma.js";
import { Prisma } from "@prisma/client";

export function normalizeItemCode(value) {
    if (!value || typeof value !== "string") return null;

    return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

export function normalizeDescription(value) {
    if (!value || typeof value !== "string") return null;

    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() || null;
}

const decimal = (value) => new Prisma.Decimal(value);

// Allow a maximum 2% variance from the PO price/amount.
const PO_AMOUNT_TOLERANCE = new Prisma.Decimal("0.02");

async function buildAllocationPlanWithClient(
    db,
    {
        purchaseOrderId,
        invoiceId = null,
        invoiceLines,
        taxTreatment = "UNKNOWN",
    }
) {
    if (
        !purchaseOrderId ||
        !Array.isArray(invoiceLines) ||
        invoiceLines.length === 0
    ) {
        return {
            success: false,
            status: "INVALID_INPUT",
            requiresReview: false,
            issues: ["Purchase order ID and invoice lines are required."],
            allocations: [],
        };
    }

    const normalizedTaxTreatment =
        typeof taxTreatment === "string"
            ? taxTreatment.trim().toUpperCase()
            : "UNKNOWN";

    const purchaseOrder = await db.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
            items: {
                include: {
                    allocations: {
                        where: invoiceId
                            ? { invoiceId: { not: invoiceId } }
                            : {},
                    },
                },
            },
        },
    });

    if (!purchaseOrder) {
        return {
            success: false,
            status: "PO_NOT_FOUND",
            requiresReview: false,
            issues: ["Purchase order does not exist."],
            allocations: [],
        };
    }

    const issues = [];
    const proposedAllocations = [];
    let requiresReview = false;

    const balances = purchaseOrder.items.map((item) => {
        const allocatedQuantity = item.allocations.reduce(
            (sum, allocation) => sum.plus(allocation.allocatedQuantity),
            decimal(0)
        );

        const allocatedAmount = item.allocations.reduce(
            (sum, allocation) => sum.plus(allocation.allocatedAmount),
            decimal(0)
        );

        return {
            item,
            remainingQuantity: item.quantity.minus(allocatedQuantity),
            remainingAmount: item.quantity
                .mul(item.unitPrice)
                .minus(allocatedAmount),
        };
    });

    for (const invoiceLine of invoiceLines) {
        let quantity;
        let unitPrice;

        try {
            quantity = decimal(invoiceLine.quantity);
            unitPrice = decimal(invoiceLine.unitPrice);
        } catch {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "INVALID_LINE_VALUES",
                message: "Invoice quantity or unit price is invalid.",
            });
            continue;
        }

        if (
            !quantity.isFinite() ||
            !unitPrice.isFinite() ||
            quantity.lte(0) ||
            unitPrice.lt(0)
        ) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "INVALID_LINE_VALUES",
                message: "Quantity must be positive and unit price non-negative.",
            });
            continue;
        }

        const invoiceItemCode = normalizeItemCode(invoiceLine.itemCode);

        let candidates;

        if (invoiceItemCode) {
            candidates = balances.filter(
                ({ item }) =>
                    normalizeItemCode(item.itemCode) === invoiceItemCode
            );
        } else {
            const description = normalizeDescription(invoiceLine.description);

            candidates = balances.filter(
                ({ item }) =>
                    normalizeDescription(item.description) === description
            );
        }

        if (candidates.length === 0) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "PO_LINE_NOT_FOUND",
                message: "No matching purchase order line was found.",
            });
            continue;
        }

        if (candidates.length > 1) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "AMBIGUOUS_PO_LINE",
                message: "Multiple PO lines match this invoice line.",
            });
            continue;
        }

        const balance = candidates[0];
        const { item } = balance;

        // Check whether the invoice unit price is within 2% of the PO price.
        const priceDifference = unitPrice.minus(item.unitPrice).abs();

        const allowedPriceDifference = item.unitPrice.mul(
            PO_AMOUNT_TOLERANCE
        );

        if (priceDifference.gt(allowedPriceDifference)) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason:
                    normalizedTaxTreatment === "INCLUSIVE"
                        ? "TAX_INCLUSIVE_PRICE_BASIS_MISMATCH"
                        : "UNIT_PRICE_MISMATCH",
                message:
                    "Invoice unit price differs from PO unit price by more than the allowed 2% tolerance.",
            });

            continue;
        }

        if (!priceDifference.isZero()) {
            requiresReview = true;
        }

        const allocatedAmount = quantity.mul(unitPrice);

        // Quantity limits are always strict.
        if (quantity.gt(balance.remainingQuantity)) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "QUANTITY_EXCEEDED",
                message: "Invoice quantity exceeds the remaining PO quantity.",
            });

            continue;
        }

        // Check whether the amount overage is within 2% of the
        // remaining PO amount.
        const amountOverage = allocatedAmount.minus(
            balance.remainingAmount
        );

        if (amountOverage.gt(0)) {
            const allowedAmountOverage = balance.remainingAmount.mul(
                PO_AMOUNT_TOLERANCE
            );

            if (amountOverage.gt(allowedAmountOverage)) {
                issues.push({
                    invoiceLineId: invoiceLine.id,
                    reason: "AMOUNT_EXCEEDED",
                    message:
                        "Invoice amount exceeds the remaining PO amount by more than 2%.",
                });

                continue;
            }

            requiresReview = true;
        }

        proposedAllocations.push({
            invoiceId: invoiceLine.invoiceId ?? invoiceId,
            purchaseOrderId: purchaseOrder.id,
            poLineItemId: item.id,
            invoiceLineItemId: invoiceLine.id,
            allocatedQuantity: quantity,
            allocatedAmount,
        });

        balance.remainingQuantity = balance.remainingQuantity.minus(quantity);
        balance.remainingAmount = balance.remainingAmount.minus(allocatedAmount);
    }

    return {
        success: issues.length === 0,
        status:
            issues.length > 0 || requiresReview
                ? "NEEDS_REVIEW"
                : "VALID",
        requiresReview,
        issues,
        allocations:
            issues.length === 0 ? proposedAllocations : [],
    };
}

// Read-only allocation planner.
export async function buildAllocationPlan(args) {
    return buildAllocationPlanWithClient(prisma, args);
}

// Persist allocations after revalidating everything in a transaction.
export async function persistPOAllocations({
    invoiceId,
    purchaseOrderId,
    taxTreatment = "UNKNOWN",
}) {
    if (!invoiceId || !purchaseOrderId) {
        return {
            success: false,
            status: "INVALID_INPUT",
            requiresReview: false,
            message: "Invoice ID and purchase order ID are required.",
        };
    }

    try {
        return await prisma.$transaction(
            async (tx) => {
                const invoice = await tx.invoice.findUnique({
                    where: { id: invoiceId },
                    include: { items: true },
                });

                if (!invoice) {
                    return {
                        success: false,
                        status: "INVOICE_NOT_FOUND",
                        message: "Invoice does not exist.",
                    };
                }

                const purchaseOrder = await tx.purchaseOrder.findUnique({
                    where: { id: purchaseOrderId },
                });

                if (!purchaseOrder) {
                    return {
                        success: false,
                        status: "PO_NOT_FOUND",
                        message: "Purchase order does not exist.",
                    };
                }

                if (invoice.vendorId !== purchaseOrder.vendorId) {
                    return {
                        success: false,
                        status: "VENDOR_MISMATCH",
                        message:
                            "Invoice and purchase order belong to different vendors.",
                    };
                }

                if (
                    invoice.poId &&
                    invoice.poId !== purchaseOrderId
                ) {
                    return {
                        success: false,
                        status: "PO_CONFLICT",
                        message:
                            "Invoice is already linked to a different purchase order.",
                    };
                }

                if (
                    !["OPEN", "PARTIALLY_INVOICED"].includes(
                        purchaseOrder.status
                    )
                ) {
                    return {
                        success: false,
                        status: "NOT_ELIGIBLE",
                        message:
                            "Purchase order is not eligible for allocation.",
                    };
                }

                const existingAllocations = await tx.pOAllocation.findMany({
                    where: { invoiceId },
                    select: { id: true },
                });

                if (existingAllocations.length > 0) {
                    return {
                        success: false,
                        status: "ALREADY_ALLOCATED",
                        message:
                            "This invoice already has allocation records.",
                    };
                }

                if (invoice.items.length === 0) {
                    return {
                        success: false,
                        status: "NO_INVOICE_LINES",
                        message:
                            "Invoice has no line items to allocate.",
                    };
                }

                const plan = await buildAllocationPlanWithClient(tx, {
                    purchaseOrderId,
                    invoiceId,
                    invoiceLines: invoice.items,
                    taxTreatment,
                });

                if (!plan.success) {
                    return {
                        success: false,
                        status: plan.status,
                        requiresReview: false,
                        message: "Allocation validation failed.",
                        issues: plan.issues,
                    };
                }

                for (const allocation of plan.allocations) {
                    await tx.pOAllocation.create({
                        data: allocation,
                    });
                }

                await tx.invoice.update({
                    where: { id: invoiceId },
                    data: { poId: purchaseOrderId },
                });

                const updatedPO = await tx.purchaseOrder.findUnique({
                    where: { id: purchaseOrderId },
                    include: {
                        items: {
                            include: {
                                allocations: true,
                            },
                        },
                    },
                });

                const allLinesFullyAllocated =
                    updatedPO.items.length > 0 &&
                    updatedPO.items.every((item) => {
                        const allocatedQuantity = item.allocations.reduce(
                            (sum, allocation) =>
                                sum.plus(allocation.allocatedQuantity),
                            decimal(0)
                        );

                        const allocatedAmount = item.allocations.reduce(
                            (sum, allocation) =>
                                sum.plus(allocation.allocatedAmount),
                            decimal(0)
                        );

                        const requiredAmount = decimal(item.quantity).mul(
                            decimal(item.unitPrice)
                        );

                        return (
                            allocatedQuantity.gte(item.quantity) &&
                            allocatedAmount.gte(requiredAmount)
                        );
                    });

                const nextPOStatus = allLinesFullyAllocated
                    ? "CLOSED"
                    : "PARTIALLY_INVOICED";

                await tx.purchaseOrder.update({
                    where: { id: purchaseOrderId },
                    data: { status: nextPOStatus },
                });

                return {
                    success: true,
                    status: "ALLOCATED",
                    requiresReview: plan.requiresReview,
                    message: plan.requiresReview
                        ? "Allocations persisted, but manual review is required due to PO variance."
                        : "All invoice lines were successfully allocated.",
                    allocationCount: plan.allocations.length,
                    allocations: plan.allocations,
                };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            }
        );
    } catch (error) {
        if (error.code === "P2034") {
            return {
                success: false,
                status: "CONCURRENT_ALLOCATION_CONFLICT",
                message:
                    "Another transaction changed PO allocations. Retry the operation.",
            };
        }

        if (error.code === "P2002") {
            return {
                success: false,
                status: "ALLOCATION_CONFLICT",
                message: "A duplicate allocation already exists.",
            };
        }

        throw error;
    }
}
