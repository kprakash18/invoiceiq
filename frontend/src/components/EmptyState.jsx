import { Upload } from 'lucide-react'

function EmptyState({ onUpload }) {
  return (
    <section className="empty-state">
      <div className="empty-icon"><Upload size={21} /></div>
      <div><h2>No invoices uploaded yet</h2><p>Upload your first invoice to start processing.</p></div>
      <button className="primary-button compact" type="button" onClick={onUpload}><Upload size={16} />Upload Invoice</button>
    </section>
  )
}

export default EmptyState
