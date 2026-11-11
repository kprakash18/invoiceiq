import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildInvoiceDetailResponse,
    buildInvoiceListResponse,
} from "../../src/routes/invoice.routes.js";
import { invoiceQueue } from "../../src/queues/invoice.queue.js";

after(async () => {
    await invoiceQueue.close();
});

describe("Invoice route response shapes", () => {
    it("preserves the invoice list envelope and pagination fields", () => {
        const invoices = [
            {
                id: "invoice-1",
                invoiceNumber: null,
                vendor: null,
                processingRuns: [],
            },
        ];

        assert.deepEqual(
            buildInvoiceListResponse({
                invoices,
                page: 2,
                limit: 10,
                total: 11,
            }),
            {
                success: true,
                data: invoices,
                pagination: {
                    page: 2,
                    limit: 10,
                    total: 11,
                    totalPages: 2,
                },
            }
        );
    });

    it("preserves detail data, normalized data and extraction evidence", () => {
        const invoice = {
            id: "invoice-1",
            vendor: null,
            purchaseOrder: null,
            items: [],
            processingRuns: [
                {
                    normalizedData: {
                        invoiceNumber: "INV-001",
                        evidence: {
                            invoiceNumber: { value: "INV-001" },
                        },
                    },
                },
            ],
            reviews: [],
        };

        assert.deepEqual(buildInvoiceDetailResponse(invoice), {
            success: true,
            data: invoice,
        });
    });

    it("returns PO allocation breakdowns with empty and current allocations", () => {
        const invoice = {
            id: "invoice-1",
            items: [
                {
                    id: "line-1",
                    description: "Current item",
                    quantity: 2,
                    unitPrice: 25,
                    allocations: [
                        {
                            allocatedQuantity: 1,
                            allocatedAmount: 25,
                            poLineItem: {
                                id: "po-line-1",
                                description: "PO item",
                                itemCode: "ITEM-1",
                            },
                        },
                    ],
                },
            ],
            purchaseOrder: {
                items: [
                    {
                        id: "po-line-1",
                        description: "PO item",
                        itemCode: "ITEM-1",
                        quantity: 5,
                        unitPrice: 25,
                        allocations: [
                            {
                                allocatedQuantity: 2,
                                allocatedAmount: 50,
                            },
                        ],
                    },
                    {
                        id: "po-line-2",
                        description: "Unused PO item",
                        itemCode: null,
                        quantity: 3,
                        unitPrice: 10,
                        allocations: [],
                    },
                ],
            },
        };

        const response = buildInvoiceDetailResponse(invoice);

        assert.deepEqual(response.data.purchaseOrder.items, [
            {
                id: "po-line-1",
                description: "PO item",
                itemCode: "ITEM-1",
                quantity: 5,
                unitPrice: 25,
                allocationBreakdown: {
                    orderedQuantity: 5,
                    previouslyInvoicedQuantity: 2,
                    currentAllocatedQuantity: 1,
                    remainingQuantity: 2,
                    previousAllocatedAmount: 50,
                    currentAllocatedAmount: 25,
                    poUnitPrice: 25,
                    currentAllocations: [
                        {
                            invoiceLineItemId: "line-1",
                            invoiceDescription: "Current item",
                            invoiceQuantity: 2,
                            invoiceUnitPrice: 25,
                            allocatedQuantity: 1,
                            allocatedAmount: 25,
                        },
                    ],
                },
            },
            {
                id: "po-line-2",
                description: "Unused PO item",
                itemCode: null,
                quantity: 3,
                unitPrice: 10,
                allocationBreakdown: {
                    orderedQuantity: 3,
                    previouslyInvoicedQuantity: 0,
                    currentAllocatedQuantity: 0,
                    remainingQuantity: 3,
                    previousAllocatedAmount: 0,
                    currentAllocatedAmount: 0,
                    poUnitPrice: 10,
                    currentAllocations: [],
                },
            },
        ]);
    });
});
