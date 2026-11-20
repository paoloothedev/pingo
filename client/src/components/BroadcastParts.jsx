// Shared by the broadcasts list, the broadcast page and the campaign page.

export const STATUS_COLORS = {
  pending: 'text-blue-600 dark:text-blue-500',
  scheduled: 'text-violet-600 dark:text-violet-400',
  running: 'text-emerald-600 dark:text-emerald-400',
  paused: 'text-amber-600 dark:text-amber-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
  stopped: 'text-red-600 dark:text-red-400',
  failed: 'text-red-600 dark:text-red-400',
}

export const STATUS_LABELS = {
  pending: 'Queued', scheduled: 'Scheduled', running: 'Sending', paused: 'Paused',
  completed: 'Completed', stopped: 'Stopped', failed: 'Failed',
}

export const fmtDateTime = (ts) => ts
  ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—'

export const broadcastTitle = (j) => j.name || j.campaign_name || `Broadcast · ${new Date(j.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`

export const isActiveBroadcast = (j) => ['running', 'paused', 'pending', 'scheduled'].includes(j.status)

export function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 min-w-0">
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone || 'text-zinc-900 dark:text-zinc-100'}`}>{value ?? 0}</div>
    </div>
  )
}

// What happened with one contact in a broadcast
export function OutreachBadge({ row }) {
  if (!row) return <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Not sent yet</span>
  const [label, cls] = row.replied_at ? ['Replied', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400']
    : row.delivered_at ? ['Delivered', 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400']
    : row.status === 'sent' ? ['Sent', 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300']
    : row.status === 'failed' ? ['Failed', 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400']
    : row.status === 'skipped' ? ['Skipped', 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400']
    : ['Waiting', 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400']
  return <span title={row.error || undefined} className={`inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium ${cls}`}>{label}</span>
}
