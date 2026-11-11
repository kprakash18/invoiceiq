"""Runtime configuration for the extraction service package."""

import os
from pathlib import Path


def _configure_tesseract() -> None:
    """Configure the portable Tesseract binary and its bundled language data."""
    configured_command = os.getenv("TESSERACT_CMD")
    render_dir = Path(__file__).resolve().parents[1] / ".render"
    appimage = render_dir / "tesseract.AppImage"
    english_data = render_dir / "tessdata" / "eng.traineddata"

    if configured_command:
        command = configured_command
    elif appimage.is_file():
        command = str(appimage)
        os.environ.setdefault("APPIMAGE_EXTRACT_AND_RUN", "1")
    else:
        return

    if appimage.is_file():
        if not english_data.is_file() or english_data.stat().st_size == 0:
            raise RuntimeError(
                f"Tesseract English traineddata is missing: {english_data}"
            )

    if english_data.is_file():
        os.environ["TESSDATA_PREFIX"] = str(english_data.parent)

    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = command


_configure_tesseract()
