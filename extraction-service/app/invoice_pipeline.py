from app.hybrid_extractor import extract_hybrid
from app.invoice_extractor import extract_invoice_data
from app.invoice_validator import validate_invoice


def process_invoice_pdf(file_path: str) -> dict:
    """
    Process a PDF invoice through hybrid extraction,
    Gemini structured extraction, and validation.
    """

    # Step 1: Extract text from the PDF
    pdf_result = extract_hybrid(file_path)

    if not pdf_result.get("success"):
        return {
            "success": False,
            "stage": "PDF_EXTRACTION",
            "error": pdf_result.get("error")
        }

    if not pdf_result.get("text", "").strip():
        return {
            "success": False,
            "stage": "PDF_EXTRACTION",
            "error": "No readable text could be extracted from the PDF."
        }

    # Step 2: Extract structured invoice data
    extraction_result = extract_invoice_data(pdf_result["pages"])

    if not extraction_result.get("success"):
        return {
            "success": False,
            "stage": "AI_EXTRACTION",
            "error": extraction_result.get("error"),
            "pdf_extraction": {
                "extraction_method": pdf_result["extraction_method"],
                "total_pages": pdf_result["total_pages"]
            }
        }

    invoice_data = extraction_result["data"]

    # Step 3: Validate invoice data
    validation_result = validate_invoice(invoice_data)

    if not validation_result.get("success"):
        return {
            "success": False,
            "stage": "VALIDATION",
            "error": validation_result.get("error"),
            "invoice_data": invoice_data
        }

    # Step 4: Determine review requirement
    requires_review = (
        validation_result["error_count"] > 0
        or validation_result["warning_count"] > 0
    )

    # Step 5: Return unified result
    return {
        "success": True,
        "stage": "COMPLETED",
        "pdf_extraction": {
            "extraction_method": pdf_result["extraction_method"],
            "total_pages": pdf_result["total_pages"],
            "digital_pages": pdf_result["digital_pages"],
            "scanned_pages": pdf_result["scanned_pages"],
            "total_characters": pdf_result["total_characters"]
        },
        "invoice_data": invoice_data,
        "validation": validation_result,
        "validation_status": (
            "NEEDS_REVIEW" if requires_review else "PASSED"
        ),
        "requires_review": requires_review
    }