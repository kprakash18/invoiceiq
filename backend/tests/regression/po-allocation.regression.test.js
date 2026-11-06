import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/config/prisma.js";
import { evaluateInvoiceDecision } from "../../src/services/decision-engine.service.js";

describe("Regression Verification Tests", () => {
    it("Verifies GOS-INV-2026-1106-004 (₹250 successful allocation) in DB", async () => {
        const invoice = await prisma.invoice.findFirst({
            where: { invoiceNumber: "GOS-INV-2026-1106-004" },
            include: {
                items: true,
                allocations: true,
                purchaseOrder: true,
                processingRuns: {
                    include: { decision: true, stages: true, validations: true },
                },
            },
        });

        assert.ok(invoice, "Invoice GOS-INV-2026-1106-004 must exist in DB");
        assert.equal(invoice.status, "APPROVED");
        assert.equal(invoice.purchaseOrder?.poNumber, "PO-2026-1003");
        assert.equal(invoice.allocations.length, 1);
        assert.equal(invoice.allocations[0].allocatedAmount.toString(), "250");
        assert.equal(invoice.allocations[0].allocatedQuantity.toString(), "1");

        const run = invoice.processingRuns[0];
        assert.ok(run, "ProcessingRun must exist");
        assert.equal(run.status, "COMPLETED");
        assert.equal(run.decision?.outcome, "APPROVED");
        assert.equal(run.decision?.reason, "ALL_CHECKS_PASSED");

        const allocResult = run.normalizedData?.allocationResult;
        assert.ok(allocResult, "AllocationResult must be recorded in normalizedData");
        assert.equal(allocResult.status, "ALLOCATED");
        assert.deepEqual(allocResult.issues, []);
    });

    it("Verifies GOS-INV-2026-1106-005 (tax-inclusive ₹295 mismatch) in DB", async () => {
        const invoice = await prisma.invoice.findFirst({
            where: { invoiceNumber: "GOS-INV-2026-1106-005" },
            include: {
                items: true,
                allocations: true,
                purchaseOrder: true,
                processingRuns: {
                    include: { decision: true, stages: true },
                },
            },
        });

        assert.ok(invoice, "Invoice GOS-INV-2026-1106-005 must exist in DB");
        assert.equal(invoice.status, "NEEDS_REVIEW");
        assert.equal(invoice.allocations.length, 0); // No allocations persisted for failed check

        const run = invoice.processingRuns[0];
        assert.ok(run, "ProcessingRun must exist");
        assert.equal(run.decision?.outcome, "NEEDS_REVIEW");
        assert.equal(run.decision?.reason, "TAX_INCLUSIVE_PRICE_BASIS_MISMATCH");

        const allocResult = run.normalizedData?.allocationResult;
        assert.ok(allocResult);
        assert.equal(allocResult.status, "NEEDS_REVIEW");
        assert.equal(allocResult.issues[0]?.reason, "TAX_INCLUSIVE_PRICE_BASIS_MISMATCH");
    });

    it("Verifies Credit Note skip behavior (GOS-CN-2026-001) in DB", async () => {
        const cn = await prisma.invoice.findFirst({
            where: { invoiceNumber: "GOS-CN-2026-001" },
            include: {
                allocations: true,
                processingRuns: {
                    include: { decision: true },
                },
            },
        });

        assert.ok(cn, "Credit note GOS-CN-2026-001 must exist in DB");
        assert.equal(cn.status, "NEEDS_REVIEW");
        assert.equal(cn.allocations.length, 0); // Credit notes never allocate POs
        assert.equal(cn.processingRuns[0]?.decision?.outcome, "NEEDS_REVIEW");
        assert.equal(cn.processingRuns[0]?.decision?.reason, "CREDIT_NOTE_REQUIRES_REVIEW");
    });

    it("Verifies Corrected Invoice skip behavior (GOS-INV-2026-1106-006) in DB", async () => {
        const corrected = await prisma.invoice.findFirst({
            where: { invoiceNumber: "GOS-INV-2026-1106-006" },
            include: {
                allocations: true,
                processingRuns: {
                    include: { decision: true },
                },
            },
        });

        assert.ok(corrected, "Corrected invoice GOS-INV-2026-1106-006 must exist in DB");
        assert.equal(corrected.status, "NEEDS_REVIEW");
        assert.equal(corrected.allocations.length, 0); // Corrected invoices never allocate POs
        assert.equal(corrected.processingRuns[0]?.decision?.outcome, "NEEDS_REVIEW");
        assert.equal(corrected.processingRuns[0]?.decision?.reason, "CORRECTED_INVOICE_REQUIRES_REVIEW");
    });
});

