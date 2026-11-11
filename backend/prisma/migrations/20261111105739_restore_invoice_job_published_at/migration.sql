/*
  Warnings:

  - You are about to drop the column `leaseExpiresAt` on the `InvoiceProcessingJob` table. All the data in the column will be lost.
  - You are about to drop the column `leaseToken` on the `InvoiceProcessingJob` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "InvoiceProcessingJob_status_leaseExpiresAt_idx";

-- AlterTable
ALTER TABLE "InvoiceProcessingJob" DROP COLUMN "leaseExpiresAt",
DROP COLUMN "leaseToken",
ADD COLUMN     "publishedAt" TIMESTAMP(3);
