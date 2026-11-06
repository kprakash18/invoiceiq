
import re
import math
from datetime import datetime


# Maximum allowed difference in invoice arithmetic (in currency units).
AMOUNT_TOLERANCE = 1.0

GSTIN_PATTERN = re.compile(
    r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"
)


def get_value(data, *keys):
    """Safely retrieve a nested extracted value."""
    current = data

    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)

    if isinstance(current, dict):
        return current.get("value")

    return current


def add_issue(results, field, severity, code, message, observed_value=None):
    results.append({
        "field": field,
        "severity": severity,
        "code": code,
        "message": message,
        "observed_value": observed_value
    })


def is_valid_date(value):
    """Accept common invoice date formats."""
    if not isinstance(value, str):
        return False

    formats = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%Y/%m/%d",
        "%d.%m.%Y",
        "%d-%b-%Y",
        "%d %b %Y",
        "%B %d, %Y",
        "%b %d, %Y",
        "%d %B %Y",
        "%d %b, %Y"
    ]

    for date_format in formats:
        try:
            datetime.strptime(value.strip(), date_format)
            return True
        except ValueError:
            continue

    return False


def validate_required_fields(data, results):
    required_fields = {
        "invoice_number": get_value(data, "invoice_number"),
        "invoice_date": get_value(data, "invoice_date"),
        "vendor.name": get_value(data, "vendor", "name"),
        "total_amount": get_value(data, "total_amount")
    }

    for field, value in required_fields.items():
        if value is None or (
            isinstance(value, str) and not value.strip()
        ):
            add_issue(
                results,
                field,
                "ERROR",
                "MISSING_REQUIRED_FIELD",
                f"Required field '{field}' is missing."
            )


def validate_dates(data, results):
    invoice_date = get_value(data, "invoice_date")
    due_date = get_value(data, "due_date")

    if invoice_date and not is_valid_date(invoice_date):
        add_issue(
            results,
            "invoice_date",
            "ERROR",
            "INVALID_DATE",
            "Invoice date has an unsupported or invalid format.",
            invoice_date
        )

    if due_date and not is_valid_date(due_date):
        add_issue(
            results,
            "due_date",
            "ERROR",
            "INVALID_DATE",
            "Due date has an unsupported or invalid format.",
            due_date
        )


def validate_gstin(data, results):
    gstin = get_value(data, "vendor", "gstin")

    if gstin:
        normalized_gstin = gstin.strip().upper()

        if not GSTIN_PATTERN.fullmatch(normalized_gstin):
            add_issue(
                results,
                "vendor.gstin",
                "WARNING",
                "INVALID_GSTIN_FORMAT",
                "Vendor GSTIN does not match the expected 15-character format.",
                gstin
            )


def validate_numeric_fields(data, results):
    amount_fields = [
        "subtotal",
        "tax_amount",
        "discount",
        "total_amount"
    ]

    for field in amount_fields:
        value = get_value(data, field)

        if value is None:
            continue

        if not isinstance(value, (int, float)) or not math.isfinite(value):
            add_issue(
                results,
                field,
                "ERROR",
                "INVALID_AMOUNT",
                f"{field} must be a valid finite number.",
                value
            )

        elif value < 0:
            add_issue(
                results,
                field,
                "ERROR",
                "NEGATIVE_AMOUNT",
                f"{field} cannot be negative.",
                value
            )


def validate_line_items(data, results):
    line_items = data.get("line_items", [])

    if not isinstance(line_items, list):
        add_issue(
            results,
            "line_items",
            "ERROR",
            "INVALID_LINE_ITEMS",
            "Line items must be a list."
        )
        return

    for index, item in enumerate(line_items):
        if not isinstance(item, dict):
            add_issue(
                results,
                f"line_items[{index}]",
                "ERROR",
                "INVALID_LINE_ITEM",
                "Line item must be an object."
            )
            continue

        for field in [
            "quantity",
            "unit_price",
            "tax_rate",
            "tax_amount",
            "line_total"
        ]:
            value = get_value(item, field)

            if value is None:
                continue

            if not isinstance(value, (int, float)) or not math.isfinite(value):
                add_issue(
                    results,
                    f"line_items[{index}].{field}",
                    "ERROR",
                    "INVALID_LINE_ITEM_NUMBER",
                    f"Line item {field} must be a valid finite number.",
                    value
                )

            elif value < 0:
                add_issue(
                    results,
                    f"line_items[{index}].{field}",
                    "ERROR",
                    "NEGATIVE_LINE_ITEM_VALUE",
                    f"Line item {field} cannot be negative.",
                    value
                )

        tax_rate = get_value(item, "tax_rate")

        if isinstance(tax_rate, (int, float)) and math.isfinite(tax_rate):
            if tax_rate > 100:
                add_issue(
                    results,
                    f"line_items[{index}].tax_rate",
                    "WARNING",
                    "UNUSUAL_TAX_RATE",
                    "Tax rate exceeds 100%.",
                    tax_rate
                )


def validate_invoice_arithmetic(data, results):
    subtotal = get_value(data, "subtotal")
    tax_amount = get_value(data, "tax_amount")
    discount = get_value(data, "discount")
    total = get_value(data, "total_amount")

    tax_treatment = data.get("tax_treatment", "UNKNOWN")

    if not isinstance(tax_treatment, str):
        tax_treatment = "UNKNOWN"

    tax_treatment = tax_treatment.strip().upper()

    # Required values must be present and valid.
    # A missing tax amount must never be assumed to be zero.
    values = [subtotal, tax_amount, total]

    if not all(
        isinstance(value, (int, float))
        and math.isfinite(value)
        for value in values
    ):
        return

    if discount is None:
        discount = 0

    if (
        not isinstance(discount, (int, float))
        or not math.isfinite(discount)
    ):
        return

    # When tax is zero, tax treatment does not affect arithmetic.
    if tax_amount == 0:
        expected_total = subtotal - discount

    elif tax_treatment == "EXCLUSIVE":
        # Tax is added to the subtotal.
        expected_total = subtotal + tax_amount - discount

    elif tax_treatment == "INCLUSIVE":
        # Tax is already included in the subtotal.
        expected_total = subtotal - discount

    elif tax_treatment == "UNKNOWN":
        add_issue(
            results,
            "tax_treatment",
            "WARNING",
            "TAX_TREATMENT_UNCLEAR",
            (
                "Tax treatment could not be determined. "
                "Human review is required before verifying "
                "the invoice total."
            ),
            tax_treatment
        )
        return

    else:
        add_issue(
            results,
            "tax_treatment",
            "WARNING",
            "INVALID_TAX_TREATMENT",
            "Tax treatment must be INCLUSIVE, EXCLUSIVE, or UNKNOWN.",
            tax_treatment
        )
        return

    difference = abs(expected_total - total)

    if difference > AMOUNT_TOLERANCE:
        add_issue(
            results,
            "total_amount",
            "WARNING",
            "ARITHMETIC_MISMATCH",
            (
                f"Expected total {expected_total:.2f}, "
                f"but extracted total is {total:.2f}. "
                f"Difference: {difference:.2f}."
            ),
            total
        )


def validate_invoice(data):
    """Run all validation checks on Gemini's extracted invoice data."""

    results = []

    if not isinstance(data, dict):
        return {
            "success": False,
            "error": "Invoice data must be a dictionary.",
            "results": []
        }

    validate_required_fields(data, results)
    validate_dates(data, results)
    validate_gstin(data, results)
    validate_numeric_fields(data, results)
    validate_line_items(data, results)
    validate_invoice_arithmetic(data, results)

    error_count = sum(
        1 for result in results if result["severity"] == "ERROR"
    )

    warning_count = sum(
        1 for result in results if result["severity"] == "WARNING"
    )

    return {
        "success": True,
        "is_valid": error_count == 0,
        "error_count": error_count,
        "warning_count": warning_count,
        "results": results
    }
