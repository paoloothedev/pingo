import { useState, useEffect, useCallback } from 'react'
import { Pause, Play, Stop, Trash, Lightning, CalendarBlank, Warning, CaretDown, CaretRight } from '@phosphor-icons/react'
import { getJob, pauseJob, resumeJob, stopJob, deleteJob, rescheduleJob } from '../api'
import { canI } from '../permissions'
import { BackLink, Panel } from './RecordParts'
import { STATUS_COLORS, STATUS_LABELS, fmtDateTime, broadcastTitle, isActiveBroadcast, Stat, OutreachBadge } from './BroadcastParts'

const btn = 'inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
const th = 'text-left py-2.5 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider'

const FILTERS = [
  ['all', 'All', () => true],
  ['replied', 'Replied', l => l.replied_at],
  ['delivered', 'Delivered', l => l.delivered_at],
  ['sent', 'Sent', l => l.status === 'sent'],
  ['waiting', 'Waiting', l => l.status === 'pending'],
  ['failed', 'Failed', l => l.status === 'failed'],
  ['skipped', 'Skipped', l => l.status === 'skipped'],
]

function templateParts(message) {
  try {
    const parsed = JSON.parse(message)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  return [message]
}

function toLocalInput(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function BroadcastPage({ id, showToast, goView }) {
  const [job, setJob] = useState(null)
  const [missing, setMissing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [openRow, setOpenRow] = useState(null)
  const [when, setWhen] = useState('')

  const load = useCallback(() => getJob(id).then(j => { setJob(j); setMissing(false) }).catch(() => setMissing(true)), [id])
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  if (missing) {
    return (
      <div className="max-w-5xl mx-auto">
        <BackLink onClick={() => goView('campaigns')}>Campaigns</BackLink>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">This broadcast doesn't exist anymore.</p>
      </div>
    )
  }
  if (!job) return null

  const act = async (fn, ok) => {
    try { await fn(); showToast(ok); load() }
    catch (err) { showToast(err.message || 'Failed.', true) }
  }
  const remove = async () => {
    if (!confirm('Delete this broadcast and its history?')) return
    try { await deleteJob(job.id); showToast('Broadcast deleted.'); goView('campaigns') }
    catch (err) { showToast(err.message || 'Failed.', true) }
  }
  const reschedule = () => {
    const at = new Date(when).getTime()
    if (!(at > Date.now())) { showToast('Pick a time in the future.', true); return }
    act(() => rescheduleJob(job.id, at), 'Rescheduled.')
    setWhen('')
  }

  const manage = canI('broadcast.manage')
  const rows = job.leads || []
  const shown = rows.filter(FILTERS.find(f => f[0] === filter)[2])

  return (
    <div className="max-w-5xl mx-auto">
      {job.campaign_id && job.campaign_name
        ? <BackLink onClick={() => goView(`campaigns/${job.campaign_id}`)}>{job.campaign_name}</BackLink>
        : <BackLink onClick={() => goView('campaigns')}>Campaigns</BackLink>}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 break-words">{broadcastTitle(job)}</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            <span className={`font-semibold ${STATUS_COLORS[job.status] || ''}`}>{STATUS_LABELS[job.status] || job.status}</span>
            {' · created '}{fmtDateTime(job.created_at)}
            {job.scheduled_at && <> · scheduled for {fmtDateTime(job.scheduled_at)}</>}
            {job.started_at && <> · started {fmtDateTime(job.started_at)}</>}
            {job.completed_at && <> · finished {fmtDateTime(job.completed_at)}</>}
          </p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {job.status === 'running' && <button onClick={() => act(() => pauseJob(job.id), 'Broadcast paused.')} className={btn}><Pause size={13} /> Pause</button>}
            {job.status === 'paused' && <button onClick={() => act(() => resumeJob(job.id), 'Broadcast resumed.')} className={btn}><Play size={13} /> Resume</button>}
            {job.status === 'scheduled' && <button onClick={() => confirm('Start this broadcast now?') && act(() => rescheduleJob(job.id, Date.now()), 'Starting now.')} className={btn}><Lightning size={13} /> Start now</button>}
            {isActiveBroadcast(job) && job.status !== 'pending' && <button onClick={() => confirm('Stop this broadcast?') && act(() => stopJob(job.id), 'Broadcast stopped.')} className={btn}><Stop size={13} /> {job.status === 'scheduled' ? 'Cancel' : 'Stop'}</button>}
            {!isActiveBroadcast(job) && <button onClick={remove} className={btn}><Trash size={13} /> Delete</button>}
          </div>
        )}
      </div>

      {job.wait_reason && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <Warning size={14} weight="fill" className="shrink-0 mt-0.5" />
          <span>Waiting: {job.wait_reason}{job.resume_at ? ` — resumes ${fmtDateTime(job.resume_at)}` : ''}</span>
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        <Stat label="Contacts" value={job.total} />
        <Stat label="Sent" value={job.sent} />
        <Stat label="Delivered" value={job.delivered} tone="text-sky-600 dark:text-sky-400" />
        <Stat label="Replied" value={job.replied} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Failed" value={job.failed} tone="text-red-600 dark:text-red-400" />
        <Stat label="Skipped" value={job.skipped} tone="text-amber-600 dark:text-amber-400" />
      </div>

      <div className="space-y-4">
        <Panel title="Message">
          <div className="space-y-2">
            {templateParts(job.message).map((m, i) => (
              <p key={i} dir="auto" className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2">{m}</p>
            ))}
          </div>
          {job.status === 'scheduled' && manage && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input type="datetime-local" value={when} min={toLocalInput(Date.now())} onChange={e => setWhen(e.target.value)}
                className="h-8 px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none" />
              <button onClick={reschedule} disabled={!when} className={`${btn} disabled:opacity-50`}><CalendarBlank size={13} /> Reschedule</button>
            </div>
          )}
        </Panel>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
          <div className="flex gap-1 p-2 border-b border-zinc-100 dark:border-zinc-800 overflow-x-auto">
            {FILTERS.map(([key, label, test]) => {
              const n = rows.filter(test).length
              if (key !== 'all' && !n) return null
              return (
                <button key={key} onClick={() => setFilter(key)}
                  className={`px-2.5 h-7 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${filter === key ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}>
                  {label} {n}
                </button>
              )
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className={th}>Contact</th><th className={th}>Result</th><th className={th}>Sent</th><th className={th}>Replied</th><th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(l => (
                  <FragmentRow key={l.id} l={l} open={openRow === l.id} toggle={() => setOpenRow(openRow === l.id ? null : l.id)} goView={goView} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ l, open, toggle, goView }) {
  const canExpand = !!l.text
  return (
    <>
      <tr onClick={canExpand ? toggle : undefined} className={`border-b border-zinc-50 dark:border-zinc-800/50 ${canExpand ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30' : ''}`}>
        <td className="py-2.5 px-4 min-w-[160px]">
          {l.lead_id && l.lead_name
            ? <button onClick={e => { e.stopPropagation(); goView(`contact/${l.lead_id}`) }} dir="auto" className="text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:text-emerald-600 dark:hover:text-emerald-400 text-left">{l.lead_name}</button>
            : <span className="text-xs text-zinc-500 dark:text-zinc-400">Deleted contact</span>}
          <div className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular-nums">{l.phone}</div>
        </td>
        <td className="py-2.5 px-4"><OutreachBadge row={l} />{l.error && <div className="text-[10px] text-zinc-500 dark:text-zinc-400 max-w-[220px] truncate" title={l.error}>{l.error}</div>}</td>
        <td className="py-2.5 px-4 text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{l.sent_at ? fmtDateTime(l.sent_at) : '—'}</td>
        <td className="py-2.5 px-4 text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">{l.replied_at ? fmtDateTime(l.replied_at) : '—'}</td>
        <td className="py-2.5 px-4 text-zinc-400 w-8">{canExpand && (open ? <CaretDown size={12} /> : <CaretRight size={12} />)}</td>
      </tr>
      {open && l.text && (
        <tr className="border-b border-zinc-50 dark:border-zinc-800/50">
          <td colSpan={5} className="px-4 pb-3">
            <p dir="auto" className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2">{l.text}</p>
          </td>
        </tr>
      )}
    </>
  )
}
