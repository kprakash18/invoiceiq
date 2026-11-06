-- Ensure Invoice.currency accepts NULL values.
ALTER TABLE "Invoice"
ALTER COLUMN "currency" DROP NOT NULL;
