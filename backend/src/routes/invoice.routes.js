import { resolve } from "node:path";
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

import {
    orchestrateInvoiceProcessing,
} from "../services/invoice-orchestration.service.js";

const router = Router();

router.post(
    "/",
    uploadInvoice,
    validatePdfSignature,
    checkDuplicateFile,
    async (req, res, next) => {
        let permanentFile = null;

        try {
            // 1. Move PDF to permanent storage.
            permanentFile = await moveToPermanentStorage(req.file.path);

            // 2. Create invoice record.
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

            // 3. Start invoice processing.
            const processing = await orchestrateInvoiceProcessing({
                invoiceId: invoice.id,
            });

            // 4. Return upload and processing result.
            return res.status(202).json({
                success: true,
                message: "Invoice uploaded and processing initiated.",
                data: {
                    invoice,
                    processing,
                },
            });

        } catch (error) {
            // 5. Cleanup if database insertion fails.
            if (permanentFile) {
                await deleteStoredFile(
                    permanentFile.absolutePath
                ).catch((cleanupError) => {
                    req.log?.error(
                        cleanupError,
                        "Permanent file cleanup failed"
                    );
                });
            } else if (req.file?.path) {
                await fs.unlink(req.file.path).catch(() => {});
            }

            // 6. Handle concurrent duplicate uploads.
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

        await fs.access(absolutePath);

        await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: "UPLOADED" },
        });

        const processing = await orchestrateInvoiceProcessing({
            invoiceId: invoice.id,
        });

        return res.status(200).json({
            success: processing.success,
            message: "Invoice retry processing completed.",
            data: {
                invoiceId: invoice.id,
                processing,
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
