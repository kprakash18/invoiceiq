
import prisma from "../config/prisma.js";

/**
 * Normalize GSTIN for comparison.
 */
export function normalizeGSTIN(gstin) {
  if (!gstin || typeof gstin !== "string") {
    return null;
  }

  return gstin.trim().toUpperCase().replace(/\s/g, "") || null;
}

/**
 * Normalize vendor names for exact comparison.
 *
 * ABC Technologies Pvt. Ltd.
 * ABC TECHNOLOGIES PVT LTD
 *
 * Both become ABC TECHNOLOGIES PVT LTD.
 */
export function normalizeVendorName(name) {
  if (!name || typeof name !== "string") {
    return null;
  }

  const normalized = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

/**
 * Identify an invoice vendor using GSTIN or vendor name.
 */
export async function matchVendor({
  vendorName,
  gstin,
}) {
  const normalizedGSTIN = normalizeGSTIN(gstin);
  const normalizedVendorName = normalizeVendorName(vendorName);

  if (!normalizedGSTIN && !normalizedVendorName) {
    return {
      status: "INSUFFICIENT_INFORMATION",
      reason: "VENDOR_DETAILS_MISSING",
      message: "Vendor name and GSTIN are both missing.",
      vendor: null,
    };
  }

  const vendors = await prisma.vendor.findMany({
    select: {
      id: true,
      name: true,
      taxId: true,
    },
  });

  // Priority 1: Exact GSTIN match.
  if (normalizedGSTIN) {
    const gstinMatches = vendors.filter(
      (vendor) =>
        normalizeGSTIN(vendor.taxId) === normalizedGSTIN
    );

    if (gstinMatches.length === 1) {
      return {
        status: "MATCHED",
        reason: "EXACT_GSTIN_MATCH",
        message: "Vendor identified using GSTIN.",
        vendor: gstinMatches[0],
      };
    }

    if (gstinMatches.length > 1) {
      return {
        status: "AMBIGUOUS",
        reason: "MULTIPLE_GSTIN_MATCHES",
        message: "Multiple vendors have the same GSTIN.",
        vendor: null,
      };
    }

    return {
      status: "NOT_FOUND",
      reason: "GSTIN_NOT_REGISTERED",
      message:
        "The extracted GSTIN does not match any registered vendor.",
      vendor: null,
    };
  }

  // Priority 2: Exact normalized vendor-name match.
  const nameMatches = vendors.filter(
    (vendor) =>
      normalizeVendorName(vendor.name) === normalizedVendorName
  );

  if (nameMatches.length === 1) {
    return {
      status: "MATCHED",
      reason: "EXACT_VENDOR_NAME_MATCH",
      message: "Vendor identified using normalized vendor name.",
      vendor: nameMatches[0],
    };
  }

  if (nameMatches.length > 1) {
    return {
      status: "AMBIGUOUS",
      reason: "MULTIPLE_VENDOR_NAME_MATCHES",
      message: "Multiple vendors have the same normalized name.",
      vendor: null,
    };
  }

  return {
    status: "NOT_FOUND",
    reason: "VENDOR_NOT_REGISTERED",
    message: "No registered vendor matches the extracted name.",
    vendor: null,
  };
}
