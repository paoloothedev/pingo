import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash, EnvelopeSimple, Pencil } from '@phosphor-icons/react'
import { getEmailCampaigns, createEmailCampaign, deleteEmailCampaign } from '../api'

export default function EmailCampaigns({ refreshId, showToast, refresh }) {
  const [campaigns, setCampaigns] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formSubject, setFormSubject] = useState('')
  const [formBody, setFormBody] = useState('')

  const load = useCallback(async () => {
    try { setCampaigns(await getEmailCampaigns()) } catch {}
  }, [])

  useEffect(() => { load() }, [load, refreshId])

  const handleCreate = async () => {
    if (!formName) return
    try {
      await createEmailCampaign({ name: formName, subject: formSubject, body: formBody })
      showToast('Email campaign created.')
      setShowForm(false); setFormName(''); setFormSubject(''); setFormBody('')
      refresh()
    } catch { showToast('Failed.', true) }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete "${name}"?`)) return
    try { await deleteEmailCampaign(id); showToast('Deleted.'); refresh() } catch { showToast('Failed.', true) }
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Email Campaigns</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Create and manage email outreach campaigns.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
          <Plus size={14} weight="bold" /> New Campaign
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 mb-6">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">New Email Campaign</h2>
          <div className="space-y-3 mb-4">
            <input type="text" placeholder="Campaign name" value={formName} onChange={e => setFormName(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <input type="text" placeholder="Email subject" value={formSubject} onChange={e => setFormSubject(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <textarea placeholder="Email body (HTML supported)" value={formBody} onChange={e => setFormBody(e.target.value)} rows={6}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none font-mono" />
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

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800">
          <EnvelopeSimple size={40} className="text-zinc-300 dark:text-zinc-600 mb-4" />
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">No email campaigns yet</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Create one above to start email outreach.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <motion.div key={c.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.name}</h3>
                    <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium ${
                      c.status === 'sent' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                      c.status === 'running' ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                      'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}>
                      {c.status}
                    </span>
                  </div>
                  {c.subject && <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Subject: {c.subject}</p>}
                  <div className="flex gap-3 text-[11px] text-zinc-400 dark:text-zinc-500 mt-2">
                    <span>{c.leads?.length || 0} recipients</span>
                    <span>{c.sent || 0} sent</span>
                    {c.failed > 0 && <span className="text-red-500">{c.failed} failed</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleDelete(c.id, c.name)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded border border-red-200 bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors">
                    <Trash size={12} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
