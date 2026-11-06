
import { Worker } from "bullmq";
import { prisma } from "../config/prisma.js";
import { redisConnection } from "../config/redis.js";
import { orchestrateInvoiceProcessing } from "../services/invoice-orchestration.service.js";

const RETRYABLE_FAILURES = new Set([
    "EXTRACTION_FAILED",
    "PERSISTENCE_FAILED",
    "TECHNICAL_FAILURE",
    "DECISION_PERSISTENCE_FAILED",
    "ORCHESTRATION_FAILED",
]);

export const invoiceWorker = new Worker(
    "invoice-processing",
    async (bullJob) => {
        const { invoiceId, processingJobId } = bullJob.data;

        const job = await prisma.invoiceProcessingJob.update({
            where: { id: processingJobId },
            data: {
                status: "RUNNING",
                attempt: { increment: 1 },
                startedAt: new Date(),
                lastAttemptAt: new Date(),
                workerId: `worker-${process.pid}`,
                errorCode: null,
                errorMessage: null,
            },
        });

        try {
            const result = await orchestrateInvoiceProcessing({ invoiceId });

            if (result.success) {
                await prisma.invoiceProcessingJob.update({
                    where: { id: processingJobId },
                    data: {
                        status: "COMPLETED",
                        completedAt: new Date(),
                    },
                });

                return result;
            }

            const failureStatus = result.status ?? "UNKNOWN_FAILURE";
            const retryable = RETRYABLE_FAILURES.has(failureStatus);
            const attemptsExhausted =
                bullJob.attemptsMade + 1 >= job.maxAttempts;

            const message = result.message ?? failureStatus;

            if (!retryable || attemptsExhausted) {
                await prisma.invoiceProcessingJob.update({
                    where: { id: processingJobId },
                    data: {
                        status: retryable ? "DEAD_LETTER" : "FAILED",
                        failedAt: new Date(),
                        errorCode: failureStatus,
                        errorMessage: message,
                    },
                });

                if (retryable) {
                    throw Object.assign(new Error(message), {
                        code: failureStatus,
                        terminal: true,
                    });
                }

                return result;
            }

            await prisma.invoice.updateMany({
                where: { id: invoiceId, status: "FAILED" },
                data: { status: "UPLOADED" },
            });

            await prisma.invoiceProcessingJob.update({
                where: { id: processingJobId },
                data: {
                    status: "RETRY_WAIT",
                    errorCode: failureStatus,
                    errorMessage: message,
                },
            });

            throw Object.assign(new Error(message), {
                code: failureStatus,
            });
        } catch (error) {
            if (error.terminal) {
                throw error;
            }

            if (RETRYABLE_FAILURES.has(error.code)) {
                throw error;
            }

            const attemptsExhausted =
                bullJob.attemptsMade + 1 >= job.maxAttempts;

            await prisma.invoice.updateMany({
                where: {
                    id: invoiceId,
                    status: { in: ["FAILED", "PROCESSING"] },
                },
                data: { status: "UPLOADED" },
            });

            await prisma.invoiceProcessingJob.update({
                where: { id: processingJobId },
                data: {
                    status: attemptsExhausted ? "DEAD_LETTER" : "RETRY_WAIT",
                    ...(attemptsExhausted && {
                        failedAt: new Date(),
                    }),
                    errorCode: error.code ?? "WORKER_ERROR",
                    errorMessage: error.message,
                },
            });

            throw error;
        }
    },
    {
        connection: redisConnection,
        concurrency: 1,
    }
);

invoiceWorker.on("completed", (job) => {
    console.log(`[InvoiceWorker] Completed job ${job.id}`);
});

invoiceWorker.on("failed", (job, error) => {
    console.error(
        `[InvoiceWorker] Job ${job?.id} failed:`,
        error.message
    );
});

invoiceWorker.on("error", (error) => {
    console.error("[InvoiceWorker] Worker error:", error);
});
