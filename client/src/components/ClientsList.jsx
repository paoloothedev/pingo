import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MagnifyingGlass, Funnel, Plus, CaretRight, Trash, X, CheckCircle,
  SquaresFour, List, ArrowRight, PaperPlaneTilt
} from '@phosphor-icons/react'
import { getClients, deleteClient, bulkAction, getLeads } from '../api'
import ClientModal from './ClientModal'
import WhatsAppSend from './WhatsAppSend'

const STAGE_OPTIONS = [
  { value: 'new', label: 'New', color: 'bg-zinc-400', hex: '#a1a1aa' },
  { value: 'contacted', label: 'Contacted', color: 'bg-blue-400', hex: '#60a5fa' },
  { value: 'interested', label: 'Interested', color: 'bg-emerald-400', hex: '#34d399' },
  { value: 'negotiating', label: 'Negotiating', color: 'bg-amber-400', hex: '#fbbf24' },
  { value: 'closed', label: 'Closed', color: 'bg-violet-400', hex: '#a78bfa' },
  { value: 'lost', label: 'Lost', color: 'bg-red-400', hex: '#f87171' },
]

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 120, damping: 20 } }
}

export default function ClientsList({ stages, tags, refreshId, showToast, refresh, openLeadModal }) {
  const [clients, setClients] = useState([])
  const [search, setSearch] = useState('')
  const [fStage, setFStage] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [showAddFromLeads, setShowAddFromLeads] = useState(false)
  const [leadSearch, setLeadSearch] = useState('')
  const [leadResults, setLeadResults] = useState([])
  const [leadSelected, setLeadSelected] = useState(new Set())
  const [leadSearching, setLeadSearching] = useState(false)
  const leadSearchTimer = useRef(null)
  const [viewMode, setViewMode] = useState('table')
  const [openClientId, setOpenClientId] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [showBulkWhatsApp, setShowBulkWhatsApp] = useState(false)

  const loadClients = useCallback(async () => {
    try {
      const params = {}
      if (search) params.search = search
      if (fStage) params.stage = fStage
      if (fStatus) params.status = fStatus
      const data = await getClients(params)
      setClients(data)
    } catch {}
  }, [search, fStage, fStatus])

  useEffect(() => { loadClients() }, [loadClients, refreshId])

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: formName, phone: formPhone, email: formEmail, notes: formNotes }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Client created.')
      setShowForm(false); setFormName(''); setFormPhone(''); setFormEmail(''); setFormNotes('')
      refresh()
    } catch { showToast('Failed to create client.', true) }
  }

  const handleDelete = async (e, id, name) => {
    e.stopPropagation()
    if (!confirm(`Delete client "${name}"?`)) return
    try {
      await deleteClient(id)
      showToast('Client deleted.')
      refresh()
    } catch { showToast('Failed.', true) }
  }

  const searchLeads = async (q) => {
    if (!q || !q.trim()) { setLeadResults([]); setLeadSelected(new Set()); return }
    setLeadSearching(true)
    try {
      const data = await getLeads({ search: q.trim(), status: 'active', page: 1, limit: 50 })
      setLeadResults(data.items)
      setLeadSelected(new Set())
    } catch {}
    setLeadSearching(false)
  }

  const onLeadSearchChange = (val) => {
    setLeadSearch(val)
    if (leadSearchTimer.current) clearTimeout(leadSearchTimer.current)
    leadSearchTimer.current = setTimeout(() => searchLeads(val), 300)
  }

  const toggleLeadSelect = (id) => {
    setLeadSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConvertLeads = async () => {
    const ids = Array.from(leadSelected)
    if (!ids.length) { showToast('Select leads to convert.', true); return }
    try {
      await bulkAction(ids, 'convert')
      showToast(`Converted ${ids.length} leads to CRM clients.`)
      setShowAddFromLeads(false)
      setLeadSearch('')
      setLeadResults([])
      setLeadSelected(new Set())
      refresh()
    } catch { showToast('Failed to convert.', true) }
  }

  const getStage = (s) => STAGE_OPTIONS.find(o => o.value === s) || STAGE_OPTIONS[0]

  const stageCounts = STAGE_OPTIONS.map(s => ({
    ...s,
    count: clients.filter(c => c.stage === s.value).length
  }))

  const activeClients = clients.filter(c => c.status === 'active').length
  const inactiveClients = clients.filter(c => c.status !== 'active').length

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === filteredClients.length) setSelected(new Set())
    else setSelected(new Set(filteredClients.map(c => c.id)))
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selected)
    if (!ids.length || !confirm(`Delete ${ids.length} clients permanently?`)) return
    try {
      for (const id of ids) await deleteClient(id)
      showToast(`Deleted ${ids.length} clients.`)
      setSelected(new Set())
      refresh()
    } catch { showToast('Failed to delete.', true) }
  }

  const groupedClients = STAGE_OPTIONS.reduce((acc, s) => {
    acc[s.value] = clients.filter(c => c.stage === s.value)
    return acc
  }, {})

  const filteredClients = clients

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">CRM</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Manage your client pipeline and relationships.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 border border-zinc-200 dark:border-zinc-800">
            <button onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium transition-colors ${viewMode === 'table' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
              <List size={12} /> Table
            </button>
            <button onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium transition-colors ${viewMode === 'kanban' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 dark:text-zinc-400'}`}>
              <SquaresFour size={12} /> Pipeline
            </button>
          </div>
          <button onClick={() => { setShowAddFromLeads(true); setLeadSearch(''); setLeadResults([]); setLeadSelected(new Set()) }}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors active:scale-[0.98]">
            <Plus size={14} weight="bold" /> Add from Leads
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <Plus size={14} weight="bold" /> Add Client
          </button>
        </div>
      </div>

      {/* Pipeline Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 mb-5">
        {stageCounts.map(s => (
          <button key={s.value} onClick={() => setFStage(fStage === s.value ? '' : s.value)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${fStage === s.value ? 'border-zinc-400 dark:border-zinc-500 bg-zinc-50 dark:bg-zinc-800/50 shadow-sm' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700'}`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.color}`} />
            <div className="text-left min-w-0">
              <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300 truncate">{s.label}</div>
              <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-tight">{s.count}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Add from Leads Modal */}
      <AnimatePresence>
        {showAddFromLeads && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAddFromLeads(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 250, damping: 25 }}
              className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Add from Leads</h2>
                <button onClick={() => setShowAddFromLeads(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="px-6 py-5 overflow-y-auto flex-1">
                <div className="flex gap-2 mb-4">
                  <div className="relative flex-1">
                    <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    <input type="text" placeholder="Search leads by name, phone, email..." value={leadSearch} onChange={e => onLeadSearchChange(e.target.value)}
                      className="h-9 w-full pl-8 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-blue-500/40" />
                  </div>
                  {leadSearching && <span className="text-[11px] text-zinc-400 self-center">Searching...</span>}
                </div>
                {leadResults.length > 0 && (
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{leadResults.length} results &middot; {leadSelected.size} selected</span>
                    <div className="flex gap-2">
                      <button onClick={() => setLeadSelected(new Set(leadResults.map(l => l.id)))}
                        className="text-[11px] text-blue-500 hover:text-blue-600 transition-colors">Select all</button>
                      <button onClick={() => setLeadSelected(new Set())}
                        className="text-[11px] text-zinc-500 hover:text-zinc-700 transition-colors">Clear</button>
                    </div>
                  </div>
                )}
                {leadResults.length === 0 && !leadSearching && leadSearch && (
                  <div className="text-center py-10 text-sm text-zinc-500 dark:text-zinc-400">No leads found.</div>
                )}
                {!leadSearch && leadResults.length === 0 && (
                  <div className="text-center py-10 text-sm text-zinc-500 dark:text-zinc-400">Search for leads to convert them into CRM clients.</div>
                )}
                {leadResults.length > 0 && (
                  <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                    {leadResults.map(l => (
                      <div key={l.id} onClick={() => toggleLeadSelect(l.id)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${leadSelected.has(l.id) ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent'}`}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${leadSelected.has(l.id) ? 'bg-blue-500 text-white' : 'border border-zinc-300 dark:border-zinc-600'}`}>
                          {leadSelected.has(l.id) && <CheckCircle size={12} weight="fill" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{l.name}</div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                            {l.phone && <span>{l.phone}</span>}
                            {l.phone && l.email && <span className="mx-1">&middot;</span>}
                            {l.email && <span>{l.email}</span>}
                            {!l.phone && !l.email && <span className="text-zinc-400">No contact info</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0 flex justify-end gap-2">
                <button onClick={() => setShowAddFromLeads(false)}
                  className="inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
                  Cancel
                </button>
                <button onClick={handleConvertLeads} disabled={!leadSelected.size}
                  className="inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50 active:scale-[0.98]">
                  Convert {leadSelected.size || ''} to CRM
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Client Detail Modal */}
      <AnimatePresence>
        {openClientId && (
          <ClientModal clientId={openClientId} close={() => setOpenClientId(null)} showToast={showToast} refresh={refresh} tags={tags} />
        )}
      </AnimatePresence>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
            <input type="text" placeholder="Name" value={formName} onChange={e => setFormName(e.target.value)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <input type="text" placeholder="Phone" value={formPhone} onChange={e => setFormPhone(e.target.value)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <input type="email" placeholder="Email" value={formEmail} onChange={e => setFormEmail(e.target.value)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <input type="text" placeholder="Notes" value={formNotes} onChange={e => setFormNotes(e.target.value)}
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!formName}
              className="inline-flex items-center px-4 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
              Create
            </button>
            <button onClick={() => setShowForm(false)}
              className="inline-flex items-center px-4 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {selected.size > 0 && viewMode === 'table' && (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
              <input type="checkbox" checked={selected.size === filteredClients.length} onChange={toggleAll}
                className="accent-emerald-500 w-3.5 h-3.5" />
              Select all
            </label>
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{selected.size} selected</span>
            <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />
            <button onClick={() => setShowBulkWhatsApp(true)}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
              <PaperPlaneTilt size={12} className="mr-1.5" weight="fill" />
              Send WhatsApp
            </button>
            <button onClick={handleBulkDelete}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors active:scale-[0.98]">
              <Trash size={12} className="mr-1.5" />
              Delete
            </button>
          </div>
        </div>
      )}

      {showBulkWhatsApp && (
        <WhatsAppSend
          leads={clients.filter(c => selected.has(c.id)).map(c => ({ id: c.lead_id || c.id, phone: c.phone, name: c.name }))}
          campaignName={null}
          close={() => setShowBulkWhatsApp(false)}
          showToast={showToast}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input type="text" placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)}
            className="h-9 w-52 pl-8 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40" />
        </div>
        <select value={fStage} onChange={e => setFStage(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
          <option value="">Stage: any</option>
          {STAGE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
          <option value="">Status: any</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button onClick={() => { setSearch(''); setFStage(''); setFStatus('') }}
          className="h-9 px-3 rounded-lg text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
          Clear
        </button>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 ml-auto">{clients.length} clients</span>
      </div>

      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <Funnel size={40} className="text-zinc-300 dark:text-zinc-600 mb-4" />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">No clients yet</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Convert leads to clients or add one manually.</p>
        </div>
      ) : viewMode === 'kanban' ? (
        /* Kanban / Pipeline View */
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGE_OPTIONS.map(s => (
            <div key={s.value} className="flex-1 min-w-[220px]">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{s.label}</span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">{groupedClients[s.value].length}</span>
              </div>
              <div className="space-y-2 min-h-[80px]">
                {groupedClients[s.value].map(c => (
                  <motion.div key={c.id} variants={cardVariants} initial="hidden" animate="visible" layout
                    onClick={() => setOpenClientId(c.id)}
                    className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm transition-all active:scale-[0.98]">
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 mb-1.5 truncate">{c.name}</div>
                    <div className="space-y-1">
                      {c.phone && <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">{c.phone}</div>}
                      {c.email && <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate">{c.email}</div>}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex gap-0.5">
                        {(c.tags || []).slice(0, 2).map(t => (
                          <span key={t.id} className="inline-block px-1 h-3.5 rounded text-[8px] font-medium text-white" style={{ background: t.color }}>{t.name}</span>
                        ))}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.status === 'active' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                        {c.status}
                      </span>
                    </div>
                  </motion.div>
                ))}
                {groupedClients[s.value].length === 0 && (
                  <div className="text-[11px] text-zinc-400 dark:text-zinc-500 italic text-center py-6 bg-zinc-50 dark:bg-zinc-800/30 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700">
                    Empty
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                  <th className="w-10 py-3 px-2">
                    <input type="checkbox" checked={selected.size > 0 && selected.size === filteredClients.length} onChange={toggleAll}
                      className="accent-emerald-500 w-3.5 h-3.5" />
                  </th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Contact</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Stage</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Tags</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => {
                  const stage = getStage(c.stage)
                  return (
                    <tr key={c.id} onClick={() => setOpenClientId(c.id)}
                      className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer">
                      <td className="py-3 px-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                          className="accent-emerald-500 w-3.5 h-3.5" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: stage.hex }}>
                            {c.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                            {c.source && <span className="ml-1.5 text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{c.source}</span>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400">
                        {c.phone && <div>{c.phone}</div>}
                        {c.email && <div className="text-zinc-400">{c.email}</div>}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium text-white ${stage.color}`}>
                          {stage.label}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium ${
                          c.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-0.5 flex-wrap max-w-[100px]">
                          {(c.tags || []).map(t => (
                            <span key={t.id} className="inline-flex items-center px-1 h-4 rounded text-[9px] font-medium text-white" style={{ background: t.color }}>{t.name}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={(e) => handleDelete(e, c.id, c.name)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-medium border border-red-200 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors">
                            <Trash size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
