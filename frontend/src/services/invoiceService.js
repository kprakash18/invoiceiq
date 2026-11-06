import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
  timeout: 30000,
})

export async function uploadInvoice(file) {
  const formData = new FormData()
  formData.append('invoice', file)

  const response = await api.post('/invoices', formData)
  return response.data
}

export async function getInvoices(page = 1, limit = 10, status = '') {
  const response = await api.get('/invoices', {
    params: {
      page,
      limit,
      ...(status ? { status } : {}),
    },
  })

  return response.data
}

export async function getInvoiceById(id) {
  const response = await api.get(`/invoices/${id}`)
  return response.data
}

export function getInvoiceFileUrl(id) {
  return `${api.defaults.baseURL}/invoices/${id}/file`
}

export function getApiError(error) {
  return (
    error.response?.data?.message ||
    error.message ||
    'Something went wrong.'
  )
}