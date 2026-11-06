import { Upload } from 'lucide-react'

function Header({ onUpload }) {
  return (
    <header className="top-header">
      <button className="primary-button" type="button" onClick={onUpload}>
        <Upload size={17} />
        Upload Invoice
      </button>
    </header>
  )
}

export default Header
