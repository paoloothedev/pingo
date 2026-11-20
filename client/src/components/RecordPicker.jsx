import { useState, useEffect, useRef } from 'react'
import { X, MagnifyingGlass } from '@phosphor-icons/react'

// Search-as-you-type picker for a single record (contact, company…).
// `search(q)` returns a promise of [{ id, name, sub? }]; `value` is { id, name } or null.
export default function RecordPicker({ value, onChange, search, placeholder = 'Search…' }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timer = useRef(null)
  const box = useRef(null)

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const onType = (v) => {
    setQ(v)
    clearTimeout(timer.current)
    if (!v.trim()) { setResults([]); return }
    timer.current = setTimeout(async () => {
      try { setResults(await search(v.trim())); setOpen(true) } catch { setResults([]) }
    }, 250)
  }

  if (value) {
    return (
      <div className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between text-xs text-zinc-900 dark:text-zinc-100">
        <span className="truncate">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" aria-label="Clear">
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={box}>
      <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
      <input type="text" value={q} onChange={e => onType(e.target.value)} onFocus={() => results.length && setOpen(true)} placeholder={placeholder}
        className="w-full h-9 pl-7 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
          {results.map(r => (
            <button key={r.id} type="button" onClick={() => { onChange({ id: r.id, name: r.name }); setQ(''); setResults([]); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors">
              <div className="text-zinc-900 dark:text-zinc-100 truncate">{r.name}</div>
              {r.sub && <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{r.sub}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
