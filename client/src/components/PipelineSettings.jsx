import { useState, useEffect } from 'react'
import { Plus, Trash, CaretUp, CaretDown } from '@phosphor-icons/react'
import {
  getPipelines, createPipeline, updatePipeline, deletePipeline,
  createPipelineStage, updatePipelineStage, deletePipelineStage, reorderPipelineStages,
} from '../api'

const input = 'h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500'
const KIND_LABEL = { open: 'Open', won: 'Won', lost: 'Lost' }

export default function PipelineSettings({ showToast }) {
  const [pipelines, setPipelines] = useState([])
  const [activeId, setActiveId] = useState('')
  const [newPipeline, setNewPipeline] = useState('')
  const [newStage, setNewStage] = useState('')

  const load = async (keep) => {
    try {
      const list = await getPipelines()
      setPipelines(list)
      setActiveId(id => (list.some(p => p.id === (keep || id)) ? (keep || id) : list[0]?.id || ''))
    } catch { showToast('Could not load pipelines.', true) }
  }
  useEffect(() => { load() }, [])

  const p = pipelines.find(x => x.id === activeId)
  const run = async (fn, ok) => {
    try { await fn(); if (ok) showToast(ok); await load() } catch (err) { showToast(err.message || 'Failed.', true) }
  }

  const addPipeline = () => {
    if (!newPipeline.trim()) return
    run(async () => { const c = await createPipeline({ name: newPipeline.trim() }); setNewPipeline(''); setActiveId(c.id) }, 'Pipeline created.')
  }
  const addStage = () => {
    if (!newStage.trim() || !p) return
    // New stages go before the won/lost columns
    run(async () => {
      const s = await createPipelineStage(p.id, { name: newStage.trim(), probability: 50 })
      const ids = p.stages.map(x => x.id)
      const firstClosed = p.stages.findIndex(x => x.kind !== 'open')
      ids.splice(firstClosed === -1 ? ids.length : firstClosed, 0, s.id)
      await reorderPipelineStages(p.id, ids)
      setNewStage('')
    }, 'Stage added.')
  }
  const move = (idx, dir) => {
    const ids = p.stages.map(s => s.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    run(() => reorderPipelineStages(p.id, ids))
  }
  const saveStage = (s, patch) => {
    setPipelines(list => list.map(x => x.id !== p.id ? x : { ...x, stages: x.stages.map(y => y.id === s.id ? { ...y, ...patch } : y) }))
    updatePipelineStage(s.id, patch).catch(err => { showToast(err.message || 'Failed.', true); load() })
  }
  const removeStage = (s) => {
    const others = p.stages.filter(x => x.id !== s.id)
    if (s.deal_count && !confirm(`"${s.name}" has ${s.deal_count} deal(s). They will move to "${others[0]?.name}". Continue?`)) return
    run(() => deletePipelineStage(s.id, others[0]?.id), 'Stage deleted.')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {pipelines.map(x => (
          <button key={x.id} onClick={() => setActiveId(x.id)}
            className={`px-3 h-8 rounded-lg text-xs font-medium transition-colors ${
              x.id === activeId ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
            }`}>{x.name}</button>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <input value={newPipeline} onChange={e => setNewPipeline(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPipeline()} placeholder="New pipeline name" className={`${input} w-40`} />
          <button onClick={addPipeline} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600">
            <Plus size={12} weight="bold" /> Add
          </button>
        </div>
      </div>

      {p && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
            <input defaultValue={p.name} key={p.id}
              onBlur={e => e.target.value.trim() && e.target.value !== p.name && run(() => updatePipeline(p.id, { name: e.target.value.trim() }), 'Renamed.')}
              className={`${input} font-medium w-56`} aria-label="Pipeline name" />
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{p.stages.reduce((n, s) => n + s.deal_count, 0)} deals</span>
            {pipelines.length > 1 && (
              <button onClick={() => confirm(`Delete pipeline "${p.name}"?`) && run(() => deletePipeline(p.id), 'Pipeline deleted.')}
                className="ml-auto inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-900/20">
                <Trash size={11} /> Delete pipeline
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  <th className="text-left font-medium py-2 px-4">Stage</th>
                  <th className="text-left font-medium py-2 px-2">Type</th>
                  <th className="text-left font-medium py-2 px-2">Win %</th>
                  <th className="text-left font-medium py-2 px-2" title="Flag deals with no stage change after this many days">Idle after (days)</th>
                  <th className="text-left font-medium py-2 px-2">Deals</th>
                  <th className="py-2 px-4" />
                </tr>
              </thead>
              <tbody>
                {p.stages.map((s, i) => (
                  <tr key={s.id} className="border-t border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-2">
                        <input type="color" value={s.color} onChange={e => saveStage(s, { color: e.target.value })} className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer" aria-label="Colour" />
                        <input defaultValue={s.name} onBlur={e => e.target.value.trim() && e.target.value !== s.name && saveStage(s, { name: e.target.value.trim() })} className={`${input} w-44`} />
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <select value={s.kind} onChange={e => saveStage(s, { kind: e.target.value, ...(e.target.value === 'won' ? { probability: 100 } : e.target.value === 'lost' ? { probability: 0 } : {}) })} className={input}>
                        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <input type="number" min="0" max="100" defaultValue={s.probability} key={`${s.id}-${s.probability}`}
                        onBlur={e => Number(e.target.value) !== s.probability && saveStage(s, { probability: Number(e.target.value) })} className={`${input} w-16`} />
                    </td>
                    <td className="py-2 px-2">
                      <input type="number" min="1" defaultValue={s.rot_days ?? ''} placeholder="—" disabled={s.kind !== 'open'}
                        onBlur={e => (e.target.value || null) != s.rot_days && saveStage(s, { rot_days: e.target.value ? Number(e.target.value) : null })} className={`${input} w-16 disabled:opacity-40`} />
                    </td>
                    <td className="py-2 px-2 tabular-nums text-zinc-500 dark:text-zinc-400">{s.deal_count}</td>
                    <td className="py-2 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => move(i, -1)} disabled={i === 0} className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30" aria-label="Move up"><CaretUp size={12} /></button>
                        <button onClick={() => move(i, 1)} disabled={i === p.stages.length - 1} className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30" aria-label="Move down"><CaretDown size={12} /></button>
                        <button onClick={() => removeStage(s)} disabled={p.stages.length <= 1} className="w-6 h-6 inline-flex items-center justify-center rounded text-zinc-400 hover:text-red-500 disabled:opacity-30" aria-label="Delete stage"><Trash size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800/60">
            <input value={newStage} onChange={e => setNewStage(e.target.value)} onKeyDown={e => e.key === 'Enter' && addStage()} placeholder="New stage name" className={`${input} w-56`} />
            <button onClick={addStage} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/50">
              <Plus size={12} /> Add stage
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
