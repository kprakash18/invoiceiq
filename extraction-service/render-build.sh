#!/usr/bin/env bash
set -euo pipefail

# Render's native runtime does not provide root access. Use the pinned portable
# AppImage, which bundles Tesseract and English traineddata, instead of apt.
TESSERACT_APPIMAGE="$PWD/.render/tesseract.AppImage"
mkdir -p "$(dirname "$TESSERACT_APPIMAGE")"
curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/AlexanderP/tesseract-appimage/releases/download/v5.5.4/tesseract-5.5.4_lept-1.87-x86_64.AppImage" \
  --output "$TESSERACT_APPIMAGE"
chmod +x "$TESSERACT_APPIMAGE"

# APPIMAGE_EXTRACT_AND_RUN avoids a FUSE dependency in Render's runtime.
APPIMAGE_EXTRACT_AND_RUN=1 "$TESSERACT_APPIMAGE" --version
LANGUAGES="$(APPIMAGE_EXTRACT_AND_RUN=1 "$TESSERACT_APPIMAGE" --list-langs)"
printf '%s\n' "$LANGUAGES"
if ! printf '%s\n' "$LANGUAGES" | grep -Eq '^[[:space:]]+eng[[:space:]]*$'; then
  echo "The portable Tesseract build is missing English traineddata." >&2
  exit 1
fi

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
