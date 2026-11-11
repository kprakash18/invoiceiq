import prisma from "../config/prisma.js";
import { normalizeAlphanumericIdentifier } from "../utils/identifier-normalization.js";

/**
 * Normalize PO numbers for comparison.
 *
 * PO-2026-1001 and PO 2026 1001
 * become PO20261001.
 */
export function normalizePONumber(poNumber) {
  return normalizeAlphanumericIdentifier(poNumber);
}

function isValidDate(value) {
  if (!value) return false;

  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function isDateAfter(date1, date2) {
  return date1.getTime() > date2.getTime();
}

/**
 * Match an extracted invoice PO number against registered POs.
 */
export async function matchPurchaseOrder({
  vendorId,
  poNumber,
  invoiceDate = null,
}) {
  const normalizedPONumber = normalizePONumber(poNumber);

  if (!normalizedPONumber) {
    return {
      status: "PO_NOT_PROVIDED",
      reason: "PO_NUMBER_MISSING",
      message: "No explicit purchase order number was extracted.",
      purchaseOrder: null,
    };
  }

  if (!vendorId) {
    return {
      status: "INSUFFICIENT_INFORMATION",
      reason: "VENDOR_ID_MISSING",
      message: "Vendor must be identified before matching a purchase order.",
      purchaseOrder: null,
    };
  }

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    include: {
      vendor: {
        select: {
          id: true,
          name: true,
        },
      },
      items: true,
    },
  });

  const matches = purchaseOrders.filter(
    (po) =>
      normalizePONumber(po.poNumber) === normalizedPONumber
  );

  if (matches.length === 0) {
    return {
      status: "NOT_FOUND",
      reason: "PO_NOT_REGISTERED",
      message: "No registered purchase order matches the extracted PO number.",
      purchaseOrder: null,
    };
  }

  if (matches.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: "MULTIPLE_PO_MATCHES",
      message: "Multiple purchase orders match the extracted PO number.",
      purchaseOrder: null,
    };
  }

  const purchaseOrder = matches[0];

  // Never match a PO belonging to another vendor.
  if (purchaseOrder.vendorId !== vendorId) {
    return {
      status: "VENDOR_MISMATCH",
      reason: "PO_VENDOR_MISMATCH",
      message: "The purchase order belongs to a different vendor.",
      purchaseOrder,
    };
  }

  // Only OPEN and PARTIALLY_INVOICED POs can receive invoices.
  if (!["OPEN", "PARTIALLY_INVOICED"].includes(purchaseOrder.status)) {
    return {
      status: "NOT_ELIGIBLE",
      reason: "PO_STATUS_NOT_ELIGIBLE",
      message: `Purchase order status is ${purchaseOrder.status}.`,
      purchaseOrder,
    };
  }

  // Check whether the invoice date falls within the PO validity period.
  if (isValidDate(invoiceDate)) {
    const invoiceDateValue = new Date(invoiceDate);

    if (
      purchaseOrder.issueDate &&
      isDateAfter(purchaseOrder.issueDate, invoiceDateValue)
    ) {
      return {
        status: "NOT_ELIGIBLE",
        reason: "INVOICE_BEFORE_PO_ISSUE_DATE",
        message: "Invoice date is earlier than the purchase order issue date.",
        purchaseOrder,
      };
    }

    if (
      purchaseOrder.expiryDate &&
      isDateAfter(invoiceDateValue, purchaseOrder.expiryDate)
    ) {
      return {
        status: "EXPIRED",
        reason: "PO_EXPIRED",
        message: "Invoice date falls after the purchase order expiry date.",
        purchaseOrder,
      };
    }
  }

  return {
    status: "MATCHED",
    reason: "EXACT_PO_NUMBER_MATCH",
    message: "Purchase order successfully matched to the invoice vendor.",
    purchaseOrder,
  };
}