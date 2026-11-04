import fitz
import pytesseract
from PIL import Image
from io import BytesIO


def extract_text_using_ocr(file_path: str) -> dict:
    """
    Extract text from scanned PDF pages using Tesseract OCR.
    """
    try:
        document = fitz.open(file_path)

        pages = []
        total_text = ""

        for page_number, page in enumerate(document, start=1):

            # Render PDF page as an image at 300 DPI
            pix = page.get_pixmap(dpi=300)

            # Convert image bytes into PIL Image
            image = Image.open(
                BytesIO(pix.tobytes("png"))
            )

            # Extract text using Tesseract
            page_text = pytesseract.image_to_string(
                image,
                lang="eng"
            )

            pages.append({
                "page": page_number,
                "text": page_text.strip()
            })

            total_text += page_text + "\n"

        document.close()

        return {
            "success": True,
            "method": "OCR",
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