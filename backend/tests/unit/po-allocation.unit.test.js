import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
    normalizeItemCode,
    normalizeDescription,
    buildAllocationPlanWithClient,
} from "../../src/services/po-allocation.service.js";

const decimal = (v) => new Prisma.Decimal(v);

function createMockPO({
    id = "po-1",
    poNumber = "PO-2026-1003",
    items = [],
} = {}) {
    return {
        id,
        poNumber,
        vendorId: "v-1",
        currency: "INR",
        status: "OPEN",
        totalAmount: decimal(10000),
        items: items.map((item, idx) => ({
            id: item.id || `poi-${idx + 1}`,
            poId: id,
            itemCode: item.itemCode ?? null,
            description: item.description || `Item ${idx + 1}`,
            quantity: decimal(item.quantity ?? 10),
            unitPrice: decimal(item.unitPrice ?? 100),
            allocations: (item.allocations || []).map((alloc, aIdx) => ({
                id: alloc.id || `alloc-${aIdx + 1}`,
                invoiceId: alloc.invoiceId || "other-inv",
                allocatedQuantity: decimal(alloc.allocatedQuantity ?? 0),
                allocatedAmount: decimal(alloc.allocatedAmount ?? 0),
            })),
        })),
    };
}

function createMockDb(poData) {
    return {
        purchaseOrder: {
            findUnique: async () => poData,
        },
    };
}

describe("PO Allocation Unit Tests", () => {
    describe("1. Identifiers Normalization", () => {
        it("normalizes item codes correctly", () => {
            assert.equal(normalizeItemCode("  pap-001  "), "PAP001");
            assert.equal(normalizeItemCode("item_#123-abc"), "ITEM123ABC");
            assert.equal(normalizeItemCode("ABC 123"), "ABC123");
            assert.equal(normalizeItemCode(""), null);
            assert.equal(normalizeItemCode(null), null);
            assert.equal(normalizeItemCode(undefined), null);
        });

        it("normalizes descriptions correctly", () => {
            assert.equal(
                normalizeDescription("  A4  Paper   Ream  "),
                "A4 PAPER REAM"
            );
            assert.equal(
                normalizeDescription("Office-Files (Pack of 10)"),
                "OFFICE FILES PACK OF 10"
            );
            assert.equal(normalizeDescription(""), null);
            assert.equal(normalizeDescription(null), null);
        });
    });

    describe("2. Item Matching Priority", () => {
        it("Priority 1: Matches on exact normalized item-code", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 10, unitPrice: 250 },
                    { id: "poi-2", itemCode: "PEN-001", description: "Ball Pens", quantity: 20, unitPrice: 10 },
                ],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "pap001", description: "Different Description", quantity: 2, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, true);
            assert.equal(plan.allocations.length, 1);
            assert.equal(plan.allocations[0].poLineItemId, "poi-1");
        });

        it("Priority 2: Falls back to normalized description if item-code does not match", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 10, unitPrice: 250 },
                ],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "UNKNOWN-CODE", description: "a4 paper ream", quantity: 2, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, true);
            assert.equal(plan.allocations.length, 1);
            assert.equal(plan.allocations[0].poLineItemId, "poi-1");
        });

        it("Fails with PO_LINE_NOT_FOUND when no matching PO item exists", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 10, unitPrice: 250 },
                ],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "LAP-999", description: "Gaming Laptop", quantity: 1, unitPrice: 50000 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, false);
            assert.equal(plan.status, "NEEDS_REVIEW");
            assert.equal(plan.issues[0].reason, "PO_LINE_NOT_FOUND");
            assert.equal(plan.allocations.length, 0);
        });

        it("Fails with AMBIGUOUS_PO_LINE when multiple PO lines match the same invoice line", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 10, unitPrice: 250 },
                    { id: "poi-2", itemCode: "PAP-001", description: "A4 Paper Ream Batch 2", quantity: 10, unitPrice: 250 },
                ],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 2, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, false);
            assert.equal(plan.status, "NEEDS_REVIEW");
            assert.equal(plan.issues[0].reason, "AMBIGUOUS_PO_LINE");
            assert.equal(plan.allocations.length, 0);
        });

        it("Fails with MISSING_ITEM_INFORMATION when invoice line has neither item code nor description", async () => {
            const po = createMockPO({
                items: [{ id: "poi-1", itemCode: "PAP-001", description: "A4 Paper", quantity: 10, unitPrice: 250 }],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: null, description: "   ", quantity: 2, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, false);
            assert.equal(plan.issues[0].reason, "MISSING_ITEM_INFORMATION");
        });
    });

    describe("3. Quantity Validation & Consumption", () => {
        it("allocates exact quantity successfully", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 5, unitPrice: 250 },
                ],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 5, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, true);
            assert.equal(plan.allocations[0].allocatedQuantity.toString(), "5");
            assert.equal(plan.allocations[0].allocatedAmount.toString(), "1250");
        });

        it("allocates partial quantity successfully", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 10, unitPrice: 250 },
                ],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 4, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, true);
            assert.equal(plan.allocations[0].allocatedQuantity.toString(), "4");
            assert.equal(plan.allocations[0].allocatedAmount.toString(), "1000");
        });

        it("fails with QUANTITY_EXCEEDED when invoice quantity exceeds available PO quantity", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 5, unitPrice: 250 },
                ],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 6, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, false);
            assert.equal(plan.status, "NEEDS_REVIEW");
            assert.equal(plan.issues[0].reason, "QUANTITY_EXCEEDED");
            assert.equal(plan.allocations.length, 0);
        });

        it("respects previously allocated quantities from other invoices", async () => {
            const po = createMockPO({
                items: [
                    {
                        id: "poi-1",
                        itemCode: "PAP-001",
                        description: "A4 Paper Ream",
                        quantity: 10,
                        unitPrice: 250,
                        allocations: [
                            { invoiceId: "prior-inv-1", allocatedQuantity: 7, allocatedAmount: 1750 },
                        ],
                    },
                ],
            });
            const db = createMockDb(po);

            // Remaining is 3. Attempting 4 must fail.
            const planExceeded = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 4, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });
            assert.equal(planExceeded.success, false);
            assert.equal(planExceeded.issues[0].reason, "QUANTITY_EXCEEDED");

            // Attempting 3 must succeed.
            const planExact = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 3, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });
            assert.equal(planExact.success, true);
            assert.equal(planExact.allocations[0].allocatedQuantity.toString(), "3");
        });

        it("prevents multiple invoice lines from consuming the same PO quantity twice", async () => {
            const po = createMockPO({
                items: [
                    { id: "poi-1", itemCode: "PAP-001", description: "A4 Paper Ream", quantity: 10, unitPrice: 250 },
                ],
            });
            const db = createMockDb(po);

            // Line 1 asks for 6, Line 2 asks for 6 (Total: 12 > 10)
            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 6, unitPrice: 250 },
                    { id: "inv-l2", itemCode: "PAP-001", quantity: 6, unitPrice: 250 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, false);
            assert.equal(plan.issues.length, 1);
            assert.equal(plan.issues[0].reason, "QUANTITY_EXCEEDED");
            assert.equal(plan.issues[0].invoiceLineId, "inv-l2");
            assert.equal(plan.allocations.length, 0); // No partial allocation returned
        });
    });

    describe("4. Unit-Price Validation & Tolerance", () => {
        it("approves exact unit-price match", async () => {
            const po = createMockPO({
                items: [{ id: "poi-1", itemCode: "PAP-001", quantity: 1, unitPrice: 250 }],
            });
            const db = createMockDb(po);

            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [{ id: "inv-l1", itemCode: "PAP-001", quantity: 1, unitPrice: 250 }],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, true);
            assert.equal(plan.status, "VALID");
            assert.equal(plan.requiresReview, false);
        });

        it("allows small price difference within 2% tolerance but sets requiresReview = true", async () => {
            const po = createMockPO({
                items: [{ id: "poi-1", itemCode: "PAP-001", quantity: 1, unitPrice: 250 }],
            });
            const db = createMockDb(po);

            // 2% of 250 is 5. Price of 254 is within tolerance (+1.6%)
            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [{ id: "inv-l1", itemCode: "PAP-001", quantity: 1, unitPrice: 254 }],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, true);
            assert.equal(plan.status, "NEEDS_REVIEW");
            assert.equal(plan.requiresReview, true);
            assert.equal(plan.allocations.length, 1);
        });

        it("fails with UNIT_PRICE_MISMATCH when price difference exceeds 2% tolerance", async () => {
            const po = createMockPO({
                items: [{ id: "poi-1", itemCode: "PAP-001", quantity: 1, unitPrice: 250 }],
            });
            const db = createMockDb(po);

            // Price of 260 exceeds 250 + 5 (4% difference)
            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [{ id: "inv-l1", itemCode: "PAP-001", quantity: 1, unitPrice: 260 }],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, false);
            assert.equal(plan.status, "NEEDS_REVIEW");
            assert.equal(plan.issues[0].reason, "UNIT_PRICE_MISMATCH");
            assert.equal(plan.allocations.length, 0);
        });

        it("rejects non-positive quantity or negative unit price with INVALID_LINE_VALUES", async () => {
            const po = createMockPO({
                items: [{ id: "poi-1", itemCode: "PAP-001", quantity: 5, unitPrice: 250 }],
            });
            const db = createMockDb(po);

            const planNegativeQty = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [{ id: "inv-l1", itemCode: "PAP-001", quantity: -2, unitPrice: 250 }],
            });
            assert.equal(planNegativeQty.success, false);
            assert.equal(planNegativeQty.issues[0].reason, "INVALID_LINE_VALUES");

            const planNegativePrice = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [{ id: "inv-l2", itemCode: "PAP-001", quantity: 1, unitPrice: -50 }],
            });
            assert.equal(planNegativePrice.success, false);
            assert.equal(planNegativePrice.issues[0].reason, "INVALID_LINE_VALUES");
        });
    });

   describe("5. Tax Treatment Policy", () => {
    it("allocates inclusive-tax invoice using its derived pre-tax price", async () => {
        const po = createMockPO({
            poNumber: "PO-2026-1003",
            items: [
                {
                    id: "poi-1",
                    itemCode: "PAP-001",
                    description: "A4 Paper Ream",
                    quantity: 1,
                    unitPrice: 250,
                },
            ],
        });

        const db = createMockDb(po);

        // Gross price ₹295 = ₹250 + ₹45 GST (18%).
        const plan = await buildAllocationPlanWithClient(db, {
            purchaseOrderId: "po-1",
            invoiceLines: [
                {
                    id: "inv-l1",
                    itemCode: "PAP-001",
                    description: "A4 Paper Ream",
                    quantity: 1,
                    unitPrice: 295,
                    taxRate: 18,
                    taxAmount: 45,
                    lineTotal: 295,
                },
            ],
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(plan.success, true);
        assert.equal(plan.status, "VALID");
        assert.equal(plan.allocations.length, 1);
        assert.equal(
            plan.allocations[0].allocatedAmount.toString(),
            "250"
        );
    });

    it("rounds repeating-decimal inclusive tax allocation to currency precision", async () => {
        const po = createMockPO({
            items: [{
                id: "poi-1",
                itemCode: "PAP-001",
                quantity: 1,
                unitPrice: 84.75,
            }],
        });

        const plan = await buildAllocationPlanWithClient(createMockDb(po), {
            purchaseOrderId: "po-1",
            invoiceLines: [{
                id: "inv-l1",
                itemCode: "PAP-001",
                quantity: 1,
                unitPrice: 100,
                taxRate: 18,
                taxAmount: 15.25,
                lineTotal: 100,
            }],
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(plan.success, true);
        assert.equal(plan.allocations[0].allocatedAmount.toString(), "84.75");
    });

    it("rejects inclusive-tax invoice when tax rate is missing", async () => {
        const po = createMockPO({
            items: [
                {
                    id: "poi-1",
                    itemCode: "PAP-001",
                    quantity: 1,
                    unitPrice: 250,
                },
            ],
        });

        const db = createMockDb(po);

        const plan = await buildAllocationPlanWithClient(db, {
            purchaseOrderId: "po-1",
            invoiceLines: [
                {
                    id: "inv-l1",
                    itemCode: "PAP-001",
                    quantity: 1,
                    unitPrice: 295,
                    taxAmount: 45,
                    lineTotal: 295,
                },
            ],
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(plan.success, false);
        assert.equal(plan.status, "NEEDS_REVIEW");
        assert.equal(
            plan.issues[0].reason,
            "INVALID_TAX_INCLUSIVE_LINE"
        );
        assert.equal(plan.allocations.length, 0);
    });

    it("rejects inclusive-tax invoice when tax amount does not reconcile", async () => {
        const po = createMockPO({
            items: [
                {
                    id: "poi-1",
                    itemCode: "PAP-001",
                    quantity: 1,
                    unitPrice: 250,
                },
            ],
        });

        const db = createMockDb(po);

        const plan = await buildAllocationPlanWithClient(db, {
            purchaseOrderId: "po-1",
            invoiceLines: [
                {
                    id: "inv-l1",
                    itemCode: "PAP-001",
                    quantity: 1,
                    unitPrice: 295,
                    taxRate: 18,
                    taxAmount: 50,
                    lineTotal: 295,
                },
            ],
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(plan.success, false);
        assert.equal(plan.status, "NEEDS_REVIEW");
        assert.equal(
            plan.issues[0].reason,
            "INVALID_TAX_INCLUSIVE_LINE"
        );
        assert.equal(plan.allocations.length, 0);
    });

    it("succeeds when invoice taxTreatment is EXCLUSIVE and pre-tax price matches PO", async () => {
        const po = createMockPO({
            poNumber: "PO-2026-1003",
            items: [
                {
                    id: "poi-1",
                    itemCode: "PAP-001",
                    description: "A4 Paper Ream",
                    quantity: 1,
                    unitPrice: 250,
                },
            ],
        });

        const db = createMockDb(po);

        const plan = await buildAllocationPlanWithClient(db, {
            purchaseOrderId: "po-1",
            invoiceLines: [
                {
                    id: "inv-l1",
                    itemCode: "PAP-001",
                    description: "A4 Paper Ream",
                    quantity: 1,
                    unitPrice: 250,
                },
            ],
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(plan.success, true);
        assert.equal(plan.status, "VALID");
        assert.equal(plan.allocations.length, 1);
        assert.equal(plan.allocations[0].allocatedAmount.toString(), "250");
    });
});
    describe("6. Line Total & Amount Validation", () => {
        it("detects INCONSISTENT_LINE_TOTAL when line total does not match quantity * unit price", async () => {
            const po = createMockPO({
                items: [{ id: "poi-1", itemCode: "PAP-001", quantity: 10, unitPrice: 250 }],
            });
            const db = createMockDb(po);

            // Quantity 2 * 250 = 500, but invoice claims lineTotal = 800
            const plan = await buildAllocationPlanWithClient(db, {
                purchaseOrderId: "po-1",
                invoiceLines: [
                    { id: "inv-l1", itemCode: "PAP-001", quantity: 2, unitPrice: 250, lineTotal: 800 },
                ],
                taxTreatment: "EXCLUSIVE",
            });

            assert.equal(plan.success, false);
            assert.equal(plan.issues[0].reason, "INCONSISTENT_LINE_TOTAL");
        });
    });
});
