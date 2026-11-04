import fitz
def extract_text_from_pdf(file_path: str) -> dict:
    """
    Extract embedded text from a digitally generated PDF.
    """
    try:
        document = fitz.open(file_path)
        pages = []
        total_text = ""
        for page_number, page in enumerate(document, start=1):
            page_text = page.get_text("text")
            pages.append({
                "page": page_number,
                "text": page_text.strip()
            })
            total_text += page_text + "\n"
        document.close()

        return {
            "success": True,
            "total_pages": len(pages),
            "total_characters": len(total_text.strip()),
            "text": total_text.strip(),
            "pages": pages
        }

    except Exception as error:
        return {
            "success": False,
            "error": str(error)
        }