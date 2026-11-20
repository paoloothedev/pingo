import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  MagnifyingGlass, CheckCircle, XCircle, Trash, ArrowClockwise,
  CaretRight, Skull
} from '@phosphor-icons/react'
import { getLeads, updateLead, deleteLead, bulkAction, addLeadsToCampaign } from '../api'
import { canI } from '../permissions'
import Pagination from './Pagination'

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.02, type: 'spring', stiffness: 120, damping: 20 }
  })
}

export default function DeadList({ stages, tags, campaigns, refreshId, openLeadModal, showToast, refresh }) {
  const [leads, setLeads] = useState([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(() => Number(localStorage.getItem('leadsPageSize')) || 50)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [fPhone, setFPhone] = useState('')
  const [fVerified, setFVerified] = useState('')
  const [fTag, setFTag] = useState([])
  const [fTagNot, setFTagNot] = useState(false)
  const [sortBy, setSortBy] = useState('dead_at')
  const [sortOrder, setSortOrder] = useState('desc')
  const [selected, setSelected] = useState(new Set())
  const [showBulkStage, setShowBulkStage] = useState(false)
  const [showBulkTag, setShowBulkTag] = useState(false)
  const [showBulkCampaign, setShowBulkCampaign] = useState(false)

  const loadDead = useCallback(async () => {
    try {
      const params = { status: 'dead' }
      if (search) params.search = search
      if (fPhone) params.phoneStatus = fPhone
      if (fVerified) params.verified = fVerified
      if (fTag.length) {
        const joined = fTag.join(',')
        if (fTagNot) params.tagNot = joined
        else params.tag = joined
      }
      params.sortBy = sortBy
      params.sortOrder = sortOrder
      params.page = page
      params.limit = limit
      const data = await getLeads(params)
      if (!data.items.length && page > 1) { setPage(p => p - 1); return }
      setLeads(data.items)
      setTotal(data.total)
      setSelected(new Set())
    } catch {}
  }, [search, fPhone, fVerified, fTag, fTagNot, sortBy, sortOrder, page, limit])

  useEffect(() => { setPage(1) }, [search, fPhone, fVerified, fTag, fTagNot, sortBy, sortOrder])

  const changeLimit = (n) => {
    setLimit(n)
    setPage(1)
    try { localStorage.setItem('leadsPageSize', String(n)) } catch {}
  }

  useEffect(() => { loadDead() }, [loadDead, refreshId])

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortOrder('asc')
    }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === leads.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(leads.map(l => l.id)))
    }
  }

  const handleRestore = async (id) => {
    try {
      await updateLead(id, { status: 'active', dead_at: null })
      showToast('Lead restored.')
      refresh()
    } catch { showToast('Failed to restore.', true) }
  }

  const handleDeleteRow = async (id, name) => {
    if (!confirm(`Delete "${name}" permanently?`)) return
    try {
      await deleteLead(id)
      showToast('Lead deleted.')
      refresh()
    } catch { showToast('Failed to delete.', true) }
  }

  const doBulk = async (action, stageId, tagId) => {
    const ids = Array.from(selected)
    if (!ids.length) { showToast('Select some leads first.', true); return }
    try {
      await bulkAction(ids, action, stageId, tagId)
      showToast(`Done: ${ids.length} leads.`)
      refresh()
    } catch { showToast('Bulk action failed.', true) }
  }

  const handleAddToCampaign = async (campId) => {
    const ids = Array.from(selected)
    if (!ids.length) { showToast('Select some leads first.', true); return }
    setShowBulkCampaign(false)
    try {
      const result = await addLeadsToCampaign(campId, ids, null, false)
      const camp = (campaigns || []).find(c => c.id === campId)
      showToast(`Added ${result.added} leads to "${camp?.name || campId}".`)
      refresh()
    } catch (err) {
      showToast(err.message || 'Failed to add to campaign.', true)
    }
  }

  const sortArrow = (col) => {
    if (sortBy !== col) return ''
    return sortOrder === 'asc' ? ' ▲' : ' ▼'
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Dead List</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Contacts marked as dead. Review and restore them if needed.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input type="text" placeholder="Search name, phone, notes..." value={search} onChange={e => setSearch(e.target.value)}
            className="h-9 w-52 pl-8 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
        </div>
        <select value={fPhone} onChange={e => setFPhone(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
          <option value="">Phone: any</option>
          <option value="valid">Valid phone</option>
          <option value="invalid">Invalid/missing</option>
        </select>
        <select value={fVerified} onChange={e => setFVerified(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
          <option value="">Verified: any</option>
          <option value="yes">Verified</option>
          <option value="no">Unverified</option>
        </select>
        <div className="flex items-center flex-wrap gap-1">
          {tags.map(t => (
            <button key={t.id} onClick={() => setFTag(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id])}
              className={`inline-flex items-center px-2.5 h-7 rounded-md text-[11px] font-medium transition-colors ${fTag.includes(t.id) ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
              {t.name}
            </button>
          ))}
          <button onClick={() => setFTagNot(!fTagNot)}
            className={`inline-flex items-center px-2 h-7 rounded-md text-[11px] font-medium transition-colors ${fTagNot ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
            title="Invert tag filter">
            NOT
          </button>
        </div>
        <button onClick={() => { setSearch(''); setFPhone(''); setFVerified(''); setFTag([]); setFTagNot(false) }}
          className="h-9 px-3 rounded-lg text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
          Clear
        </button>
      </div>

      {selected.size > 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
              <input type="checkbox" checked={selected.size > 0 && selected.size === leads.length} onChange={toggleAll}
                className="accent-emerald-500 w-3.5 h-3.5" />
              Select all
            </label>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{selected.size} selected</span>
            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />
            <button onClick={() => { const ids = Array.from(selected); if (!ids.length) { showToast('Select some leads first.', true); return }; Promise.all(ids.map(id => updateLead(id, { status: 'active', dead_at: null }))).then(() => { showToast(`Restored ${ids.length} leads.`); refresh() }).catch(() => showToast('Failed.', true)) }}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
              <ArrowClockwise size={12} className="mr-1.5" />
              Restore
            </button>
            {canI('leads.verify') && (
            <button onClick={() => doBulk('verify')}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
              Verify
            </button>
            )}
            {canI('leads.edit') && (
            <button onClick={() => setShowBulkStage(!showBulkStage)}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              Move to stage...
            </button>
            )}
            {showBulkStage && (
              <select value="" onChange={e => { if (e.target.value) doBulk('stage', e.target.value) }}
                className="h-7 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
                <option value="">Select stage...</option>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {canI('leads.edit') && (
            <button onClick={() => setShowBulkTag(!showBulkTag)}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              Assign tag...
            </button>
            )}
            {showBulkTag && (
              <select value="" onChange={e => { if (e.target.value) { doBulk('tag', null, e.target.value); setShowBulkTag(false) } }}
                className="h-7 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
                <option value="">Select tag...</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {canI('campaigns.edit') && (
            <button onClick={() => setShowBulkCampaign(!showBulkCampaign)}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              Add to campaign...
            </button>
            )}
            {showBulkCampaign && (
              <select value="" onChange={e => { if (e.target.value) handleAddToCampaign(e.target.value) }}
                className="h-7 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
                <option value="">Select campaign...</option>
                {(campaigns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button onClick={() => { if (confirm(`Delete ${selected.size} leads permanently?`)) doBulk('delete') }}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors active:scale-[0.98]">
              <Trash size={12} className="mr-1.5" />
              Delete
            </button>
          </div>
        </div>
      )}

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <Skull size={40} className="text-zinc-300 dark:text-zinc-600 mb-4" />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">All clear</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No contacts have been marked dead.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                  <th className="w-10 py-3 px-2"><input type="checkbox" checked={selected.size > 0 && selected.size === leads.length} onChange={toggleAll} className="accent-emerald-500 w-3.5 h-3.5" /></th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Phone</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Notes</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('dead_at')}>
                    Dead on{sortArrow('dead_at')}
                  </th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('verified')}>
                    Verified{sortArrow('verified')}
                  </th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Tags</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l, i) => (
                  <motion.tr
                    key={l.id}
                    custom={i}
                    variants={rowVariants}
                    initial="hidden"
                    animate="visible"
                    className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="py-3 px-2"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} className="accent-emerald-500 w-3.5 h-3.5" /></td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[130px]">{l.name}</span>
                        <button onClick={() => window.open('https://www.google.com/search?q=' + encodeURIComponent(l.name), '_blank')}
                          className="text-[10px] px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 transition-colors shrink-0" title="Search Google">
                          G
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400">{l.phone || <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>}</td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400 max-w-[120px] truncate">{(l.notes || '').slice(0, 40)}</td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400">{l.dead_at ? new Date(l.dead_at).toLocaleDateString() : <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>}</td>
                    <td className="py-3 px-4">
                      {l.verified
                        ? <span className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><CheckCircle size={10} weight="fill" /> Yes</span>
                        : <span className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"><XCircle size={10} weight="fill" /> No</span>
                      }
                    </td>
                    <td className="py-3 px-4">
                      {l.tags?.length ? (
                        <div className="flex gap-0.5 flex-wrap max-w-[100px]">
                          {l.tags.map(t => (
                            <span key={t.id} className="inline-flex items-center px-1 h-4 rounded text-[9px] font-medium text-white whitespace-nowrap" style={{ background: t.color }}>{t.name}</span>
                          ))}
                        </div>
                      ) : <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1">
                        <button onClick={() => handleRestore(l.id)}
                          className="inline-flex items-center gap-0.5 px-2 h-6 rounded text-[10px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.95]">
                          <ArrowClockwise size={10} weight="bold" />
                          Rst
                        </button>
                        <button onClick={() => openLeadModal(l.id)}
                          className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.95]">
                          <CaretRight size={12} />
                        </button>
                        {canI('leads.delete') && (
                        <button onClick={() => handleDeleteRow(l.id, l.name)}
                          className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-medium border border-red-200 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors active:scale-[0.95]">
                          <Trash size={12} />
                        </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Pagination page={page} limit={limit} total={total} onPage={setPage} onLimit={changeLimit} />
    </div>
  )
}
