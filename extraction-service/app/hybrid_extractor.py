import fitz
import pytesseract

from PIL import Image
from io import BytesIO


TEXT_THRESHOLD = 30


def extract_hybrid(file_path: str) -> dict:
    """
    Extract text using PyMuPDF and Tesseract OCR.

    Digital pages -> PyMuPDF
    Scanned pages -> Tesseract OCR
    """

    try:
        document = fitz.open(file_path)

        pages = []
        total_text = ""

        digital_pages = 0
        scanned_pages = 0

        for page_number, page in enumerate(document, start=1):

            # First, attempt digital text extraction
            page_text = page.get_text("text").strip()

            if len(page_text) >= TEXT_THRESHOLD:

                method = "DIGITAL_TEXT"
                digital_pages += 1

            else:
                # If insufficient embedded text, use OCR
                pix = page.get_pixmap(dpi=300)

                image = Image.open(
                    BytesIO(pix.tobytes("png"))
                )

                page_text = pytesseract.image_to_string(
                    image,
                    lang="eng"
                ).strip()

                method = "OCR"
                scanned_pages += 1

            pages.append({
                "page": page_number,
                "method": method,
                "character_count": len(page_text),
                "text": page_text
            })

            total_text += page_text + "\n"

        document.close()

        if scanned_pages == 0:
            extraction_method = "DIGITAL_TEXT"

        elif digital_pages == 0:
            extraction_method = "OCR"

        else:
            extraction_method = "HYBRID"

        return {
            "success": True,
            "extraction_method": extraction_method,
            "total_pages": len(pages),
            "digital_pages": digital_pages,
            "scanned_pages": scanned_pages,
            "total_characters": len(total_text.strip()),
            "text": total_text.strip(),
            "pages": pages
        }

    except Exception as error:
        return {
            "success": False,
            "error": str(error)
        }