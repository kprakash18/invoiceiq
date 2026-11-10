import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  CloudUpload,
  FileImage,
  FileText,
  FolderOpen,
  UploadCloud,
} from 'lucide-react'
import { uploadInvoice, getApiError } from '../services/invoiceService'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ACCEPTED_FILE_TYPES = new Map([
  ['application/pdf', 'PDF'],
  ['image/jpeg', 'JPG'],
  ['image/png', 'PNG'],
])

const isAcceptedFile = (nextFile) => {
  const name = nextFile.name.toLowerCase()
  const hasAcceptedExtension =
    name.endsWith('.pdf') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png')

  return hasAcceptedExtension && ACCEPTED_FILE_TYPES.has(nextFile.type)
}

function UploadInvoice({ onUploaded }) {
  const inputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const previewUrl = useMemo(() => {
    if (!file || !file.type.startsWith('image/')) return ''
    return URL.createObjectURL(file)
  }, [file])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function acceptFile(nextFile) {
    if (!nextFile) return

    setError('')
    setSuccess('')

    if (!isAcceptedFile(nextFile)) {
      setError('Please select a valid PDF, JPG, JPEG, or PNG file.')
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

      const uploadedInvoice = response.data?.invoice

      if (uploadedInvoice?.id) {
        onUploaded?.(uploadedInvoice)
      }
    } catch (err) {
      setError(getApiError(err))
    } finally {
      setUploading(false)
    }
  }

  const selectedType = file ? ACCEPTED_FILE_TYPES.get(file.type) || 'File' : ''
  const SelectedIcon = file?.type.startsWith('image/') ? FileImage : FileText

  return (
    <div className="upload-page">
      <div className="upload-page-heading">
        <h1>Upload Invoice</h1>
        <p>Upload a vendor invoice PDF or image to begin processing.</p>
      </div>

      <section className="upload-card">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
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
          {previewUrl ? (
            <span className="upload-image-preview">
              <img src={previewUrl} alt="" />
            </span>
          ) : (
            <span className="dropzone-icon">
              <UploadCloud size={34} />
            </span>
          )}

          <strong>
            {file
              ? file.name
              : <>Drag and drop vendor invoice here, or <u>Browse files</u></>}
          </strong>

          <span className="dropzone-help">
            {file
              ? `${selectedType} invoice, ${(file.size / 1024 / 1024).toFixed(2)} MB selected`
              : 'Accepted formats: PDF, JPG, JPEG, PNG up to 10 MB'}
          </span>

          {file && (
            <span className="selected-file-type">
              <SelectedIcon size={15} />
              {selectedType} source document
            </span>
          )}

          <span className="browse-button">
            <FolderOpen size={18} />
            Browse Files
          </span>
        </button>

        <div className="upload-footer">
          <span className="secure-note">PDF, JPG, JPEG, PNG · Maximum file size: 10 MB</span>

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
