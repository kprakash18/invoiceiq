import { Upload } from 'lucide-react'

function Header({ onUpload }) {
  return (
    <header className="top-header">
      <div className="header-context" aria-label="Application context">
        <span>Invoice Process</span>
        <strong>PDF to decision pipeline</strong>
      </div>

      <button className="primary-button" type="button" onClick={onUpload}>
        <Upload size={17} />
        Upload Invoice
      </button>
    </header>
  )
}

export default Header
