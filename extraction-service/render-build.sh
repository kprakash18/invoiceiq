#!/usr/bin/env bash
set -euo pipefail

# pytesseract is only a wrapper; the OCR engine and English trained data are
# required at runtime by the existing extraction implementation.
sudo apt-get update
sudo apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
