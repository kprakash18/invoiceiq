import path, { resolve } from "node:path";
import { Router } from "express";
import fs from "node:fs/promises";

import { uploadInvoice } from "../middleware/upload.middleware.js";
import { validatePdfSignature } from "../middleware/pdf-validation.middleware.js";
import { checkDuplicateFile } from "../middleware/duplicate-check.middleware.js";

import {
    moveToPermanentStorage,
    deleteStoredFile,
} from "../utils/file-storage.js";

import { prisma } from "../config/prisma.js";
import { enqueueInvoiceProcessing } from "../services/invoice-job.service.js";

const router = Router();

router.post(
    "/",
    uploadInvoice,
    validatePdfSignature,
    checkDuplicateFile,
    async (req, res, next) => {
        let permanentFile = null;
        let invoiceCreated = false;

        try {
            permanentFile = await moveToPermanentStorage(req.file.path);

            const invoice = await prisma.invoice.create({
                data: {
                    originalFileName: req.file.originalname,
                    fileHash: req.fileHash,
                    filePath: permanentFile.filePath,
                },
                select: {
                    id: true,
                    originalFileName: true,
                    status: true,
                    fileHash: true,
                    filePath: true,
                    createdAt: true,
                },
            });

            invoiceCreated = true;

            const job = await enqueueInvoiceProcessing({
                invoiceId: invoice.id,
            });

            return res.status(202).json({
                success: true,
                message: "Invoice uploaded and queued for processing.",
                data: {
                    invoice,
                    job,
                },
            });
        } catch (error) {
            if (!invoiceCreated && permanentFile) {
                await deleteStoredFile(
                    permanentFile.absolutePath
                ).catch((cleanupError) => {
                    req.log?.error(
                        cleanupError,
                        "Permanent file cleanup failed"
                    );
                });
            } else if (!permanentFile && req.file?.path) {
                await fs.unlink(req.file.path).catch(() => {});
            }

            if (error.code === "P2002") {
                return res.status(409).json({
                    success: false,
                    message: "This invoice file has already been uploaded.",
                });
            }

            next(error);
        }
    }
);

router.get("/", async (req, res, next) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(
            50,
            Math.max(1, Number(req.query.limit) || 10)
        );

        const validStatuses = [
            "UPLOADED",
            "PROCESSING",
            "APPROVED",
            "NEEDS_REVIEW",
            "REJECTED",
            "FAILED",
        ];

        const status = req.query.status;

        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid invoice status.",
            });
        }

        const where = status ? { status } : {};

        const [invoices, total] = await Promise.all([
            prisma.invoice.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    vendor: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    processingRuns: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                        include: {
                            decision: true,
                        },
                    },
                },
            }),
            prisma.invoice.count({ where }),
        ]);

        return res.status(200).json({
            success: true,
            data: invoices,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        next(error);
    }
});

    router.get("/:id/file", async (req, res, next) => {
        try {
            const invoice = await prisma.invoice.findUnique({
                where: { id: req.params.id },
                select: {
                    filePath: true,
                    originalFileName: true,
                },
            });

            if (!invoice) {
                return res.status(404).json({
                    success: false,
                    message: "Invoice not found.",
                });
            }

            if (!invoice.filePath) {
                return res.status(404).json({
                    success: false,
                    message: "Invoice PDF path is missing.",
                });
            }

            const storageRoot = resolve(process.cwd(), "storage");
            const absolutePath = resolve(storageRoot, invoice.filePath);

            // Prevent paths outside the storage directory.
            if (
                absolutePath === storageRoot ||
                !absolutePath.startsWith(storageRoot + path.sep)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid stored file path.",
                });
            }

            await fs.access(absolutePath);

           res.setHeader("Content-Type", "application/pdf");

            res.setHeader(
                "Content-Disposition",
                `inline; filename="${path.basename(invoice.originalFileName || "invoice.pdf")}"`
            );

// Allow the Vite frontend to embed this PDF.
res.removeHeader("X-Frame-Options");
res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' http://localhost:5173"
);

return res.sendFile(absolutePath);
        } catch (error) {
            if (error.code === "ENOENT") {
                return res.status(404).json({
                    success: false,
                    message: "Stored invoice PDF was not found.",
                });
            }

            next(error);
        }
    });


router.get("/:id", async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                invoiceNumber: true,
                invoiceDate: true,
                dueDate: true,
                currency: true,
                subtotal: true,
                taxAmount: true,
                totalAmount: true,
                status: true,
                originalFileName: true,
                extractionMethod: true,
                createdAt: true,
                updatedAt: true,

                vendor: {
                    select: {
                        id: true,
                        name: true,
                        taxId: true,
                        email: true,
                        phone: true,
                        address: true,
                    },
                },

                purchaseOrder: {
                    select: {
                        id: true,
                        poNumber: true,
                        status: true,
                        currency: true,
                        totalAmount: true,
                        issueDate: true,
                        expiryDate: true,
                        items: {
                            select: {
                                id: true,
                                description: true,
                                itemCode: true,
                                quantity: true,
                                unitPrice: true,
                                allocations: {
                                    where: {
                                        invoiceId: {
                                            not: req.params.id,
                                        },
                                    },
                                    select: {
                                        allocatedQuantity: true,
                                        allocatedAmount: true,
                                    },
                                },
                            },
                        },
                    },
                },

                items: {
                    orderBy: { createdAt: "asc" },
                    select: {
                        id: true,
                        description: true,
                        itemCode: true,
                        quantity: true,
                        unitPrice: true,
                        taxAmount: true,
                        lineTotal: true,
                        allocations: {
                            select: {
                                allocatedQuantity: true,
                                allocatedAmount: true,
                                poLineItem: {
                                    select: {
                                        id: true,
                                        description: true,
                                        itemCode: true,
                                    },
                                },
                            },
                        },
                    },
                },

                processingRuns: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: {
                        id: true,
                        status: true,
                        attempt: true,
                        startedAt: true,
                        completedAt: true,
                        error: true,
                        extractionMethod: true,
                        modelName: true,
                        normalizedData: true,

                        stages: {
                            orderBy: { createdAt: "asc" },
                            select: {
                                id: true,
                                name: true,
                                status: true,
                                startedAt: true,
                                completedAt: true,
                                durationMs: true,
                                message: true,
                                error: true,
                                metadata: true,
                            },
                        },

                        validations: {
                            orderBy: { createdAt: "asc" },
                            select: {
                                id: true,
                                ruleCode: true,
                                field: true,
                                passed: true,
                                severity: true,
                                message: true,
                                expectedValue: true,
                                actualValue: true,
                            },
                        },

                        decision: {
                            select: {
                                outcome: true,
                                reason: true,
                                explanation: true,
                                policyVersion: true,
                                createdAt: true,
                            },
                        },
                    },
                },

                reviews: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: {
                        id: true,
                        status: true,
                        comments: true,
                        reason: true,
                        createdAt: true,
                    },
                },
            },
        });

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found.",
            });
        }

        // Build read-only allocation breakdown for each PO line.
        if (invoice.purchaseOrder) {
            invoice.purchaseOrder.items = invoice.purchaseOrder.items.map(
                (poItem) => {
                    const previousQuantity = poItem.allocations.reduce(
                        (sum, allocation) =>
                            sum + Number(allocation.allocatedQuantity),
                        0
                    );

                    const previousAmount = poItem.allocations.reduce(
                        (sum, allocation) =>
                            sum + Number(allocation.allocatedAmount),
                        0
                    );

                    const currentAllocations = invoice.items.flatMap((item) =>
                        item.allocations
                            .filter(
                                (allocation) =>
                                    allocation.poLineItem.id === poItem.id
                            )
                            .map((allocation) => ({
                                invoiceLineItemId: item.id,
                                invoiceDescription: item.description,
                                invoiceQuantity: Number(item.quantity),
                                invoiceUnitPrice: Number(item.unitPrice),
                                allocatedQuantity: Number(
                                    allocation.allocatedQuantity
                                ),
                                allocatedAmount: Number(
                                    allocation.allocatedAmount
                                ),
                            }))
                    );

                    const currentQuantity = currentAllocations.reduce(
                        (sum, allocation) =>
                            sum + allocation.allocatedQuantity,
                        0
                    );

                    const currentAmount = currentAllocations.reduce(
                        (sum, allocation) =>
                            sum + allocation.allocatedAmount,
                        0
                    );

                    return {
                        id: poItem.id,
                        description: poItem.description,
                        itemCode: poItem.itemCode,
                        quantity: poItem.quantity,
                        unitPrice: poItem.unitPrice,

                        allocationBreakdown: {
                            orderedQuantity: Number(poItem.quantity),
                            previouslyInvoicedQuantity: previousQuantity,
                            currentAllocatedQuantity: currentQuantity,
                            remainingQuantity:
                                Number(poItem.quantity) -
                                previousQuantity -
                                currentQuantity,

                            previousAllocatedAmount: previousAmount,
                            currentAllocatedAmount: currentAmount,

                            poUnitPrice: Number(poItem.unitPrice),
                            currentAllocations,
                        },
                    };
                }
            );
        }

        return res.status(200).json({
            success: true,
            data: invoice,
        });
    } catch (error) {
        next(error);
    }
});


router.get("/:id/job", async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findUnique({
            where: { id: req.params.id },
            select: { id: true },
        });

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found.",
            });
        }

        const job = await prisma.invoiceProcessingJob.findFirst({
            where: { invoiceId: invoice.id },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                status: true,
                attempt: true,
                maxAttempts: true,
                queuedAt: true,
                startedAt: true,
                completedAt: true,
                failedAt: true,
                errorCode: true,
                errorMessage: true,
            },
        });

        return res.status(200).json({
            success: true,
            data: job,
        });
    } catch (error) {
        next(error);
    }
});

router.post("/:id/retry", async (req, res, next) => {
    try {
        const invoice = await prisma.invoice.findUnique({
            where: { id: req.params.id },
        });

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found.",
            });
        }

        if (invoice.status !== "FAILED") {
            return res.status(409).json({
                success: false,
                message: `Only FAILED invoices can be retried. Current status: ${invoice.status}.`,
            });
        }

        const absolutePath = resolve(
            process.cwd(),
            "storage",
            invoice.filePath
        );

        await fs.access(absolutePath);

        const updated = await prisma.invoice.updateMany({
            where: {
                id: invoice.id,
                status: "FAILED",
            },
            data: {
                status: "UPLOADED",
            },
        });

        if (updated.count === 0) {
            return res.status(409).json({
                success: false,
                message: "Invoice status changed. Please retry again.",
            });
        }

        const job = await enqueueInvoiceProcessing({
            invoiceId: invoice.id,
        });

        return res.status(202).json({
            success: true,
            message: "Invoice retry queued for processing.",
            data: {
                invoiceId: invoice.id,
                job,
            },
        });
    } catch (error) {
        if (error.code === "ENOENT") {
            return res.status(404).json({
                success: false,
                message: "Stored invoice PDF was not found.",
            });
        }

        next(error);
    }
});

export default router;
