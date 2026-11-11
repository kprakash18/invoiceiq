-- Restore lease columns that must remain available during the BullMQ rollback window.
ALTER TABLE "InvoiceProcessingJob"
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "leaseToken" TEXT;

CREATE INDEX "InvoiceProcessingJob_status_leaseExpiresAt_idx"
ON "InvoiceProcessingJob"("status", "leaseExpiresAt");
