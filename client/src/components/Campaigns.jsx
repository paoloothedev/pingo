import { useState, useEffect, useCallback } from 'react'
import { PlusCircle, CalendarBlank, ListBullets, PaperPlaneTilt, ChatCircleDots } from '@phosphor-icons/react'
import { getCampaigns, createCampaign } from '../api'
import { canI } from '../permissions'
import BroadcastJobs from './BroadcastJobs'
import ContactPicker, { EMPTY_PICK, pickBody } from './ContactPicker'

function NewCampaign({ showToast, onCreated }) {
  const [name, setName] = useState('')
  const [addNow, setAddNow] = useState(false)
  const [filters, setFilters] = useState(EMPTY_PICK)

  const create = async () => {
    if (!name.trim()) { showToast('Give the campaign a name.', true); return }
    try {
      const camp = await createCampaign({ name: name.trim(), ...(addNow ? pickBody(filters) : {}) })
      if (addNow && !camp.leads.length) showToast('Campaign created, but no contact matched those filters.', true)
      else showToast(camp.leads.length ? `Campaign "${camp.name}" created with ${camp.leads.length} contacts.` : `Campaign "${camp.name}" created.`)
      onCreated(camp)
    } catch (e) { showToast(e.message || 'Failed to create campaign.', true) }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Campaign name</label>
          <input type="text" value={name} autoFocus onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="e.g. Riyadh restaurants"
            className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors" />
        </div>
        <button onClick={create} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
          <PlusCircle size={14} weight="bold" /> Create campaign
        </button>
      </div>
      <label className="flex items-center gap-2 mt-3 text-xs text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" checked={addNow} onChange={e => setAddNow(e.target.checked)} className="accent-emerald-500" />
        Add contacts now (you can also add them later)
      </label>
      {addNow && <div className="mt-4"><ContactPicker value={filters} onChange={setFilters} /></div>}
    </div>
  )
}

export default function Campaigns({ refreshId, showToast, refresh, goView }) {
  const [campaigns, setCampaigns] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => getCampaigns().then(setCampaigns).catch(() => {}), [])
  useEffect(() => { load() }, [load, refreshId])

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Campaigns</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">A campaign is a list of contacts. Every WhatsApp send is a broadcast, with its results below.</p>
        </div>
        {canI('campaigns.edit') && (
          <button onClick={() => setCreating(v => !v)} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <PlusCircle size={14} weight="bold" /> New campaign
          </button>
        )}
      </div>

      <div className="space-y-8">
        {creating && (
          <NewCampaign showToast={showToast} onCreated={(camp) => { setCreating(false); refresh(); goView(`campaigns/${camp.id}`) }} />
        )}

        <section>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Your campaigns</h2>
          {campaigns && campaigns.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 px-5 py-4">
              <ListBullets size={20} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">No campaign lists in this workspace yet. Create one with just a name, then add contacts whenever you're ready. Broadcasts sent directly from Contacts appear below.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(campaigns || []).map(c => (
                <button key={c.id} onClick={() => goView(`campaigns/${c.id}`)}
                  className="text-left rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 hover:border-emerald-500/30 hover:shadow-sm transition-all active:scale-[0.99]">
                  <h3 dir="auto" className="text-zinc-900 dark:text-zinc-100 font-semibold text-sm mb-3 break-words">{c.name}</h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1"><ListBullets size={12} className="text-zinc-400" />{c.lead_count} contacts</span>
                    <span className="flex items-center gap-1"><PaperPlaneTilt size={12} className="text-zinc-400" />{c.sent} sent</span>
                    <span className="flex items-center gap-1"><ChatCircleDots size={12} className="text-emerald-500" />{c.replied} replied</span>
                    <span className="flex items-center gap-1"><CalendarBlank size={12} className="text-zinc-400" />{new Date(c.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {canI('broadcast.view', 'campaigns.send') && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">WhatsApp broadcasts</h2>
            <BroadcastJobs showToast={showToast} goView={goView} />
          </section>
        )}
      </div>
    </div>
  )
}
