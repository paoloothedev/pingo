import { useState, useEffect } from 'react'
import { Copy, CheckCircle } from '@phosphor-icons/react'
import { getDuplicates, mergeContacts, dismissDuplicate } from '../api'
import { LIFECYCLE } from '../lifecycle'
import { formatDate } from '../format'
import { can } from '../permissions'
import { BackLink } from './RecordParts'

// Manual review of possible duplicates. Nothing merges automatically: shared phones are common for
// branches of one chain (e.g. a hotline), so the user decides per group.
export default function Duplicates({ user, showToast, goView, refresh }) {
  const [groups, setGroups] = useState(null)
  const [choice, setChoice] = useState({}) // groupKey → { primary, merge:Set }
  const [dismissed, setDismissed] = useState(new Set())
  const [busy, setBusy] = useState(null)
  const canEdit = can(user, 'leads.edit')

  const load = () => getDuplicates().then(gs => {
    setGroups(gs)
    const init = {}
    for (const g of gs) {
      const key = g.reason + ':' + g.value
      // Default primary: the most advanced lifecycle, then the oldest record
      const rank = { customer: 3, qualified: 2, churned: 1, lead: 0 }
      const sorted = [...g.contacts].sort((a, b) => (rank[b.lifecycle] ?? 0) - (rank[a.lifecycle] ?? 0) || a.created_at - b.created_at)
      init[key] = { primary: sorted[0].id, merge: new Set(g.contacts.map(c => c.id).filter(id => id !== sorted[0].id)) }
    }
    setChoice(init)
  }).catch(err => showToast(err.message || 'Could not load duplicates.', true))
  useEffect(() => { load() }, [])

  const setPrimary = (key, id, all) => setChoice(c => ({ ...c, [key]: { primary: id, merge: new Set(all.filter(x => x !== id)) } }))
  const toggle = (key, id) => setChoice(c => {
    const m = new Set(c[key].merge)
    m.has(id) ? m.delete(id) : m.add(id)
    return { ...c, [key]: { ...c[key], merge: m } }
  })
  const merge = async (key) => {
    const { primary, merge: m } = choice[key]
    if (!m.size) return
    setBusy(key)
    try {
      const r = await mergeContacts(primary, [...m])
      showToast(`Merged ${r.merged} contact${r.merged === 1 ? '' : 's'}.`)
      refresh?.()
      await load()
    } catch (err) { showToast(err.message || 'Merge failed.', true) }
    finally { setBusy(null) }
  }

  const dismiss = async (g, key) => {
    setDismissed(d => new Set(d).add(key))
    try { await dismissDuplicate(g.reason, g.value) } catch (err) { showToast(err.message || 'Could not save.', true) }
  }

  const visible = (groups || []).filter(g => !dismissed.has(g.reason + ':' + g.value))

  return (
    <div className="max-w-4xl mx-auto">
      <BackLink onClick={() => goView('leads')}>Contacts</BackLink>
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Possible duplicates</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 mb-6">
        Contacts sharing a phone number or email. Branches of the same chain often share a hotline — only merge real duplicates.
        Merging keeps the chosen contact, fills its empty fields and moves tags, campaigns, deals and history onto it.
      </p>

      {groups === null ? null : visible.length === 0 ? (
        <div className="flex flex-col items-center py-20 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-center">
          <CheckCircle size={36} className="text-emerald-500 mb-3" />
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No duplicates to review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(g => {
            const key = g.reason + ':' + g.value
            const ch = choice[key]
            if (!ch) return null
            return (
              <section key={key} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 h-11 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <Copy size={13} /> Same {g.reason}: <span className="font-medium text-zinc-900 dark:text-zinc-100">{g.value}</span>
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{g.contacts.length} contacts</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        <th className="text-left font-medium py-2 px-4">Keep</th>
                        <th className="text-left font-medium py-2 px-2">Merge in</th>
                        <th className="text-left font-medium py-2 px-2">Name</th>
                        <th className="text-left font-medium py-2 px-2">Phone</th>
                        <th className="text-left font-medium py-2 px-2">Email</th>
                        <th className="text-left font-medium py-2 px-2">Lifecycle</th>
                        <th className="text-left font-medium py-2 px-4">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.contacts.map(c => {
                        const lc = LIFECYCLE[c.lifecycle] || LIFECYCLE.lead
                        const isPrimary = ch.primary === c.id
                        return (
                          <tr key={c.id} className={`border-t border-zinc-100 dark:border-zinc-800/60 ${isPrimary ? 'bg-emerald-50/60 dark:bg-emerald-900/10' : ''}`}>
                            <td className="py-2 px-4"><input type="radio" name={key} checked={isPrimary} onChange={() => setPrimary(key, c.id, g.contacts.map(x => x.id))} className="accent-emerald-500" aria-label={`Keep ${c.name}`} /></td>
                            <td className="py-2 px-2"><input type="checkbox" disabled={isPrimary} checked={!isPrimary && ch.merge.has(c.id)} onChange={() => toggle(key, c.id)} className="accent-emerald-500 disabled:opacity-30" aria-label={`Merge ${c.name}`} /></td>
                            <td className="py-2 px-2">
                              <button onClick={() => goView(`contact/${c.id}`)} className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-emerald-600 dark:hover:text-emerald-400 text-left">{c.name}</button>
                              {c.status === 'dead' && <span className="ml-1.5 text-[10px] text-red-500">dead</span>}
                            </td>
                            <td className="py-2 px-2 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{c.phone || '—'}</td>
                            <td className="py-2 px-2 text-zinc-600 dark:text-zinc-400">{c.email || '—'}</td>
                            <td className="py-2 px-2"><span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium ${lc.cls}`}>{lc.label}</span></td>
                            <td className="py-2 px-4 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{formatDate(c.created_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
                  <button onClick={() => dismiss(g, key)}
                    className="px-3 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    Not duplicates
                  </button>
                  {canEdit && (
                    <button onClick={() => merge(key)} disabled={!ch.merge.size || busy === key}
                      className="px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50">
                      {busy === key ? 'Merging…' : `Merge ${ch.merge.size} into selected`}
                    </button>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
