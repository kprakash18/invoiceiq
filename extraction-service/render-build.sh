#!/usr/bin/env bash
set -euo pipefail

# Render's native runtime does not provide root access. Use a portable Tesseract
# executable and download the official English traineddata alongside it.
TESSERACT_APPIMAGE="$PWD/.render/tesseract.AppImage"
TESSERACT_WRAPPER="$PWD/.render/tesseract-wrapper"
TESSDATA_DIR="$PWD/.render/tessdata"
mkdir -p "$TESSDATA_DIR"
curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/AlexanderP/tesseract-appimage/releases/download/v5.5.4/tesseract-5.5.4_lept-1.87-x86_64.AppImage" \
  --output "$TESSERACT_APPIMAGE"
chmod +x "$TESSERACT_APPIMAGE"

# Fetch language data from the official fast model repository.
curl --fail --location --silent --show-error --retry 3 \
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata" \
  --output "$TESSDATA_DIR/eng.traineddata"
test -s "$TESSDATA_DIR/eng.traineddata"

# The explicit --tessdata-dir argument avoids relying on the AppImage's
# compiled-in data path or on how its launcher handles TESSDATA_PREFIX.
cat > "$TESSERACT_WRAPPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export APPIMAGE_EXTRACT_AND_RUN=1
export TESSDATA_PREFIX="$SCRIPT_DIR/tessdata"
exec "$SCRIPT_DIR/tesseract.AppImage" --tessdata-dir "$TESSDATA_PREFIX" "$@"
EOF
chmod +x "$TESSERACT_WRAPPER"

# APPIMAGE_EXTRACT_AND_RUN avoids a FUSE dependency in Render's runtime.
export APPIMAGE_EXTRACT_AND_RUN=1
export TESSDATA_PREFIX="$TESSDATA_DIR"
"$TESSERACT_WRAPPER" --version
LANGUAGES="$("$TESSERACT_WRAPPER" --list-langs)"
printf '%s\n' "$LANGUAGES"
if ! printf '%s\n' "$LANGUAGES" | grep -Eq '^[[:space:]]+eng[[:space:]]*$'; then
  echo "Tesseract did not load eng.traineddata from $TESSDATA_DIR." >&2
  exit 1
fi

python -m pip install --upgrade pip
python -m pip install -r requirements.txt
