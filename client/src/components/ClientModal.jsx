import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Pencil, Check, Phone, EnvelopeSimple, ArrowRight,
  CaretRight, Trash, Link as LinkIcon, MapPin
} from '@phosphor-icons/react'
import { getClient, updateClient, deleteClient, addClientActivity } from '../api'

const STAGES = [
  { value: 'new', label: 'New', color: 'bg-zinc-400', dot: 'bg-zinc-400' },
  { value: 'contacted', label: 'Contacted', color: 'bg-blue-400', dot: 'bg-blue-400' },
  { value: 'interested', label: 'Interested', color: 'bg-emerald-400', dot: 'bg-emerald-400' },
  { value: 'negotiating', label: 'Negotiating', color: 'bg-amber-400', dot: 'bg-amber-400' },
  { value: 'closed', label: 'Closed', color: 'bg-violet-400', dot: 'bg-violet-400' },
  { value: 'lost', label: 'Lost', color: 'bg-red-400', dot: 'bg-red-400' },
]

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ClientModal({ clientId, close, showToast, refresh, tags: allTags }) {
  const [client, setClient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [activeTab, setActiveTab] = useState('info')

  const loadClient = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const data = await getClient(clientId)
      setClient(data)
      setEditForm({
        name: data.name || '',
        phone: data.phone || '',
        email: data.email || '',
        facebook: data.facebook || '',
        instagram: data.instagram || '',
        tiktok: data.tiktok || '',
        link: data.link || '',
        location: data.location || '',
        notes: data.notes || '',
      })
    } catch {}
    setLoading(false)
  }, [clientId])

  useEffect(() => { loadClient() }, [loadClient])

  useEffect(() => {
    const handleClick = (e) => {
      if (e.target.classList.contains('modal-overlay')) close()
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [close])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateClient(clientId, editForm)
      showToast('Client updated.')
      setEditing(false)
      loadClient()
      refresh()
    } catch { showToast('Failed to save.', true) }
    setSaving(false)
  }

  const handleStageChange = async (newStage) => {
    if (newStage === client.stage) return
    const oldStage = client.stage
    try {
      await updateClient(clientId, { stage: newStage })
      await addClientActivity(clientId, 'stage_changed', { from: oldStage, to: newStage })
      showToast(`Stage changed to "${STAGES.find(s => s.value === newStage)?.label}".`)
      loadClient()
      refresh()
    } catch { showToast('Failed to change stage.', true) }
  }

  const handleStatusToggle = async () => {
    const newStatus = client.status === 'active' ? 'inactive' : 'active'
    try {
      await updateClient(clientId, { status: newStatus })
      await addClientActivity(clientId, 'status_changed', { from: client.status, to: newStatus })
      showToast(`Client ${newStatus === 'active' ? 'activated' : 'deactivated'}.`)
      loadClient()
      refresh()
    } catch { showToast('Failed.', true) }
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    try {
      const updatedNotes = client.notes ? client.notes + '\n' + newNote.trim() : newNote.trim()
      await updateClient(clientId, { notes: updatedNotes })
      await addClientActivity(clientId, 'note_added', { preview: newNote.trim().slice(0, 100) })
      setNewNote('')
      showToast('Note added.')
      loadClient()
    } catch { showToast('Failed.', true) }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete client "${client.name}"? This cannot be undone.`)) return
    try {
      await deleteClient(clientId)
      showToast('Client deleted.')
      close()
      refresh()
    } catch { showToast('Failed.', true) }
  }

  if (loading || !client) return null

  const stage = STAGES.find(s => s.value === client.stage) || STAGES[0]
  const currentIdx = STAGES.findIndex(s => s.value === client.stage)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm modal-overlay">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 250, damping: 25 }}
        className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: stage.color }}>
              {client.name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{client.name}</h2>
              <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {client.source && <span className="capitalize">{client.source}</span>}
                {client.source && <span className="mx-1">&middot;</span>}
                <span>Added {fmtTime(client.created_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {!editing ? (
              <button onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <Pencil size={12} /> Edit
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving}
                className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                <Check size={12} /> {saving ? 'Saving...' : 'Save'}
              </button>
            )}
            <button onClick={handleDelete}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash size={14} />
            </button>
            <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors ml-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Pipeline */}
        <div className="px-6 py-3 border-b border-zinc-100 dark:border-zinc-800/50 shrink-0">
          <div className="flex items-center gap-1">
            {STAGES.map((s, i) => (
              <div key={s.value} className="flex items-center flex-1">
                <button onClick={() => handleStageChange(s.value)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all w-full ${
                    i === currentIdx
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                      : i < currentIdx
                        ? 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        : 'text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                  }`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${i === currentIdx ? s.dot : i < currentIdx ? 'bg-zinc-300 dark:bg-zinc-600' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
                  <span className="truncate">{s.label}</span>
                </button>
                {i < STAGES.length - 1 && (
                  <CaretRight size={10} className={`shrink-0 mx-0.5 ${i < currentIdx ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-200 dark:text-zinc-700'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-100 dark:border-zinc-800/50 px-6 shrink-0">
          {[{ id: 'info', label: 'Details' }, { id: 'activity', label: 'Activity' }].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-emerald-500 text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === 'info' && (
            <div className="space-y-5">
              {/* Contact */}
              <div>
                <h3 className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">Contact Information</h3>
                {editing ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">Name</label>
                      <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        className="h-9 w-full px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">Phone</label>
                      <input type="text" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                        className="h-9 w-full px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">Email</label>
                      <input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                        className="h-9 w-full px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">Location</label>
                      <input type="text" value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })}
                        className="h-9 w-full px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {client.phone && (
                      <div className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <Phone size={14} className="text-zinc-400" />
                        <span>{client.phone}</span>
                        {client.phone_valid ? (
                          <span className="text-[10px] text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">Valid</span>
                        ) : (
                          <span className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded">Invalid</span>
                        )}
                      </div>
                    )}
                    {client.email && (
                      <div className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <EnvelopeSimple size={14} className="text-zinc-400" />
                        <span>{client.email}</span>
                      </div>
                    )}
                    {client.location && (
                      <div className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <MapPin size={14} className="text-zinc-400" />
                        <span className="truncate">{client.location}</span>
                      </div>
                    )}
                    {!client.phone && !client.email && !client.location && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">No contact info</p>
                    )}
                  </div>
                )}
              </div>

              {/* Social Links */}
              <div>
                <h3 className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">Social Links</h3>
                {editing ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: 'facebook', label: 'Facebook' },
                      { key: 'instagram', label: 'Instagram' },
                      { key: 'tiktok', label: 'TikTok' },
                      { key: 'link', label: 'Website / Link' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">{f.label}</label>
                        <input type="url" value={editForm[f.key]} onChange={e => setEditForm({ ...editForm, [f.key]: e.target.value })} placeholder="https://..."
                          className="h-9 w-full px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {client.facebook && <a href={client.facebook} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium bg-[#1877f2] text-white hover:opacity-90 transition-opacity"><LinkIcon size={12} /> Facebook</a>}
                    {client.instagram && <a href={client.instagram} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white hover:opacity-90 transition-opacity"><LinkIcon size={12} /> Instagram</a>}
                    {client.tiktok && <a href={client.tiktok} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium bg-black text-white border border-zinc-700 hover:opacity-90 transition-opacity"><LinkIcon size={12} /> TikTok</a>}
                    {client.link && <a href={client.link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md text-[11px] font-medium bg-zinc-600 text-white hover:bg-zinc-700 transition-colors"><LinkIcon size={12} /> Website</a>}
                    {!client.facebook && !client.instagram && !client.tiktok && !client.link && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">No social links</p>
                    )}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <h3 className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">Notes</h3>
                {editing ? (
                  <textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 resize-none" />
                ) : (
                  <div className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed">
                    {client.notes || <span className="italic text-zinc-400">No notes</span>}
                  </div>
                )}
              </div>

              {/* Add note (non-edit mode) */}
              {!editing && (
                <div className="border-t border-zinc-100 dark:border-zinc-800/50 pt-4">
                  <div className="flex gap-2">
                    <input type="text" placeholder="Add a quick note..." value={newNote} onChange={e => setNewNote(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                      className="flex-1 h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40" />
                    <button onClick={handleAddNote} disabled={!newNote.trim()}
                      className="inline-flex items-center px-3 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50 active:scale-[0.98]">
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-1">
              {(client.activities || []).length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 italic text-center py-8">No activity yet.</p>
              ) : (
                client.activities.map((a, i) => {
                  let details = {}
                  try { details = JSON.parse(a.details || '{}') } catch {}
                  const labels = {
                    created: 'Client created',
                    updated: 'Client updated',
                    stage_changed: `Stage changed: ${STAGES.find(s => s.value === details.from)?.label || details.from} → ${STAGES.find(s => s.value === details.to)?.label || details.to}`,
                    status_changed: `Status changed: ${details.from} → ${details.to}`,
                    note_added: `Note added: "${details.preview || ''}"`,
                  }
                  return (
                    <div key={a.id || i} className="flex gap-3 py-2.5 border-b border-zinc-50 dark:border-zinc-800/30 last:border-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs text-zinc-700 dark:text-zinc-300">{labels[a.action] || a.action}</div>
                        <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{fmtTime(a.created_at)}</div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium text-white ${stage.color}`}>{stage.label}</span>
            <button onClick={handleStatusToggle}
              className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium cursor-pointer transition-colors ${
                client.status === 'active' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200'
              }`}>
              {client.status === 'active' ? 'Active' : 'Inactive'} (click to toggle)
            </button>
          </div>
          <div className="flex gap-1">
            {STAGES.slice(currentIdx + 1).map(s => (
              <button key={s.value} onClick={() => handleStageChange(s.value)}
                className="inline-flex items-center gap-1 px-2 h-6 rounded text-[10px] font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <ArrowRight size={10} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
