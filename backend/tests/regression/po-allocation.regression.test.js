import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/config/prisma.js";
import { evaluateInvoiceDecision } from "../../src/services/decision-engine.service.js";

describe("Regression Verification Tests", () => {
    it("Verifies APX-INV-001 successful allocation in DB", async () => {
        const invoice = await prisma.invoice.findFirst({
            where: {
                invoiceNumber: "APX-INV-001",
                originalFileName: "01_happy_pdf.pdf",
            },
            include: {
                items: true,
                allocations: true,
                purchaseOrder: true,
                processingRuns: {
                    include: { decision: true, stages: true, validations: true },
                },
            },
        });

        assert.ok(invoice, "Invoice APX-INV-001 must exist in DB");
        assert.equal(invoice.status, "APPROVED");
        assert.equal(invoice.purchaseOrder?.poNumber, "PO-HAPPY-PDF");
        assert.equal(invoice.allocations.length, 1);
        assert.equal(invoice.allocations[0].allocatedAmount.toString(), "10000");
        assert.equal(invoice.allocations[0].allocatedQuantity.toString(), "2");

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

    it("Verifies TW-INV-001 tax-inclusive mismatch in DB", async () => {
        const invoice = await prisma.invoice.findFirst({
            where: {
                invoiceNumber: "TW-INV-001",
                originalFileName: "07_tax_inclusive.pdf",
            },
            include: {
                items: true,
                allocations: true,
                purchaseOrder: true,
                processingRuns: {
                    include: { decision: true, stages: true },
                },
            },
        });

        assert.ok(invoice, "Invoice TW-INV-001 must exist in DB");
        assert.equal(invoice.status, "NEEDS_REVIEW");
        assert.equal(invoice.allocations.length, 0); // No allocations persisted for failed check

        const run = invoice.processingRuns[0];
        assert.ok(run, "ProcessingRun must exist");
        assert.equal(run.decision?.outcome, "NEEDS_REVIEW");
        assert.equal(run.decision?.reason, "ARITHMETIC_MISMATCH");

        const allocResult = run.normalizedData?.allocationResult;
        assert.ok(allocResult);
        assert.equal(allocResult.status, "NEEDS_REVIEW");
        assert.equal(allocResult.issues[0]?.reason, "INVALID_TAX_INCLUSIVE_LINE");
    });

    function createDocumentTypeFixture(documentType) {
        return {
            extraction: { success: true },
            validation: { success: true, results: [] },
            duplicate: { isDuplicate: false },
            vendorMatch: { status: "MATCHED" },
            poMatch: { status: "MATCHED" },
            currencyMatch: { status: "MATCHED" },
            allocation: { status: "SKIPPED" },
            documentType,
        };
    }

    it("Verifies Credit Note skip behavior with a generated fixture", () => {
        const decision = evaluateInvoiceDecision(
            createDocumentTypeFixture("CREDIT_NOTE")
        );

        assert.equal(decision.outcome, "NEEDS_REVIEW");
        assert.equal(decision.reason, "CREDIT_NOTE_REQUIRES_REVIEW");
    });

    it("Verifies Corrected Invoice skip behavior with a generated fixture", () => {
        const decision = evaluateInvoiceDecision(
            createDocumentTypeFixture("CORRECTED_INVOICE")
        );

        assert.equal(decision.outcome, "NEEDS_REVIEW");
        assert.equal(decision.reason, "CORRECTED_INVOICE_REQUIRES_REVIEW");
    });

    it("returns NEEDS_REVIEW with PO_NUMBER_MISSING when no explicit PO is available", () => {
    const decision = evaluateInvoiceDecision({
        extraction: { success: true },
        validation: { success: true, results: [] },
        duplicate: { isDuplicate: false, reason: "NO_DUPLICATE_FOUND" },
        vendorMatch: { status: "MATCHED" },
        poMatch: {
            status: "PO_NOT_PROVIDED",
            reason: "PO_NUMBER_MISSING",
            message: "No explicit purchase order number was extracted.",
        },
        currencyMatch: { status: "UNKNOWN" },
        allocation: { status: "SKIPPED" },
        documentType: "INVOICE",
    });

    assert.equal(decision.outcome, "NEEDS_REVIEW");
    assert.equal(decision.reason, "PO_NUMBER_MISSING");
});
});
