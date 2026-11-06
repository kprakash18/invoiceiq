from typing import Optional, Literal
from pydantic import BaseModel, Field


class ExtractedString(BaseModel):
    value: Optional[str] = None
    evidence: Optional[str] = None
    page: Optional[int] = None
    confidence: Optional[float] = None


class ExtractedNumber(BaseModel):
    value: Optional[float] = None
    evidence: Optional[str] = None
    page: Optional[int] = None
    confidence: Optional[float] = None


class VendorDetails(BaseModel):
    name: ExtractedString = Field(default_factory=ExtractedString)
    gstin: ExtractedString = Field(default_factory=ExtractedString)
    email: ExtractedString = Field(default_factory=ExtractedString)
    address: ExtractedString = Field(default_factory=ExtractedString)


class InvoiceLineItem(BaseModel):
    description: ExtractedString = Field(default_factory=ExtractedString)
    quantity: ExtractedNumber = Field(default_factory=ExtractedNumber)
    unit_price: ExtractedNumber = Field(default_factory=ExtractedNumber)
    tax_rate: ExtractedNumber = Field(default_factory=ExtractedNumber)
    tax_amount: ExtractedNumber = Field(default_factory=ExtractedNumber)
    line_total: ExtractedNumber = Field(default_factory=ExtractedNumber)


class InvoiceData(BaseModel):
    # Document classification
    document_type: Literal[
        "INVOICE",
        "CREDIT_NOTE",
        "CORRECTED_INVOICE",
        "UNKNOWN",
    ] = "UNKNOWN"

    original_invoice_number: ExtractedString = Field(
        default_factory=ExtractedString
    )

    invoice_number: ExtractedString = Field(default_factory=ExtractedString)
    invoice_date: ExtractedString = Field(default_factory=ExtractedString)
    due_date: ExtractedString = Field(default_factory=ExtractedString)
    currency: ExtractedString = Field(default_factory=ExtractedString)

    po_number: ExtractedString = Field(default_factory=ExtractedString)
    order_number: ExtractedString = Field(default_factory=ExtractedString)

    vendor: VendorDetails = Field(default_factory=VendorDetails)

    subtotal: ExtractedNumber = Field(default_factory=ExtractedNumber)

    # Whether tax is already included in the subtotal.
    tax_treatment: Literal[
        "INCLUSIVE",
        "EXCLUSIVE",
        "UNKNOWN",
    ] = "UNKNOWN"

    tax_amount: ExtractedNumber = Field(default_factory=ExtractedNumber)
    discount: ExtractedNumber = Field(default_factory=ExtractedNumber)
    total_amount: ExtractedNumber = Field(default_factory=ExtractedNumber)

    line_items: list[InvoiceLineItem] = Field(default_factory=list)
