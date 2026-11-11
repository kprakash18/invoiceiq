import { ReceiptText, UploadCloud } from 'lucide-react'

const links = [
  { label: 'Upload Invoice', icon: UploadCloud, view: 'upload' },
  { label: 'Invoices', icon: ReceiptText, view: 'all-invoices' },
]

function Sidebar({ activeView = 'all-invoices', onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">IQ</div>
        <div>
          <div className="brand-name">InvoiceIQ</div>
          <div className="brand-subtitle">Processing Demo</div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">Invoice Journey</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {links.map(({ label, icon: Icon, view }) => {
            const active =
              activeView === view ||
              (view === 'all-invoices' && activeView === 'invoice-details')

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
