import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { verifyAllocationIntegrity } from "../../src/services/invoice-decision.service.js";

const decimal = (value) => new Prisma.Decimal(value);

function createInvoice({
    taxRate = 18,
    taxAmount = 45,
    allocatedAmount = 250,
} = {}) {
    const invoiceId = "inv-1";
    const lineId = "inv-line-1";
    const poId = "po-1";

    const item = {
        id: lineId,
        invoiceId,
        description: "A4 Paper Ream",
        quantity: decimal(1),
        unitPrice: decimal(295),
        taxRate: taxRate === null ? null : decimal(taxRate),
        taxAmount: taxAmount === null ? null : decimal(taxAmount),
        lineTotal: decimal(295),
    };

    return {
        invoice: {
            id: invoiceId,
            items: [item],
            allocations: [
                {
                    invoiceId,
                    purchaseOrderId: poId,
                    invoiceLineItemId: lineId,
                    invoiceLineItem: { invoiceId },
                    poLineItem: { poId },
                    allocatedQuantity: decimal(1),
                    allocatedAmount: decimal(allocatedAmount),
                },
            ],
        },
        purchaseOrderId: poId,
    };
}

describe("Invoice Decision Allocation Integrity", () => {
    it("accepts valid inclusive-tax allocation using pre-tax amount", () => {
        const data = createInvoice();

        const result = verifyAllocationIntegrity({
            ...data,
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(result.valid, true);
    });

    it("rejects allocation using gross amount instead of pre-tax amount", () => {
        const data = createInvoice({ allocatedAmount: 295 });

        const result = verifyAllocationIntegrity({
            ...data,
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(result.valid, false);
    });

    it("rejects inclusive-tax invoice with missing tax rate", () => {
        const data = createInvoice({ taxRate: null });

        const result = verifyAllocationIntegrity({
            ...data,
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(result.valid, false);
        assert.match(result.message, /invalid tax values/i);
    });

    it("rejects inclusive-tax invoice with inconsistent tax amount", () => {
        const data = createInvoice({ taxAmount: 50 });

        const result = verifyAllocationIntegrity({
            ...data,
            taxTreatment: "INCLUSIVE",
        });

        assert.equal(result.valid, false);
        assert.match(result.message, /invalid tax values/i);
    });
});
