import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  MagnifyingGlass, Funnel, CheckCircle, XCircle, Trash,
  ArrowSquareOut, UserPlus, CaretRight, PaperPlaneTilt, Copy
} from '@phosphor-icons/react'
import { getLeads, updateLead, deleteLead, bulkAction, addLeadsToCampaign, getProjectMembers, getCustomFields, getViews, createView, deleteView, getCategories, createCampaign } from '../api'
import { canI } from '../permissions'
import { formatCustomValue } from './CustomFieldInputs'
import Pagination from './Pagination'
import { LIFECYCLE } from '../lifecycle'
import WhatsAppSend from './WhatsAppSend'
import { copyText } from '../clipboard'

function socialLinks(l) {
  return (
    <div className="flex gap-0.5">
      {l.facebook && <a className="inline-flex items-center px-1 h-4 rounded text-[9px] font-bold bg-[#1877f2] text-white no-underline" href={l.facebook} target="_blank" rel="noopener">FB</a>}
      {l.instagram && <a className="inline-flex items-center px-1 h-4 rounded text-[9px] font-bold bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white no-underline" href={l.instagram} target="_blank" rel="noopener">IG</a>}
      {l.tiktok && <a className="inline-flex items-center px-1 h-4 rounded text-[9px] font-bold bg-black text-white border border-zinc-200 dark:border-zinc-700 no-underline" href={l.tiktok} target="_blank" rel="noopener">TT</a>}
      {l.link && <a className="inline-flex items-center px-1 h-4 rounded text-[9px] font-bold bg-zinc-500 text-white no-underline" href={l.link} target="_blank" rel="noopener">LK</a>}
      {l.location && <a className="inline-flex items-center px-1 h-4 rounded text-[9px] font-bold bg-emerald-600 text-white no-underline" href={l.location} target="_blank" rel="noopener">MP</a>}
    </div>
  )
}

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.02, type: 'spring', stiffness: 120, damping: 20 }
  })
}

// Tag buttons shown before "All tags": the most used, plus anything selected.
const TOP_TAGS = 10

export default function LeadsTable({ stages, tags, campaigns, refreshId, openLeadModal, showToast, refresh, goView, user }) {
  const [leads, setLeads] = useState([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(() => Number(localStorage.getItem('leadsPageSize')) || 50)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [fVerified, setFVerified] = useState('')
  const [fPhone, setFPhone] = useState('')
  const [fStage, setFStage] = useState('')
  const [fCampUse, setFCampUse] = useState('')
  const [fSocial, setFSocial] = useState(false)
  const [fTag, setFTag] = useState([])
  const [fTagNot, setFTagNot] = useState(false)
  const [fTagMode, setFTagMode] = useState('any')
  const [fCategory, setFCategory] = useState('')
  const [categories, setCategories] = useState([])
  const [allTags, setAllTags] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const [fLifecycle, setFLifecycle] = useState('')
  const [fOwner, setFOwner] = useState('')
  const [members, setMembers] = useState([])
  const [fieldDefs, setFieldDefs] = useState([])
  const [fCustom, setFCustom] = useState({})
  const [views, setViews] = useState([])
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  const [showBulkLifecycle, setShowBulkLifecycle] = useState(false)
  const [showBulkOwner, setShowBulkOwner] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [showBulkStage, setShowBulkStage] = useState(false)
  const [showBulkTag, setShowBulkTag] = useState(false)
  const [showBulkCampaign, setShowBulkCampaign] = useState(false)
  const [showBulkWhatsApp, setShowBulkWhatsApp] = useState(false)

  const loadLeads = useCallback(async () => {
    try {
      const params = { status: 'active' }
      if (search) params.search = search
      if (fVerified) params.verified = fVerified
      if (fPhone) params.phoneStatus = fPhone
      if (fStage) params.stage = fStage
      if (fCampUse) params.campaignUse = fCampUse
      if (fSocial) params.hasSocial = 'true'
      if (fLifecycle) params.lifecycle = fLifecycle
      if (fOwner) params.owner = fOwner
      for (const [k, v] of Object.entries(fCustom)) if (v !== '' && v != null) params['cf.' + k] = v
      if (fCategory) params.category = fCategory
      if (fTag.length) {
        const joined = fTag.join(',')
        if (fTagNot) params.tagNot = joined
        else { params.tag = joined; params.tagMode = fTagMode }
      }
      params.page = page
      params.limit = limit
      const data = await getLeads(params)
      if (!data.items.length && page > 1) { setPage(p => p - 1); return }
      setLeads(data.items)
      setTotal(data.total)
      setSelected(new Set())
    } catch {}
  }, [search, fVerified, fPhone, fStage, fCampUse, fSocial, fTag, fTagNot, fTagMode, fCategory, fLifecycle, fOwner, fCustom, page, limit])

  useEffect(() => { setPage(1) }, [search, fVerified, fPhone, fStage, fCampUse, fSocial, fTag, fTagNot, fTagMode, fCategory, fLifecycle, fOwner, fCustom])
  useEffect(() => { getCategories().then(setCategories).catch(() => {}) }, [refreshId])

  // Saved views store the whole filter state
  const byUse = [...tags].sort((x, y) => (y.lead_count || 0) - (x.lead_count || 0))
  const q = tagQuery.trim().toLowerCase()
  const visibleTags = allTags
    ? byUse.filter(t => !q || t.name.toLowerCase().includes(q) || fTag.includes(t.id))
    : byUse.filter((t, i) => i < TOP_TAGS || fTag.includes(t.id))

  const currentFilters = () => ({ search, fVerified, fPhone, fStage, fCampUse, fSocial, fTag, fTagNot, fTagMode, fCategory, fLifecycle, fOwner, fCustom })
  const applyFilters = (f = {}) => {
    setSearch(f.search || ''); setFVerified(f.fVerified || ''); setFPhone(f.fPhone || ''); setFStage(f.fStage || '')
    setFCampUse(f.fCampUse || ''); setFSocial(!!f.fSocial); setFTag(f.fTag || []); setFTagNot(!!f.fTagNot)
    setFTagMode(f.fTagMode || 'any'); setFCategory(f.fCategory || ''); setFLifecycle(f.fLifecycle || ''); setFOwner(f.fOwner || ''); setFCustom(f.fCustom || {})
  }
  const loadViews = () => getViews('contact').then(setViews).catch(() => {})
  useEffect(() => { loadViews() }, [])
  const saveView = async () => {
    if (!viewName.trim()) return
    try {
      await createView({ entity: 'contact', name: viewName.trim(), filters: currentFilters() })
      showToast('View saved.'); setSavingView(false); setViewName(''); loadViews()
    } catch (err) { showToast(err.message || 'Could not save view.', true) }
  }
  const removeView = async (v) => {
    try { await deleteView(v.id); showToast('View deleted.'); loadViews() } catch (err) { showToast(err.message || 'Failed.', true) }
  }
  const filterableDefs = fieldDefs.filter(d => ['select', 'multiselect', 'checkbox', 'user'].includes(d.type))

  useEffect(() => {
    getProjectMembers().then(setMembers).catch(() => {})
    getCustomFields('contact').then(setFieldDefs).catch(() => {})
  }, [refreshId])

  const changeLimit = (n) => {
    setLimit(n)
    setPage(1)
    try { localStorage.setItem('leadsPageSize', String(n)) } catch {}
  }

  useEffect(() => { loadLeads() }, [loadLeads, refreshId])

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

  const quickVerify = async (id) => {
    try {
      await updateLead(id, { verified: true })
      showToast('Lead verified.')
      refresh()
    } catch { showToast('Failed to verify.', true) }
  }

  const handleDeleteRow = async (id, name) => {
    if (!confirm(`Delete "${name}" permanently? This cannot be undone.`)) return
    try {
      await deleteLead(id)
      showToast('Lead deleted.')
      refresh()
    } catch { showToast('Failed to delete.', true) }
  }

  const doBulk = async (action, stageId, tagId, value) => {
    const ids = Array.from(selected)
    if (!ids.length) { showToast('Select some leads first.', true); return }
    try {
      await bulkAction(ids, action, stageId, tagId, value)
      showToast(`Done: ${ids.length} leads.`)
      refresh()
    } catch { showToast('Bulk action failed.', true) }
  }

  const handleAddToCampaign = async (campId) => {
    const ids = Array.from(selected)
    if (!ids.length) { showToast('Select some leads first.', true); return }
    setShowBulkCampaign(false)
    if (campId === '__new') {
      const name = prompt('Campaign name')?.trim()
      if (!name) return
      try {
        const camp = await createCampaign({ name, leadIds: ids })
        showToast(`Campaign "${camp.name}" created with ${camp.leads.length} contacts.`)
        refresh()
      } catch (err) { showToast(err.message || 'Failed to create campaign.', true) }
      return
    }
    try {
      const result = await addLeadsToCampaign(campId, ids, null, false)
      const camp = (campaigns || []).find(c => c.id === campId)
      showToast(`Added ${result.added} leads to "${camp?.name || campId}".`)
      refresh()
    } catch (err) {
      showToast(err.message || 'Failed to add to campaign.', true)
    }
  }

  const getStage = (id) => stages.find(s => s.id === id) || stages[0]

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Contacts</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Everyone you work with — from cold leads to customers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
        <button onClick={() => goView('duplicates')}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
          Find duplicates
        </button>
        {canI('leads.edit') && (
        <button onClick={() => openLeadModal(null)}
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
          <UserPlus size={14} weight="bold" />
          Add contact
        </button>
        )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 mb-3 border-b border-zinc-200 dark:border-zinc-800">
        {[['', 'All'], ...Object.entries(LIFECYCLE).map(([k, v]) => [k, v.plural])].map(([k, l]) => (
          <button key={k} onClick={() => setFLifecycle(k)}
            className={`px-3 h-9 -mb-px text-xs font-medium border-b-2 transition-colors ${fLifecycle === k ? 'border-emerald-500 text-zinc-900 dark:text-zinc-100' : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Views:</span>
        {views.length === 0 && !savingView && <span className="text-[11px] text-zinc-400 dark:text-zinc-500">none yet — set filters, then save them</span>}
        {views.map(v => (
          <span key={v.id} className="inline-flex items-center rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
            <button onClick={() => applyFilters(v.filters)} className="px-2.5 h-7 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              {v.name}{v.shared ? ' · team' : ''}
            </button>
            {v.account_id === user?.id && (
              <button onClick={() => removeView(v)} aria-label={`Delete view ${v.name}`} className="px-1.5 h-7 text-zinc-400 hover:text-red-500 border-l border-zinc-200 dark:border-zinc-700">×</button>
            )}
          </span>
        ))}
        {savingView ? (
          <span className="inline-flex items-center gap-1">
            <input autoFocus value={viewName} onChange={e => setViewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveView(); if (e.key === 'Escape') setSavingView(false) }}
              placeholder="View name" className="h-7 w-36 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <button onClick={saveView} className="px-2.5 h-7 rounded-md text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600">Save</button>
            <button onClick={() => setSavingView(false)} className="px-2 h-7 text-[11px] text-zinc-500">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setSavingView(true)} className="px-2.5 h-7 rounded-md text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">+ Save current filters</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input type="text" placeholder="Search name, phone, notes..." value={search} onChange={e => setSearch(e.target.value)}
            className="h-9 w-52 pl-8 pr-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
        </div>
        <select value={fVerified} onChange={e => setFVerified(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
          <option value="">Verified: any</option>
          <option value="yes">Verified only</option>
          <option value="no">Unverified only</option>
        </select>
        <select value={fPhone} onChange={e => setFPhone(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
          <option value="">Phone: any</option>
          <option value="valid">Valid phone</option>
          <option value="invalid">Invalid/missing phone</option>
        </select>
        <select value={fStage} onChange={e => setFStage(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
          <option value="">Stage: any</option>
          {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {categories.length > 0 && (
          <select value={fCategory} onChange={e => setFCategory(e.target.value)}
            className="h-9 max-w-[200px] px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
            <option value="">Business type: any</option>
            {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
            <option value="__none">Business type: not set</option>
          </select>
        )}
        <select value={fOwner} onChange={e => setFOwner(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
          <option value="">Owner: anyone</option>
          <option value="me">Owned by me</option>
          <option value="none">Unassigned</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
        </select>
        {filterableDefs.map(d => (
          <select key={d.id} value={fCustom[d.key] ?? ''} onChange={e => setFCustom(c => ({ ...c, [d.key]: e.target.value }))}
            className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
            <option value="">{d.label}: any</option>
            {d.type === 'checkbox' && <><option value="true">{d.label}: yes</option><option value="false">{d.label}: no</option></>}
            {(d.type === 'select' || d.type === 'multiselect') && d.options.map(o => <option key={o} value={o}>{d.label}: {o}</option>)}
            {d.type === 'user' && members.map(m => <option key={m.id} value={m.id}>{d.label}: {m.display_name || m.username}</option>)}
            <option value="__empty">{d.label}: empty</option>
          </select>
        ))}
        <select value={fCampUse} onChange={e => setFCampUse(e.target.value)}
          className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
          <option value="">Campaign: any</option>
          <option value="used">Already in campaign</option>
          <option value="unused">Not in campaign</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none h-9 px-2 rounded-lg border border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
          <input type="checkbox" checked={fSocial} onChange={e => setFSocial(e.target.checked)}
            className="accent-emerald-500 w-3.5 h-3.5" />
          Has social
        </label>
        <div className="flex items-center flex-wrap gap-1">
          {visibleTags.map(t => (
            <button key={t.id} onClick={() => setFTag(prev => prev.includes(t.id) ? prev.filter(id => id !== t.id) : [...prev, t.id])}
              className={`inline-flex items-center px-2.5 h-7 rounded-md text-[11px] font-medium transition-colors ${fTag.includes(t.id) ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
              {t.name}
            </button>
          ))}
          {tags.length > TOP_TAGS && (
            <button onClick={() => { setAllTags(v => !v); setTagQuery('') }}
              className="inline-flex items-center px-2 h-7 rounded-md text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
              {allTags ? 'Fewer tags' : `All ${tags.length} tags`}
            </button>
          )}
          {allTags && (
            <input value={tagQuery} onChange={e => setTagQuery(e.target.value)} placeholder="Find a tag..." autoFocus
              className="h-7 w-32 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 outline-none" />
          )}
          <button onClick={() => setFTagNot(!fTagNot)}
            className={`inline-flex items-center px-2 h-7 rounded-md text-[11px] font-medium transition-colors ${fTagNot ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
            title="Invert tag filter">
            NOT
          </button>
          {fTag.length > 1 && (
            <button onClick={() => setFTagMode(m => m === 'any' ? 'all' : 'any')}
              className={`inline-flex items-center px-2 h-7 rounded-md text-[11px] font-medium transition-colors ${fTagMode === 'all' ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
              title="Match all selected tags">
              {fTagMode === 'all' ? 'ALL' : 'ANY'}
            </button>
          )}
        </div>
        <button onClick={() => { setSearch(''); setFVerified(''); setFPhone(''); setFStage(''); setFCampUse(''); setFSocial(false); setFTag([]); setFTagNot(false); setFTagMode('any'); setFCategory(''); setFLifecycle(''); setFOwner(''); setFCustom({}) }}
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
            {canI('leads.verify') && (
            <button onClick={() => doBulk('verify')}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
              <CheckCircle size={12} className="mr-1.5" />
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
            {canI('leads.edit') && (
            <button onClick={() => doBulk('dead')}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 transition-colors active:scale-[0.98]">
              Mark dead
            </button>
            )}
            {canI('leads.delete') && (
            <button onClick={() => { if (confirm(`Delete ${selected.size} leads permanently?`)) doBulk('delete') }}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors active:scale-[0.98]">
              <Trash size={12} className="mr-1.5" />
              Delete
            </button>
            )}
            {canI('leads.edit') && (
            <button onClick={() => setShowBulkLifecycle(!showBulkLifecycle)}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100 transition-colors">
              Set lifecycle...
            </button>
            )}
            {showBulkLifecycle && (
              <select value="" onChange={e => { if (e.target.value) { doBulk('lifecycle', null, null, e.target.value); setShowBulkLifecycle(false) } }}
                className="h-7 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
                <option value="">Select lifecycle...</option>
                {Object.entries(LIFECYCLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            )}
            {canI('leads.edit') && (
            <button onClick={() => setShowBulkOwner(!showBulkOwner)}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              Assign owner...
            </button>
            )}
            {showBulkOwner && (
              <select value="" onChange={e => { if (e.target.value) { doBulk('owner', null, null, e.target.value === '__none' ? null : e.target.value); setShowBulkOwner(false) } }}
                className="h-7 px-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none">
                <option value="">Select owner...</option>
                <option value="__none">Nobody</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
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
                <option value="__new">+ New campaign...</option>
                {(campaigns || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {canI('campaigns.send') && (
            <button onClick={() => setShowBulkWhatsApp(true)}
              className="inline-flex items-center px-3 h-7 rounded-md text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
              <PaperPlaneTilt size={12} className="mr-1.5" weight="fill" />
              Send WhatsApp
            </button>
            )}
          </div>
        </div>
      )}

      {showBulkWhatsApp && (
        <WhatsAppSend
          leads={leads.filter(l => selected.has(l.id))}
          close={() => setShowBulkWhatsApp(false)}
          showToast={showToast}
          onCreated={(job) => goView(`broadcast/${job.id}`)}
        />
      )}

      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <Funnel size={40} className="text-zinc-300 dark:text-zinc-600 mb-4" />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">No leads found</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm text-center">Try adjusting your filters or import some leads to get started.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                  <th className="w-10 py-3 px-2">
                    <input type="checkbox" checked={selected.size > 0 && selected.size === leads.length} onChange={toggleAll}
                      className="accent-emerald-500 w-3.5 h-3.5" />
                  </th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Lifecycle</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Company</th>
                  {fieldDefs.map(d => (
                    <th key={d.id} className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider whitespace-nowrap">{d.label}</th>
                  ))}
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Phone</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Email</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Links</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Stage</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Verified</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Campaign</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Tags</th>
                  <th className="text-left py-3 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Notes</th>
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
                        <button onClick={() => goView(`contact/${l.id}`)} className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[130px] hover:text-emerald-600 dark:hover:text-emerald-400 text-left">{l.name}</button>
                        <button onClick={() => window.open('https://www.google.com/search?q=' + encodeURIComponent(l.name), '_blank')}
                          className="text-[10px] px-1 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 transition-colors shrink-0" title="Search Google">
                          <ArrowSquareOut size={10} />
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium whitespace-nowrap ${(LIFECYCLE[l.lifecycle] || LIFECYCLE.lead).cls}`}>
                        {(LIFECYCLE[l.lifecycle] || LIFECYCLE.lead).label}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400 max-w-[140px] truncate">
                      {l.company ? <button onClick={() => goView(`company/${l.company.id}`)} className="hover:text-emerald-600 dark:hover:text-emerald-400 truncate max-w-full">{l.company.name}</button> : '—'}
                    </td>
                    {fieldDefs.map(d => (
                      <td key={d.id} className="py-3 px-4 text-xs text-zinc-600 dark:text-zinc-400 max-w-[160px] truncate">{formatCustomValue(d, l.custom?.[d.key], { members }) || '—'}</td>
                    ))}
                    <td className="py-3 px-4">
                      <span className="text-xs text-zinc-700 dark:text-zinc-300">{l.phone || <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>}</span>
                      {l.phone && (
                        l.phone_valid
                          ? <CheckCircle size={10} weight="fill" className="inline ml-1 text-emerald-500" />
                          : <XCircle size={10} weight="fill" className="inline ml-1 text-red-500" />
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[120px]">{l.email || <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>}</td>
                    <td className="py-3 px-4">{socialLinks(l)}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium text-white truncate max-w-[90px]" style={{ background: getStage(l.stage_id)?.color }}>
                        {getStage(l.stage_id)?.name}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {l.verified
                        ? <span className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><CheckCircle size={10} weight="fill" /> Yes</span>
                        : <span className="inline-flex items-center gap-0.5 px-1.5 h-5 rounded text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"><XCircle size={10} weight="fill" /> No</span>
                      }
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400">
                      {l.campaigns?.length ? (
                        <div className="flex flex-col items-start gap-0.5">
                          {l.campaigns.map(x => (
                            <button key={x.id} onClick={e => { e.stopPropagation(); goView(`campaigns/${x.id}`) }} dir="auto"
                              className="max-w-[140px] truncate text-left hover:text-emerald-600 dark:hover:text-emerald-400">{x.name}</button>
                          ))}
                        </div>
                      ) : <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>}
                    </td>
                    <td className="py-3 px-4">
                      {l.tags?.length ? (
                        <div className="flex gap-0.5 flex-wrap max-w-[180px]">
                          {l.tags.map(t => (
                            <span key={t.id} className="inline-flex items-center px-1 h-4 rounded text-[9px] font-medium text-white whitespace-nowrap" style={{ background: t.color }}>{t.name}</span>
                          ))}
                        </div>
                      ) : <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>}
                    </td>
                    <td className="py-3 px-4 text-xs text-zinc-500 dark:text-zinc-400 max-w-[90px] truncate">{(l.notes || '').slice(0, 40)}{(l.notes || '').length > 40 ? '...' : ''}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1">
                        {l.message && (
                          <button onClick={async () => { const ok = await copyText(l.message); showToast(ok ? 'Message copied.' : 'Could not copy.', !ok) }} title="Copy message"
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition-colors active:scale-[0.95]">
                            <Copy size={12} />
                          </button>
                        )}
                        {!l.verified && canI('leads.verify') && (
                          <button onClick={() => quickVerify(l.id)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors active:scale-[0.95]">
                            <CheckCircle size={12} />
                          </button>
                        )}
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
