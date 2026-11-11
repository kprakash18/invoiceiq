import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  LoaderCircle,
  MinusCircle,
  SkipForward,
  XCircle,
} from 'lucide-react'
import StatusBadge from './StatusBadge'
import {
  getApiError,
  getInvoiceById,
  getInvoiceFileUrl,
  getInvoiceJob,
} from '../services/invoiceService'

const CHECK_STAGE_NAMES = ['VENDOR_MATCHING', 'DUPLICATE_CHECK', 'PO_MATCHING']
const POLL_INTERVAL_MS = 3000
const MAX_COMPLETED_JOB_DECISION_RETRIES = 3
const MAX_JOB_STATUS_ERROR_RETRIES = 3

const TECHNICAL_FAILURE_STATUSES = new Set(['FAILED'])
const ACTIVE_INVOICE_STATUSES = new Set(['UPLOADED', 'PROCESSING'])
const ACTIVE_JOB_STATUSES = new Set(['QUEUED', 'RUNNING', 'RETRY_WAIT'])
const FINAL_DECISION_OUTCOMES = new Set(['APPROVED', 'NEEDS_REVIEW', 'REJECTED'])

const stageLabels = {
  PDF_EXTRACTION: 'Source Extraction',
  NORMALIZATION: 'Data Normalization',
  VALIDATION: 'Validation',
  VENDOR_MATCHING: 'Vendor Matching',
  DUPLICATE_CHECK: 'Duplicate Detection',
  PO_MATCHING: 'PO Matching',
  PO_ALLOCATION: 'PO Allocation',
  DECISION: 'Final Decision',
  ORCHESTRATION: 'Processing',
}

const formatStatus = (status) =>
  status ? status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unavailable'

const parseValidDate = (date) => {
  if (!date) return null
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDate = (date) => {
  const parsed = parseValidDate(date)

  return parsed
    ? parsed.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'
}

const formatDateTime = (date) => {
  const parsed = parseValidDate(date)

  return parsed
    ? parsed.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—'
}

const toFiniteNumber = (value) => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const formatCurrency = (amount, currency = 'INR') => {
  const number = toFiniteNumber(amount)
  if (number == null) return '—'

  const currencyCode =
    typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency)
      ? currency.toUpperCase()
      : 'INR'

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(number)
  } catch {
    return `${number.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${currencyCode}`
  }
}

const formatNumber = (value) => {
  if (value == null || value === '') return '—'
  const number = toFiniteNumber(value)
  return number == null ? '—' : number.toLocaleString('en-IN')
}

const formatValue = (value) => {
  if (value == null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const stageLabel = (name) => stageLabels[name] || name?.replaceAll('_', ' ') || 'Processing Stage'

const stageStatusIcon = (status) => {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 size={17} />
    case 'FAILED':
      return <XCircle size={17} />
    case 'SKIPPED':
      return <SkipForward size={17} />
    case 'IN_PROGRESS':
      return <LoaderCircle size={17} />
    case 'QUEUED':
      return <Clock size={17} />
    default:
      return <MinusCircle size={17} />
  }
}

const getStageClass = (status) => `stage-${(status || 'pending').toLowerCase().replaceAll('_', '-')}`

const getEvidence = (field) => {
  if (!field || typeof field !== 'object') return null
  return field.evidence || null
}

const hasFinalDecision = (decision) => FINAL_DECISION_OUTCOMES.has(decision?.outcome)

const isTechnicalFailure = (details, job) =>
  TECHNICAL_FAILURE_STATUSES.has(details?.status) ||
  ['FAILED', 'DEAD_LETTER', 'CANCELLED'].includes(job?.status)

const shouldContinuePolling = ({
  details,
  job,
  decision,
  completedJobDecisionRetries = 0,
  finalJobRefreshPending = false,
  jobStatusErrorRetries = 0,
}) => {
  if (!details) return false

  if (hasFinalDecision(decision)) {
    return finalJobRefreshPending
  }

  if (job?.status === 'COMPLETED') {
    return completedJobDecisionRetries < MAX_COMPLETED_JOB_DECISION_RETRIES
  }

  if (isTechnicalFailure(details, job)) {
    return false
  }

  if (!job && jobStatusErrorRetries >= MAX_JOB_STATUS_ERROR_RETRIES) {
    return false
  }

  return ACTIVE_INVOICE_STATUSES.has(details.status) || ACTIVE_JOB_STATUSES.has(job?.status)
}

const getJobStatusMessage = ({ job, details, decision, waitingForDecision, pollingPaused }) => {
  if (waitingForDecision) {
    return {
      tone: pollingPaused ? 'warning' : 'processing',
      title: pollingPaused ? 'Decision data is not available yet' : 'Processing complete, waiting for decision data',
      message: pollingPaused
        ? 'The worker marked the job complete, but the persisted final decision was not returned after several refresh attempts. Try refreshing this invoice.'
        : 'The worker marked the job complete, and the page is checking for the persisted decision.',
    }
  }

  if (hasFinalDecision(decision)) {
    return {
      tone: 'success',
      title: 'Final decision available',
      message: decision.explanation || 'The invoice has a persisted final decision.',
    }
  }

  switch (job?.status) {
    case 'QUEUED':
      return {
        tone: 'processing',
        title: 'Uploaded and queued',
        message: 'The document was accepted and is waiting for the processing worker.',
      }
    case 'RUNNING':
      return {
        tone: 'processing',
        title: 'Processing in progress',
        message: 'Extraction, validation, matching, and decision checks are running.',
      }
    case 'RETRY_WAIT':
      return {
        tone: 'warning',
        title: 'Processing will retry',
        message: job.errorMessage || 'A retryable processing issue occurred. The worker will try again.',
      }
    case 'COMPLETED':
      return {
        tone: 'success',
        title: 'Processing job completed',
        message: 'The processing job completed. The final business decision is being loaded.',
      }
    case 'FAILED':
    case 'DEAD_LETTER':
    case 'CANCELLED':
      return {
        tone: 'danger',
        title: `Processing ${formatStatus(job.status)}`,
        message: job.errorMessage || 'The processing job did not complete successfully.',
      }
    default:
      if (details?.status === 'UPLOADED') {
        return {
          tone: 'processing',
          title: 'Uploaded',
          message: 'The document was uploaded. Processing status will appear when the job is available.',
        }
      }

      if (details?.status === 'PROCESSING') {
        return {
          tone: 'processing',
          title: 'Processing invoice',
          message: 'The invoice is being processed.',
        }
      }

      if (details?.status === 'FAILED') {
        return {
          tone: 'danger',
          title: 'Processing failed',
          message: 'The invoice could not be processed successfully.',
        }
      }

      return {
        tone: 'neutral',
        title: 'Processing status unavailable',
        message: 'No current job status was returned for this invoice.',
      }
  }
}

const getSourceDocumentType = (fileName = '') => {
  const normalized = fileName.toLowerCase()

  if (normalized.endsWith('.pdf')) return { label: 'PDF', kind: 'pdf' }
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return { label: 'JPG image', kind: 'image' }
  if (normalized.endsWith('.png')) return { label: 'PNG image', kind: 'image' }

  return { label: 'Source file', kind: 'unknown' }
}

function FieldGrid({ fields }) {
  return (
    <div className="facts-grid">
      {fields.map(({ label, value, hint, tone }) => (
        <div className={`fact${tone ? ` fact-${tone}` : ''}`} key={label}>
          <span>{label}</span>
          <strong>{formatValue(value)}</strong>
          {hint && <small>{hint}</small>}
        </div>
      ))}
    </div>
  )
}

function SectionHeader({ title, eyebrow, children }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span>{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  )
}

function EmptyNote({ children }) {
  return <p className="detail-empty">{children}</p>
}

function JsonDetails({ label, data, defaultOpen = false }) {
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return null

  return (
    <details className="json-details" open>
      <summary>
        {label}
        <ChevronDown size={15} />
      </summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  )
}

function EvidenceValue({ value }) {
  if (value == null || value === '') return <>—</>

  if (Array.isArray(value)) {
    return (
      <span>
        {value.map((entry, index) => (
          <span className="evidence-entry" key={index}>
            {formatValue(entry)}
          </span>
        ))}
      </span>
    )
  }

  return <>{formatValue(value)}</>
}

function DecisionHeader({ details, decision, run, onBack }) {
  const vendorName = details.vendor?.name || 'Vendor not matched'
  const currency = details.currency || run?.normalizedData?.currencyCode || 'INR'
  const decisionOutcome = hasFinalDecision(decision) ? decision.outcome : 'Not decided'

  return (
    <section className="decision-hero">
      <div className="decision-main">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to invoices
        </button>

        <div className="decision-title-row">
          <FileText size={24} />
          <div>
            <span>Invoice Processing Result</span>
            <h1>{details.invoiceNumber || details.originalFileName || 'Invoice'}</h1>
          </div>
        </div>

        <div className="decision-context">
          <span>{vendorName}</span>
          <span>{details.originalFileName || 'Original file unavailable'}</span>
          {run?.attempt && <span>Attempt {run.attempt}</span>}
        </div>
      </div>

      <div className="decision-panel">
        <div className="decision-status-line">
          <StatusBadge status={decisionOutcome} />
          {decision?.policyVersion && <span>Policy v{decision.policyVersion}</span>}
        </div>

        <div className="decision-amount">
          <span>Total amount</span>
          <strong>{formatCurrency(details.totalAmount, currency)}</strong>
        </div>

        <div className="decision-summary-text">
          <span>{decision?.reason || 'Decision not recorded yet'}</span>
          <p>{decision?.explanation || 'The backend has not returned a final decision for this invoice.'}</p>
        </div>
      </div>
    </section>
  )
}

function ProcessingStatusBanner({
  details,
  decision,
  job,
  uploadConfirmation,
  connectivityWarning,
  waitingForDecision,
  pollingPaused,
  onRefresh,
}) {
  const status = getJobStatusMessage({
    job,
    details,
    decision,
    waitingForDecision,
    pollingPaused,
  })

  return (
    <section className={`processing-status-banner status-tone-${status.tone}`}>
      <div>
        {uploadConfirmation?.message && (
          <span className="upload-confirmation">
            <CheckCircle2 size={16} />
            {uploadConfirmation.message}
          </span>
        )}
        <h2>{status.title}</h2>
        <p>{status.message}</p>
        {job?.errorCode && <small>Error code: {job.errorCode}</small>}
        {connectivityWarning && (
          <small className="connectivity-warning">{connectivityWarning}</small>
        )}
        {pollingPaused && (
          <button className="text-link inline-refresh-button" type="button" onClick={onRefresh}>
            Refresh invoice status
          </button>
        )}
      </div>
      <div className="processing-status-meta">
        <StatusBadge status={hasFinalDecision(decision) ? decision.outcome : 'Not decided'} />
        {details?.status && <StatusBadge status={details.status} />}
        {job?.status && <StatusBadge status={job.status} />}
        {job?.attempt != null && job?.maxAttempts != null && (
          <span>
            Attempt {job.attempt} of {job.maxAttempts}
          </span>
        )}
      </div>
    </section>
  )
}

function ProcessingPipeline({ stages }) {
  return (
    <section className="detail-section">
      <SectionHeader title="Processing Pipeline" eyebrow="Execution order" />

      {stages.length ? (
        <div className="pipeline-strip">
          {stages.map((stage, index) => (
            <div className={`pipeline-step ${getStageClass(stage.status)}`} key={stage.id || stage.name}>
              <div className="pipeline-marker">
                {stageStatusIcon(stage.status)}
                <span>{index + 1}</span>
              </div>
              <div>
                <strong>{stageLabel(stage.name)}</strong>
                <span>{formatStatus(stage.status)}</span>
                <small>
                  {stage.durationMs != null ? `${stage.durationMs} ms` : formatDateTime(stage.completedAt)}
                </small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyNote>No processing stages were returned for this invoice.</EmptyNote>
      )}
    </section>
  )
}

function LineItemsTable({ items, currency, evidence }) {
  return (
    <div className="subsection">
      <h3>Extracted Line Items</h3>

      {items.length ? (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Item Code</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Tax</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.description || '—'}</td>
                  <td>{item.itemCode || '—'}</td>
                  <td>{formatNumber(item.quantity)}</td>
                  <td>{formatCurrency(item.unitPrice, currency)}</td>
                  <td>{formatCurrency(item.taxAmount, currency)}</td>
                  <td>{formatCurrency(item.lineTotal, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyNote>No persisted line items were returned for this invoice.</EmptyNote>
      )}

      {evidence && (
        <JsonDetails label="View raw line-item extraction evidence" data={evidence} />
      )}
    </div>
  )
}

function SourceDocumentPreview({ details, sourceUrl, sourceType }) {
  const [previewErrorSource, setPreviewErrorSource] = useState('')
  const previewError = previewErrorSource === sourceUrl

  if (!details.originalFileName) {
    return <EmptyNote>Original invoice file is unavailable.</EmptyNote>
  }

  if (previewError) {
    return (
      <div className="source-preview-error">
        <AlertCircle size={18} />
        <p>The source preview could not be loaded.</p>
        <a className="text-link" href={sourceUrl} target="_blank" rel="noreferrer">
          Open source file
        </a>
      </div>
    )
  }

  if (sourceType.kind === 'image') {
    return (
      <img
        className="invoice-source-image"
        src={sourceUrl}
        alt={`Original invoice image: ${details.originalFileName}`}
        onError={() => setPreviewErrorSource(sourceUrl)}
      />
    )
  }

  return (
    <iframe
      className="invoice-source-frame"
      src={sourceUrl}
      title="Original invoice document"
      onError={() => setPreviewErrorSource(sourceUrl)}
    />
  )
}

function InputExtraction({ details, run, sourceUrl }) {
  const normalized = run?.normalizedData || {}
  const evidence = normalized.evidence || {}
  const currency = details.currency || normalized.currencyCode || 'INR'
  const sourceType = getSourceDocumentType(details.originalFileName)

  const fieldRows = [
    ['Document Type', normalized.documentType || '—', getEvidence(evidence.documentType)],
    ['Invoice Number', details.invoiceNumber || normalized.invoiceNumber || '—', getEvidence(evidence.invoiceNumber)],
    ['Original Invoice', normalized.originalInvoiceNumber || '—', getEvidence(evidence.originalInvoiceNumber)],
    ['PO Number', normalized.poNumber || '—', null],
    ['Invoice Date', formatDate(details.invoiceDate || normalized.invoiceDate), getEvidence(evidence.invoiceDate)],
    ['Due Date', formatDate(details.dueDate || normalized.dueDate), getEvidence(evidence.dueDate)],
    ['Currency', details.currency || normalized.currencyCode || '—', `Status: ${normalized.currencyStatus || 'unavailable'}`],
    ['Subtotal', formatCurrency(details.subtotal ?? normalized.subtotal, currency), getEvidence(evidence.subtotal)],
    ['Tax', formatCurrency(details.taxAmount ?? normalized.taxAmount, currency), getEvidence(evidence.taxAmount)],
    ['Total', formatCurrency(details.totalAmount ?? normalized.totalAmount, currency), getEvidence(evidence.totalAmount)],
  ]

  return (
    <section className="detail-section">
      <SectionHeader title="Input and Extraction" eyebrow={`${sourceType.label} to normalized data`}>
        <a className="text-link" href={sourceUrl} target="_blank" rel="noreferrer">
          Open source
        </a>
      </SectionHeader>

      <div className="input-extraction-layout">
        <div className="source-document-panel">
          <div className="source-document-meta">
            <span>{sourceType.label}</span>
            <strong>{details.originalFileName || 'Original file unavailable'}</strong>
          </div>
          <SourceDocumentPreview
            details={details}
            sourceUrl={sourceUrl}
            sourceType={sourceType}
          />
        </div>

        <div className="extraction-panel">
          <FieldGrid
            fields={[
              {
                label: 'Source document',
                value: sourceType.label,
              },
              {
                label: 'Extraction method',
                value: run?.extractionMethod || details.extractionMethod || '—',
              },
              {
                label: 'Model',
                value: run?.modelName || '—',
              },
              {
                label: 'Line persistence',
                value:
                  normalized.lineItemsPersisted == null
                    ? 'Unavailable'
                    : normalized.lineItemsPersisted
                      ? 'Persisted'
                      : 'Not persisted',
                tone: normalized.lineItemsPersisted === false ? 'warning' : '',
              },
            ]}
          />

          <div className="field-table-wrap">
            <table className="compact-table">
              <thead>
                <tr>
                  <th>Extracted Field</th>
                  <th>Value</th>
                  <th>Evidence / Note</th>
                </tr>
              </thead>
              <tbody>
                {fieldRows.map(([label, value, note]) => (
                  <tr className={value === '—' ? 'missing-row' : ''} key={label}>
                    <td>{label}</td>
                    <td>{value}</td>
                    <td>
                      <EvidenceValue value={note ?? (value === '—' ? 'Missing or not returned by extraction.' : '—')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <JsonDetails label="Normalized Data Returned by Backend" data={normalized} defaultOpen />
        </div>
      </div>

      <LineItemsTable items={details.items || []} currency={currency} evidence={evidence.lineItems} />
    </section>
  )
}

function CheckCard({ title, stage, facts }) {
  return (
    <article className="check-card">
      <div className="check-card-header">
        <h3>{title}</h3>
        <span className={`stage-pill ${getStageClass(stage?.status)}`}>{formatStatus(stage?.status)}</span>
      </div>

      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatValue(value)}</dd>
          </div>
        ))}
      </dl>

      <p>{stage?.message || stage?.error || 'No stage detail was returned by the API.'}</p>
      <JsonDetails label="View check metadata" data={stage?.metadata} />
    </article>
  )
}

function VendorDuplicateChecks({ details, stages }) {
  const stageMap = new Map(stages.map((stage) => [stage.name, stage]))
  const vendorStage = stageMap.get('VENDOR_MATCHING')
  const duplicateStage = stageMap.get('DUPLICATE_CHECK')
  const poStage = stageMap.get('PO_MATCHING')

  return (
    <section className="detail-section">
      <SectionHeader title="Vendor and Duplicate Checks" eyebrow="Business checks" />

      <div className="check-grid">
        <CheckCard
          title="Vendor Matching"
          stage={vendorStage}
          facts={[
            ['Matched Vendor', details.vendor?.name || vendorStage?.metadata?.vendorName || '—'],
            ['GSTIN', details.vendor?.taxId || '—'],
            ['Email', details.vendor?.email || '—'],
            ['Result', vendorStage?.metadata?.result || 'Unavailable'],
          ]}
        />
        <CheckCard
          title="Duplicate Detection"
          stage={duplicateStage}
          facts={[
            [
              'Duplicate Detected',
              duplicateStage?.metadata?.isDuplicate == null
                ? 'Unavailable'
                : duplicateStage.metadata.isDuplicate
                  ? 'Yes'
                  : 'No',
            ],
            ['Result', duplicateStage?.metadata?.result || 'Unavailable'],
          ]}
        />
        <CheckCard
          title="PO Matching"
          stage={poStage}
          facts={[
            ['Matched PO', details.purchaseOrder?.poNumber || '—'],
            ['PO Status', details.purchaseOrder?.status || '—'],
            [
              'Currency Match',
              poStage?.metadata?.currencyMatches == null
                ? 'Unavailable'
                : poStage.metadata.currencyMatches
                  ? 'Yes'
                  : 'No',
            ],
            ['Result', poStage?.metadata?.result || 'Unavailable'],
          ]}
        />
      </div>
    </section>
  )
}

function PurchaseOrderAllocation({ details, run }) {
  const po = details.purchaseOrder
  const currency = details.currency || po?.currency || 'INR'
  const allocationResult = run?.normalizedData?.allocationResult
  const issues = allocationResult?.issues || []

  return (
    <section className="detail-section">
      <SectionHeader title="PO Matching and Allocation" eyebrow="Invoice lines to PO consumption" />

      {po ? (
        <>
          <FieldGrid
            fields={[
              { label: 'PO Number', value: po.poNumber },
              { label: 'PO Status', value: po.status },
              { label: 'PO Currency', value: po.currency },
              { label: 'PO Total', value: formatCurrency(po.totalAmount, po.currency || currency) },
              { label: 'Issue Date', value: formatDate(po.issueDate) },
              { label: 'Expiry Date', value: formatDate(po.expiryDate) },
            ]}
          />

          <div className="subsection">
            <h3>Allocation Result</h3>
            <div className="allocation-result-panel">
              <div>
                <span>Status</span>
                <strong>{allocationResult?.status || 'Unavailable'}</strong>
              </div>
              <div>
                <span>Requires review</span>
                <strong>
                  {allocationResult?.requiresReview == null
                    ? 'Unavailable'
                    : allocationResult.requiresReview
                      ? 'Yes'
                      : 'No'}
                </strong>
              </div>
              <p>{allocationResult?.message || 'No allocation summary was returned in normalized data.'}</p>
            </div>
          </div>

          {issues.length > 0 && (
            <div className="issue-list">
              <h3>Allocation Issues</h3>
              {issues.map((issue, index) => (
                <article className="issue-item" key={`${issue.reason}-${index}`}>
                  <strong>{issue.reason || 'Allocation issue'}</strong>
                  <p>{issue.message || 'No issue message was returned.'}</p>
                  {issue.invoiceLineId && <span>Invoice line: {issue.invoiceLineId}</span>}
                </article>
              ))}
            </div>
          )}

          <div className="subsection">
            <h3>Allocation Breakdown</h3>
            {po.items?.length ? (
              <div className="table-wrapper allocation-table">
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
                    {po.items.flatMap((poItem) => {
                      const breakdown = poItem.allocationBreakdown
                      const allocations = breakdown?.currentAllocations || []
                      const rows = allocations.length ? allocations : [null]

                      return rows.map((allocation, index) => {
                        const poUnitPrice = toFiniteNumber(breakdown?.poUnitPrice ?? poItem.unitPrice)
                        const invoiceUnitPrice = toFiniteNumber(allocation?.invoiceUnitPrice)
                        const allocatedQuantity = toFiniteNumber(allocation?.allocatedQuantity)
                        const canCalculateVariance =
                          invoiceUnitPrice != null && poUnitPrice != null && allocatedQuantity != null
                        const unitVariance = canCalculateVariance ? invoiceUnitPrice - poUnitPrice : null
                        const totalVariance = canCalculateVariance ? unitVariance * allocatedQuantity : null

                        return (
                          <tr key={`${poItem.id}-${index}`}>
                            <td>
                              <strong>{poItem.description || '—'}</strong>
                              <small>{poItem.itemCode || 'No item code'}</small>
                            </td>
                            <td>{allocation?.invoiceDescription || '—'}</td>
                            <td>{formatNumber(breakdown?.orderedQuantity ?? poItem.quantity)}</td>
                            <td>{formatNumber(breakdown?.previouslyInvoicedQuantity)}</td>
                            <td>{formatNumber(breakdown?.currentAllocatedQuantity)}</td>
                            <td>{formatNumber(breakdown?.remainingQuantity)}</td>
                            <td>{formatCurrency(poUnitPrice, currency)}</td>
                            <td>{formatCurrency(invoiceUnitPrice, currency)}</td>
                            <td>{unitVariance != null ? formatCurrency(unitVariance, currency) : '—'}</td>
                            <td>{totalVariance != null ? formatCurrency(totalVariance, currency) : '—'}</td>
                          </tr>
                        )
                      })
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyNote>No PO line items were returned by the API.</EmptyNote>
            )}
          </div>
        </>
      ) : (
        <EmptyNote>No purchase order is matched to this invoice.</EmptyNote>
      )}
    </section>
  )
}

function ValidationSection({ validations }) {
  return (
    <section className="detail-section">
      <SectionHeader title="Validation" eyebrow="Recorded validation issues" />

      {validations.length ? (
        <div className="validation-list">
          {validations.map((result) => (
            <article className="validation-item" key={result.id}>
              <div className="validation-heading">
                {result.passed ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                <strong>{result.ruleCode || 'VALIDATION_RULE'}</strong>
                <span>{result.severity || 'UNKNOWN'}</span>
              </div>
              <p>{result.message || 'No validation message was returned.'}</p>
              <FieldGrid
                fields={[
                  { label: 'Field', value: result.field || '—' },
                  { label: 'Expected', value: formatValue(result.expectedValue) },
                  { label: 'Actual', value: formatValue(result.actualValue) },
                ]}
              />
            </article>
          ))}
        </div>
      ) : (
        <EmptyNote>No validation issue records were returned. This UI does not infer passed checks from missing issue rows.</EmptyNote>
      )}
    </section>
  )
}

function DecisionExplanation({ decision, run, reviews }) {
  const allocationIssues = run?.normalizedData?.allocationResult?.issues || []
  const review = reviews?.[0]

  return (
    <section className="detail-section">
      <SectionHeader title="Decision Explanation" eyebrow="Outcome and unresolved items" />

      {decision ? (
        <div className="decision-explainer">
          <div>
            <span>Outcome</span>
            <StatusBadge status={decision.outcome} />
          </div>
          <div>
            <span>Reason</span>
            <strong>{decision.reason || '—'}</strong>
          </div>
          <div>
            <span>Policy</span>
            <strong>{decision.policyVersion ? `v${decision.policyVersion}` : '—'}</strong>
          </div>
          <p>{decision.explanation || 'No decision explanation was returned.'}</p>
        </div>
      ) : (
        <EmptyNote>No final decision has been recorded.</EmptyNote>
      )}

      {allocationIssues.length > 0 && (
        <div className="issue-list">
          <h3>Relevant Allocation Issues</h3>
          {allocationIssues.map((issue, index) => (
            <article className="issue-item" key={`${issue.reason}-${index}`}>
              <strong>{issue.reason || 'Issue'}</strong>
              <p>{issue.message || 'No issue message was returned.'}</p>
            </article>
          ))}
        </div>
      )}

      {review ? (
        <div className="review-note">
          <strong>Latest Review Record</strong>
          <p>Status: {review.status || '—'}</p>
          <p>Reason: {review.reason || '—'}</p>
          <p>Comments: {review.comments || '—'}</p>
          <span>{formatDateTime(review.createdAt)}</span>
        </div>
      ) : (
        <p className="detail-muted">No human review record was returned for this invoice.</p>
      )}
    </section>
  )
}

function ProcessingTrace({ run, stages }) {
  return (
    <section className="detail-section">
      <SectionHeader title="Processing Trace" eyebrow="Detailed stage records" />

      {run && (
        <FieldGrid
          fields={[
            { label: 'Run status', value: run.status || '—' },
            { label: 'Attempt', value: run.attempt || '—' },
            { label: 'Started', value: formatDateTime(run.startedAt) },
            { label: 'Completed', value: formatDateTime(run.completedAt) },
          ]}
        />
      )}

      {run?.error && <p className="error-message">{run.error}</p>}

      {stages.length ? (
        <div className="processing-timeline">
          {stages.map((stage) => (
            <div className="timeline-stage" key={stage.id || stage.name}>
              <div className={`stage-icon ${getStageClass(stage.status)}`}>{stageStatusIcon(stage.status)}</div>
              <div className="stage-content">
                <div className="stage-heading">
                  <strong>{stageLabel(stage.name)}</strong>
                  <span>{formatStatus(stage.status)}</span>
                </div>
                <p>{stage.message || stage.error || 'No additional information was returned.'}</p>
                <div className="stage-times">
                  <span>Started: {formatDateTime(stage.startedAt)}</span>
                  <span>Completed: {formatDateTime(stage.completedAt)}</span>
                  {stage.durationMs != null && <span>Duration: {stage.durationMs} ms</span>}
                </div>
                {stage.error && <p className="stage-error">{stage.error}</p>}
                <JsonDetails label="View stage metadata" data={stage.metadata} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyNote>No processing trace is available.</EmptyNote>
      )}
    </section>
  )
}

function InvoiceDetails({ invoice, onBack, uploadConfirmation }) {
  const [details, setDetails] = useState(null)
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(Boolean(invoice?.id))
  const [error, setError] = useState('')
  const [connectivityWarning, setConnectivityWarning] = useState('')
  const [waitingForDecision, setWaitingForDecision] = useState(false)
  const [pollingPaused, setPollingPaused] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    if (!invoice?.id) {
      return undefined
    }

    let active = true
    const polling = {
      controller: null,
      timeoutId: null,
      hasLoadedDetails: false,
      completedJobDecisionRetries: 0,
      finalJobRefreshPending: false,
      jobStatusErrorRetries: 0,
    }

    async function loadInvoice({ poll = false } = {}) {
      if (polling.timeoutId) {
        window.clearTimeout(polling.timeoutId)
        polling.timeoutId = null
      }

      if (polling.controller) {
        polling.controller.abort()
      }

      const nextController = new AbortController()
      polling.controller = nextController

      try {
        if (!poll) {
          setLoading(true)
        }

        if (!poll || !polling.hasLoadedDetails) {
          setError('')
        }

        setPollingPaused(false)

        const [detailResponse, jobResponse] = await Promise.all([
          getInvoiceById(invoice.id, { signal: nextController.signal }),
          getInvoiceJob(invoice.id, { signal: nextController.signal }).catch((jobError) => {
            if (jobError.name === 'CanceledError' || jobError.code === 'ERR_CANCELED') {
              throw jobError
            }

            return { success: false, data: null, error: jobError }
          }),
        ])

        if (!active || polling.controller !== nextController) {
          return
        }

        const nextDetails = detailResponse.data
        const nextJob = jobResponse.data || null
        const nextDecision = nextDetails?.processingRuns?.[0]?.decision
        const nextHasFinalDecision = hasFinalDecision(nextDecision)
        const jobRefreshFailed = Boolean(jobResponse.error)

        setDetails(nextDetails)
        setJob(nextJob)
        polling.hasLoadedDetails = Boolean(nextDetails)
        polling.jobStatusErrorRetries = jobRefreshFailed ? polling.jobStatusErrorRetries + 1 : 0
        setConnectivityWarning(
          jobRefreshFailed
            ? `Job status could not be refreshed: ${getApiError(jobResponse.error)}${
                polling.jobStatusErrorRetries >= MAX_JOB_STATUS_ERROR_RETRIES
                  ? ' Automatic status refresh has paused.'
                  : ''
              }`
            : ''
        )

        if (nextJob?.status === 'COMPLETED' && !nextHasFinalDecision) {
          polling.completedJobDecisionRetries += 1
          setWaitingForDecision(true)
        } else {
          polling.completedJobDecisionRetries = 0
          setWaitingForDecision(false)
        }

        if (nextHasFinalDecision && nextJob?.status === 'RUNNING' && !polling.finalJobRefreshPending) {
          polling.finalJobRefreshPending = true
        } else if (polling.finalJobRefreshPending) {
          polling.finalJobRefreshPending = false
        }

        const shouldPoll = shouldContinuePolling({
          details: nextDetails,
          job: nextJob,
          decision: nextDecision,
          completedJobDecisionRetries: polling.completedJobDecisionRetries,
          finalJobRefreshPending: polling.finalJobRefreshPending,
          jobStatusErrorRetries: polling.jobStatusErrorRetries,
        })

        if (shouldPoll) {
          polling.timeoutId = window.setTimeout(() => loadInvoice({ poll: true }), POLL_INTERVAL_MS)
        } else if (
          (nextJob?.status === 'COMPLETED' && !nextHasFinalDecision) ||
          (!nextJob && jobRefreshFailed && polling.jobStatusErrorRetries >= MAX_JOB_STATUS_ERROR_RETRIES)
        ) {
          setPollingPaused(true)
        }
      } catch (err) {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
          return
        }

        if (active) {
          if (polling.hasLoadedDetails) {
            polling.jobStatusErrorRetries += 1
            if (polling.jobStatusErrorRetries < MAX_JOB_STATUS_ERROR_RETRIES) {
              setConnectivityWarning(`Latest status could not be refreshed: ${getApiError(err)}`)
              polling.timeoutId = window.setTimeout(() => loadInvoice({ poll: true }), POLL_INTERVAL_MS)
            } else {
              setConnectivityWarning(`Latest status could not be refreshed: ${getApiError(err)} Automatic refresh has paused.`)
              setPollingPaused(true)
            }
          } else {
            setError(getApiError(err))
          }
        }
      } finally {
        if (active && polling.controller === nextController) {
          setLoading(false)
        }
      }
    }

    loadInvoice()

    return () => {
      active = false
      if (polling.timeoutId) {
        window.clearTimeout(polling.timeoutId)
      }
      if (polling.controller) {
        polling.controller.abort()
      }
    }
  }, [invoice?.id, refreshNonce])

  const content = useMemo(() => {
    if (!details) return null
    const run = details.processingRuns?.[0]
    const stages = run?.stages || []
    const validations = run?.validations || []
    const decision = run?.decision
    const sourceUrl = getInvoiceFileUrl(details.id)

    return {
      run,
      stages,
      validations,
      decision,
      sourceUrl,
    }
  }, [details])

  if (!invoice?.id) {
    return (
      <div className="details-page details-state">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to invoices
        </button>
        <p className="error-message">No invoice was selected.</p>
      </div>
    )
  }

  if (loading) {
    return <div className="details-page details-state">Loading invoice details...</div>
  }

  if (error) {
    return (
      <div className="details-page details-state">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to invoices
        </button>
        <p className="error-message">{error}</p>
      </div>
    )
  }

  if (!details || !content) return null

  return (
    <div className="details-page">
      <DecisionHeader details={details} decision={content.decision} run={content.run} onBack={onBack} />
      <ProcessingStatusBanner
        details={details}
        decision={content.decision}
        job={job}
        uploadConfirmation={uploadConfirmation}
        connectivityWarning={connectivityWarning}
        waitingForDecision={waitingForDecision}
        pollingPaused={pollingPaused}
        onRefresh={() => setRefreshNonce((value) => value + 1)}
      />
      <ProcessingPipeline stages={content.stages} />
      <InputExtraction details={details} run={content.run} sourceUrl={content.sourceUrl} />
      <VendorDuplicateChecks
        details={details}
        stages={content.stages.filter((stage) => CHECK_STAGE_NAMES.includes(stage.name))}
      />
      <PurchaseOrderAllocation details={details} run={content.run} />
      <ValidationSection validations={content.validations} />
      <DecisionExplanation decision={content.decision} run={content.run} reviews={details.reviews} />
      <ProcessingTrace run={content.run} stages={content.stages} />
    </div>
  )
}

export default InvoiceDetails
