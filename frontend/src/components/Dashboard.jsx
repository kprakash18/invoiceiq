import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Loader2, ReceiptText, UploadCloud } from 'lucide-react'
import { getApiError, getInvoices } from '../services/invoiceService'

const summaryTiles = [
  {
    key: 'total',
    label: 'Total invoices',
    status: '',
    icon: ReceiptText,
  },
  {
    key: 'approved',
    label: 'Approved invoices',
    status: 'APPROVED',
    icon: CheckCircle2,
  },
  {
    key: 'needsReview',
    label: 'Needs review',
    status: 'NEEDS_REVIEW',
    icon: AlertTriangle,
  },
  {
    key: 'processing',
    label: 'Currently processing',
    status: 'PROCESSING',
    icon: Loader2,
  },
  {
    key: 'failed',
    label: 'Failed processing',
    status: 'FAILED',
    icon: Ban,
  },
]

function Dashboard({ onNavigate }) {
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function fetchSummary() {
      setLoading(true)
      setError('')

      try {
        const entries = await Promise.all(
          summaryTiles.map(async (tile) => {
            const response = await getInvoices(1, 1, tile.status)
            return [tile.key, response.pagination?.total ?? 0]
          })
        )

        if (!cancelled) {
          setCounts(Object.fromEntries(entries))
        }
      } catch (err) {
        if (!cancelled) setError(getApiError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchSummary()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <h1>Dashboard</h1>
        <p>A compact view of invoice processing outcomes across the current workspace.</p>
      </div>

      {error ? (
        <div className="invoice-state dashboard-state">
          <h3>Unable to load dashboard</h3>
          <p>{error}</p>
        </div>
      ) : (
        <section className="dashboard-summary" aria-label="Invoice summary">
          {summaryTiles.map(({ key, label, icon: Icon }) => (
            <article className="summary-tile" key={key}>
              <div className="summary-icon">
                <Icon size={18} />
              </div>
              <span>{label}</span>
              <strong>{loading ? '...' : counts[key] ?? 0}</strong>
            </article>
          ))}
        </section>
      )}

      <section className="dashboard-actions" aria-label="Primary actions">
        <button type="button" className="primary-button" onClick={() => onNavigate?.('upload')}>
          <UploadCloud size={16} />
          Upload Invoice
        </button>
        <button type="button" className="secondary-button" onClick={() => onNavigate?.('all-invoices')}>
          <ReceiptText size={16} />
          View Invoices
        </button>
      </section>
    </div>
  )
}

export default Dashboard
