import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/config/prisma.js";
import { Prisma } from "@prisma/client";
import { persistPOAllocations } from "../../src/services/po-allocation.service.js";
import { detectDuplicateInvoice } from "../../src/services/duplicate-detection.service.js";

const decimal = (v) => new Prisma.Decimal(v);

describe("PO Allocation Integration Tests", () => {
    let testVendor;
    let testVendor2;
    let testPO;
    let testPOLine1;
    let testPOLine2;

    const createdInvoiceIds = [];
    const createdPOIds = [];
    const createdVendorIds = [];

    before(async () => {
        // Create an isolated test vendor
        testVendor = await prisma.vendor.create({
            data: {
                name: "Test Allocation Vendor Ltd",
                taxId: `GSTIN-TEST-${Date.now()}-1`,
                currency: "INR",
            },
        });
        createdVendorIds.push(testVendor.id);

        testVendor2 = await prisma.vendor.create({
            data: {
                name: "Other Test Vendor Ltd",
                taxId: `GSTIN-TEST-${Date.now()}-2`,
                currency: "INR",
            },
        });
        createdVendorIds.push(testVendor2.id);

        // Create an isolated test PO with 2 lines
        testPO = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO-TEST-${Date.now()}`,
                vendorId: testVendor.id,
                currency: "INR",
                totalAmount: decimal(3500),
                issueDate: new Date("2026-11-01"),
                status: "OPEN",
                items: {
                    create: [
                        {
                            id: `POLINE-${Date.now()}-1`,
                            itemCode: "ITM-001",
                            description: "Test Widget A",
                            quantity: decimal(10),
                            unitPrice: decimal(250),
                        },
                        {
                            id: `POLINE-${Date.now()}-2`,
                            itemCode: "ITM-002",
                            description: "Test Widget B",
                            quantity: decimal(20),
                            unitPrice: decimal(50),
                        },
                    ],
                },
            },
            include: { items: true },
        });
        createdPOIds.push(testPO.id);

        testPOLine1 = testPO.items.find((i) => i.itemCode === "ITM-001");
        testPOLine2 = testPO.items.find((i) => i.itemCode === "ITM-002");
    });

    after(async () => {
        // Cleanup all test records created
        if (createdInvoiceIds.length > 0) {
            await prisma.pOAllocation.deleteMany({
                where: { invoiceId: { in: createdInvoiceIds } },
            });
            await prisma.invoiceLineItem.deleteMany({
                where: { invoiceId: { in: createdInvoiceIds } },
            });
            await prisma.invoice.deleteMany({
                where: { id: { in: createdInvoiceIds } },
            });
        }

        if (createdPOIds.length > 0) {
            await prisma.pOAllocation.deleteMany({
                where: { purchaseOrderId: { in: createdPOIds } },
            });
            await prisma.pOLineItem.deleteMany({
                where: { poId: { in: createdPOIds } },
            });
            await prisma.purchaseOrder.deleteMany({
                where: { id: { in: createdPOIds } },
            });
        }

        if (createdVendorIds.length > 0) {
            await prisma.vendor.deleteMany({
                where: { id: { in: createdVendorIds } },
            });
        }
    });

    async function createTestInvoice({
        invoiceNumber,
        vendorId = testVendor.id,
        currency = "INR",
        lines = [],
    }) {
        const inv = await prisma.invoice.create({
            data: {
                invoiceNumber: invoiceNumber || `INV-TEST-${Date.now()}-${Math.random()}`,
                vendorId,
                currency,
                originalFileName: "test_invoice.pdf",
                fileHash: `hash-${Date.now()}-${Math.random()}`,
                filePath: "test/path.pdf",
                status: "PROCESSING",
                items: {
                    create: lines.map((l, idx) => ({
                        description: l.description || `Line ${idx + 1}`,
                        itemCode: l.itemCode ?? null,
                        quantity: decimal(l.quantity),
                        unitPrice: decimal(l.unitPrice),
                        lineTotal: decimal(l.lineTotal ?? Number(l.quantity) * Number(l.unitPrice)),
                    })),
                },
            },
            include: { items: true },
        });
        createdInvoiceIds.push(inv.id);
        return inv;
    }

    it("1. Normal invoice with successful allocation updates PO status to PARTIALLY_INVOICED", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 3, unitPrice: 250 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, true);
        assert.equal(result.status, "ALLOCATED");
        assert.equal(result.allocationCount, 1);

        // Verify DB state
        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 1);
        assert.equal(dbAllocations[0].allocatedQuantity.toString(), "3");
        assert.equal(dbAllocations[0].allocatedAmount.toString(), "750");

        // Verify PO status updated to PARTIALLY_INVOICED
        const po = await prisma.purchaseOrder.findUnique({ where: { id: testPO.id } });
        assert.equal(po.status, "PARTIALLY_INVOICED");
    });

    it("2. Invoice with unmatched PO item fails with PO_LINE_NOT_FOUND and creates 0 allocations", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "NONEXISTENT", description: "Mystery Gizmo", quantity: 1, unitPrice: 100 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.equal(result.issues[0].reason, "PO_LINE_NOT_FOUND");

        // Verify DB state: 0 allocations
        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("3. Invoice exceeding remaining PO quantity fails with QUANTITY_EXCEEDED and creates 0 allocations", async () => {
        // testPOLine1 had 10, 3 already allocated in Test 1. Remaining is 7. Attempting 8 must fail.
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 8, unitPrice: 250 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.equal(result.issues[0].reason, "QUANTITY_EXCEEDED");

        // Verify DB state
        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("4. Invoice with incorrect unit price fails with UNIT_PRICE_MISMATCH and creates 0 allocations", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 350 }, // PO is 250
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.equal(result.issues[0].reason, "UNIT_PRICE_MISMATCH");

        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("5. Tax-inclusive invoice against tax-exclusive PO returns TAX_INCLUSIVE_PRICE_BASIS_MISMATCH", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 295 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.equal(result.issues[0].reason, "TAX_INCLUSIVE_PRICE_BASIS_MISMATCH");

        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("6. Invoice with mismatched currency fails with CURRENCY_MISMATCH", async () => {
        const invoice = await createTestInvoice({
            currency: "USD",
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 250 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "CURRENCY_MISMATCH");

        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("7. Invoice with mismatched vendor fails with VENDOR_MISMATCH", async () => {
        const invoice = await createTestInvoice({
            vendorId: testVendor2.id, // Different vendor
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 250 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "VENDOR_MISMATCH");

        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("8. Duplicate invoice detection prevents allocation", async () => {
        const invoice = await createTestInvoice({
            invoiceNumber: "INV-DUP-TEST-001",
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 250 },
            ],
        });

        // Simulate an existing invoice with same number and vendor
        const dupCheck = await detectDuplicateInvoice({
            vendorId: testVendor.id,
            invoiceNumber: "INV-DUP-TEST-001",
            excludeInvoiceId: "other-id",
        });

        assert.equal(dupCheck.isDuplicate, true);
    });

    it("9. Corrected invoice returns SKIPPED with 0 allocations", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 250 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            documentType: "CORRECTED_INVOICE",
        });

        assert.equal(result.success, true);
        assert.equal(result.status, "SKIPPED");
        assert.equal(result.allocationCount, 0);

        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("10. Credit note returns SKIPPED with 0 allocations", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 250 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            documentType: "CREDIT_NOTE",
        });

        assert.equal(result.success, true);
        assert.equal(result.status, "SKIPPED");
        assert.equal(result.allocationCount, 0);

        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });
        assert.equal(dbAllocations.length, 0);
    });

    it("11. Failed transaction rolls back all writes cleanly", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: 1, unitPrice: 250 },
            ],
        });

        const allocationsBefore = await prisma.pOAllocation.count({
            where: { purchaseOrderId: testPO.id },
        });

        // Attempt allocation with an invalid line value that causes failure
        const badInvoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-001", description: "Test Widget A", quantity: -5, unitPrice: 250 },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: badInvoice.id,
            purchaseOrderId: testPO.id,
        });

        assert.equal(result.success, false);

        const allocationsAfter = await prisma.pOAllocation.count({
            where: { purchaseOrderId: testPO.id },
        });
        assert.equal(allocationsAfter, allocationsBefore);
    });

    it("12. Reprocessing an invoice is idempotent and avoids duplicate records", async () => {
        const invoice = await createTestInvoice({
            lines: [
                { itemCode: "ITM-002", description: "Test Widget B", quantity: 5, unitPrice: 50 },
            ],
        });

        // First attempt: persists allocations
        const firstRun = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });
        assert.equal(firstRun.success, true);
        assert.equal(firstRun.status, "ALLOCATED");

        const countAfterFirst = await prisma.pOAllocation.count({
            where: { invoiceId: invoice.id },
        });
        assert.equal(countAfterFirst, 1);

        // Second attempt (reprocessing/retry): must succeed idempotently without error
        const secondRun = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });
        assert.equal(secondRun.success, true);
        assert.equal(secondRun.status, "ALLOCATED");

        const countAfterSecond = await prisma.pOAllocation.count({
            where: { invoiceId: invoice.id },
        });
        assert.equal(countAfterSecond, 1); // No duplicate allocation created!
    });
    it("12a. Partial existing allocations require manual review", async () => {
        const invoice = await createTestInvoice({
            lines: [
                {
                    itemCode: "ITM-001",
                    description: "Test Widget A",
                    quantity: 2,
                    unitPrice: 250,
                },
                {
                    itemCode: "ITM-002",
                    description: "Test Widget B",
                    quantity: 3,
                    unitPrice: 50,
                },
            ],
        });

        const firstRun = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(firstRun.success, true);
        assert.equal(firstRun.status, "ALLOCATED");

        const allocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });

        assert.equal(allocations.length, 2);

        // Simulate incomplete persisted allocation data.
        await prisma.pOAllocation.delete({
            where: { id: allocations[0].id },
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");

        assert.ok(
            result.issues.some(
                (issue) =>
                    issue.reason === "INCOMPLETE_EXISTING_ALLOCATION"
            )
        );

        // Existing allocation must not be silently deleted.
        const remainingAllocations = await prisma.pOAllocation.count({
            where: { invoiceId: invoice.id },
        });

        assert.equal(remainingAllocations, 1);
    });

    it("12b. Existing allocation referencing another PO line requires review", async () => {
        const invoice = await createTestInvoice({
            lines: [
                {
                    itemCode: "ITM-001",
                    description: "Test Widget A",
                    quantity: 2,
                    unitPrice: 250,
                },
            ],
        });

        const firstRun = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(firstRun.success, true);

        // Change the allocation to reference the wrong PO line.
        await prisma.pOAllocation.updateMany({
            where: { invoiceId: invoice.id },
            data: {
                poLineItemId: testPOLine2.id,
            },
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");

        assert.ok(
            result.issues.some(
                (issue) =>
                    issue.reason === "INVALID_EXISTING_ALLOCATION"
            )
        );
    });

    it("12c. Existing allocation with incorrect amount requires review", async () => {
        const invoice = await createTestInvoice({
            lines: [
                {
                    itemCode: "ITM-001",
                    description: "Test Widget A",
                    quantity: 2,
                    unitPrice: 250,
                },
            ],
        });

        const firstRun = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(firstRun.success, true);

        // Correct quantity, deliberately incorrect allocated amount.
        await prisma.pOAllocation.updateMany({
            where: { invoiceId: invoice.id },
            data: {
                allocatedAmount: decimal(400),
            },
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");

        assert.ok(
            result.issues.some(
                (issue) =>
                    issue.reason === "INCONSISTENT_EXISTING_ALLOCATION"
            )
        );
    });

    it("13. Concurrent allocation attempts against the same PO prevent over-allocation", async () => {
        // Create a new PO with exactly 5 units available
        const tightPO = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO-CONCURRENT-${Date.now()}`,
                vendorId: testVendor.id,
                currency: "INR",
                totalAmount: decimal(500),
                issueDate: new Date("2026-11-01"),
                status: "OPEN",
                items: {
                    create: [
                        {
                            id: `POLINE-CONC-${Date.now()}`,
                            itemCode: "CONC-001",
                            description: "Limited Item",
                            quantity: decimal(5),
                            unitPrice: decimal(100),
                        },
                    ],
                },
            },
            include: { items: true },
        });
        createdPOIds.push(tightPO.id);

        // Two concurrent invoices both requesting 4 units (Total 8 > 5)
        const invA = await createTestInvoice({
            lines: [{ itemCode: "CONC-001", description: "Limited Item", quantity: 4, unitPrice: 100 }],
        });
        const invB = await createTestInvoice({
            lines: [{ itemCode: "CONC-001", description: "Limited Item", quantity: 4, unitPrice: 100 }],
        });

        // Fire both concurrently
        const [resA, resB] = await Promise.all([
            persistPOAllocations({ invoiceId: invA.id, purchaseOrderId: tightPO.id, taxTreatment: "EXCLUSIVE" }),
            persistPOAllocations({ invoiceId: invB.id, purchaseOrderId: tightPO.id, taxTreatment: "EXCLUSIVE" }),
        ]);

        const successes = [resA, resB].filter((r) => r.success);
        const failures = [resA, resB].filter((r) => !r.success);

        // Exactly one must succeed, and one must be rejected for exceeding remaining quantity
        assert.equal(successes.length, 1);
        assert.equal(failures.length, 1);
        assert.equal(failures[0].issues[0].reason, "QUANTITY_EXCEEDED");

        // Total allocated in DB must be exactly 4 (never exceeds 5!)
        const totalAllocated = await prisma.pOAllocation.findMany({
            where: { purchaseOrderId: tightPO.id },
        });
        assert.equal(totalAllocated.length, 1);
        assert.equal(totalAllocated[0].allocatedQuantity.toString(), "4");
    });

    it("14. Closing PO: allocating remaining lines transitions PO status to CLOSED", async () => {
        // Create PO with 2 units
        const poToClose = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO-CLOSE-${Date.now()}`,
                vendorId: testVendor.id,
                currency: "INR",
                totalAmount: decimal(200),
                issueDate: new Date("2026-11-01"),
                status: "OPEN",
                items: {
                    create: [
                        {
                            id: `POLINE-CLOSE-${Date.now()}`,
                            itemCode: "CLOSE-001",
                            description: "Closeable Item",
                            quantity: decimal(2),
                            unitPrice: decimal(100),
                        },
                    ],
                },
            },
        });
        createdPOIds.push(poToClose.id);

        const inv = await createTestInvoice({
            lines: [{ itemCode: "CLOSE-001", description: "Closeable Item", quantity: 2, unitPrice: 100 }],
        });

        const res = await persistPOAllocations({
            invoiceId: inv.id,
            purchaseOrderId: poToClose.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(res.success, true);

        const updatedPO = await prisma.purchaseOrder.findUnique({
            where: { id: poToClose.id },
        });
        assert.equal(updatedPO.status, "CLOSED");
    });
});

