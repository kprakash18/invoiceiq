-- AlterTable
ALTER TABLE "InvoiceProcessingJob" ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" TEXT;

-- CreateIndex
CREATE INDEX "InvoiceProcessingJob_status_leaseExpiresAt_idx" ON "InvoiceProcessingJob"("status", "leaseExpiresAt");
