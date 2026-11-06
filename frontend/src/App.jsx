import { useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import AllInvoices from './components/AllInvoices'
import UploadInvoice from './components/UploadInvoice'
import InvoiceDetails from './components/InvoiceDetails'
import './App.css'

function App() {
  const [activeView, setActiveView] = useState('all-invoices')
  const [selectedInvoice, setSelectedInvoice] = useState(null)

  const isInvoicesView = activeView.startsWith('all-invoices')
  const initialStatus = activeView.split(':')[1] || ''

  function openInvoice(invoice) {
    setSelectedInvoice(invoice)
    setActiveView('invoice-details')
  }

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={setActiveView} />

      <div className="main-shell">
        <Header onUpload={() => setActiveView('upload')} />

        <main className="page-content">
          {activeView === 'upload' ? (
            <UploadInvoice />
          ) : activeView === 'invoice-details' ? (
            <InvoiceDetails
              invoice={selectedInvoice}
              onBack={() => setActiveView('all-invoices')}
            />
          ) : isInvoicesView ? (
            <AllInvoices
              key={initialStatus}
              initialStatus={initialStatus}
              onOpenInvoice={openInvoice}
            />
          ) : (
            <AllInvoices onOpenInvoice={openInvoice} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App