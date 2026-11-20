import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { MagnifyingGlass, User, Buildings, Handshake } from '@phosphor-icons/react'
import { globalSearch } from '../api'
import { formatMoney } from '../format'

// Ctrl/Cmd+K search across contacts, companies and deals. `onPick(kind, id)` navigates.
export default function GlobalSearch({ open, close, onPick }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState({ contacts: [], companies: [], deals: [] })
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQ(''); setRes({ contacts: [], companies: [], deals: [] }); setActive(0)
    setTimeout(() => inputRef.current?.focus(), 10)
  }, [open])

  useEffect(() => {
    if (q.trim().length < 2) { setRes({ contacts: [], companies: [], deals: [] }); return }
    const t = setTimeout(() => globalSearch(q.trim()).then(r => { setRes(r); setActive(0) }).catch(() => {}), 200)
    return () => clearTimeout(t)
  }, [q])

  const items = [
    ...res.contacts.map(c => ({ kind: 'contact', id: c.id, icon: User, title: c.name, sub: [c.phone, c.email].filter(Boolean).join(' · ') })),
    ...res.companies.map(c => ({ kind: 'company', id: c.id, icon: Buildings, title: c.name, sub: [c.industry, c.city].filter(Boolean).join(' · ') })),
    ...res.deals.map(d => ({ kind: 'deal', id: d.id, icon: Handshake, title: d.title, sub: [d.stage_name, d.value ? formatMoney(d.value, d.currency) : ''].filter(Boolean).join(' · ') })),
  ]
  const pick = (it) => { if (!it) return; close(); onPick(it.kind, it.id) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[active]) }
    else if (e.key === 'Escape') close()
  }

  if (!open) return null
  let lastKind = null
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 pt-[12vh]" onClick={close}>
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}
        className="w-full max-w-xl rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 h-12 border-b border-zinc-200 dark:border-zinc-800">
          <MagnifyingGlass size={16} className="text-zinc-400 shrink-0" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search contacts, companies, deals… (name, phone, email)"
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none" />
          <kbd className="text-[10px] text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto py-1">
          {q.trim().length < 2 ? (
            <p className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">Type at least 2 characters.</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">No matches.</p>
          ) : items.map((it, i) => {
            const header = it.kind !== lastKind ? { contact: 'Contacts', company: 'Companies', deal: 'Deals' }[it.kind] : null
            lastKind = it.kind
            const Icon = it.icon
            return (
              <div key={it.kind + it.id}>
                {header && <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{header}</div>}
                <button onMouseEnter={() => setActive(i)} onClick={() => pick(it)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left ${i === active ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
                  <Icon size={14} className="text-zinc-400 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{it.title}</span>
                    {it.sub && <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{it.sub}</span>}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
