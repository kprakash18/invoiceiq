import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ReceiptText } from 'lucide-react'
import StatusBadge from './StatusBadge'
import { getInvoices, getApiError } from '../services/invoiceService'

const statuses = ['','PROCESSING', 'NEEDS_REVIEW','FAILED']

const label = (status) =>
  status ? status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'All'

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString() : '—'

const formatDateTime = (date) =>
  date ? new Date(date).toLocaleString() : '—'

const formatAmount = (amount, currency) => {
  if (amount == null) return '—'
  return `${currency || ''} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim()
}

function AllInvoices({ initialStatus = '', onOpenInvoice }) {
  const [status, setStatus] = useState(initialStatus)
  const [page, setPage] = useState(1)
  const [invoices, setInvoices] = useState([])
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const pageSize = 10

  useEffect(() => {
    let cancelled = false

    async function fetchInvoices() {
      setLoading(true)
      setError('')

      try {
        const response = await getInvoices(page, pageSize, status)

        if (cancelled) return

        setInvoices(response.data || [])
        setPagination(response.pagination || { total: 0, totalPages: 0 })
      } catch (err) {
        if (!cancelled) setError(getApiError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchInvoices()

    return () => {
      cancelled = true
    }
  }, [page, status])

  function changeStatus(nextStatus) {
    setStatus(nextStatus)
    setPage(1)
  }

  const totalPages = pagination.totalPages || 1
  const total = pagination.total || 0
  const start = total ? (page - 1) * pageSize + 1 : 0
  const end = Math.min(page * pageSize, total)

  return (
    <div className="all-invoices-page">
      <div className="page-heading">
        <h1>All Invoices</h1>
        <p>View and track uploaded invoices.</p>
      </div>

      <section className="all-invoices-card">
        <div className="filter-bar">
          <div className="filter-tabs" role="tablist" aria-label="Invoice status filters">
            {statuses.map((item) => (
              <button
                key={item || 'all'}
                type="button"
                className={`filter-tab${status === item ? ' selected' : ''}`}
                onClick={() => changeStatus(item)}
              >
                {label(item)}
              </button>
            ))}
          </div>
        </div>

        <div className="all-table-wrap">
          {loading ? (
            <div className="invoice-state">Loading invoices...</div>
          ) : error ? (
            <div className="invoice-state">
              <h3>Unable to load invoices</h3>
              <p>{error}</p>
            </div>
          ) : invoices.length ? (
            <table className="all-invoices-table">
              <thead>
                <tr>
                  <th>Invoice Number</th>
                  <th>Filename</th>
                  <th>Vendor</th>
                  <th>Invoice Date</th>
                  <th className="right">Total Amount</th>
                  <th className="center">Status</th>
                  <th className="right">Uploaded At</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    onClick={() => onOpenInvoice?.({
                      id: invoice.id,
                      invoiceNumber: invoice.invoiceNumber,
                      vendor: invoice.vendor?.name || '—',
                      date: formatDate(invoice.invoiceDate),
                      amount: formatAmount(invoice.totalAmount, invoice.currency),
                      currency: invoice.currency,
                      file: invoice.originalFileName,
                      status: invoice.status,
                    })}
                  >
                    <td className="code-cell emphasized">{invoice.invoiceNumber || '—'}</td>
                    <td className="code-cell file-cell">{invoice.originalFileName || '—'}</td>
                    <td>{invoice.vendor?.name || '—'}</td>
                    <td className="secondary-cell">{formatDate(invoice.invoiceDate)}</td>
                    <td className="right code-cell emphasized">
                      {formatAmount(invoice.totalAmount, invoice.currency)}
                    </td>
                    <td className="center">
                      <StatusBadge status={label(invoice.status)} />
                    </td>
                    <td className="right code-cell secondary-cell">
                      {formatDateTime(invoice.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="invoice-state">
              <ReceiptText size={26} />
              <h3>No invoices found</h3>
              <p>There are currently no invoices matching this status.</p>
            </div>
          )}
        </div>

        <div className="pagination">
          <span>
            Showing <strong>{start} - {end}</strong> of <strong>{total}</strong> invoices
          </span>

          <div className="pagination-controls">
            <button
              type="button"
              disabled={page === 1 || loading}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft size={15} /> Previous
            </button>

            <span className="page-number">{page}</span>

            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

export default AllInvoices