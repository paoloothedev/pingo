import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, MagnifyingGlass, Handshake, Buildings, User, CalendarBlank, Warning, GearSix } from '@phosphor-icons/react'
import { getPipelines, getDealsBoard, moveDeal } from '../api'
import { formatMoney, formatDate } from '../format'
import { can } from '../permissions'
import DealModal from './DealModal'

const input = 'h-8 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 outline-none focus:ring-1 focus:ring-emerald-500/40'

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function writePref(key, v) {
  try { localStorage.setItem(key, v) } catch {}
}

// One currency for a set of deals if they share it, otherwise null (show plain numbers).
function commonCurrency(deals) {
  const set = new Set(deals.map(d => d.currency))
  return set.size === 1 ? [...set][0] : null
}
function money(v, currency) {
  return currency ? formatMoney(v, currency, { compact: true }) : Number(v || 0).toLocaleString()
}

export default function DealsBoard({ user, refreshId, showToast, goView }) {
  const [pipelines, setPipelines] = useState([])
  const [pipelineId, setPipelineId] = useState(() => readPref('dealsPipeline', ''))
  const [board, setBoard] = useState(null)
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useState(() => readPref('dealsOwner', ''))
  const [modal, setModal] = useState(null) // { dealId } | { defaults }
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)
  const [lostPrompt, setLostPrompt] = useState(null) // { deal, stage }
  const [lostReason, setLostReason] = useState('')
  const canEdit = can(user, 'deals.edit')
  const location = useLocation()
  const navigate = useNavigate()

  // ?deal=<id> (from global search) opens that deal, then cleans the URL
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('deal')
    if (id) {
      setModal({ dealId: id })
      navigate(location.pathname, { replace: true })
    }
  }, [location.search])

  useEffect(() => {
    getPipelines().then(list => {
      setPipelines(list)
      if (!list.some(p => p.id === pipelineId)) setPipelineId(list[0]?.id || '')
    }).catch(() => showToast('Could not load pipelines.', true))
  }, [refreshId])

  const loadBoard = useCallback(async () => {
    if (!pipelineId) return
    try {
      const params = { pipeline: pipelineId }
      if (search.trim()) params.search = search.trim()
      if (owner) params.owner = owner
      setBoard(await getDealsBoard(params))
    } catch (err) { showToast(err.message || 'Could not load deals.', true) }
  }, [pipelineId, search, owner])

  useEffect(() => {
    const t = setTimeout(loadBoard, search ? 250 : 0)
    return () => clearTimeout(t)
  }, [loadBoard, refreshId])

  const summary = useMemo(() => {
    if (!board) return null
    const open = board.stages.filter(s => s.kind === 'open')
    const deals = open.flatMap(s => s.deals)
    return {
      count: open.reduce((n, s) => n + s.count, 0),
      value: open.reduce((n, s) => n + s.total_value, 0),
      weighted: open.reduce((n, s) => n + s.weighted_value, 0),
      currency: commonCurrency(deals),
    }
  }, [board])

  const choosePipeline = (id) => { setPipelineId(id); writePref('dealsPipeline', id) }
  const chooseOwner = (v) => { setOwner(v); writePref('dealsOwner', v) }

  const doMove = async (deal, stage, reason) => {
    // Optimistic: move the card locally, then reload for exact totals
    setBoard(b => b && {
      ...b,
      stages: b.stages.map(s => ({
        ...s,
        deals: s.id === stage.id ? [{ ...deal, stage_id: stage.id }, ...s.deals] : s.deals.filter(d => d.id !== deal.id),
      })),
    })
    try {
      await moveDeal(deal.id, stage.id, reason)
      if (stage.kind === 'won') showToast(`Won: ${deal.title} 🎉`)
    } catch (err) {
      showToast(err.message || 'Could not move deal.', true)
    }
    loadBoard()
  }

  const onDrop = (stage) => {
    setOverStage(null)
    const deal = board?.stages.flatMap(s => s.deals).find(d => d.id === dragId)
    setDragId(null)
    if (!deal || deal.stage_id === stage.id) return
    if (stage.kind === 'lost') { setLostReason(''); setLostPrompt({ deal, stage }); return }
    doMove(deal, stage)
  }

  if (!pipelines.length && !board) {
    return <div className="py-24 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading deals…</div>
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mr-2">Deals</h1>
        {pipelines.length > 1 && (
          <select value={pipelineId} onChange={e => choosePipeline(e.target.value)} className={input} aria-label="Pipeline">
            {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div className="relative">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search deals…" className={`${input} pl-7 w-44`} />
        </div>
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          {[['', 'All'], ['me', 'Mine'], ['none', 'Unassigned']].map(([v, l]) => (
            <button key={v} onClick={() => chooseOwner(v)}
              className={`px-2.5 h-8 text-xs font-medium transition-colors ${owner === v ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {summary && (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
            {summary.count} open · <span className="text-zinc-900 dark:text-zinc-100 font-medium">{money(summary.value, summary.currency)}</span>
            <span className="hidden sm:inline"> · weighted {money(summary.weighted, summary.currency)}</span>
          </div>
        )}
        {can(user, 'settings.edit') && (
          <button onClick={() => goView('settings')} title="Pipeline settings (Settings → Pipelines)"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 bg-white dark:bg-zinc-900">
            <GearSix size={14} />
          </button>
        )}
        {canEdit && (
          <button onClick={() => setModal({ defaults: { pipeline_id: pipelineId } })}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <Plus size={12} weight="bold" /> New deal
          </button>
        )}
      </div>

      {/* Board */}
      <div className="overflow-x-auto pb-4 -mx-1 px-1">
        <div className="flex gap-3 min-h-[60vh]">
          {board?.stages.map(stage => {
            const cur = commonCurrency(stage.deals)
            const isOver = overStage === stage.id && dragId
            return (
              <div key={stage.id}
                onDragOver={e => { if (dragId) { e.preventDefault(); setOverStage(stage.id) } }}
                onDragLeave={() => setOverStage(s => (s === stage.id ? null : s))}
                onDrop={() => onDrop(stage)}
                className={`w-72 shrink-0 flex flex-col rounded-xl border transition-colors ${
                  isOver ? 'border-emerald-400 bg-emerald-50/60 dark:bg-emerald-900/10' : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40'
                }`}>
                <div className="px-3 pt-3 pb-2 border-b border-zinc-200/70 dark:border-zinc-800">
                  <div className="h-1 rounded-full mb-2.5" style={{ background: stage.color }} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{stage.name}</span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
                      {stage.kind === 'open' ? `${stage.probability}%` : stage.kind}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums mt-0.5">
                    {stage.count} · {money(stage.total_value, cur)}
                  </div>
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
                  {stage.deals.map(d => (
                    <DealCard key={d.id} deal={d} draggable={canEdit} dragging={dragId === d.id}
                      onDragStart={() => setDragId(d.id)} onDragEnd={() => { setDragId(null); setOverStage(null) }}
                      onOpen={() => setModal({ dealId: d.id })} />
                  ))}
                  {stage.count > stage.deals.length && (
                    <p className="text-[10px] text-center text-zinc-400 py-1">+{stage.count - stage.deals.length} more — use search to narrow</p>
                  )}
                  {canEdit && stage.kind === 'open' && (
                    <button onClick={() => setModal({ defaults: { pipeline_id: pipelineId, stage_id: stage.id } })}
                      className="w-full h-8 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-[11px] text-zinc-400 hover:text-emerald-600 hover:border-emerald-400 transition-colors">
                      + Add deal
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {board && board.stages.every(s => s.count === 0) && !search && (
        <div className="flex flex-col items-center text-center py-6">
          <Handshake size={36} className="text-zinc-300 dark:text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">No deals yet. Create one for a contact you're talking to, then drag it through the stages.</p>
        </div>
      )}

      {modal && (
        <DealModal dealId={modal.dealId || null} defaults={modal.defaults} pipelines={pipelines} close={() => setModal(null)}
          showToast={showToast} onSaved={loadBoard} canDelete={can(user, 'deals.delete')} />
      )}

      {lostPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setLostPrompt(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Mark "{lostPrompt.deal.title}" as lost?</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">Why was it lost? This feeds the lost-reasons report.</p>
            <input autoFocus value={lostReason} onChange={e => setLostReason(e.target.value)} placeholder="e.g. Price, timing, competitor…"
              onKeyDown={e => { if (e.key === 'Enter') { doMove(lostPrompt.deal, lostPrompt.stage, lostReason); setLostPrompt(null) } }}
              className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 mb-4" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setLostPrompt(null)} className="px-3 h-8 rounded-lg text-xs border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">Cancel</button>
              <button onClick={() => { doMove(lostPrompt.deal, lostPrompt.stage, lostReason); setLostPrompt(null) }}
                className="px-3 h-8 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">Mark lost</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

function DealCard({ deal, draggable, dragging, onDragStart, onDragEnd, onOpen }) {
  const overdue = deal.status === 'open' && deal.expected_close && deal.expected_close < Date.now()
  return (
    <div draggable={draggable} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }} onDragEnd={onDragEnd}
      onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen()}
      className={`rounded-lg border bg-white dark:bg-zinc-900 p-2.5 text-left cursor-pointer transition-all hover:shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 ${
        dragging ? 'opacity-40' : ''
      } ${deal.rotting ? 'border-amber-300 dark:border-amber-700/60' : 'border-zinc-200 dark:border-zinc-800'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 leading-snug line-clamp-2">{deal.title}</span>
        {deal.status !== 'open' && (
          <span className={`shrink-0 px-1.5 h-4 inline-flex items-center rounded text-[9px] font-semibold uppercase ${
            deal.status === 'won' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}>{deal.status}</span>
        )}
      </div>
      {(deal.contact || deal.company) && (
        <div className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {deal.contact && <div className="flex items-center gap-1 truncate"><User size={10} className="shrink-0" />{deal.contact.name}</div>}
          {deal.company && <div className="flex items-center gap-1 truncate"><Buildings size={10} className="shrink-0" />{deal.company.name}</div>}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">{deal.value ? formatMoney(deal.value, deal.currency) : '—'}</span>
        <span className="flex items-center gap-1.5">
          {deal.rotting && <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title="No stage change for a while"><Warning size={10} />idle</span>}
          {deal.expected_close && (
            <span className={`flex items-center gap-0.5 ${overdue ? 'text-red-600 dark:text-red-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
              <CalendarBlank size={10} />{formatDate(deal.expected_close)}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
