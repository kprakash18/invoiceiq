import { useRef, useState } from 'react'
import {
  CheckCircle2,
  CloudUpload,
  FolderOpen,
  UploadCloud,
} from 'lucide-react'
import { uploadInvoice, getApiError } from '../services/invoiceService'

const MAX_FILE_SIZE = 10 * 1024 * 1024

function UploadInvoice() {
  const inputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  function acceptFile(nextFile) {
    if (!nextFile) return

    setError('')
    setSuccess('')

    if (
      !nextFile.name.toLowerCase().endsWith('.pdf') ||
      nextFile.type !== 'application/pdf'
    ) {
      setError('Please select a valid PDF file.')
      return
    }

    if (nextFile.size > MAX_FILE_SIZE) {
      setError('File size must not exceed 10 MB.')
      return
    }

    setFile(nextFile)
  }

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    acceptFile(event.dataTransfer.files?.[0])
  }

  async function handleUpload() {
    if (!file || uploading) return

    setUploading(true)
    setError('')
    setSuccess('')

    try {
      const response = await uploadInvoice(file)

      setSuccess(
        response.message || 'Invoice uploaded and queued for processing.'
      )
      setFile(null)

      if (inputRef.current) {
        inputRef.current.value = ''
      }
    } catch (err) {
      setError(getApiError(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="upload-page">
      <div className="upload-page-heading">
        <h1>Upload Invoice</h1>
        <p>Upload a vendor invoice PDF to begin processing.</p>
      </div>

      <section className="upload-card">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          hidden
          onChange={(event) => acceptFile(event.target.files?.[0])}
        />

        <button
          className={`dropzone${dragging ? ' dragging' : ''}`}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={uploading}
        >
          <span className="dropzone-icon">
            <UploadCloud size={34} />
          </span>

          <strong>
            {file
              ? file.name
              : <>Drag and drop vendor PDF here, or <u>Browse files</u></>}
          </strong>

          <span className="dropzone-help">
            {file
              ? `${(file.size / 1024 / 1024).toFixed(2)} MB selected`
              : 'Accepted format: PDF up to 10 MB'}
          </span>

          <span className="browse-button">
            <FolderOpen size={18} />
            Browse Files
          </span>
        </button>

        <div className="upload-footer">
          <span className="secure-note">Maximum file size: 10 MB</span>

          <button
            className="primary-button upload-submit"
            type="button"
            disabled={!file || uploading}
            onClick={handleUpload}
          >
            <CloudUpload size={18} />
            {uploading ? 'Uploading...' : 'Upload Invoice'}
          </button>
        </div>

        {error && <div className="upload-error">{error}</div>}

        {success && (
          <div className="upload-success">
            <CheckCircle2 size={16} />
            {success}
          </div>
        )}
      </section>
    </div>
  )
}

export default UploadInvoice