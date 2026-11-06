
import { useEffect, useState } from 'react'

import {
  ArrowLeft,
  FileText,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  LoaderCircle,
  ChevronDown,
} from 'lucide-react'

import StatusBadge from './StatusBadge'
import {
  getInvoiceById,
  getApiError,
  getInvoiceFileUrl,
} from '../services/invoiceService'

const formatCurrency = (amount, currency = 'INR') => {
  if (amount == null) return '—'

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount))
}

const formatDate = (date) => {
  if (!date) return '—'

  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const formatDateTime = (date) => {
  if (!date) return '—'

  return new Date(date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

const formatValue = (value) => {
  if (value == null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const stageStatusIcon = (status) => {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 size={18} />
    case 'FAILED':
      return <XCircle size={18} />
    case 'SKIPPED':
      return <SkipForward size={18} />
    case 'IN_PROGRESS':
      return <LoaderCircle size={18} />
    default:
      return <Clock size={18} />
  }
}

const stageStatusClass = (status) => {
  switch (status) {
    case 'COMPLETED':
      return 'stage-completed'
    case 'FAILED':
      return 'stage-failed'
    case 'SKIPPED':
      return 'stage-skipped'
    case 'IN_PROGRESS':
      return 'stage-running'
    default:
      return 'stage-pending'
  }
}

const stageLabel = (name) => {
  const labels = {
    PDF_EXTRACTION: 'PDF Extraction',
    NORMALIZATION: 'Data Normalization',
    VALIDATION: 'Validation',
    VENDOR_MATCHING: 'Vendor Matching',
    DUPLICATE_CHECK: 'Duplicate Detection',
    PO_MATCHING: 'Purchase Order Matching',
    PO_ALLOCATION: 'PO Allocation',
    DECISION: 'Final Decision',
    ORCHESTRATION: 'Processing',
  }

  return labels[name] || name?.replaceAll('_', ' ') || 'Processing Stage'
}

function InvoiceDetails({ invoice, onBack }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadInvoice() {
      try {
        setLoading(true)
        setError('')

        const response = await getInvoiceById(invoice.id)

        if (active) {
          setDetails(response.data)
        }
      } catch (err) {
        if (active) {
          setError(getApiError(err))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadInvoice()

    return () => {
      active = false
    }
  }, [invoice.id])

  if (loading) {
    return <div className="details-page">Loading invoice details...</div>
  }

  if (error) {
    return (
      <div className="details-page">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to invoices
        </button>
        <p className="error-message">{error}</p>
      </div>
    )
  }

  if (!details) return null

  const run = details.processingRuns?.[0]
  const stages = run?.stages || []
  const validations = run?.validations || []
  const decision = run?.decision
  const currency = details.currency || 'INR'
  const pdfUrl = getInvoiceFileUrl(details.id)

  return (
    <div className="details-page">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to invoices
      </button>

      {/* Invoice summary */}
      <section className="invoice-summary">
        <div className="summary-main">
          <div>
            <div className="summary-title">
              <FileText size={22} />
              <h1>{details.invoiceNumber || details.originalFileName}</h1>
              <StatusBadge status={details.status} />
            </div>

            <p>{details.originalFileName}</p>
          </div>

          <div className="summary-amount">
            <span>Total Amount</span>
            <strong>
              {formatCurrency(details.totalAmount, currency)}
            </strong>
          </div>
        </div>
      </section>

     {/* Original invoice PDF */}
      <section className="detail-section document-section">
        <div className="document-heading">
          <div>
            <h2>Original Invoice</h2>
            <p>{details.originalFileName || 'Original document'}</p>
          </div>

          <a href={pdfUrl} target="_blank" rel="noreferrer">
            Open PDF in new tab
          </a>
        </div>

        {details.originalFileName ? (
          <iframe
            className="invoice-pdf"
            src={pdfUrl}
            title="Original invoice PDF"
          />
        ) : (
          <p className="detail-empty">Original invoice file is unavailable.</p>
        )}
      </section>

      {/* Invoice information */}
      <section className="detail-section">
        <h2>Invoice Information</h2>

        <div className="extracted-fields">
          <div>
            <label>Invoice Number</label>
            <strong>{details.invoiceNumber || '—'}</strong>
          </div>

          <div>
            <label>Invoice Date</label>
            <strong>{formatDate(details.invoiceDate)}</strong>
          </div>

          <div>
            <label>Due Date</label>
            <strong>{formatDate(details.dueDate)}</strong>
          </div>

          <div>
            <label>Subtotal</label>
            <strong>{formatCurrency(details.subtotal, currency)}</strong>
          </div>

          <div>
            <label>Tax Amount</label>
            <strong>{formatCurrency(details.taxAmount, currency)}</strong>
          </div>

          <div>
            <label>Currency</label>
            <strong>{currency}</strong>
          </div>
        </div>

        <div className="detail-file">
          <FileText size={20} />
          <div>
            <label>Original File</label>
            <strong>{details.originalFileName}</strong>
          </div>
        </div>
      </section>

      {/* Vendor */}
      <section className="detail-section">
        <h2>Vendor</h2>

        {details.vendor ? (
          <div className="extracted-fields">
            <div>
              <label>Vendor Name</label>
              <strong>{details.vendor.name || '—'}</strong>
            </div>

            <div>
              <label>GSTIN</label>
              <strong>{details.vendor.taxId || '—'}</strong>
            </div>

            <div>
              <label>Email</label>
              <strong>{details.vendor.email || '—'}</strong>
            </div>
          </div>
        ) : (
          <p className="detail-empty">
            No vendor has been matched to this invoice.
          </p>
        )}
      </section>

      {/* Line items */}
      <section className="detail-section">
        <h2>Line Items</h2>

        {details.items?.length ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Tax</th>
                  <th>Line Total</th>
                </tr>
              </thead>

              <tbody>
                {details.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description || '—'}</td>
                    <td>{formatValue(item.quantity)}</td>
                    <td>{formatCurrency(item.unitPrice, currency)}</td>
                    <td>{formatCurrency(item.taxAmount, currency)}</td>
                    <td>{formatCurrency(item.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="detail-empty">No line items were extracted.</p>
        )}
      </section>


      {/* Purchase order and allocation */}
      <div className="allocation-section">
        <h3>Allocation & Variance Breakdown</h3>

        {details.purchaseOrder?.items?.length > 0 ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>PO Item</th>
                  <th>Invoice Item</th>
                  <th>Ordered</th>
                  <th>Previously Invoiced</th>
                  <th>Current Allocated</th>
                  <th>Remaining</th>
                  <th>PO Unit Price</th>
                  <th>Invoice Unit Price</th>
                  <th>Unit Variance</th>
                  <th>Total Variance</th>
                </tr>
              </thead>

              <tbody>
                {details.purchaseOrder.items.flatMap((poItem) => {
                  const breakdown = poItem.allocationBreakdown
                  const allocations = breakdown?.currentAllocations || []

                  const rows = allocations.length > 0 ? allocations : [null]

                  return rows.map((allocation, index) => {
                    const unitVariance = allocation
                      ? allocation.invoiceUnitPrice - breakdown.poUnitPrice
                      : null

                    const totalVariance = allocation
                      ? unitVariance * allocation.allocatedQuantity
                      : null

                    return (
                      <tr key={`${poItem.id}-${index}`}>
                        <td>
                          <strong>{poItem.description}</strong>
                          <br />
                          <small>{poItem.itemCode || '—'}</small>
                        </td>

                        <td>{allocation?.invoiceDescription || '—'}</td>

                        <td>{formatValue(breakdown?.orderedQuantity)}</td>

                        <td>
                          {formatValue(breakdown?.previouslyInvoicedQuantity)}
                        </td>

                        <td>
                          {formatValue(breakdown?.currentAllocatedQuantity)}
                        </td>

                        <td>{formatValue(breakdown?.remainingQuantity)}</td>

                        <td>
                          {formatCurrency(breakdown?.poUnitPrice, currency)}
                        </td>

                        <td>
                          {allocation
                            ? formatCurrency(allocation.invoiceUnitPrice, currency)
                            : '—'}
                        </td>

                        <td>
                          {unitVariance !== null
                            ? formatCurrency(unitVariance, currency)
                            : '—'}
                        </td>

                        <td>
                          {totalVariance !== null
                            ? formatCurrency(totalVariance, currency)
                            : '—'}
                        </td>
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="detail-empty">No PO line items are available.</p>
        )}
      </div>


      {/* Processing timeline */}
      <section className="detail-section">
        <h2>Processing Timeline</h2>

        {run ? (
          <>
            <p className="detail-muted">
              Attempt {run.attempt} ·{' '}
              {run.extractionMethod || 'Extraction method unavailable'}
            </p>

            <div className="processing-timeline">
              {stages.map((stage) => (
                <div className="timeline-stage" key={stage.id}>
                  <div className={`stage-icon ${stageStatusClass(stage.status)}`}>
                    {stageStatusIcon(stage.status)}
                  </div>

                  <div className="stage-content">
                    <div className="stage-heading">
                      <strong>{stageLabel(stage.name)}</strong>
                      <span>{stage.status.replaceAll('_', ' ')}</span>
                    </div>

                    <p>
                      {stage.message || stage.error || 'No additional information.'}
                    </p>

                    <div className="stage-times">
                      <span>
                        Started: {formatDateTime(stage.startedAt)}
                      </span>

                      <span>
                        Completed: {formatDateTime(stage.completedAt)}
                      </span>

                      {stage.durationMs != null && (
                        <span>Duration: {stage.durationMs} ms</span>
                      )}
                    </div>

                    {stage.error && (
                      <p className="stage-error">{stage.error}</p>
                    )}

                    {stage.metadata && (
                      <details className="stage-metadata">
                        <summary>
                          View stage metadata
                          <ChevronDown size={15} />
                        </summary>

                        <pre>
                          {JSON.stringify(stage.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="detail-empty">
            No processing run is available.
          </p>
        )}
      </section>

      {/* Validation results */}
      <section className="detail-section">
        <h2>Validation Results</h2>

        {validations.length ? (
          <div className="validation-list">
            {validations.map((result) => (
              <div className="validation-item" key={result.id}>
                <div className="validation-heading">
                  {result.passed ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    <AlertCircle size={18} />
                  )}

                  <strong>{result.ruleCode}</strong>
                  <span>{result.severity}</span>
                </div>

                <p>{result.message}</p>

                <div className="validation-values">
                  <div>
                    <label>Field</label>
                    <strong>{result.field || '—'}</strong>
                  </div>

                  <div>
                    <label>Expected</label>
                    <strong>{formatValue(result.expectedValue)}</strong>
                  </div>

                  <div>
                    <label>Actual</label>
                    <strong>{formatValue(result.actualValue)}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="detail-empty">
            No validation results recorded.
          </p>
        )}
      </section>

      {/* Final decision */}
      <section className="detail-section decision-section">
        <h2>Final Decision</h2>

        {decision ? (
          <div
            className={`decision-card decision-${decision.outcome
              .toLowerCase()
              .replaceAll('_', '-')}`}
          >
            <div className="decision-card-header">
              <div>
                <span className="decision-eyebrow">
                  PROCESSING OUTCOME
                </span>

                <div className="decision-outcome">
                  <StatusBadge status={decision.outcome} />
                </div>
              </div>

              <span className="decision-policy">
                Policy v{decision.policyVersion}
              </span>
            </div>

            <div className="decision-reason">
              <span>Decision reason</span>
              <strong>{decision.reason || '—'}</strong>
            </div>

            <div className="decision-explanation">
              <span>Explanation</span>
              <p>
                {decision.explanation || 'No explanation available.'}
              </p>
            </div>
          </div>
        ) : (
          <p className="detail-empty">
            No final decision has been recorded.
          </p>
        )}
      </section>
    </div>
  )
}

export default InvoiceDetails;

