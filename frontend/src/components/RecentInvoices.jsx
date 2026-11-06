import { ArrowRight } from 'lucide-react'
import StatusBadge from './StatusBadge'

function RecentInvoices({ invoices }) {
  return (
    <section className="invoice-card">
      <div className="card-header"><h2>Recent Invoices</h2><a href="#all-invoices" className="view-all">View all <ArrowRight size={14} /></a></div>
      <div className="table-scroll">
        <table className="invoice-table">
          <thead><tr><th>Invoice Number</th><th>Vendor</th><th>Amount</th><th>Date</th><th>Status</th><th className="align-right">Action</th></tr></thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="invoice-id">{invoice.id}</td>
                <td className={invoice.muted ? 'muted-cell' : 'vendor-name'}>{invoice.vendor}</td>
                <td className="amount">{invoice.amount}</td>
                <td className="date-cell">{invoice.date}</td>
                <td><StatusBadge status={invoice.status} /></td>
                <td className="align-right"><a className="row-action" href={`#${invoice.id}`}>View</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default RecentInvoices
