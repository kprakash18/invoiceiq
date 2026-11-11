"""Runtime configuration for the extraction service package."""

import os
from pathlib import Path


def _configure_tesseract() -> None:
    """Point pytesseract at the build-installed portable Tesseract binary."""
    configured_command = os.getenv("TESSERACT_CMD")
    appimage = (
        Path(__file__).resolve().parents[1]
        / ".render"
        / "tesseract.AppImage"
    )

    if configured_command:
        command = configured_command
    elif appimage.is_file():
        command = str(appimage)
        os.environ.setdefault("APPIMAGE_EXTRACT_AND_RUN", "1")
    else:
        return

    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = command


_configure_tesseract()
