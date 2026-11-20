import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash, CaretUp, CaretDown, Signpost } from '@phosphor-icons/react'
import { createStage, updateStage, deleteStage, reorderStages } from '../api'
import { canI } from '../permissions'

export default function Stages({ stages, loadStages, refreshId, showToast, refresh }) {
  const canEdit = canI('stages.edit')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3d5a45')
  useEffect(() => { loadStages() }, [loadStages, refreshId])

  const handleAdd = async () => {
    if (!newName.trim()) { showToast('Enter a stage name.', true); return }
    try {
      await createStage({ name: newName.trim(), color: newColor })
      setNewName('')
      showToast('Stage added.')
      refresh()
    } catch { showToast('Failed to add stage.', true) }
  }

  const handleUpdate = async (id, data) => {
    try { await updateStage(id, data); refresh() }
    catch { showToast('Failed to update.', true) }
  }

  const handleDelete = async (id) => {
    if (stages.length <= 1) { showToast('Cannot delete the last stage.', true); return }
    if (!confirm('Delete this stage? Leads will move to another stage.')) return
    try { await deleteStage(id); showToast('Stage deleted.'); refresh() }
    catch { showToast('Failed to delete.', true) }
  }

  const handleReorder = async (id, dir) => {
    const idx = stages.findIndex(s => s.id === id)
    if ((dir === 'up' && idx === 0) || (dir === 'down' && idx === stages.length - 1)) return
    const ordered = stages.map(s => s.id)
    const swap = dir === 'up' ? idx - 1 : idx + 1
    ;[ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]]
    try { await reorderStages(ordered); refresh() }
    catch { showToast('Failed to reorder.', true) }
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 mb-1">Pipeline Stages</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Manage the stages leads move through.</p>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden mb-6"
      >
        <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Pipeline</h2>
        </div>
        <div className="p-5 space-y-2">
          {stages.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl px-4 h-12 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900">
              <span className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-mono font-medium text-zinc-400 dark:text-zinc-500 shrink-0" style={{ backgroundColor: s.color + '20', color: s.color }}>
                {i + 1}
              </span>
              <input type="color" disabled={!canEdit} value={s.color} onChange={e => handleUpdate(s.id, { color: e.target.value })}
                className="w-7 h-7 rounded-lg cursor-pointer border-0 bg-transparent shrink-0" />
              <input type="text" disabled={!canEdit} value={s.name} onChange={e => handleUpdate(s.id, { name: e.target.value })}
                className="flex-1 bg-transparent border-0 text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder-zinc-400 dark:placeholder-zinc-500" />
              <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono tabular-nums w-10 text-right">{s.lead_count || 0}</span>
              {canEdit && <div className="flex gap-0.5">
                <button onClick={() => handleReorder(s.id, 'up')} disabled={i === 0}
                  className="p-1.5 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                  <CaretUp size={12} />
                </button>
                <button onClick={() => handleReorder(s.id, 'down')} disabled={i === stages.length - 1}
                  className="p-1.5 rounded-lg text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                  <CaretDown size={12} />
                </button>
              </div>}
              {canEdit && <button onClick={() => handleDelete(s.id)}
                className="inline-flex items-center px-3 h-8 rounded-lg text-[11px] font-medium border border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors shrink-0 active:scale-[0.98]">
                <Trash size={12} className="mr-1.5" />
                Delete
              </button>}
            </div>
          ))}
        </div>
      </motion.div>

      {canEdit && <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 100, damping: 20 }}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50"
      >
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Add stage</h2>
        <div className="flex items-center gap-3">
          <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
            className="w-9 h-9 rounded-lg cursor-pointer border-0 bg-transparent shrink-0" />
          <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Stage name"
            className="flex-1 h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors" />
          <button onClick={handleAdd}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] whitespace-nowrap">
            <Plus size={14} weight="bold" />
            Add stage
          </button>
        </div>
      </motion.div>}
    </div>
  )
}
