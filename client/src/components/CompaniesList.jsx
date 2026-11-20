import { useState, useEffect, useCallback } from 'react'
import { Buildings, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { getCompanies, getProjectMembers } from '../api'
import { can } from '../permissions'
import Pagination from './Pagination'
import CompanyModal from './CompanyModal'

const control = 'h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors'
const th = 'text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider whitespace-nowrap'

export default function CompaniesList({ user, refreshId, showToast, goView }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useState('')
  const [members, setMembers] = useState([])
  const [creating, setCreating] = useState(false)

  useEffect(() => { getProjectMembers().then(setMembers).catch(() => {}) }, [])

  const load = useCallback(async () => {
    try {
      const params = { page, limit, sortBy: 'name', sortOrder: 'asc' }
      if (search.trim()) params.search = search.trim()
      if (owner) params.owner = owner
      const r = await getCompanies(params)
      if (!r.items.length && page > 1) { setPage(p => p - 1); return }
      setRows(r.items); setTotal(r.total)
    } catch (err) { showToast(err.message || 'Could not load companies.', true) }
  }, [page, limit, search, owner])

  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t) }, [load, refreshId])
  useEffect(() => { setPage(1) }, [search, owner])

  const memberName = (id) => { const m = members.find(x => x.id === id); return m ? (m.display_name || m.username) : '—' }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Companies</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Businesses your contacts belong to.</p>
        </div>
        {can(user, 'leads.edit') && (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98] shrink-0">
            <Plus size={14} weight="bold" /> Add company
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, domain, phone, city…" className={`${control} w-60 pl-8`} />
        </div>
        <select value={owner} onChange={e => setOwner(e.target.value)} className={control}>
          <option value="">Owner: anyone</option>
          <option value="me">Owned by me</option>
          <option value="none">Unassigned</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 text-center px-4">
          <Buildings size={40} className="text-zinc-300 dark:text-zinc-600 mb-4" />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{search ? 'No matching companies' : 'No companies yet'}</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">Companies are created automatically when you import from Google Maps, or add one yourself.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                  <th className={th}>Name</th><th className={th}>Industry</th><th className={th}>City</th>
                  <th className={th}>Phone</th><th className={th}>Website</th><th className={th}>Contacts</th><th className={th}>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.id} onClick={() => goView(`company/${c.id}`)}
                    className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer">
                    <td className="py-3 px-4 text-xs font-medium text-zinc-900 dark:text-zinc-100 max-w-[220px] truncate">{c.name}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400 max-w-[160px] truncate">{c.industry || '—'}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400">{c.city || '—'}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{c.phone || '—'}</td>
                    <td className="py-3 px-4 text-xs max-w-[180px] truncate">
                      {c.website ? <a href={c.website} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="text-emerald-600 dark:text-emerald-400 hover:underline">{c.domain || c.website}</a> : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">{c.contact_count}</td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{memberName(c.owner_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimit={n => { setLimit(n); setPage(1) }} />

      {creating && (
        <CompanyModal close={() => setCreating(false)} showToast={showToast} onSaved={c => c && goView(`company/${c.id}`)} />
      )}
    </div>
  )
}
