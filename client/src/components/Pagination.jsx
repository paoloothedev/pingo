import { CaretLeft, CaretRight } from '@phosphor-icons/react'

const SIZES = [25, 50, 100, 200]

export default function Pagination({ page, limit, total, onPage, onLimit }) {
  if (!total) return null
  const pages = Math.max(1, Math.ceil(total / limit))
  const from = (page - 1) * limit + 1
  const to = Math.min(total, page * limit)
  const btn = 'inline-flex items-center justify-center w-7 h-7 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="tabular-nums">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <select value={limit} onChange={e => onLimit(Number(e.target.value))}
          className="h-7 px-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
          {SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
        <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><CaretLeft size={12} /></button>
        <span className="tabular-nums">{page} / {pages}</span>
        <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><CaretRight size={12} /></button>
      </div>
    </div>
  )
}
