-- CreateEnum
CREATE TYPE "InvoiceJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobOutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "InvoiceProcessingJob" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "processingRunId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "InvoiceJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "workerId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOutbox" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "JobOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOutbox_pkey" PRIMARY KEY ("id")
);

-- Enforce valid counters at the database boundary.
ALTER TABLE "InvoiceProcessingJob"
    ADD CONSTRAINT "InvoiceProcessingJob_attempts_check" CHECK ("attempt" >= 0 AND "maxAttempts" > 0 AND "attempt" <= "maxAttempts");

ALTER TABLE "JobOutbox"
    ADD CONSTRAINT "JobOutbox_attempt_check" CHECK ("attempt" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceProcessingJob_idempotencyKey_key" ON "InvoiceProcessingJob"("idempotencyKey");
CREATE INDEX "InvoiceProcessingJob_invoiceId_createdAt_idx" ON "InvoiceProcessingJob"("invoiceId", "createdAt");
CREATE INDEX "InvoiceProcessingJob_status_availableAt_idx" ON "InvoiceProcessingJob"("status", "availableAt");
CREATE INDEX "InvoiceProcessingJob_status_failedAt_idx" ON "InvoiceProcessingJob"("status", "failedAt");
CREATE INDEX "InvoiceProcessingJob_processingRunId_idx" ON "InvoiceProcessingJob"("processingRunId");

-- At most one queued/running/retry-wait job may exist for an invoice.
CREATE UNIQUE INDEX "InvoiceProcessingJob_one_active_per_invoice_idx"
    ON "InvoiceProcessingJob"("invoiceId")
    WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_WAIT');

-- CreateIndex
CREATE UNIQUE INDEX "JobOutbox_jobId_key" ON "JobOutbox"("jobId");
CREATE INDEX "JobOutbox_status_availableAt_idx" ON "JobOutbox"("status", "availableAt");
CREATE INDEX "JobOutbox_status_publishedAt_idx" ON "JobOutbox"("status", "publishedAt");

-- AddForeignKey
ALTER TABLE "InvoiceProcessingJob" ADD CONSTRAINT "InvoiceProcessingJob_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceProcessingJob" ADD CONSTRAINT "InvoiceProcessingJob_processingRunId_fkey" FOREIGN KEY ("processingRunId") REFERENCES "ProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobOutbox" ADD CONSTRAINT "JobOutbox_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "InvoiceProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
