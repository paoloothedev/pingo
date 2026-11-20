import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Trash } from '@phosphor-icons/react'
import { getDeal, createDeal, updateDeal, deleteDeal, getContacts, getCompanies, getProjectMembers, getCustomFields } from '../api'
import CustomFieldInputs from './CustomFieldInputs'
import { formatDate, toDateInput, fromDateInput } from '../format'
import RecordPicker from './RecordPicker'

const input = 'w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors'
const label = 'block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5'

const searchContacts = async (q) => {
  const r = await getContacts({ search: q, page: 1, limit: 8 })
  return r.items.map(c => ({ id: c.id, name: c.name, sub: [c.phone, c.company?.name].filter(Boolean).join(' · ') }))
}
const searchCompanies = async (q) => {
  const r = await getCompanies({ search: q, page: 1, limit: 8 })
  return r.items.map(c => ({ id: c.id, name: c.name, sub: [c.city, c.industry].filter(Boolean).join(' · ') }))
}

// dealId = null → create. `defaults` pre-fills a new deal (e.g. { stage_id, contact }).
export default function DealModal({ dealId, pipelines, defaults = {}, close, showToast, onSaved, canDelete = true }) {
  const [loading, setLoading] = useState(!!dealId)
  const [deal, setDeal] = useState(null)
  const [members, setMembers] = useState([])
  const [fieldDefs, setFieldDefs] = useState([])
  const [custom, setCustom] = useState({})
  const [busy, setBusy] = useState(false)

  const firstPipeline = pipelines[0]
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [currency, setCurrency] = useState('')
  const [pipelineId, setPipelineId] = useState(defaults.pipeline_id || firstPipeline?.id || '')
  const [stageId, setStageId] = useState(defaults.stage_id || '')
  const [contact, setContact] = useState(defaults.contact || null)
  const [company, setCompany] = useState(defaults.company || null)
  const [ownerId, setOwnerId] = useState('')
  const [expectedClose, setExpectedClose] = useState('')
  const [lostReason, setLostReason] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    getProjectMembers().then(setMembers).catch(() => {})
    getCustomFields('deal').then(setFieldDefs).catch(() => {})
    if (!dealId) return
    getDeal(dealId).then(d => {
      setDeal(d)
      setTitle(d.title); setValue(d.value ? String(d.value) : ''); setCurrency(d.currency)
      setPipelineId(d.pipeline_id); setStageId(d.stage_id)
      setContact(d.contact ? { id: d.contact.id, name: d.contact.name } : null)
      setCompany(d.company ? { id: d.company.id, name: d.company.name } : null)
      setOwnerId(d.owner_id || ''); setExpectedClose(toDateInput(d.expected_close))
      setLostReason(d.lost_reason || ''); setNotes(d.notes || ''); setCustom(d.custom || {})
    }).catch(() => { showToast('Could not load deal.', true); close() })
      .finally(() => setLoading(false))
  }, [dealId])

  const pipeline = pipelines.find(p => p.id === pipelineId) || firstPipeline
  const stages = pipeline?.stages || []
  const effectiveStageId = stageId && stages.some(s => s.id === stageId) ? stageId : (stages.find(s => s.kind === 'open') || stages[0])?.id
  const stage = stages.find(s => s.id === effectiveStageId)

  const save = async () => {
    if (!title.trim()) { showToast('Give the deal a title.', true); return }
    setBusy(true)
    const data = {
      title: title.trim(),
      value: value === '' ? 0 : Number(value),
      stage_id: effectiveStageId,
      contact_id: contact?.id || null,
      company_id: company?.id || null,
      expected_close: fromDateInput(expectedClose),
      notes,
      custom,
    }
    if (currency) data.currency = currency
    if (ownerId || dealId) data.owner_id = ownerId || null
    if (stage?.kind === 'lost') data.lost_reason = lostReason
    try {
      const saved = dealId ? await updateDeal(dealId, data) : await createDeal(data)
      showToast(dealId ? 'Deal updated.' : 'Deal created.')
      onSaved?.(saved)
      close()
    } catch (err) {
      showToast(err.message || 'Failed to save deal.', true)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete deal "${deal?.title}"? This cannot be undone.`)) return
    try {
      await deleteDeal(dealId)
      showToast('Deal deleted.')
      onSaved?.(null)
      close()
    } catch (err) { showToast(err.message || 'Failed to delete.', true) }
  }

  if (loading) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm modal-overlay p-4" onClick={close}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 250, damping: 25 }}
        className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[88vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{dealId ? 'Edit deal' : 'New deal'}</h2>
          <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <div className="sm:col-span-2">
              <label className={label}>Title</label>
              <input autoFocus type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Website redesign for Acme" className={input} />
            </div>
            <div>
              <label className={label}>Value</label>
              <div className="flex gap-2">
                <input type="number" min="0" step="any" value={value} onChange={e => setValue(e.target.value)} placeholder="0" className={input} />
                <input type="text" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                  placeholder={deal?.currency || 'USD'} className={`${input} w-20 text-center uppercase`} aria-label="Currency" />
              </div>
            </div>
            <div>
              <label className={label}>Expected close</label>
              <input type="date" value={expectedClose} onChange={e => setExpectedClose(e.target.value)} className={input} />
            </div>
            {pipelines.length > 1 && (
              <div>
                <label className={label}>Pipeline</label>
                <select value={pipeline?.id || ''} onChange={e => { setPipelineId(e.target.value); setStageId('') }} className={input}>
                  {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={label}>Stage</label>
              <select value={effectiveStageId || ''} onChange={e => setStageId(e.target.value)} className={input}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}{s.kind === 'open' ? ` · ${s.probability}%` : ''}</option>)}
              </select>
            </div>
            {stage?.kind === 'lost' && (
              <div className="sm:col-span-2">
                <label className={label}>Lost reason</label>
                <input type="text" value={lostReason} onChange={e => setLostReason(e.target.value)} placeholder="e.g. Budget, went with competitor…" className={input} />
              </div>
            )}
            <div>
              <label className={label}>Contact</label>
              <RecordPicker value={contact} onChange={setContact} search={searchContacts} placeholder="Search contacts…" />
            </div>
            <div>
              <label className={label}>Company</label>
              <RecordPicker value={company} onChange={setCompany} search={searchCompanies} placeholder="Search companies…" />
            </div>
            <div>
              <label className={label}>Owner</label>
              <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className={input}>
                <option value="">{dealId ? 'Nobody' : 'Me (default)'}</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
              </select>
            </div>
            <CustomFieldInputs defs={fieldDefs} values={custom} members={members} currency={currency || deal?.currency || 'USD'}
              onChange={(k, v) => setCustom(c => ({ ...c, [k]: v }))} />
            <div className="sm:col-span-2">
              <label className={label}>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                className={`${input} h-auto py-2 resize-y`} />
            </div>
          </div>

          {deal?.history?.length > 0 && (
            <div className="mt-6">
              <h3 className={label}>Stage history</h3>
              <ol className="space-y-1.5">
                {deal.history.map((h, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: h.color || '#a1a1aa' }} />
                    <span className="text-zinc-900 dark:text-zinc-200">{h.stage_name || 'Deleted stage'}</span>
                    <span className="text-zinc-400 dark:text-zinc-500">{formatDate(h.at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 h-16 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          <div>
            {dealId && canDelete && (
              <button onClick={remove}
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <Trash size={13} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={close}
              className="px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={busy}
              className="px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] disabled:opacity-50">
              {busy ? 'Saving…' : dealId ? 'Save changes' : 'Create deal'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
