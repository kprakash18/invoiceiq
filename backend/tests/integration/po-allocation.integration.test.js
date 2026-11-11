import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/config/prisma.js";
import { Prisma } from "@prisma/client";
import { persistPOAllocations } from "../../src/services/po-allocation.service.js";
import { detectDuplicateInvoice } from "../../src/services/duplicate-detection.service.js";
import { finalizeInvoiceDecision } from "../../src/services/invoice-decision.service.js";
import { matchPurchaseOrder } from "../../src/services/po-matching.service.js";

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
                        taxRate:
                            l.taxRate == null ? null : decimal(l.taxRate),
                        taxAmount:
                            l.taxAmount == null ? null : decimal(l.taxAmount),
                        lineTotal: decimal(
                            l.lineTotal ??
                                Number(l.quantity) * Number(l.unitPrice)
                        ),
                    })),
                },
            },
            include: { items: true },
        });
        createdInvoiceIds.push(inv.id);
        return inv;
    }

    async function createFinalizationRun({
        invoice,
        poMatch,
        allocationResult,
        taxTreatment = "EXCLUSIVE",
    }) {
        return prisma.processingRun.create({
            data: {
                invoiceId: invoice.id,
                status: "IN_PROGRESS",
                attempt: 1,
                normalizedData: {
                    documentType: "INVOICE",
                    currency: invoice.currency,
                    currencyCode: invoice.currency,
                    currencyStatus: "IDENTIFIED",
                    taxTreatment,
                    vendor: {
                        name: testVendor.name,
                        gstin: testVendor.taxId,
                    },
                    poNumber: poMatch.purchaseOrder?.poNumber,
                    allocationResult,
                },
                stages: {
                    create: [
                        { name: "PDF_EXTRACTION", status: "COMPLETED" },
                        { name: "VALIDATION", status: "COMPLETED" },
                        { name: "VENDOR_MATCHING", status: "COMPLETED" },
                        { name: "DUPLICATE_CHECK", status: "COMPLETED" },
                        {
                            name: "PO_MATCHING",
                            status: "COMPLETED",
                            message: poMatch.message,
                            metadata: {
                                result: poMatch.status,
                                reason: poMatch.reason,
                                purchaseOrderId:
                                    poMatch.purchaseOrder?.id ?? null,
                                currencyMatches:
                                    poMatch.status === "MATCHED" &&
                                    invoice.currency ===
                                        poMatch.purchaseOrder.currency,
                                invoiceCurrency: invoice.currency,
                                poCurrency:
                                    poMatch.purchaseOrder?.currency ?? null,
                            },
                        },
                        {
                            name: "PO_ALLOCATION",
                            status:
                                allocationResult.status === "SKIPPED"
                                    ? "SKIPPED"
                                    : "COMPLETED",
                            message: allocationResult.message,
                            metadata: {
                                result: allocationResult.status,
                                requiresReview:
                                    allocationResult.requiresReview ?? false,
                                allocationCount:
                                    allocationResult.allocationCount ?? 0,
                                issues: allocationResult.issues ?? [],
                            },
                        },
                    ],
                },
            },
        });
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

    it("5. Allocates tax-inclusive invoice against tax-exclusive PO", async () => {
        const invoice = await createTestInvoice({
            lines: [
                {
                    itemCode: "ITM-001",
                    description: "Test Widget A",
                    quantity: 1,
                    unitPrice: 295,
                    taxRate: 18,
                    taxAmount: 45,
                    lineTotal: 295,
                },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(result.success, true);
        assert.equal(result.status, "ALLOCATED");
        assert.equal(result.allocationCount, 1);

        const dbAllocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });

        assert.equal(dbAllocations.length, 1);
        assert.equal(dbAllocations[0].allocatedQuantity.toString(), "1");
        assert.equal(dbAllocations[0].allocatedAmount.toString(), "250");
    });

    it("5a. Rejects tax-inclusive invoice when tax rate is missing", async () => {
        const invoice = await createTestInvoice({
            lines: [
                {
                    itemCode: "ITM-001",
                    description: "Test Widget A",
                    quantity: 1,
                    unitPrice: 295,
                    taxAmount: 45,
                    lineTotal: 295,
                },
            ],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: testPO.id,
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.equal(result.issues[0].reason, "INVALID_TAX_INCLUSIVE_LINE");

        const allocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });

        assert.equal(allocations.length, 0);
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

    it("8. Detects formatting variations but keeps vendor scope", async () => {
        const original = await createTestInvoice({
            invoiceNumber: "INV-2026-001",
        });

        const duplicate = await createTestInvoice({
            invoiceNumber: "inv 2026 001",
        });

        const dupCheck = await detectDuplicateInvoice({
            vendorId: testVendor.id,
            invoiceNumber: duplicate.invoiceNumber,
            excludeInvoiceId: duplicate.id,
        });

        assert.equal(dupCheck.isDuplicate, true);
        assert.equal(dupCheck.reason, "DUPLICATE_VENDOR_INVOICE_NUMBER");
        assert.equal(dupCheck.duplicateInvoice.id, original.id);

        const otherVendorInvoice = await createTestInvoice({
            invoiceNumber: "INV2026001",
            vendorId: testVendor2.id,
        });

        const otherVendorCheck = await detectDuplicateInvoice({
            vendorId: testVendor2.id,
            invoiceNumber: otherVendorInvoice.invoiceNumber,
            excludeInvoiceId: otherVendorInvoice.id,
        });

        assert.equal(otherVendorCheck.isDuplicate, false);
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

    it("15. Finalization approves an invoice that closes the originally matched PO", async () => {
        const suffix = Date.now();
        const poToClose = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO-FINAL-CLOSE-${suffix}`,
                vendorId: testVendor.id,
                currency: "INR",
                totalAmount: decimal(200),
                issueDate: new Date("2026-11-01"),
                status: "OPEN",
                items: {
                    create: [
                        {
                            id: `POLINE-FINAL-CLOSE-${suffix}`,
                            itemCode: "FINAL-001",
                            description: "Final Quantity Item",
                            quantity: decimal(2),
                            unitPrice: decimal(100),
                        },
                    ],
                },
            },
        });
        createdPOIds.push(poToClose.id);

        const firstInvoice = await createTestInvoice({
            invoiceNumber: `INV-FINAL-CLOSE-001-${suffix}`,
            lines: [
                {
                    itemCode: "FINAL-001",
                    description: "Final Quantity Item",
                    quantity: 2,
                    unitPrice: 100,
                },
            ],
        });

        const originalMatch = await matchPurchaseOrder({
            vendorId: testVendor.id,
            poNumber: poToClose.poNumber,
        });

        assert.equal(originalMatch.status, "MATCHED");

        const allocation = await persistPOAllocations({
            invoiceId: firstInvoice.id,
            purchaseOrderId: poToClose.id,
            taxTreatment: "EXCLUSIVE",
        });

        assert.equal(allocation.success, true);
        assert.equal(allocation.status, "ALLOCATED");

        const closedPO = await prisma.purchaseOrder.findUnique({
            where: { id: poToClose.id },
        });
        assert.equal(closedPO.status, "CLOSED");

        const firstRun = await createFinalizationRun({
            invoice: firstInvoice,
            poMatch: originalMatch,
            allocationResult: {
                status: allocation.status,
                requiresReview: allocation.requiresReview,
                allocationCount: allocation.allocationCount,
                issues: allocation.issues ?? [],
                message: allocation.message,
            },
        });

        const firstDecision = await finalizeInvoiceDecision({
            invoiceId: firstInvoice.id,
            processingRunId: firstRun.id,
        });

        assert.equal(firstDecision.success, true);
        assert.equal(firstDecision.status, "DECISION_RECORDED");
        assert.equal(firstDecision.decision.outcome, "APPROVED");
        assert.equal(firstDecision.decision.reason, "ALL_CHECKS_PASSED");

        const approvedInvoice = await prisma.invoice.findUnique({
            where: { id: firstInvoice.id },
        });
        assert.equal(approvedInvoice.status, "APPROVED");

        const stillClosedPO = await prisma.purchaseOrder.findUnique({
            where: { id: poToClose.id },
        });
        assert.equal(stillClosedPO.status, "CLOSED");

        const secondInvoice = await createTestInvoice({
            invoiceNumber: `INV-FINAL-CLOSE-002-${suffix}`,
            lines: [
                {
                    itemCode: "FINAL-001",
                    description: "Final Quantity Item",
                    quantity: 1,
                    unitPrice: 100,
                },
            ],
        });

        const closedMatch = await matchPurchaseOrder({
            vendorId: testVendor.id,
            poNumber: poToClose.poNumber,
        });

        assert.equal(closedMatch.status, "NOT_ELIGIBLE");
        assert.equal(closedMatch.reason, "PO_STATUS_NOT_ELIGIBLE");

        const secondRun = await createFinalizationRun({
            invoice: secondInvoice,
            poMatch: closedMatch,
            allocationResult: {
                status: "SKIPPED",
                requiresReview: false,
                allocationCount: 0,
                issues: [],
                message: "PO matching or currency verification failed.",
            },
        });

        const secondDecision = await finalizeInvoiceDecision({
            invoiceId: secondInvoice.id,
            processingRunId: secondRun.id,
        });

        assert.equal(secondDecision.success, true);
        assert.equal(secondDecision.status, "DECISION_RECORDED");
        assert.equal(secondDecision.decision.outcome, "NEEDS_REVIEW");
        assert.equal(
            secondDecision.decision.reason,
            "PO_STATUS_NOT_ELIGIBLE"
        );

        const secondAllocations = await prisma.pOAllocation.count({
            where: { invoiceId: secondInvoice.id },
        });
        assert.equal(secondAllocations, 0);
    });

    it("16. Split PO invoices cannot cumulatively exceed ordered quantity", async () => {
    const splitPO = await prisma.purchaseOrder.create({
        data: {
            poNumber: `PO-SPLIT-${Date.now()}`,
            vendorId: testVendor.id,
            currency: "INR",
            totalAmount: decimal(100000),
            issueDate: new Date("2026-11-01"),
            status: "OPEN",
            items: {
                create: [{
                    id: `POLINE-SPLIT-${Date.now()}`,
                    itemCode: "SPLIT-001",
                    description: "Industrial Component",
                    quantity: decimal(100),
                    unitPrice: decimal(1000),
                }],
            },
        },
        include: { items: true },
    });

    createdPOIds.push(splitPO.id);

    const poLine = splitPO.items[0];

    async function allocateInvoice(invoiceNumber, quantity) {
        const invoice = await createTestInvoice({
            invoiceNumber,
            lines: [{
                itemCode: "SPLIT-001",
                description: "Industrial Component",
                quantity,
                unitPrice: 1000,
            }],
        });

        const result = await persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: splitPO.id,
            taxTreatment: "EXCLUSIVE",
        });

        return { invoice, result };
    }

    // First invoice: 30 of 100
    const first = await allocateInvoice("SPLIT-INV-001", 30);

    assert.equal(first.result.success, true);
    assert.equal(first.result.status, "ALLOCATED");

    // Second invoice: another 40; cumulative allocation = 70
    const second = await allocateInvoice("SPLIT-INV-002", 40);

    assert.equal(second.result.success, true);
    assert.equal(second.result.status, "ALLOCATED");

    const previousAllocations = await prisma.pOAllocation.findMany({
        where: {
            invoiceId: { in: [first.invoice.id, second.invoice.id] },
        },
    });

    assert.equal(previousAllocations.length, 2);

    const previousQuantity = previousAllocations.reduce(
        (sum, allocation) =>
            sum.plus(allocation.allocatedQuantity),
        decimal(0),
    );

    assert.equal(previousQuantity.toString(), "70");

    // Third invoice requests 35, but only 30 remain
    const third = await allocateInvoice("SPLIT-INV-003", 35);

    assert.equal(third.result.success, false);
    assert.equal(third.result.status, "NEEDS_REVIEW");
    assert.equal(third.result.issues[0].reason, "QUANTITY_EXCEEDED");

    // Failed allocation must create no records
    const thirdAllocations = await prisma.pOAllocation.findMany({
        where: { invoiceId: third.invoice.id },
    });

    assert.equal(thirdAllocations.length, 0);

    // Earlier successful allocations must remain unchanged
    const finalAllocations = await prisma.pOAllocation.findMany({
        where: {
            invoiceId: { in: [first.invoice.id, second.invoice.id] },
        },
    });

    const finalQuantity = finalAllocations.reduce(
        (sum, allocation) =>
            sum.plus(allocation.allocatedQuantity),
        decimal(0),
    );

    assert.equal(finalQuantity.toString(), "70");
});
});

