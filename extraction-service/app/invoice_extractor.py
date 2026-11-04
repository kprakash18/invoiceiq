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
7. Identify the correct invoice date, due date and PO number.
8. Distinguish subtotal, tax, discount and total amount.
9. Preserve evidence for every extracted value.
10. Include the source page number whenever available.
11. Confidence must be between 0 and 1.
12. Do not confuse payment receipts with vendor invoices.

Return data matching the provided InvoiceData schema.

INVOICE TEXT:

{invoice_text}
"""


def extract_invoice_data(invoice_text: str) -> dict:

    if not invoice_text or not invoice_text.strip():
        return {
            "success": False,
            "error": "Invoice text is empty"
        }

    prompt = INVOICE_EXTRACTION_PROMPT.format(
        invoice_text=invoice_text
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