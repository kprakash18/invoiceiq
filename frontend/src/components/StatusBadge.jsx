function StatusBadge({ status }) {
  const displayStatus = String(status || 'Unavailable')
  const statusClass = displayStatus.toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')

  return <span className={`status-badge status-${statusClass}`}>{displayStatus.replaceAll('_', ' ')}</span>
}

export default StatusBadge
