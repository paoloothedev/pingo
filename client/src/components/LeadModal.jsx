import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Trash, Skull, CheckCircle } from '@phosphor-icons/react'
import { getLead, createLead, updateLead, deleteLead, getProjectMembers, getCompanies, getCustomFields } from '../api'
import CustomFieldInputs from './CustomFieldInputs'
import RecordPicker from './RecordPicker'
import { LIFECYCLE } from '../lifecycle'

const searchCompanies = async (q) => {
  const r = await getCompanies({ search: q, page: 1, limit: 8 })
  return r.items.map(c => ({ id: c.id, name: c.name, sub: [c.city, c.industry].filter(Boolean).join(' · ') }))
}

export default function LeadModal({ leadId, stages, tags, close, showToast, refresh }) {
  const [lead, setLead] = useState(null)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [facebook, setFacebook] = useState('')
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [link, setLink] = useState('')
  const [location, setLocation] = useState('')
  const [stage, setStage] = useState('')
  const [status, setStatus] = useState('active')
  const [verified, setVerified] = useState('no')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('')
  const [doNotContact, setDoNotContact] = useState(false)
  const [phoneValid, setPhoneValid] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState(new Set())
  const [lifecycle, setLifecycle] = useState('lead')
  const [ownerId, setOwnerId] = useState('')
  const [company, setCompany] = useState(null)
  const [members, setMembers] = useState([])
  const [fieldDefs, setFieldDefs] = useState([])
  const [custom, setCustom] = useState({})

  useEffect(() => {
    getProjectMembers().then(setMembers).catch(() => {})
    getCustomFields('contact').then(setFieldDefs).catch(() => {})
  }, [])

  useEffect(() => {
    if (leadId === null) {
      setName(''); setPhone(''); setEmail(''); setFacebook(''); setInstagram(''); setTiktok(''); setLink(''); setLocation('')
      setStage(stages[0]?.id || ''); setStatus('active'); setVerified('no'); setNotes(''); setMessage(''); setDoNotContact(false); setPhoneValid(false); setSelectedTagIds(new Set())
      setLifecycle('lead'); setOwnerId(''); setCompany(null); setCustom({})
      setLead(null)
    } else {
      (async () => {
        setLoading(true)
        try {
          const l = await getLead(leadId)
          setLead(l); setName(l.name || ''); setPhone(l.phone || ''); setEmail(l.email || '')
          setFacebook(l.facebook || ''); setInstagram(l.instagram || ''); setTiktok(l.tiktok || '')
          setLink(l.link || ''); setLocation(l.location || ''); setStage(l.stage_id || '')
          setStatus(l.status || 'active'); setVerified(l.verified ? 'yes' : 'no')
          setNotes(l.notes || ''); setMessage(l.message || ''); setDoNotContact(!!l.do_not_contact); setPhoneValid(!!l.phone_valid)
          setSelectedTagIds(new Set((l.tags || []).map(t => t.id)))
          setLifecycle(l.lifecycle || 'lead'); setOwnerId(l.owner_id || ''); setCompany(l.company || null); setCustom(l.custom || {})
        } catch {}
        setLoading(false)
      })()
    }
  }, [leadId, stages])

  useEffect(() => {
    const handleClick = (e) => {
      if (e.target.classList.contains('modal-overlay')) close()
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [close])

  const toggleTag = (tagId) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  const handleSave = async () => {
    if (!name.trim()) { showToast('Name is required.', true); return }
    const data = {
      name: name.trim(), phone, email, facebook, instagram, tiktok, link, location, notes, message, do_not_contact: doNotContact,
      stage_id: stage, status, verified: verified === 'yes', phone_valid: phoneValid,
      tag_ids: Array.from(selectedTagIds),
      lifecycle, company_id: company?.id || null, custom,
    }
    if (ownerId || leadId) data.owner_id = ownerId || null
    try {
      if (leadId) {
        await updateLead(leadId, data)
        showToast('Contact updated.')
      } else {
        await createLead(data)
        showToast('Contact created.')
      }
      close()
      refresh()
    } catch (err) { showToast(err.message || 'Failed to save contact.', true) }
  }

  const handleDelete = async () => {
    if (!lead) return
    if (!confirm(`Delete "${lead.name}" permanently?`)) return
    try {
      await deleteLead(lead.id)
      showToast('Contact deleted.')
      close()
      refresh()
    } catch { showToast('Failed to delete.', true) }
  }

  const handleMarkDead = async () => {
    if (!lead) return
    if (!confirm(`Mark "${lead.name}" as dead?`)) return
    try {
      await updateLead(lead.id, { status: 'dead', dead_at: Date.now() })
      showToast('Contact moved to the dead list.')
      close()
      refresh()
    } catch { showToast('Failed.', true) }
  }

  const getStage = (id) => stages.find(s => s.id === id)

  if (loading) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm modal-overlay" onClick={close}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 250, damping: 25 }}
        className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{leadId ? 'Edit contact' : 'New contact'}</h2>
          <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Lifecycle</label>
              <select value={lifecycle} onChange={e => setLifecycle(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
                {Object.entries(LIFECYCLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Owner</label>
              <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
                <option value="">{leadId ? 'Nobody' : 'Me (default)'}</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Company</label>
              <RecordPicker value={company} onChange={setCompany} search={searchCompanies} placeholder="Search companies…" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Phone</label>
              <input type="text" value={phone} onChange={e => { setPhone(e.target.value); setPhoneValid(!!e.target.value.replace(/\D/g, '').length && e.target.value.replace(/\D/g, '').length >= 7) }}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
              {phone && (phoneValid
                ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Valid format</span>
                : <span className="text-[11px] text-red-600 dark:text-red-400 mt-1">Invalid format</span>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Email</label>
              <input type="text" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Facebook</label>
              <input type="text" value={facebook} onChange={e => setFacebook(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Instagram</label>
              <input type="text" value={instagram} onChange={e => setInstagram(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">TikTok</label>
              <input type="text" value={tiktok} onChange={e => setTiktok(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Other link</label>
              <input type="text" value={link} onChange={e => setLink(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Google Maps location</label>
              <input type="text" value={location} onChange={e => setLocation(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Outreach stage</label>
              <select value={stage} onChange={e => setStage(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
                <option value="active">Active</option>
                <option value="dead">Dead</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Verified</label>
              <select value={verified} onChange={e => setVerified(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Phone status</label>
              <div className="h-9 flex items-center">
                {phone ? (
                  phoneValid
                    ? <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Valid number</span>
                    : <span className="text-xs text-red-600 dark:text-red-400 font-medium">Invalid number</span>
                ) : <span className="text-xs text-zinc-400 dark:text-zinc-500">No phone entered</span>}
              </div>
            </div>
            <CustomFieldInputs defs={fieldDefs} values={custom} members={members}
              onChange={(k, v) => setCustom(c => ({ ...c, [k]: v }))} />
          </div>

          <div className="mt-6">
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {tags.map(t => (
                <label key={t.id} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer px-2.5 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors select-none">
                  <input type="checkbox" checked={selectedTagIds.has(t.id)} onChange={() => toggleTag(t.id)}
                    className="accent-emerald-500 w-3.5 h-3.5" />
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
          </div>

          <div className="mt-4">
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Message (draft to copy and send)</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} dir="auto" placeholder="Written by you or by Claude"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
          </div>

          <label className="mt-3 flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={doNotContact} onChange={e => setDoNotContact(e.target.checked)} className="accent-emerald-500 mt-0.5" />
            <span>Do not contact <span className="text-zinc-400 dark:text-zinc-500">— never include in WhatsApp broadcasts (set automatically when they reply "no")</span></span>
          </label>

          {lead?.campaigns?.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3">In campaigns</h3>
              <div className="flex flex-wrap gap-2">
                {lead.campaigns.map(c => (
                  <span key={c.id} className="inline-flex items-center px-2.5 h-7 rounded-lg text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{c.name}</span>
                ))}
              </div>
            </div>
          )}

          {lead?.stageHistory?.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Stage history</h3>
              <div className="space-y-2">
                {lead.stageHistory.map(h => {
                  const s = getStage(h.stage_id)
                  return (
                    <div key={h.id} className="flex items-center gap-3 text-xs">
                      <span className="w-2 h-2 rounded-full" style={{ background: s?.color || '#94a3b8' }} />
                      <span className="text-zinc-900 dark:text-zinc-100">{s?.name || 'Unknown'}</span>
                      <span className="text-zinc-400 dark:text-zinc-500 text-[11px]">{new Date(h.at).toLocaleString()}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 shrink-0">
          <div>
            {lead && (
              <>
                <button onClick={handleDelete} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[11px] font-medium border border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors active:scale-[0.98] mr-2">
                  <Trash size={14} />
                  Delete
                </button>
                <button onClick={handleMarkDead} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[11px] font-medium border border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-100 transition-colors active:scale-[0.98]">
                  <Skull size={14} />
                  Mark dead
                </button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className="inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">Cancel</button>
            <button onClick={handleSave} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
              <CheckCircle size={14} weight="bold" />
              {leadId ? 'Save changes' : 'Create contact'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
