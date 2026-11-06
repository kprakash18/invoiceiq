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

export async function buildAllocationPlanWithClient(
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
            issues: [
                {
                    reason: "INVALID_INPUT",
                    message: "Purchase order ID and invoice lines are required.",
                },
            ],
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
            issues: [
                {
                    reason: "PO_NOT_FOUND",
                    message: "Purchase order does not exist.",
                },
            ],
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
        const invoiceDescription = normalizeDescription(invoiceLine.description);

        if (!invoiceItemCode && !invoiceDescription) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "MISSING_ITEM_INFORMATION",
                message: "Invoice line must have an item code or description.",
            });
            continue;
        }

        // Validate line total if provided
        if (invoiceLine.lineTotal != null) {
            try {
                const lineTotal = decimal(invoiceLine.lineTotal);
                const calculatedTotal = quantity.mul(unitPrice);

                if (!lineTotal.isFinite() || lineTotal.lt(0)) {
                    issues.push({
                        invoiceLineId: invoiceLine.id,
                        reason: "INVALID_LINE_VALUES",
                        message: "Line total must be a valid non-negative number.",
                    });
                    continue;
                }

                const taxAmount = invoiceLine.taxAmount
                    ? decimal(invoiceLine.taxAmount)
                    : decimal(0);

                const diffPreTax = lineTotal.minus(calculatedTotal).abs();
                const diffWithTax = lineTotal
                    .minus(calculatedTotal.plus(taxAmount))
                    .abs();

                if (diffPreTax.gt(0.05) && diffWithTax.gt(0.05)) {
                    issues.push({
                        invoiceLineId: invoiceLine.id,
                        reason: "INCONSISTENT_LINE_TOTAL",
                        message: `Invoice line total (${lineTotal}) does not match quantity * unit price (${calculatedTotal}).`,
                    });
                    continue;
                }
            } catch {
                issues.push({
                    invoiceLineId: invoiceLine.id,
                    reason: "INVALID_LINE_VALUES",
                    message: "Invoice line total is invalid.",
                });
                continue;
            }
        }

        let candidates = [];

        // Priority 1: Exact normalized item-code match
        if (invoiceItemCode) {
            candidates = balances.filter(
                ({ item }) =>
                    normalizeItemCode(item.itemCode) === invoiceItemCode
            );
        }

        // Priority 2: Normalized description match if no item-code match
        if (candidates.length === 0 && invoiceDescription) {
            candidates = balances.filter(
                ({ item }) =>
                    normalizeDescription(item.description) === invoiceDescription
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

        // Tax treatment & price validation
        if (normalizedTaxTreatment === "INCLUSIVE") {
            // An inclusive invoice unit price cannot be directly matched to a tax-exclusive PO price basis.
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "TAX_INCLUSIVE_PRICE_BASIS_MISMATCH",
                message:
                    "Invoice uses inclusive tax treatment, but its printed unit price cannot be directly matched to a tax-exclusive PO price. Manual verification of the price basis is required.",
            });
            continue;
        }

        // For EXCLUSIVE or UNKNOWN: compare pre-tax unit price against PO unit price
        const priceDifference = unitPrice.minus(item.unitPrice).abs();
        const allowedPriceDifference = item.unitPrice.mul(PO_AMOUNT_TOLERANCE);

        if (priceDifference.gt(allowedPriceDifference)) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "UNIT_PRICE_MISMATCH",
                message: `Invoice unit price (${unitPrice}) differs from PO unit price (${item.unitPrice}) by more than the allowed 2% tolerance.`,
            });
            continue;
        }

        if (!priceDifference.isZero()) {
            requiresReview = true;
        }

        // Quantity limits are strictly enforced
        if (quantity.gt(balance.remainingQuantity)) {
            issues.push({
                invoiceLineId: invoiceLine.id,
                reason: "QUANTITY_EXCEEDED",
                message: `Invoice quantity (${quantity}) exceeds the remaining PO quantity (${balance.remainingQuantity}).`,
            });
            continue;
        }

        const allocatedAmount = quantity.mul(unitPrice);

        // Check whether the amount overage is within 2% of the remaining PO amount
        const amountOverage = allocatedAmount.minus(balance.remainingAmount);

        if (amountOverage.gt(0)) {
            const allowedAmountOverage = balance.remainingAmount.mul(
                PO_AMOUNT_TOLERANCE
            );

            if (amountOverage.gt(allowedAmountOverage)) {
                issues.push({
                    invoiceLineId: invoiceLine.id,
                    reason: "AMOUNT_EXCEEDED",
                    message: "Invoice amount exceeds the remaining PO amount by more than 2%.",
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

        // Decrement balance so subsequent invoice lines cannot consume the same PO quantity
        balance.remainingQuantity = balance.remainingQuantity.minus(quantity);
        balance.remainingAmount = balance.remainingAmount.minus(allocatedAmount);
    }

    const success = issues.length === 0;
    const status =
        issues.length > 0 || requiresReview ? "NEEDS_REVIEW" : "VALID";

    return {
        success,
        status,
        requiresReview,
        issues,
        allocations: success ? proposedAllocations : [],
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
    documentType = null,
}) {
    if (!invoiceId || !purchaseOrderId) {
        return {
            success: false,
            status: "INVALID_INPUT",
            requiresReview: false,
            message: "Invoice ID and purchase order ID are required.",
            issues: [
                {
                    reason: "INVALID_INPUT",
                    message: "Invoice ID and purchase order ID are required.",
                },
            ],
            allocations: [],
        };
    }

    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        attempt++;

        try {
            return await prisma.$transaction(
                async (tx) => {
                    // 1. Concurrency control: acquire row-level locks on PurchaseOrder and POLineItems
                    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${purchaseOrderId} FOR UPDATE`;
                    await tx.$queryRaw`SELECT id FROM "POLineItem" WHERE "poId" = ${purchaseOrderId} FOR UPDATE`;

                    // 2. Fetch invoice with line items
                    const invoice = await tx.invoice.findUnique({
                        where: { id: invoiceId },
                        include: { items: true },
                    });

                    if (!invoice) {
                        return {
                            success: false,
                            status: "INVOICE_NOT_FOUND",
                            requiresReview: false,
                            message: "Invoice does not exist.",
                            issues: [
                                {
                                    reason: "INVOICE_NOT_FOUND",
                                    message: "Invoice does not exist.",
                                },
                            ],
                            allocations: [],
                        };
                    }

                    // 3. Document classification check
                    let docType = documentType;
                    if (!docType) {
                        const run = await tx.processingRun.findFirst({
                            where: { invoiceId },
                            orderBy: { attempt: "desc" },
                            select: { normalizedData: true },
                        });
                        docType = run?.normalizedData?.documentType ?? "INVOICE";
                    }

                    if (
                        docType === "CREDIT_NOTE" ||
                        docType === "CORRECTED_INVOICE"
                    ) {
                        return {
                            success: true,
                            status: "SKIPPED",
                            requiresReview: false,
                            message: `PO allocation is not performed for ${docType} documents.`,
                            allocationCount: 0,
                            allocations: [],
                        };
                    }

                    if (docType !== "INVOICE") {
                        return {
                            success: false,
                            status: "INVALID_INPUT",
                            requiresReview: false,
                            message: `PO allocation is not performed for ${docType} documents.`,
                            issues: [
                                {
                                    reason: "UNSUPPORTED_DOCUMENT_TYPE",
                                    message: `PO allocation is not performed for ${docType} documents.`,
                                },
                            ],
                            allocationCount: 0,
                            allocations: [],
                        };
                    }

                    // 4. Validate invoice items
                    if (!invoice.items || invoice.items.length === 0) {
                        return {
                            success: false,
                            status: "INVALID_INPUT",
                            requiresReview: false,
                            message: "Invoice has no line items to allocate.",
                            issues: [
                                {
                                    reason: "NO_INVOICE_LINES",
                                    message: "Invoice has no line items to allocate.",
                                },
                            ],
                            allocations: [],
                        };
                    }

                    // 5. Validate vendor matching
                    if (!invoice.vendorId) {
                        return {
                            success: false,
                            status: "INVALID_INPUT",
                            requiresReview: false,
                            message: "Invoice vendor is not matched.",
                            issues: [
                                {
                                    reason: "VENDOR_NOT_MATCHED",
                                    message: "Invoice vendor is not matched.",
                                },
                            ],
                            allocations: [],
                        };
                    }

                    // 6. Fetch and validate purchase order
                    const purchaseOrder = await tx.purchaseOrder.findUnique({
                        where: { id: purchaseOrderId },
                    });

                    if (!purchaseOrder) {
                        return {
                            success: false,
                            status: "PO_NOT_FOUND",
                            requiresReview: false,
                            message: "Purchase order does not exist.",
                            issues: [
                                {
                                    reason: "PO_NOT_FOUND",
                                    message: "Purchase order does not exist.",
                                },
                            ],
                            allocations: [],
                        };
                    }

                    // 7. Validate vendor matching between invoice and PO
                    if (invoice.vendorId !== purchaseOrder.vendorId) {
                        return {
                            success: false,
                            status: "VENDOR_MISMATCH",
                            requiresReview: false,
                            message:
                                "Invoice and purchase order belong to different vendors.",
                            issues: [
                                {
                                    reason: "VENDOR_MISMATCH",
                                    message:
                                        "Invoice and purchase order belong to different vendors.",
                                },
                            ],
                            allocations: [],
                        };
                    }

                    // 8. Validate currency matching between invoice and PO
                    if (
                        invoice.currency &&
                        purchaseOrder.currency &&
                        invoice.currency !== purchaseOrder.currency
                    ) {
                        return {
                            success: false,
                            status: "CURRENCY_MISMATCH",
                            requiresReview: false,
                            message: `Invoice currency (${invoice.currency}) differs from PO currency (${purchaseOrder.currency}).`,
                            issues: [
                                {
                                    reason: "CURRENCY_MISMATCH",
                                    message: `Invoice currency (${invoice.currency}) differs from PO currency (${purchaseOrder.currency}).`,
                                },
                            ],
                            allocations: [],
                        };
                    }

                    // 9. PO conflict check
                    if (
                        invoice.poId &&
                        invoice.poId !== purchaseOrderId
                    ) {
                        return {
                            success: false,
                            status: "PO_CONFLICT",
                            requiresReview: false,
                            message:
                                "Invoice is already linked to a different purchase order.",
                            issues: [
                                {
                                    reason: "PO_CONFLICT",
                                    message:
                                        "Invoice is already linked to a different purchase order.",
                                },
                            ],
                            allocations: [],
                        };
                    }

// 10. Idempotency & existing allocation validation

    const existingAllocations = await tx.pOAllocation.findMany({
        where: { invoiceId },
        include: {
            poLineItem: {
                select: {
                    id: true,
                    poId: true,
                    itemCode: true,
                    description: true,
                },
            },
        },
    });

if (existingAllocations.length > 0) {
    const issues = [];

    if (invoice.poId !== purchaseOrderId) {
        issues.push({
            reason: "PO_CONFLICT",
            message: "Existing allocations do not match the invoice PO.",
        });
    }

    // Fetch every PO line, not just lines with existing allocations.
    const poLines = await tx.pOLineItem.findMany({
        where: { poId: purchaseOrderId },
        select: {
            id: true,
            poId: true,
            itemCode: true,
            description: true,
        },
    });

    const invoiceLineMap = new Map(
        invoice.items.map((line) => [line.id, line])
    );

    const allocationMap = new Map();

    for (const allocation of existingAllocations) {
        const line = invoiceLineMap.get(
            allocation.invoiceLineItemId
        );

        const poLine = allocation.poLineItem;

        if (
            !line ||
            allocation.purchaseOrderId !== purchaseOrderId ||
            !poLine ||
            poLine.poId !== purchaseOrderId
        ) {
            issues.push({
                invoiceLineItemId: allocation.invoiceLineItemId,
                reason: "INVALID_EXISTING_ALLOCATION",
                message:
                    "An existing allocation has an invalid relationship.",
            });
            continue;
        }

        const invoiceItemCode = normalizeItemCode(line.itemCode);
        const invoiceDescription = normalizeDescription(
            line.description
        );

        // Match using the same priority as the allocation planner.
        let candidates = [];

        if (invoiceItemCode) {
            candidates = poLines.filter(
                (item) =>
                    normalizeItemCode(item.itemCode) === invoiceItemCode
            );
        }

        if (candidates.length === 0 && invoiceDescription) {
            candidates = poLines.filter(
                (item) =>
                    normalizeDescription(item.description) ===
                    invoiceDescription
            );
        }

        if (candidates.length === 0) {
            issues.push({
                invoiceLineItemId: line.id,
                reason: "PO_LINE_NOT_FOUND",
                message:
                    "No matching PO line exists for the invoice item.",
            });
            continue;
        }

        if (candidates.length > 1) {
            issues.push({
                invoiceLineItemId: line.id,
                reason: "AMBIGUOUS_PO_LINE",
                message:
                    "Multiple PO lines match the invoice item.",
            });
            continue;
        }

        if (candidates[0].id !== poLine.id) {
            issues.push({
                invoiceLineItemId: line.id,
                reason: "INVALID_EXISTING_ALLOCATION",
                message:
                    "Existing allocation references a PO line that does not match the planner's selected line.",
            });
            continue;
        }

        const current = allocationMap.get(line.id) || {
            quantity: decimal(0),
            amount: decimal(0),
        };

        current.quantity = current.quantity.plus(
            allocation.allocatedQuantity
        );

        current.amount = current.amount.plus(
            allocation.allocatedAmount
        );

        allocationMap.set(line.id, current);
    }

    // Verify complete quantity and amount coverage.
    for (const line of invoice.items) {
        const allocated = allocationMap.get(line.id);

        if (!allocated) {
            issues.push({
                invoiceLineItemId: line.id,
                reason: "INCOMPLETE_EXISTING_ALLOCATION",
                message: "Invoice line has no valid existing allocation.",
            });
            continue;
        }

        const expectedQuantity = decimal(line.quantity);
        const expectedAmount = expectedQuantity.mul(
            decimal(line.unitPrice)
        );

        if (
            !allocated.quantity.eq(expectedQuantity) ||
            allocated.amount.minus(expectedAmount).abs().gt("0.01")
        ) {
            issues.push({
                invoiceLineItemId: line.id,
                reason: "INCONSISTENT_EXISTING_ALLOCATION",
                message:
                    "Existing allocation quantity or amount does not match the invoice line.",
            });
        }
    }

    if (issues.length > 0) {
        return {
            success: false,
            status: "NEEDS_REVIEW",
            requiresReview: true,
            message:
                "Existing allocations require manual verification.",
            issues,
            allocations: [],
        };
    }

    return {
        success: true,
        status: "ALLOCATED",
        requiresReview: false,
        message:
            "Invoice lines are already fully allocated to this purchase order.",
        allocationCount: existingAllocations.length,
        allocations: existingAllocations,
    };
}

                    // 11. PO status eligibility check
                    if (
                        !["OPEN", "PARTIALLY_INVOICED"].includes(
                            purchaseOrder.status
                        )
                    ) {
                        return {
                            success: false,
                            status: "NOT_ELIGIBLE",
                            requiresReview: false,
                            message: `Purchase order is not eligible for allocation (status: ${purchaseOrder.status}).`,
                            issues: [
                                {
                                    reason: "PO_NOT_ELIGIBLE",
                                    message: `Purchase order is not eligible for allocation (status: ${purchaseOrder.status}).`,
                                },
                            ],
                            allocations: [],
                        };
                    }

                    // 12. Build deterministic allocation plan inside the transaction
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
                            allocations: [],
                        };
                    }

                    // 13. Persist allocations
                    for (const allocation of plan.allocations) {
                        await tx.pOAllocation.create({
                            data: allocation,
                        });
                    }

                    // 14. Link invoice to purchase order
                    await tx.invoice.update({
                        where: { id: invoiceId },
                        data: { poId: purchaseOrderId },
                    });

                    // 15. Re-evaluate PO status
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
                    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
                    timeout: 15000,
                }
            );
        } catch (error) {
            // Handle serialization or deadlock conflicts with retry
            if (
                (error.code === "P2034" ||
                    error.code === "40001" ||
                    error.code === "40P01") &&
                attempt < MAX_RETRIES
            ) {
                await new Promise((resolve) =>
                    setTimeout(resolve, 50 * attempt)
                );
                continue;
            }

            if (error.code === "P2034") {
                return {
                    success: false,
                    status: "CONCURRENT_ALLOCATION_CONFLICT",
                    requiresReview: false,
                    message:
                        "Another transaction changed PO allocations. Retry the operation.",
                    issues: [
                        {
                            reason: "CONCURRENT_ALLOCATION_CONFLICT",
                            message:
                                "Another transaction changed PO allocations. Retry the operation.",
                        },
                    ],
                    allocations: [],
                };
            }

            if (error.code === "P2002") {
                return {
                    success: false,
                    status: "ALLOCATION_CONFLICT",
                    requiresReview: false,
                    message: "A duplicate allocation already exists.",
                    issues: [
                        {
                            reason: "ALLOCATION_CONFLICT",
                            message: "A duplicate allocation already exists.",
                        },
                    ],
                    allocations: [],
                };
            }

            throw error;
        }
    }
}
