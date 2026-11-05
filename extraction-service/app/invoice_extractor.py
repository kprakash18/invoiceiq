import json
import time
from app.gemini_client import client, GEMINI_MODEL
from app.invoice_schema import InvoiceData



INVOICE_EXTRACTION_PROMPT = """
You are an expert accounts payable invoice extraction system.

Your task is to extract invoice information from the provided text.

RULES:

1. Extract only information explicitly available in the document.
2. Never invent or assume missing information.
3. If a field is missing, return null for its value.
4. Preserve the original invoice number and vendor name.
5. Convert monetary values and quantities into numbers.
6. Extract all available invoice line items.
7. Identify the correct invoice date and due date.

8. PURCHASE ORDER AND ORDER NUMBER RULES:
   - Extract po_number only when the document explicitly identifies a reference as
     "PO Number", "PO No.", "Purchase Order Number", "Purchase Order No.",
     or an unambiguous equivalent.
   - Extract order_number when the document labels a reference as
     "Order Number", "Order No.", or a vendor order reference.
   - Never assume that a generic Order Number is a Purchase Order Number.
   - Never copy order_number into po_number.
   - If no explicit purchase order reference exists, po_number.value must be null.
   - Preserve the exact reference as printed in the invoice.

9. Distinguish subtotal, tax, discount and total amount.
10. Preserve evidence for every extracted value.
11. Include the exact source page number for every extracted field.
12. If page markers such as PAGE 1 or PAGE 2 are provided, use the corresponding page number.
13. Never invent a page number. If the source page cannot be determined, return null.
14. Confidence must be between 0 and 1.
15. Do not confuse payment receipts with vendor invoices.

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
        return {"success": False, "error": "Invoice text is empty"}

    try:
        formatted_text = format_invoice_input(invoice_text)
    except (ValueError, AttributeError, TypeError) as error:
        return {"success": False, "error": str(error)}

    if not formatted_text.strip():
        return {"success": False, "error": "Invoice text is empty"}

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
                    "response_schema": InvoiceData
                }
            )

            if not response.text:
                return {
                    "success": False,
                    "error": "Gemini returned an empty response"
                }

            extracted_json = json.loads(response.text)

            invoice_data = InvoiceData.model_validate(
                extracted_json
            )

            return {
                "success": True,
                "data": invoice_data.model_dump()
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
                "error": error_message
            }

    return {
        "success": False,
        "error": "Gemini request failed after retries"
    }

    if not invoice_text or not invoice_text.strip():
        return {
            "success": False,
            "error": "Invoice text is empty"
        }

    try:

        prompt = INVOICE_EXTRACTION_PROMPT.format(
            invoice_text=invoice_text
        )

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": InvoiceData
            }
        )

        if not response.text:
            return {
                "success": False,
                "error": "Gemini returned an empty response"
            }

        extracted_json = json.loads(response.text)

        invoice_data = InvoiceData.model_validate(
            extracted_json
        )

        return {
            "success": True,
            "data": invoice_data.model_dump()
        }

    except Exception as error:

        return {
            "success": False,
            "error": str(error)
        }