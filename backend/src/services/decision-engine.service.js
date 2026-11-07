
const POLICY_VERSION = "1.0";

const HARD_REJECTION_CODES = new Set([
    "NEGATIVE_AMOUNT",
    "NEGATIVE_LINE_ITEM_VALUE",
]);

const SUPPORTED_DOCUMENT_TYPES = new Set([
    "INVOICE",
    "CREDIT_NOTE",
    "CORRECTED_INVOICE",
    "UNKNOWN",
]);

export function evaluateInvoiceDecision({
    extraction,
    validation,
    duplicate,
    vendorMatch,
    poMatch,
    currencyMatch,
    allocation,
    documentType = "UNKNOWN",
}) {
    // 1. Technical extraction failure
    if (!extraction?.success) {
        return {
            technicalFailure: true,
            reason: "EXTRACTION_FAILED",
            explanation:
                extraction?.error ?? "Invoice extraction failed.",
            policyVersion: POLICY_VERSION,
        };
    }

    // 2. Validation could not run
    if (!validation?.success) {
        return createDecision(
            "NEEDS_REVIEW",
            "VALIDATION_FAILED",
            "Invoice validation could not be completed."
        );
    }

    const issues = validation.results ?? [];

    // 3. Verify document classification
    const type = SUPPORTED_DOCUMENT_TYPES.has(documentType)
        ? documentType
        : "UNKNOWN";

    if (type === "CREDIT_NOTE") {
        return {
            ...createDecision(
                "NEEDS_REVIEW",
                "CREDIT_NOTE_REQUIRES_REVIEW",
                "Credit notes require human verification of the original invoice and credit adjustment."
            ),
            validationIssues: issues,
        };
    }

    if (type === "CORRECTED_INVOICE") {
        return {
            ...createDecision(
                "NEEDS_REVIEW",
                "CORRECTED_INVOICE_REQUIRES_REVIEW",
                "Corrected invoices require human verification of the original invoice and revised values."
            ),
            validationIssues: issues,
        };
    }

    if (type === "UNKNOWN") {
        return {
            ...createDecision(
                "NEEDS_REVIEW",
                "DOCUMENT_TYPE_UNIDENTIFIED",
                "The document type could not be reliably identified."
            ),
            validationIssues: issues,
        };
    }

    // 4. Classify validation issues for ordinary invoices
    const hardViolation = issues.find((issue) =>
        HARD_REJECTION_CODES.has(issue.code)
    );

    if (hardViolation) {
        return {
            ...createDecision(
                "REJECTED",
                hardViolation.code,
                hardViolation.message ??
                    "Invoice contains a prohibited negative value."
            ),
            validationIssues: issues,
        };
    }

    if (issues.length > 0) {
        return {
            ...createDecision(
                "NEEDS_REVIEW",
                issues[0].code ?? "VALIDATION_ISSUES",
                issues[0].message ??
                    "Invoice contains validation issues."
            ),
            validationIssues: issues,
        };
    }

    // 5. Duplicate detection
    if (duplicate?.isDuplicate) {
        return createDecision(
            "NEEDS_REVIEW",
            "DUPLICATE_VENDOR_INVOICE_NUMBER",
            duplicate.message ??
                "A possible duplicate invoice was detected."
        );
    }

    if (!duplicate || duplicate.reason !== "NO_DUPLICATE_FOUND") {
        return createDecision(
            "NEEDS_REVIEW",
            "DUPLICATE_CHECK_INCOMPLETE",
            duplicate?.message ??
                "Duplicate detection could not be completed."
        );
    }

    // 6. Vendor matching
    if (vendorMatch?.status !== "MATCHED") {
        return createDecision(
            "NEEDS_REVIEW",
            `VENDOR_${vendorMatch?.status ?? "UNKNOWN"}`,
            vendorMatch?.message ??
                "Vendor could not be reliably matched."
        );
    }

    // 7. PO matching
   if (poMatch?.status !== "MATCHED") {
        return createDecision(
            "NEEDS_REVIEW",
            poMatch?.reason ?? `PO_${poMatch?.status ?? "UNKNOWN"}`,
            poMatch?.message ??
                "Purchase order could not be reliably matched."
        );
   }

    // 8. Currency matching
    if (currencyMatch?.status !== "MATCHED") {
        return createDecision(
            "NEEDS_REVIEW",
            `CURRENCY_${currencyMatch?.status ?? "UNKNOWN"}`,
            currencyMatch?.message ??
                "Invoice and purchase order currencies could not be verified."
        );
    }

    // 9. PO allocation
    if (allocation?.status !== "ALLOCATED") {
        const allocationIssue = allocation?.issues?.[0];

        return createDecision(
            "NEEDS_REVIEW",
            allocationIssue?.reason ??
                `ALLOCATION_${allocation?.status ?? "UNKNOWN"}`,
            allocationIssue?.message ??
                allocation?.message ??
                "Invoice lines could not be fully allocated."
        );
    }

    // 10. All checks passed
    return createDecision(
        "APPROVED",
        "ALL_CHECKS_PASSED",
        "Invoice passed all validation, matching, currency, and allocation checks."
    );
}

function createDecision(outcome, reason, explanation) {
    return {
        outcome,
        reason,
        explanation,
        policyVersion: POLICY_VERSION,
    };
}
