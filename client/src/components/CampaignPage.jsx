import { useState, useEffect, useCallback } from 'react'
import { Copy, Plus, Trash, PaperPlaneTilt, MagnifyingGlass, PencilSimple, X } from '@phosphor-icons/react'
import { getCampaign, updateCampaign, deleteCampaign, addFilteredToCampaign, removeLeadFromCampaign } from '../api'
import { copyText } from '../clipboard'
import { canI } from '../permissions'
import { BackLink } from './RecordParts'
import { Stat, OutreachBadge } from './BroadcastParts'
import BroadcastJobs from './BroadcastJobs'
import WhatsAppSend from './WhatsAppSend'
import ContactPicker, { EMPTY_PICK, pickBody } from './ContactPicker'

const btn = 'inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
const th = 'text-left py-2.5 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider'

export default function CampaignPage({ id, stages, showToast, refresh, goView }) {
  const [c, setC] = useState(null)
  const [missing, setMissing] = useState(false)
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState(EMPTY_PICK)

  const load = useCallback(() => getCampaign(id).then(x => { setC(x); setMissing(false) }).catch(() => setMissing(true)), [id])
  useEffect(() => { load() }, [load])

  if (missing) {
    return (
      <div className="max-w-5xl mx-auto">
        <BackLink onClick={() => goView('campaigns')}>Campaigns</BackLink>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">This campaign doesn't exist anymore.</p>
      </div>
    )
  }
  if (!c) return null

  const rename = async () => {
    const name = prompt('Campaign name', c.name)?.trim()
    if (!name || name === c.name) return
    try { await updateCampaign(c.id, { name }); load(); refresh() }
    catch (e) { showToast(e.message || 'Failed to rename.', true) }
  }
  const remove = async () => {
    if (!confirm(`Delete campaign "${c.name}"? Its contacts are freed up; contacts and past broadcasts stay.`)) return
    try { await deleteCampaign(c.id); showToast('Campaign deleted.'); refresh(); goView('campaigns') }
    catch (e) { showToast(e.message || 'Failed to delete.', true) }
  }
  const copyPhones = async () => {
    const phones = c.leads.filter(l => l.phone).map(l => l.phone)
    if (await copyText(phones.join('\n'))) showToast(`Copied ${phones.length} phone numbers.`)
    else showToast('Could not copy.', true)
  }
  const addMore = async () => {
    if (pick.count <= 0) { showToast('Pick how many contacts to add.', true); return }
    try {
      const r = await addFilteredToCampaign(c.id, pickBody(pick))
      showToast(`Added ${r.added} contacts.`)
      setAdding(false)
      load(); refresh()
    } catch (e) { showToast(e.message === 'No eligible leads available.' ? 'No contact matches those filters.' : e.message || 'Failed to add contacts.', true) }
  }
  const removeLead = async (l) => {
    if (!confirm(`Remove "${l.name}" from this campaign?`)) return
    try { await removeLeadFromCampaign(c.id, l.id); load(); refresh() }
    catch (e) { showToast(e.message || 'Failed to remove.', true) }
  }

  const stageOf = (sid) => stages.find(s => s.id === sid)
  const q = search.toLowerCase().trim()
  const leads = q
    ? c.leads.filter(l => (l.name || '').toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.tags || []).some(t => t.name.toLowerCase().includes(q)))
    : c.leads

  return (
    <div className="max-w-5xl mx-auto">
      <BackLink onClick={() => goView('campaigns')}>Campaigns</BackLink>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 dir="auto" className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 break-words">{c.name}</h1>
            {canI('campaigns.edit') && <button onClick={rename} title="Rename" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><PencilSimple size={14} /></button>}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Created {new Date(c.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canI('campaigns.send') && c.leads.some(l => l.phone) && (
            <button onClick={() => setSending(true)} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
              <PaperPlaneTilt size={13} weight="fill" /> Send WhatsApp
            </button>
          )}
          {canI('campaigns.edit') && <button onClick={() => setAdding(v => !v)} className={btn}><Plus size={13} weight="bold" /> Add contacts</button>}
          <button onClick={copyPhones} className={btn}><Copy size={13} /> Copy phones</button>
          {canI('campaigns.delete') && <button onClick={remove} className={btn}><Trash size={13} /> Delete</button>}
        </div>
      </div>

      {adding && (
        <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50">
          <ContactPicker value={pick} onChange={setPick} />
          <div className="flex gap-2 justify-end mt-3">
            <button onClick={() => setAdding(false)} className={btn}>Cancel</button>
            <button onClick={addMore} className="inline-flex items-center px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600">Add contacts</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
        <Stat label="Contacts" value={c.lead_count} />
        <Stat label="Sent" value={c.sent} />
        <Stat label="Delivered" value={c.delivered} tone="text-sky-600 dark:text-sky-400" />
        <Stat label="Replied" value={c.replied} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Waiting" value={c.pending} tone="text-violet-600 dark:text-violet-400" />
        <Stat label="Failed" value={c.failed} tone="text-red-600 dark:text-red-400" />
      </div>

      {canI('broadcast.view', 'campaigns.send') && (
        <>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Broadcasts</h2>
          <div className="mb-6">
            <BroadcastJobs showToast={showToast} goView={goView} campaignId={c.id} onChange={load} />
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Contacts ({c.lead_count})</h2>
        <div className="relative w-full sm:w-64">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts..."
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500" />
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
        {c.leads.length === 0 ? (
          <p className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">This campaign is empty. Press Add contacts, or select contacts on the Contacts page and choose Add to campaign.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className={th}>Name</th><th className={th}>Phone</th><th className={th}>Outreach</th><th className={th}>Stage</th><th className={th}>Tags</th><th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {leads.map(l => {
                const stage = stageOf(l.stage_id)
                return (
                  <tr key={l.id} onClick={() => goView(`contact/${l.id}`)} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer">
                    <td className="py-2.5 px-4 text-xs font-medium text-zinc-900 dark:text-zinc-100 min-w-[160px]"><bdi>{l.name}</bdi></td>
                    <td className="py-2.5 px-4 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">{l.phone || '—'}</td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {l.do_not_contact ? <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Opted out</span> : <OutreachBadge row={l.outreach} />}
                    </td>
                    <td className="py-2.5 px-4">
                      {stage ? <span className="inline-block px-1.5 h-5 rounded text-[10px] font-semibold text-white whitespace-nowrap" style={{ background: stage.color }}>{stage.name}</span> : '—'}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex gap-0.5 flex-wrap max-w-[180px]">
                        {(l.tags || []).map(t => <span key={t.id} className="inline-block px-1 h-4 rounded text-[9px] font-medium text-white whitespace-nowrap" style={{ background: t.color }}>{t.name}</span>)}
                      </div>
                    </td>
                    <td className="py-2.5 px-4" onClick={e => e.stopPropagation()}>
                      {canI('campaigns.edit') && <button onClick={() => removeLead(l)} title="Remove from campaign" className="text-zinc-400 hover:text-red-500"><X size={13} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {sending && (
        <WhatsAppSend leads={c.leads} campaignId={c.id} campaignName={c.name} close={() => setSending(false)} showToast={showToast}
          onCreated={(job) => goView(`broadcast/${job.id}`)} />
      )}
    </div>
  )
}
