import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import AllInvoices from './components/AllInvoices'
import UploadInvoice from './components/UploadInvoice'
import InvoiceDetails from './components/InvoiceDetails'
import './App.css'

const parseHashRoute = () => {
  const hash = window.location.hash.replace(/^#\/?/, '')

  if (!hash || hash === 'invoices') {
    return { view: 'all-invoices', invoice: null }
  }

  if (hash === 'upload') {
    return { view: 'upload', invoice: null }
  }

  if (hash.startsWith('invoice/')) {
    const id = decodeURIComponent(hash.slice('invoice/'.length))
    return id
      ? { view: 'invoice-details', invoice: { id } }
      : { view: 'all-invoices', invoice: null }
  }

  return { view: 'all-invoices', invoice: null }
}

const setHashRoute = (route) => {
  if (window.location.hash !== route) {
    window.location.hash = route
  }
}

function App() {
  const initialRoute = parseHashRoute()
  const [activeView, setActiveView] = useState(initialRoute.view)
  const [selectedInvoice, setSelectedInvoice] = useState(initialRoute.invoice)
  const [uploadConfirmation, setUploadConfirmation] = useState(null)

  const isInvoicesView = activeView.startsWith('all-invoices')
  const initialStatus = activeView.split(':')[1] || ''

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/invoices')
    }

    function onHashChange() {
      const nextRoute = parseHashRoute()
      setActiveView(nextRoute.view)
      setSelectedInvoice(nextRoute.invoice)

      if (
        nextRoute.view !== 'invoice-details' ||
        nextRoute.invoice?.id !== uploadConfirmation?.invoiceId
      ) {
        setUploadConfirmation(null)
      }
    }

    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('popstate', onHashChange)

    return () => {
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('popstate', onHashChange)
    }
  }, [uploadConfirmation?.invoiceId])

  function navigate(view) {
    if (view === 'upload') {
      setHashRoute('#/upload')
      setActiveView('upload')
      setSelectedInvoice(null)
      setUploadConfirmation(null)
      return
    }

    if (view === 'all-invoices') {
      setHashRoute('#/invoices')
      setActiveView('all-invoices')
      setSelectedInvoice(null)
      setUploadConfirmation(null)
      return
    }

    if (view.startsWith('all-invoices:')) {
      window.history.pushState(null, '', '#/invoices')
      setActiveView(view)
      setSelectedInvoice(null)
      setUploadConfirmation(null)
      return
    }

    setActiveView(view)
    setSelectedInvoice(null)
    setUploadConfirmation(null)
  }

  function openInvoice(invoice, confirmation = null) {
    setSelectedInvoice(invoice)
    setActiveView('invoice-details')
    setUploadConfirmation(confirmation)

    if (invoice?.id) {
      setHashRoute(`#/invoice/${encodeURIComponent(invoice.id)}`)
    }
  }

  function handleUploaded(invoice) {
    openInvoice(invoice, {
      invoiceId: invoice.id,
      message: 'Document uploaded and queued for processing.',
    })
  }

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onNavigate={navigate} />

      <div className="main-shell">
        <Header onUpload={() => navigate('upload')} />

        <main className="page-content">
          {activeView === 'upload' ? (
            <UploadInvoice onUploaded={handleUploaded} />
          ) : activeView === 'invoice-details' ? (
            <InvoiceDetails
              invoice={selectedInvoice}
              uploadConfirmation={uploadConfirmation}
              onBack={() => navigate('all-invoices')}
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
