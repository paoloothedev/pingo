import { ArrowLeft } from '@phosphor-icons/react'
import { formatMoney } from '../format'
import { formatCustomValue } from './CustomFieldInputs'

// Shared building blocks for the full-page contact / company views.

export function BackLink({ onClick, children }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 mb-3">
      <ArrowLeft size={12} /> {children}
    </button>
  )
}

export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-4 h-11 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function FieldRow({ label, children }) {
  const empty = children === null || children === undefined || children === '' || children === false
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-1.5 text-xs">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-100 min-w-0 break-words">{empty ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : children}</dd>
    </div>
  )
}

export function CustomFieldRows({ defs, values, members }) {
  return defs.map(d => (
    <FieldRow key={d.id} label={d.label}>{formatCustomValue(d, values?.[d.key], { members })}</FieldRow>
  ))
}

export function ExternalLink({ href, children }) {
  if (!href) return null
  return <a href={href} target="_blank" rel="noopener" className="text-emerald-600 dark:text-emerald-400 hover:underline break-all">{children || href}</a>
}

const STATUS_CLS = {
  open: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  won: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  lost: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// `stageName(stageId)` resolves a pipeline stage name
export function DealList({ deals, stageName, onOpen, empty = 'No deals yet.' }) {
  if (!deals?.length) return <p className="text-xs text-zinc-500 dark:text-zinc-400">{empty}</p>
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {deals.map(d => (
        <li key={d.id}>
          <button onClick={() => onOpen(d.id)} className="w-full flex items-center justify-between gap-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 -mx-2 px-2 rounded-lg">
            <span className="min-w-0">
              <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{d.title}</span>
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{stageName(d.stage_id)}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-xs tabular-nums text-zinc-700 dark:text-zinc-300">{d.value ? formatMoney(d.value, d.currency) : '—'}</span>
              <span className={`px-1.5 h-4 inline-flex items-center rounded text-[9px] font-semibold uppercase ${STATUS_CLS[d.status] || STATUS_CLS.open}`}>{d.status}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
