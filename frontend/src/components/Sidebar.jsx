import { AlertTriangle, Ban, ReceiptText, RefreshCw, UploadCloud } from 'lucide-react'

const links = [
  { label: 'Upload Invoice', icon: UploadCloud, view: 'upload' },
  { label: 'All Invoices', icon: ReceiptText, view: 'all-invoices' },
  { label: 'Needs Review', icon: AlertTriangle, view: 'all-invoices:NEEDS_REVIEW' },
  { label: 'Processing', icon: RefreshCw, view: 'all-invoices:PROCESSING' },
  { label: 'Failed', icon: Ban, view: 'all-invoices:FAILED' },
]

function Sidebar({ activeView = 'all-invoices', onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">IQ</div>
        <div>
          <div className="brand-name">InvoiceIQ</div>
          <div className="brand-subtitle">AP Automation</div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">Processing Console</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {links.map(({ label, icon: Icon, view }) => {
            const active = activeView === view

            return (
              <button
                className={`nav-link${active ? ' active' : ''}`}
                type="button"
                onClick={() => onNavigate?.(view)}
                key={label}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={19} strokeWidth={active ? 2.2 : 1.9} />
                <span>{label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}

export default Sidebar