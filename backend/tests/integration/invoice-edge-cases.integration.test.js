
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/config/prisma.js";
import { persistPOAllocations } from "../../src/services/po-allocation.service.js";

describe("Invoice PO allocation edge cases", { concurrency: false }, () => {
    let vendor;
    let otherVendor;
    let po;

    const createdInvoiceIds = [];

    before(async () => {
        const suffix = `${Date.now()}-${Math.random()}`;

        vendor = await prisma.vendor.create({
            data: {
                name: `EDGE-TEST-VENDOR-${suffix}`,
                taxId: `EDGE-TAX-${suffix}`,
                currency: "INR",
            },
        });

        otherVendor = await prisma.vendor.create({
            data: {
                name: `EDGE-OTHER-VENDOR-${suffix}`,
                taxId: `OTHER-TAX-${suffix}`,
                currency: "INR",
            },
        });

        po = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO-EDGE-${suffix}`,
                vendorId: vendor.id,
                currency: "INR",
                status: "OPEN",
                totalAmount: 45000,
                issueDate: new Date(),
                items: {
                    create: [
                        {
                            itemCode: "EDGE-CHAIR",
                            description: "Test Office Chair",
                            quantity: 10,
                            unitPrice: 4500,
                        },
                    ],
                },
            },
        });
    });

    async function createInvoice({
        vendorId = vendor.id,
        currency = "INR",
        lines = [],
    } = {}) {
        const suffix = `${Date.now()}-${Math.random()}`;

        const invoice = await prisma.invoice.create({
            data: {
                invoiceNumber: `INV-EDGE-${suffix}`,
                originalFileName: `edge-test-${suffix}.pdf`,
                fileHash: `edge-hash-${suffix}`,
                filePath: `test/edge-test-${suffix}.pdf`,
                vendorId,
                currency,
                status: "PROCESSING",
                items: {
                    create: lines.map((line, index) => ({
                        description: line.description,
                        itemCode: line.itemCode ?? null,
                        quantity: line.quantity,
                        unitPrice: line.unitPrice,
                        lineTotal:
                            line.lineTotal ??
                            line.quantity * line.unitPrice,
                    })),
                },
            },
            include: { items: true },
        });

        createdInvoiceIds.push(invoice.id);
        return invoice;
    }

    async function allocate(invoice, options = {}) {
        return persistPOAllocations({
            invoiceId: invoice.id,
            purchaseOrderId: po.id,
            taxTreatment: "EXCLUSIVE",
            ...options,
        });
    }

    async function assertNoAllocations(invoiceId) {
        const count = await prisma.pOAllocation.count({
            where: { invoiceId },
        });

        assert.equal(count, 0);
    }

    it("accepts a valid PO allocation", async () => {
        const invoice = await createInvoice({
            lines: [{
                itemCode: "EDGE-CHAIR",
                description: "Test Office Chair",
                quantity: 1,
                unitPrice: 4500,
            }],
        });

        const result = await allocate(invoice);

        assert.equal(result.success, true);
        assert.equal(result.status, "ALLOCATED");
        assert.equal(result.allocationCount, 1);

        const allocations = await prisma.pOAllocation.findMany({
            where: { invoiceId: invoice.id },
        });

        assert.equal(allocations.length, 1);
        assert.equal(allocations[0].allocatedQuantity.toString(), "1");
        assert.equal(allocations[0].allocatedAmount.toString(), "4500");
    });

    it("rejects an unmatched invoice item", async () => {
        const invoice = await createInvoice({
            lines: [{
                itemCode: "UNKNOWN-ITEM",
                description: "Executive Desk",
                quantity: 1,
                unitPrice: 5000,
            }],
        });

        const result = await allocate(invoice);

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.ok(
            result.issues.some(
                issue => issue.reason === "PO_LINE_NOT_FOUND"
            )
        );

        await assertNoAllocations(invoice.id);
    });

    it("rejects quantity exceeding remaining PO quantity", async () => {
        // One unit was allocated in the first test.
        // Remaining quantity = 9.
        const invoice = await createInvoice({
            lines: [{
                itemCode: "EDGE-CHAIR",
                description: "Test Office Chair",
                quantity: 10,
                unitPrice: 4500,
            }],
        });

        const result = await allocate(invoice);

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.ok(
            result.issues.some(
                issue => issue.reason === "QUANTITY_EXCEEDED"
            )
        );

        await assertNoAllocations(invoice.id);
    });

    it("rejects unit price mismatch", async () => {
        const invoice = await createInvoice({
            lines: [{
                itemCode: "EDGE-CHAIR",
                description: "Test Office Chair",
                quantity: 1,
                unitPrice: 6000,
            }],
        });

        const result = await allocate(invoice);

        assert.equal(result.success, false);
        assert.equal(result.status, "NEEDS_REVIEW");
        assert.ok(
            result.issues.some(
                issue => issue.reason === "UNIT_PRICE_MISMATCH"
            )
        );

        await assertNoAllocations(invoice.id);
    });

    it("rejects currency mismatch", async () => {
        const invoice = await createInvoice({
            currency: "USD",
            lines: [{
                itemCode: "EDGE-CHAIR",
                description: "Test Office Chair",
                quantity: 1,
                unitPrice: 4500,
            }],
        });

        const result = await allocate(invoice);

        assert.equal(result.success, false);
        assert.equal(result.status, "CURRENCY_MISMATCH");

        await assertNoAllocations(invoice.id);
    });

    it("rejects vendor mismatch", async () => {
        const invoice = await createInvoice({
            vendorId: otherVendor.id,
            lines: [{
                itemCode: "EDGE-CHAIR",
                description: "Test Office Chair",
                quantity: 1,
                unitPrice: 4500,
            }],
        });

        const result = await allocate(invoice);

        assert.equal(result.success, false);
        assert.equal(result.status, "VENDOR_MISMATCH");

        await assertNoAllocations(invoice.id);
    });

    after(async () => {
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

        if (po?.id) {
            await prisma.pOAllocation.deleteMany({
                where: { purchaseOrderId: po.id },
            });

            await prisma.pOLineItem.deleteMany({
                where: { poId: po.id },
            });

            await prisma.purchaseOrder.delete({
                where: { id: po.id },
            });
        }

        if (vendor?.id || otherVendor?.id) {
            await prisma.vendor.deleteMany({
                where: {
                    id: {
                        in: [vendor?.id, otherVendor?.id].filter(Boolean),
                    },
                },
            });
        }

        await prisma.$disconnect();
    });
});
