import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash, PencilSimple, Check, X, ChatText } from '@phosphor-icons/react'
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../api'
import { canI } from '../permissions'

export default function MessageTemplates({ showToast }) {
  const canEdit = canI('templates.edit')
  const [templates, setTemplates] = useState([])
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')

  useEffect(() => {
    (async () => {
      try { const t = await getTemplates(); setTemplates(t) } catch {}
    })()
  }, [])

  const handleCreateTemplate = async () => {
    if (!newName.trim() || !newContent.trim()) { showToast('Fill in both fields.', true); return }
    try {
      await createTemplate({ name: newName.trim(), content: newContent.trim() })
      setNewName(''); setNewContent('')
      showToast('Template created.')
      const t = await getTemplates(); setTemplates(t)
    } catch { showToast('Failed to create.', true) }
  }

  const handleEditTemplate = async (id) => {
    if (!editName.trim() || !editContent.trim()) { showToast('Fill in both fields.', true); return }
    try {
      await updateTemplate(id, { name: editName.trim(), content: editContent.trim() })
      setEditingId(null)
      showToast('Template updated.')
      const t = await getTemplates(); setTemplates(t)
    } catch { showToast('Failed to update.', true) }
  }

  const handleDeleteTemplate = async (id) => {
    if (!confirm('Delete this template?')) return
    try {
      await deleteTemplate(id)
      showToast('Template deleted.')
      const t = await getTemplates(); setTemplates(t)
    } catch { showToast('Failed to delete.', true) }
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <ChatText size={40} className="text-zinc-300 dark:text-zinc-600 mb-4" />
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-1">No templates yet</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Create a template below to reuse messages.</p>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            {templates.map(t => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-zinc-50 dark:bg-zinc-950 rounded-xl p-4"
              >
                {editingId === t.id ? (
                  <>
                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors mb-2" placeholder="Template name" />
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={3}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors mb-3" placeholder="Template message" />
                    <div className="flex gap-2">
                      <button onClick={() => handleEditTemplate(t.id)}
                        className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
                        <Check size={12} weight="bold" />
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
                        <X size={12} />
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.name}</span>
                      {canEdit && <div className="flex gap-2">
                        <button onClick={() => { setEditingId(t.id); setEditName(t.name); setEditContent(t.content) }}
                          className="inline-flex items-center gap-1 px-3 h-7 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
                          <PencilSimple size={12} />
                          Edit
                        </button>
                        <button onClick={() => handleDeleteTemplate(t.id)}
                          className="inline-flex items-center gap-1 px-3 h-7 rounded-lg text-[11px] font-medium border border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors active:scale-[0.98]">
                          <Trash size={12} />
                          Delete
                        </button>
                      </div>}
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{t.content}</p>
                  </>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {canEdit && <div className="p-5 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Add New Template</h3>
          <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors mb-3" placeholder="Template name" />
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={3}
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors mb-3" placeholder="Message content" />
          <button onClick={handleCreateTemplate}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <Plus size={14} weight="bold" />
            Add Template
          </button>
        </div>}
      </div>
    </div>
  )
}
