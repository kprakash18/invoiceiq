import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { invoiceQueue } from "../queues/invoice.queue.js";

const ACTIVE_STATUSES = ["QUEUED", "RUNNING", "RETRY_WAIT"];

export async function enqueueInvoiceProcessing({ invoiceId }) {
    const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, status: true },
    });

    if (!invoice) {
        throw new Error("Invoice not found.");
    }

    if (invoice.status !== "UPLOADED") {
        throw new Error(
            `Invoice cannot be queued from status ${invoice.status}.`
        );
    }

    let job;

    try {
        job = await prisma.invoiceProcessingJob.create({
            data: {
                invoiceId,
                idempotencyKey: randomUUID(),
            },
        });
    } catch (error) {
        if (error.code !== "P2002" && error.code !== "P2010") {
            throw error;
        }

        const activeJob = await prisma.invoiceProcessingJob.findFirst({
            where: {
                invoiceId,
                status: { in: ACTIVE_STATUSES },
            },
            orderBy: { createdAt: "desc" },
        });

        if (activeJob) {
            return activeJob;
        }

        throw error;
    }

    await invoiceQueue.add(
        "process-invoice",
        { invoiceId, processingJobId: job.id },
        { jobId: job.id }
    );

    return prisma.invoiceProcessingJob.update({
        where: { id: job.id },
        data: { publishedAt: new Date() },
    });
}


export async function recoverInvoiceProcessingJobs() {
    const jobs = await prisma.invoiceProcessingJob.findMany({
        where: {
            status: "QUEUED",
            publishedAt: null,
        },
    });

    for (const job of jobs) {
        await invoiceQueue.add(
            "process-invoice",
            {
                invoiceId: job.invoiceId,
                processingJobId: job.id,
            },
            { jobId: job.id }
        );

    await prisma.invoiceProcessingJob.update({
        where: { id: job.id },
        data: { publishedAt: new Date() },
    });
}

return jobs.length;
}