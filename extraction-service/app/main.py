from fastapi import FastAPI, UploadFile, File, HTTPException
import os
import tempfile

from app.pdf_extractor import extract_text_from_pdf

app = FastAPI(
    title="InvoiceIQ Extraction Service",
    description="Hybrid PDF text extraction using PyMuPDF and Tesseract OCR",
    version="1.0.0"
)

@app.get("/health")
def health_check():
    return {
        "success": True,
        "message": "InvoiceIQ Extraction Service is running"
    }

@app.post("/extract/digital")
async def extract_digital(file: UploadFile = File(...)):

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported"
        )

    temp_path = None

    try:
        content = await file.read()

        if not content.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="Invalid PDF signature"
            )

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".pdf"
        ) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        result = extract_text_from_pdf(temp_path)

        if not result["success"]:
            raise HTTPException(
                status_code=422,
                detail="Could not extract PDF text"
            )

        return result

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

from app.ocr_extractor import extract_text_using_ocr


@app.post("/extract/ocr")
async def extract_ocr(file: UploadFile = File(...)):

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported"
        )

    temp_path = None

    try:
        content = await file.read()

        if not content.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="Invalid PDF signature"
            )

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".pdf"
        ) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        result = extract_text_using_ocr(temp_path)

        if not result["success"]:
            raise HTTPException(
                status_code=422,
                detail="OCR extraction failed"
            )

        return result

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)            

from app.pdf_detector import detect_pdf_type


@app.post("/detect")
async def detect_pdf(file: UploadFile = File(...)):

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported"
        )

    temp_path = None

    try:
        content = await file.read()

        if not content.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="Invalid PDF signature"
            )

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".pdf"
        ) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        result = detect_pdf_type(temp_path)

        if not result["success"]:
            raise HTTPException(
                status_code=422,
                detail="PDF detection failed"
            )

        return result

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

from app.hybrid_extractor import extract_hybrid
@app.post("/extract/hybrid")
async def extract_hybrid_endpoint(
    file: UploadFile = File(...)
):

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported"
        )

    temp_path = None

    try:
        content = await file.read()

        if not content.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="Invalid PDF signature"
            )

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".pdf"
        ) as temp_file:

            temp_file.write(content)
            temp_path = temp_file.name

        result = extract_hybrid(temp_path)

        if not result["success"]:
            raise HTTPException(
                status_code=422,
                detail="Hybrid extraction failed"
            )

        return result

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
