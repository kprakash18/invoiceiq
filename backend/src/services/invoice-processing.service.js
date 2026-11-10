
import "dotenv/config";
import { normalizeInvoiceData } from "./invoice-normalization.service.js";
import { prisma } from "../config/prisma.js";

import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const EXTRACTION_SERVICE_URL =
    process.env.EXTRACTION_SERVICE_URL ?? "http://localhost:8000";

const STORAGE_ROOT = resolve(process.cwd(), "storage");

const contentTypesByExtension = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
};

export async function extractInvoiceFromFile(filePath) {
    if (!filePath) {
        return {
            success: false,
            stage: "EXTRACTION_SERVICE",
            error: "Invoice file path is required.",
        };
    }

    try {
        const absoluteFilePath = resolve(STORAGE_ROOT, filePath);
        const fileBuffer = await readFile(absoluteFilePath);
        const extension = extname(filePath).toLowerCase();
        const contentType = contentTypesByExtension[extension];

        if (!contentType) {
            return {
                success: false,
                stage: "EXTRACTION_SERVICE",
                error: "Invoice file type is not supported.",
            };
        }

        const formData = new FormData();

        const invoiceBlob = new Blob([fileBuffer], {
            type: contentType,
        });

        formData.append("file", invoiceBlob, basename(filePath));

        const response = await fetch(
            `${EXTRACTION_SERVICE_URL}/process`,
            {
                method: "POST",
                body: formData,
            }
        );

        const result = await response.json();

        if (!response.ok) {
            return {
                success: false,
                stage: "EXTRACTION_SERVICE",
                error:
                    result.detail ??
                    `Extraction service returned HTTP ${response.status}.`,
            };
        }

        return result;
    } catch (error) {
        return {
            success: false,
            stage: "EXTRACTION_SERVICE",
            error: error.message,
        };
    }
}

export async function processInvoiceFile(filePath) {
    // Stage 1: Extract invoice data from the uploaded document.
    const extraction = await extractInvoiceFromFile(filePath);

    if (!extraction.success) {
        return {
            success: false,
            stage: extraction.stage,
            error: extraction.error,
        };
    }

    // Stage 2: Normalize extracted data
    const normalization = normalizeInvoiceData(
        extraction.invoice_data
    );

    if (!normalization.success) {
        return {
            success: false,
            stage: "NORMALIZATION",
            error: normalization.message,
        };
    }

    return {
        success: true,
        stage: "NORMALIZED",
        extractionMethod: extraction.pdf_extraction.extraction_method,
        pdfExtraction: extraction.pdf_extraction,
        rawExtraction: extraction.invoice_data,
        data: normalization.data,
        evidence: normalization.evidence,
        validation: extraction.validation,
        currencyRequiresReview:
            normalization.data.currencyStatus !== "IDENTIFIED",
    };
}

const toJsonSafe = (value) =>
    JSON.parse(JSON.stringify(value));

const toDecimalString = (value) =>
    value === null || value === undefined
        ? null
        : String(value);

const toValidationString = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;

    return JSON.stringify(value);
};

export async function persistInvoiceExtraction({
    invoiceId,
    processed,
}) {
    if (!invoiceId || !processed?.success) {
        return {
            success: false,
            status: "INVALID_INPUT",
            message: "A valid invoice ID and successful extraction are required.",
        };
    }

    const data = processed.data;
    const validation = processed.validation;

    const validMethods = [
        "DIGITAL_TEXT",
        "OCR",
        "HYBRID",
    ];

    if (!validMethods.includes(processed.extractionMethod)) {
        return {
            success: false,
            status: "INVALID_EXTRACTION_METHOD",
            message: "Extraction method is not supported.",
        };
    }

    const lineItems = data.lineItems ?? [];

    const canPersistLineItems = lineItems.every((item) =>
        typeof item.description === "string" &&
        item.description.trim() !== "" &&
        item.quantity !== null &&
        item.unitPrice !== null &&
        item.lineTotal !== null &&
        Number.isFinite(item.quantity) &&
        Number.isFinite(item.unitPrice) &&
        Number.isFinite(item.lineTotal)
    );

    const validationIssues = validation?.results ?? [];
    const now = new Date();

    try {
        return await prisma.$transaction(
            async (tx) => {
                // 1. Verify invoice exists.
                const invoice = await tx.invoice.findUnique({
                    where: { id: invoiceId },
                    select: { id: true },
                });

                if (!invoice) {
                    return {
                        success: false,
                        status: "INVOICE_NOT_FOUND",
                        message: "Invoice does not exist.",
                    };
                }

                // 2. Never overwrite line items that have allocations.
                const allocationCount =
                    await tx.pOAllocation.count({
                        where: { invoiceId },
                    });

                if (allocationCount > 0) {
                    return {
                        success: false,
                        status: "EXISTING_ALLOCATIONS",
                        message: "Cannot replace invoice data after PO allocations exist.",
                    };
                }

                // 3. Calculate the next processing attempt.
                const previousRun =
                    await tx.processingRun.findFirst({
                        where: { invoiceId },
                        orderBy: { attempt: "desc" },
                        select: { attempt: true },
                    });

                const attempt = (previousRun?.attempt ?? 0) + 1;

                // 4. Update invoice header fields.
                await tx.invoice.update({
                    where: { id: invoiceId },
                    data: {
                        invoiceNumber: data.invoiceNumber,
                        invoiceDate: data.invoiceDate,
                        dueDate: data.dueDate,
                        currency: data.currencyCode,
                        subtotal: toDecimalString(data.subtotal),
                        taxAmount: toDecimalString(data.taxAmount),
                        totalAmount: toDecimalString(data.totalAmount),
                        extractionMethod: processed.extractionMethod,
                        status: "PROCESSING",
                    },
                });

                // 5. Replace old, unallocated line items.
                await tx.invoiceLineItem.deleteMany({
                    where: { invoiceId },
                });

                // 6. Persist valid line items.
                if (canPersistLineItems && lineItems.length > 0) {
                    await tx.invoiceLineItem.createMany({
                        data: lineItems.map((item) => ({
                            invoiceId,
                            description: item.description.trim(),
                            quantity: toDecimalString(item.quantity),
                            unitPrice: toDecimalString(item.unitPrice),
                            taxAmount: toDecimalString(item.taxAmount),
                            lineTotal: toDecimalString(item.lineTotal),
                            taxRate: toDecimalString(item.taxRate),
                        })),
                    });
                }

                // 7. Prepare validation records.
                const validationRecords = validationIssues.map(
                    (issue) => ({
                        ruleCode: issue.code ?? "UNKNOWN_VALIDATION_ISSUE",
                        field: issue.field ?? null,
                        passed: false,
                        severity: ["INFO", "WARNING", "ERROR"].includes(
                            issue.severity
                        )
                            ? issue.severity
                            : "ERROR",
                        message: issue.message ?? "Validation issue detected.",
                        actualValue: toValidationString(
                            issue.observed_value
                        ),
                    })
                );

                // 8. Create processing run and stages.
                const processingRun = await tx.processingRun.create({
                    data: {
                        invoiceId,
                        attempt,
                        status: "IN_PROGRESS",
                        startedAt: now,
                        extractionMethod: processed.extractionMethod,
                        modelName: "gemini-3.5-flash-lite",
                        rawExtraction: toJsonSafe(processed.rawExtraction),
                        normalizedData: toJsonSafe({
                            ...data,
                            invoiceDate: data.invoiceDate?.toISOString() ?? null,
                            dueDate: data.dueDate?.toISOString() ?? null,
                            evidence: processed.evidence,
                            currencyRequiresReview:
                                processed.currencyRequiresReview,
                            lineItemsPersisted: canPersistLineItems,
                        }),
                        stages: {
                            create: [
                                {
                                    name: "PDF_EXTRACTION",
                                    status: "COMPLETED",
                                    startedAt: now,
                                    completedAt: now,
                                    message: "PDF extraction completed.",
                                    metadata: toJsonSafe(
                                        processed.pdfExtraction
                                    ),
                                },
                                {
                                    name: "NORMALIZATION",
                                    status: "COMPLETED",
                                    startedAt: now,
                                    completedAt: now,
                                    message: "Invoice data normalized.",
                                },
                                {
                                    name: "VALIDATION",
                                    status: validation?.success
                                        ? "COMPLETED"
                                        : "FAILED",
                                    startedAt: now,
                                    completedAt: now,
                                    message: validation?.success
                                        ? `${validationIssues.length} validation issues recorded.`
                                        : "Validation did not complete successfully.",
                                },
                            ],
                        },
                        validations: {
                            create: validationRecords,
                        },
                    },
                    select: {
                        id: true,
                        invoiceId: true,
                        attempt: true,
                        status: true,
                    },
                });

                return {
                    success: true,
                    status: "PERSISTED",
                    processingRun,
                    lineItemsPersisted: canPersistLineItems,
                    lineItemCount: canPersistLineItems
                        ? lineItems.length
                        : 0,
                    validationIssueCount: validationRecords.length,
                    currency: data.currencyCode,
                    currencyRequiresReview:
                        processed.currencyRequiresReview,
                };
            },
            {
                isolationLevel: "Serializable",
            }
        );
    } catch (error) {
        console.error("Invoice persistence failed:", error);

        return {
            success: false,
            status: "PERSISTENCE_FAILED",
            message: error.message,
        };
    }
}
