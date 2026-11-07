
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/config/prisma.js";
import { finalizeInvoiceDecision } from "../../src/services/invoice-decision.service.js";

describe("Bundled invoice decision integration", { concurrency: false }, () => {
    let vendor;
    let po1;
    let po2;
    let invoice;

    after(async () => {
        if (invoice) {
            await prisma.invoice.deleteMany({
                where: { id: invoice.id },
            });
        }

        if (po1 || po2) {
            await prisma.pOAllocation.deleteMany({
                where: {
                    purchaseOrderId: {
                        in: [po1?.id, po2?.id].filter(Boolean),
                    },
                },
            });

            await prisma.pOLineItem.deleteMany({
                where: {
                    poId: { in: [po1?.id, po2?.id].filter(Boolean) },
                },
            });

            await prisma.purchaseOrder.deleteMany({
                where: {
                    id: { in: [po1?.id, po2?.id].filter(Boolean) },
                },
            });
        }

        if (vendor) {
            await prisma.vendor.deleteMany({
                where: { id: vendor.id },
            });
        }
    });

    it("does not split a bundled invoice across POs based only on matching totals", async () => {
        const suffix = `${Date.now()}-${Math.random()}`;

        vendor = await prisma.vendor.create({
            data: {
                name: `BUNDLED-TEST-VENDOR-${suffix}`,
                taxId: `BUNDLED-TAX-${suffix}`,
                currency: "INR",
            },
        });

        po1 = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO-BUNDLE-1-${suffix}`,
                vendorId: vendor.id,
                currency: "INR",
                status: "OPEN",
                totalAmount: 90000,
                issueDate: new Date("2026-11-01"),
                items: {
                    create: [{
                        description: "Server maintenance",
                        quantity: 1,
                        unitPrice: 90000,
                    }],
                },
            },
        });

        po2 = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO-BUNDLE-2-${suffix}`,
                vendorId: vendor.id,
                currency: "INR",
                status: "OPEN",
                totalAmount: 60000,
                issueDate: new Date("2026-11-01"),
                items: {
                    create: [{
                        description: "Network support",
                        quantity: 1,
                        unitPrice: 60000,
                    }],
                },
            },
        });

        invoice = await prisma.invoice.create({
            data: {
                invoiceNumber: `INV-BUNDLE-${suffix}`,
                originalFileName: "bundled-invoice.pdf",
                fileHash: `bundle-hash-${suffix}`,
                filePath: "test/bundled-invoice.pdf",
                vendorId: vendor.id,
                currency: "INR",
                status: "PROCESSING",
                invoiceDate: new Date("2026-11-07"),
                items: {
                    create: [{
                        description: "Annual IT infrastructure package",
                        quantity: 1,
                        unitPrice: 150000,
                        lineTotal: 150000,
                    }],
                },
            },
        });

        const processingRun = await prisma.processingRun.create({
            data: {
                invoiceId: invoice.id,
                status: "IN_PROGRESS",
                attempt: 1,
                normalizedData: {
                    documentType: "INVOICE",
                    currency: "INR",
                    currencyCode: "INR",
                    currencyStatus: "IDENTIFIED",
                    vendor: {
                        name: vendor.name,
                        gstin: vendor.taxId,
                    },
                    allocationResult: {
                        status: "SKIPPED",
                        requiresReview: false,
                        issues: [],
                        message: "No explicit PO reference; allocation skipped.",
                    },
                    // No poNumber: the invoice does not identify either PO.
                },
                stages: {
                    create: [
                        { name: "PDF_EXTRACTION", status: "COMPLETED" },
                        { name: "VALIDATION", status: "COMPLETED" },
                    ],
                },
            },
        });

        const result = await finalizeInvoiceDecision({
            invoiceId: invoice.id,
            processingRunId: processingRun.id,
        });

        assert.equal(result.success, true);
        assert.equal(result.status, "DECISION_RECORDED");
        assert.equal(result.decision.outcome, "NEEDS_REVIEW");
        assert.equal(result.decision.reason, "PO_NUMBER_MISSING");

        const [savedInvoice, savedRun, allocations] = await Promise.all([
            prisma.invoice.findUnique({
                where: { id: invoice.id },
            }),
            prisma.processingRun.findUnique({
                where: { id: processingRun.id },
                include: { decision: true },
            }),
            prisma.pOAllocation.findMany({
                where: { invoiceId: invoice.id },
            }),
        ]);

        assert.equal(savedInvoice.status, "NEEDS_REVIEW");
        assert.equal(savedRun.status, "COMPLETED");
        assert.equal(savedRun.decision.reason, "PO_NUMBER_MISSING");
        assert.equal(allocations.length, 0);

        const [po1Lines, po2Lines] = await Promise.all([
            prisma.pOLineItem.findMany({ where: { poId: po1.id } }),
            prisma.pOLineItem.findMany({ where: { poId: po2.id } }),
        ]);

        assert.equal(Number(po1Lines[0].quantity), 1);
        assert.equal(Number(po2Lines[0].quantity), 1);
    });
});
