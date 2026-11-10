import pytesseract

from PIL import Image, UnidentifiedImageError


def extract_text_from_image(file_path: str) -> dict:
    """
    Extract text from a scanned invoice image using Tesseract OCR.
    """
    try:
        with Image.open(file_path) as image:
            image.verify()

        with Image.open(file_path) as image:
            normalized_image = image.convert("RGB")
            page_text = pytesseract.image_to_string(
                normalized_image,
                lang="eng"
            ).strip()

        return {
            "success": True,
            "extraction_method": "OCR",
            "total_pages": 1,
            "digital_pages": 0,
            "scanned_pages": 1,
            "total_characters": len(page_text),
            "text": page_text,
            "pages": [
                {
                    "page": 1,
                    "method": "OCR",
                    "character_count": len(page_text),
                    "text": page_text
                }
            ]
        }

    except UnidentifiedImageError:
        return {
            "success": False,
            "error": "Uploaded image is corrupt or unreadable."
        }

    except Exception as error:
        return {
            "success": False,
            "error": str(error)
        }
