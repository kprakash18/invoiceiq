
const unwrap = (field) => {
    if (field && typeof field === "object" && "value" in field) {
        return field.value;
    }

    return field ?? null;
};

const parseAmount = (value) => {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const amount = Number(value);

    return Number.isFinite(amount) ? amount : null;
};

const parseTaxRate = (value) => {
    const unwrapped = unwrap(value);

    if (unwrapped === null || unwrapped === undefined || unwrapped === "") {
        return null;
    }

    const normalized =
        typeof unwrapped === "string"
            ? unwrapped.trim().replace(/%$/, "")
            : unwrapped;

    return parseAmount(normalized);
};

const parseDate = (value) => {
    if (!value) return null;

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
};

const normalizeCurrency = (value) => {
    if (!value) {
        return {
            currencyCode: null,
            currencyStatus: "MISSING",
        };
    }

    const normalized = String(value).trim().toUpperCase();

    const knownCurrencies = {
        "₹": "INR",
        INR: "INR",
        USD: "USD",
        EUR: "EUR",
        GBP: "GBP",
    };

    if (knownCurrencies[normalized]) {
        return {
            currencyCode: knownCurrencies[normalized],
            currencyStatus: "IDENTIFIED",
        };
    }

    return {
        currencyCode: null,
        currencyStatus: "AMBIGUOUS",
    };
};

const normalizeLineItem = (item) => ({
    description: unwrap(item.description),
    quantity: parseAmount(unwrap(item.quantity)),
    unitPrice: parseAmount(unwrap(item.unit_price)),
    taxRate: parseTaxRate(item.tax_rate),
    taxAmount: parseAmount(unwrap(item.tax_amount)),
    lineTotal: parseAmount(unwrap(item.line_total)),
});

export function normalizeInvoiceData(invoiceData) {
    if (!invoiceData || typeof invoiceData !== "object") {
        return {
            success: false,
            status: "INVALID_EXTRACTION_DATA",
            message: "Invoice extraction data must be an object.",
        };
    }

    const lineItems = unwrap(invoiceData.line_items);

    if (lineItems !== null && !Array.isArray(lineItems)) {
        return {
            success: false,
            status: "INVALID_LINE_ITEMS",
            message: "Extracted invoice line items must be an array.",
        };
    }

    const currencyValue = unwrap(invoiceData.currency);
    const currency = normalizeCurrency(currencyValue);

    const allowedDocumentTypes = new Set([
        "INVOICE",
        "CREDIT_NOTE",
        "CORRECTED_INVOICE",
        "UNKNOWN",
    ]);

    const extractedDocumentType = invoiceData.document_type;

    const documentType = allowedDocumentTypes.has(extractedDocumentType)
        ? extractedDocumentType
        : "UNKNOWN";

    const normalized = {
        documentType,
        originalInvoiceNumber: unwrap(
            invoiceData.original_invoice_number
        ),

        invoiceNumber: unwrap(invoiceData.invoice_number),
        invoiceDate: parseDate(unwrap(invoiceData.invoice_date)),
        dueDate: parseDate(unwrap(invoiceData.due_date)),

        currency: currencyValue,
        currencyCode: currency.currencyCode,
        currencyStatus: currency.currencyStatus,

       subtotal: parseAmount(unwrap(invoiceData.subtotal)),
        taxTreatment: ["INCLUSIVE", "EXCLUSIVE", "UNKNOWN"].includes(
            invoiceData.tax_treatment
        )
            ? invoiceData.tax_treatment
            : "UNKNOWN",
taxAmount: parseAmount(unwrap(invoiceData.tax_amount)),
discount: parseAmount(unwrap(invoiceData.discount)),
        totalAmount: parseAmount(unwrap(invoiceData.total_amount)),

        lineItems: (lineItems ?? []).map(normalizeLineItem),

        vendor: {
            name: unwrap(invoiceData.vendor?.name),
            gstin: unwrap(invoiceData.vendor?.gstin),
            email: unwrap(invoiceData.vendor?.email),
            address: unwrap(invoiceData.vendor?.address),
        },

        poNumber: unwrap(invoiceData.po_number),
        orderNumber: unwrap(invoiceData.order_number),
    };

    const evidence = {
        documentType: invoiceData.document_type ?? null,
        originalInvoiceNumber:
            invoiceData.original_invoice_number ?? null,

        invoiceNumber: invoiceData.invoice_number ?? null,
        invoiceDate: invoiceData.invoice_date ?? null,
        dueDate: invoiceData.due_date ?? null,
        currency: invoiceData.currency ?? null,
        subtotal: invoiceData.subtotal ?? null,
        taxAmount: invoiceData.tax_amount ?? null,
        totalAmount: invoiceData.total_amount ?? null,
        lineItems: lineItems ?? [],
        vendor: invoiceData.vendor ?? null,
    };

    return {
        success: true,
        data: normalized,
        evidence,
    };
}
