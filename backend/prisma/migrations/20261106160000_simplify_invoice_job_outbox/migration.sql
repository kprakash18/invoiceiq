/*
  Warnings:

  - You are about to drop the `JobOutbox` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "JobOutbox" DROP CONSTRAINT "JobOutbox_jobId_fkey";

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "currency" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InvoiceProcessingJob" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- DropTable
DROP TABLE "JobOutbox";

-- DropEnum
DROP TYPE "JobOutboxStatus";
