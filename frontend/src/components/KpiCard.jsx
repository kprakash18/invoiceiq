function KpiCard({ label, value }) {
  return <article className="kpi-card"><span className="kpi-label">{label}</span><strong className="kpi-value">{value}</strong></article>
}

export default KpiCard
