
import prisma from "../config/prisma.js";
import { normalizeAlphanumericIdentifier } from "../utils/identifier-normalization.js";

/**
 * Normalize invoice numbers before comparison.
 *
 * INV-001, inv 001 and INV001 become INV001.
 */
export function normalizeInvoiceNumber(invoiceNumber) {
  return normalizeAlphanumericIdentifier(invoiceNumber);
}

/**
 * Detect business-level duplicate invoices.
 *
 * Same vendor + same normalized invoice number.
 */
export async function detectDuplicateInvoice({
  vendorId,
  invoiceNumber,
  excludeInvoiceId = null,
}) {
  const normalizedInvoiceNumber =
    normalizeInvoiceNumber(invoiceNumber);

  if (!vendorId || !normalizedInvoiceNumber) {
    return {
      isDuplicate: false,
      reason: "INSUFFICIENT_INFORMATION",
      message: "Vendor ID or invoice number is missing.",
      duplicateInvoice: null,
    };
  }

  const existingInvoices = await prisma.invoice.findMany({
    where: {
      vendorId,
      invoiceNumber: {
        not: null,
      },
      ...(excludeInvoiceId && {
        id: {
          not: excludeInvoiceId,
        },
      }),
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      totalAmount: true,
      status: true,
      createdAt: true,
    },
  });

  const duplicateInvoice = existingInvoices.find(
    (invoice) =>
      normalizeInvoiceNumber(invoice.invoiceNumber) ===
      normalizedInvoiceNumber
  );

  if (duplicateInvoice) {
    return {
      isDuplicate: true,
      reason: "DUPLICATE_VENDOR_INVOICE_NUMBER",
      message:
        "An invoice with the same normalized invoice number already exists for this vendor.",
      duplicateInvoice,
    };
  }

  return {
    isDuplicate: false,
    reason: "NO_DUPLICATE_FOUND",
    message: "No matching invoice was found.",
    duplicateInvoice: null,
  };
}
