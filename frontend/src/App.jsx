import { useState } from 'react'
import { Upload } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import KpiCard from './components/KpiCard'
import RecentInvoices from './components/RecentInvoices'
import EmptyState from './components/EmptyState'
import './App.css'

const invoices = [
  { id: 'INV-2026-001', vendor: 'Acme Cloud Services', amount: '$1,250.00', date: 'May 24, 2026', status: 'Approved' },
  { id: 'INV-2026-002', vendor: 'Apex Logistics Ltd', amount: '$4,820.00', date: 'May 24, 2026', status: 'Needs review' },
  { id: 'INV-2026-003', vendor: 'Stripe Payments', amount: '$890.00', date: 'May 23, 2026', status: 'Processing' },
  { id: 'INV_2026_receipt_04.pdf', vendor: 'Unknown vendor', amount: '—', date: 'May 22, 2026', status: 'Failed', muted: true },
  { id: 'INV-2026-005', vendor: 'Datadog Operations', amount: '$620.00', date: 'May 21, 2026', status: 'Approved' },
]

function UploadDialog({ onClose }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-icon"><Upload size={19} /></div>
        <h2 id="upload-title">Upload an invoice</h2>
        <p>Drop a PDF here or choose a file to begin processing.</p>
        <label className="file-picker">
          <Upload size={16} />
          Choose PDF
          <input type="file" accept="application/pdf" onChange={onClose} />
        </label>
        <button className="dialog-cancel" type="button" onClick={onClose}>Cancel</button>
      </section>
    </div>
  )
}

function App() {
  const [uploadOpen, setUploadOpen] = useState(false)

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-shell">
        <Header onUpload={() => setUploadOpen(true)} />
        <main className="page-content">
          <div className="content-wrap">
            <div className="page-heading">
              <h1>Invoice Overview</h1>
              <p>Monitor your invoice processing activity.</p>
            </div>
            <section className="kpi-grid" aria-label="Invoice totals">
              <KpiCard label="Total invoices" value="128" />
              <KpiCard label="Approved" value="86" />
              <KpiCard label="Needs review" value="24" />
              <KpiCard label="Failed" value="3" />
            </section>
            <RecentInvoices invoices={invoices} />
            <EmptyState onUpload={() => setUploadOpen(true)} />
          </div>
        </main>
      </div>
      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} />}
    </div>
  )
}

export default App
