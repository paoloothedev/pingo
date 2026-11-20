export function formatMoney(value, currency = 'USD', { compact = false } = {}) {
  const n = Number(value) || 0
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: compact || Number.isInteger(n) ? 0 : 2,
      notation: compact && Math.abs(n) >= 10000 ? 'compact' : 'standard',
    }).format(n)
  } catch {
    return `${n.toLocaleString()} ${currency}`
  }
}

export function formatDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// <input type="date"> value (local date) ↔ timestamp
export function toDateInput(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function fromDateInput(v) {
  if (!v) return null
  const [y, m, d] = v.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}
