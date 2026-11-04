import fitz


def detect_pdf_type(file_path: str) -> dict:
    """
    Detect whether a PDF is digitally generated or scanned.
    """

    try:
        document = fitz.open(file_path)

        page_results = []

        for page_number, page in enumerate(document, start=1):

            text = page.get_text("text").strip()

            character_count = len(text)

            if character_count >= 30:
                page_type = "DIGITAL"
            else:
                page_type = "SCANNED"

            page_results.append({
                "page": page_number,
                "type": page_type,
                "character_count": character_count
            })

        document.close()

        digital_pages = sum(
            1 for page in page_results
            if page["type"] == "DIGITAL"
        )

        scanned_pages = len(page_results) - digital_pages

        if scanned_pages == 0:
            pdf_type = "DIGITAL"
        elif digital_pages == 0:
            pdf_type = "SCANNED"
        else:
            pdf_type = "MIXED"

        return {
            "success": True,
            "pdf_type": pdf_type,
            "total_pages": len(page_results),
            "digital_pages": digital_pages,
            "scanned_pages": scanned_pages,
            "pages": page_results
        }

    except Exception as error:
        return {
            "success": False,
            "error": str(error)
        }