import { AlertTriangle, Ban, Grid2X2, ReceiptText, RefreshCw } from 'lucide-react'

const links = [
  { label: 'Overview', icon: Grid2X2, active: true },
  { label: 'All Invoices', icon: ReceiptText },
  { label: 'Needs Review', icon: AlertTriangle },
  { label: 'Processing', icon: RefreshCw },
  { label: 'Failed', icon: Ban },
]

function Sidebar() {
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
          {links.map(({ label, icon: Icon, active }) => (
            <a className={`nav-link${active ? ' active' : ''}`} href={`#${label.toLowerCase().replaceAll(' ', '-')}`} key={label} aria-current={active ? 'page' : undefined}>
              <Icon size={19} strokeWidth={active ? 2.2 : 1.9} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
      </div>
    </aside>
  )
}

export default Sidebar
