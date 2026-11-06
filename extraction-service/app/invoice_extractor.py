import json
import time

from app.gemini_client import client, GEMINI_MODEL
from app.invoice_schema import InvoiceData


INVOICE_EXTRACTION_PROMPT = """
You are an expert accounts payable invoice extraction system.

Extract invoice information from the provided document text.

GENERAL RULES:

1. Extract only information explicitly available in the document.
2. Never invent or assume missing information.
3. If a field is missing, return null for its value.
4. Preserve the original invoice number and vendor name.
5. Convert monetary values and quantities into numbers.
6. Extract all available invoice line items.
7. Identify the correct invoice date and due date.
8. Distinguish subtotal, tax, discount and total amount.
9. Preserve evidence for every extracted value.
10. Include the exact source page number for every extracted field.
11. Never invent a page number.
12. Confidence must be between 0 and 1.
13. Do not confuse payment receipts with vendor invoices.

DOCUMENT CLASSIFICATION RULES:

14. Identify document_type using explicit document wording.

    - INVOICE: An ordinary vendor invoice.
    - CREDIT_NOTE: A document explicitly identified as a credit note,
      credit memo, or equivalent credit adjustment.
    - CORRECTED_INVOICE: A document explicitly identified as a corrected,
      revised, amended, or replacement invoice.
    - UNKNOWN: The document type cannot be reliably determined.

15. Do not classify an ordinary invoice as a corrected invoice merely
    because it contains the word "revised" in unrelated text.

16. Do not classify a document as a credit note merely because it contains
    negative amounts.

17. Extract original_invoice_number only when the document explicitly
    references the invoice being corrected or credited.

18. Look for labels such as:
    - Original Invoice Number
    - Reference Invoice
    - Against Invoice No.
    - Corrected Invoice Against
    - Credit Note Against Invoice

19. Never copy the current invoice number into original_invoice_number.

20. If no explicit original invoice reference exists,
    original_invoice_number.value must be null.

PURCHASE ORDER AND ORDER NUMBER RULES:

21. Extract po_number only when the document explicitly identifies a
    reference as "PO Number", "PO No.", "Purchase Order Number",
    "Purchase Order No.", or an unambiguous equivalent.

22. Extract order_number when the document labels a reference as
    "Order Number", "Order No.", or a vendor order reference.

23. Never assume that a generic Order Number is a Purchase Order Number.

24. Never copy order_number into po_number.

25. If no explicit purchase order reference exists, po_number.value must
    be null.

26. Preserve the exact reference as printed in the invoice.

TAX TREATMENT RULES:

27. Identify tax_treatment using explicit evidence from the invoice.

    - EXCLUSIVE: Tax is charged separately and added to the taxable
      subtotal to calculate the invoice total.

    - INCLUSIVE: The subtotal or listed item prices explicitly include
      tax, and tax_amount represents the included tax component.

    - UNKNOWN: The invoice does not clearly establish whether tax is
      included or charged separately.

28. Look for explicit labels and wording such as:
    - Tax Inclusive
    - GST Included
    - Inclusive of Tax
    - Tax Exclusive
    - GST Extra
    - Prices inclusive of GST
    - Prices exclusive of GST

29. Do not infer tax treatment from arithmetic alone.

30. Do not add an included tax amount to an already tax-inclusive
    subtotal.

31. Preserve the exact source evidence supporting tax_treatment.

32. If evidence is unclear, missing, or contradictory, return UNKNOWN.

33. Do not confuse the tax treatment of individual line items with
    the tax treatment of the invoice subtotal.

34. If the invoice explicitly states that prices include tax, classify
    the treatment as INCLUSIVE even when tax is displayed separately
    as a breakdown.

35. If the invoice explicitly states that tax is added separately,
    classify the treatment as EXCLUSIVE.

36. Preserve the printed unit_price exactly as shown. Never remove,
    add, or calculate tax into the unit price.

37. Extract line_total exactly as printed. Preserve tax_amount separately.
    Do not calculate line totals from quantity and unit_price.

38. If the invoice does not clearly establish whether unit_price includes
    tax, do not assume its pricing basis.
    
Return data matching the provided InvoiceData schema.

INVOICE TEXT:

{invoice_text}
"""


def format_invoice_input(invoice_input):
    """
    Format invoice text while preserving page numbers.

    Accepts either:
    - A plain text string
    - A list of page dictionaries from extract_hybrid()
    """

    if isinstance(invoice_input, str):
        return invoice_input

    if isinstance(invoice_input, list):
        formatted_pages = []

        for page_data in invoice_input:
            page_number = page_data.get("page")
            method = page_data.get("method", "UNKNOWN")
            page_text = page_data.get("text", "")

            if not page_text.strip():
                continue

            formatted_pages.append(
                f"PAGE {page_number} (Extraction method: {method}):\n"
                f"{page_text}"
            )

        return "\n\n".join(formatted_pages)

    raise ValueError("Invoice input must be text or a list of pages.")


def extract_invoice_data(invoice_text: str | list[dict]) -> dict:

    if not invoice_text:
        return {
            "success": False,
            "error": "Invoice text is empty",
        }

    try:
        formatted_text = format_invoice_input(invoice_text)

    except (ValueError, AttributeError, TypeError) as error:
        return {
            "success": False,
            "error": str(error),
        }

    if not formatted_text.strip():
        return {
            "success": False,
            "error": "Invoice text is empty",
        }

    prompt = INVOICE_EXTRACTION_PROMPT.format(
        invoice_text=formatted_text
    )

    max_attempts = 3

    for attempt in range(max_attempts):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "response_schema": InvoiceData,
                },
            )

            if not response.text:
                return {
                    "success": False,
                    "error": "Gemini returned an empty response",
                }

            extracted_json = json.loads(response.text)

            invoice_data = InvoiceData.model_validate(
                extracted_json
            )

            return {
                "success": True,
                "data": invoice_data.model_dump(),
            }

        except Exception as error:
            error_message = str(error)

            is_temporary_error = (
                "503" in error_message
                or "UNAVAILABLE" in error_message
                or "429" in error_message
                or "RESOURCE_EXHAUSTED" in error_message
            )

            if is_temporary_error and attempt < max_attempts - 1:
                wait_time = 2 ** (attempt + 1)

                print(
                    f"Gemini temporarily unavailable. "
                    f"Retrying in {wait_time} seconds..."
                )

                time.sleep(wait_time)
                continue

            return {
                "success": False,
                "error": error_message,
            }

    return {
        "success": False,
        "error": "Gemini request failed after retries",
    }
