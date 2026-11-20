import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Pause, Play, Stop, Trash, Broadcast, Clock, CalendarBlank, Lightning, ShieldCheck } from '@phosphor-icons/react'
import { getJobs, getDailyStatus, pauseJob, resumeJob, stopJob, deleteJob, rescheduleJob } from '../api'
import { canI } from '../permissions'
import { STATUS_COLORS, STATUS_LABELS, fmtDateTime, broadcastTitle, isActiveBroadcast } from './BroadcastParts'

const th = 'text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium text-[11px] uppercase tracking-wider'
const iconBtn = 'inline-flex items-center justify-center w-7 h-7 rounded text-[10px] font-medium transition-colors active:scale-[0.95]'
const dangerBtn = `${iconBtn} border border-red-200 dark:border-red-800 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100`
const primaryBtn = `${iconBtn} bg-emerald-500 text-white hover:bg-emerald-600`
const plainBtn = `${iconBtn} border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50`

function DailyBar({ daily, goView }) {
  const ratio = daily.limit ? daily.new_chats / daily.limit : 1
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="mb-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">New chats today · health {daily.health}/100</span>
        <span className="text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{daily.new_chats} / {daily.limit}</span>
      </div>
      <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, ratio * 100)}%` }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className={`h-full rounded-full ${!daily.limit ? 'bg-zinc-400' : ratio < 0.5 ? 'bg-emerald-500' : ratio < 0.8 ? 'bg-amber-500' : 'bg-red-500'}`} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 mt-1.5">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {daily.limit === 0 ? 'No new chats allowed today (warm-up or health pause)' : daily.remaining === 0 ? 'Limit reached — resumes tomorrow' : `${daily.remaining} remaining · ${daily.sent} messages sent today`}
        </span>
        {goView && (
          <button onClick={() => goView('settings?tab=whatsapp')} className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
            <ShieldCheck size={10} /> Number & limits
          </button>
        )}
      </div>
    </motion.div>
  )
}

// The list of broadcasts. `campaignId` limits it to one campaign (and hides the daily bar); rows open the broadcast page.
export default function BroadcastJobs({ showToast, goView, campaignId, onChange }) {
  const [jobs, setJobs] = useState(null)
  const [daily, setDaily] = useState(null)

  const load = useCallback(async () => {
    try { setJobs(await getJobs(campaignId)) } catch {}
    if (!campaignId) try { setDaily(await getDailyStatus()) } catch {}
  }, [campaignId])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  const act = async (fn, ok, fail) => {
    try { await fn(); if (ok) showToast(ok); await load(); onChange?.() }
    catch (err) { showToast(err.message || fail, true) }
  }
  const handleStop = (id) => confirm('Stop this broadcast?') && act(() => stopJob(id), 'Broadcast stopped.', 'Failed to stop.')
  const handleStartNow = (id) => confirm('Start this scheduled broadcast now?') && act(() => rescheduleJob(id, Date.now()), 'Starting now.', 'Failed.')
  const handleCancel = (id) => confirm('Cancel this scheduled broadcast?') && act(() => stopJob(id), 'Scheduled broadcast cancelled.', 'Failed to cancel.')
  const handleDelete = (id) => confirm('Delete this broadcast and its history?') && act(() => deleteJob(id), 'Broadcast deleted.', 'Failed to delete.')

  const manage = canI('broadcast.manage')

  return (
    <div>
      {daily && <DailyBar daily={daily} goView={goView} />}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
        {jobs && jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <Broadcast size={28} className="text-zinc-300 dark:text-zinc-600 mb-3" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Nothing sent yet</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-[50ch]">
              {campaignId ? 'Press Send WhatsApp above to message this campaign.' : 'Open a campaign and press Send WhatsApp, or select contacts in Contacts and send to them directly.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className={th}>Broadcast</th>
                  <th className={th}>Status</th>
                  <th className={th}>Progress</th>
                  <th className={th}>Sent</th>
                  <th className={th}>Delivered</th>
                  <th className={th}>Replied</th>
                  <th className={th}>Failed</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {(jobs || []).map(j => {
                  const done = j.sent + j.failed + (j.skipped || 0)
                  const pct = j.total > 0 ? Math.round(done / j.total * 100) : 0
                  return (
                    <tr key={j.id} onClick={() => goView?.(`broadcast/${j.id}`)}
                      className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer">
                      <td className="py-3 px-4 min-w-[180px]">
                        <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{broadcastTitle(j)}</div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500">{fmtDateTime(j.created_at)} · {j.total} contacts</div>
                      </td>
                      <td className="py-3 px-4 min-w-[120px]">
                        <span className={`font-semibold text-xs ${STATUS_COLORS[j.status] || 'text-zinc-500 dark:text-zinc-400'}`}>{STATUS_LABELS[j.status] || j.status}</span>
                        {j.status === 'scheduled' && j.scheduled_at && (
                          <div className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 whitespace-nowrap"><CalendarBlank size={10} /> {fmtDateTime(j.scheduled_at)}</div>
                        )}
                        {j.wait_reason && <div className="text-[10px] text-amber-600 dark:text-amber-400 max-w-[220px]">{j.wait_reason}{j.resume_at ? ` · ${fmtDateTime(j.resume_at)}` : ''}</div>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full flex-1 w-16 overflow-hidden">
                            <div style={{ width: `${pct}%` }} className="h-full rounded-full bg-emerald-500 transition-all" />
                          </div>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono w-8 text-right tabular-nums">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-medium tabular-nums text-zinc-700 dark:text-zinc-300">{j.sent}</td>
                      <td className="py-3 px-4 text-xs font-medium tabular-nums text-sky-600 dark:text-sky-400">{j.delivered}</td>
                      <td className="py-3 px-4 text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{j.replied}</td>
                      <td className="py-3 px-4 text-xs font-medium tabular-nums text-red-600 dark:text-red-400">{j.failed}</td>
                      <td className="py-3 px-4" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          {j.status === 'running' && manage && (
                            <>
                              <button title="Pause" onClick={() => act(() => pauseJob(j.id), 'Broadcast paused.', 'Failed to pause.')} className={plainBtn}><Pause size={12} /></button>
                              <button title="Stop" onClick={() => handleStop(j.id)} className={dangerBtn}><Stop size={12} weight="fill" /></button>
                            </>
                          )}
                          {j.status === 'paused' && manage && (
                            <>
                              <button title="Resume" onClick={() => act(() => resumeJob(j.id), 'Broadcast resumed.', 'Failed to resume.')} className={primaryBtn}><Play size={12} weight="fill" /></button>
                              <button title="Stop" onClick={() => handleStop(j.id)} className={dangerBtn}><Stop size={12} weight="fill" /></button>
                            </>
                          )}
                          {j.status === 'scheduled' && manage && (
                            <>
                              <button title="Start now" onClick={() => handleStartNow(j.id)} className={primaryBtn}><Lightning size={12} weight="fill" /></button>
                              <button title="Cancel" onClick={() => handleCancel(j.id)} className={dangerBtn}><Stop size={12} weight="fill" /></button>
                            </>
                          )}
                          {j.status === 'pending' && (
                            <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 px-1.5 h-7"><Clock size={12} className="animate-pulse" /> Queued</span>
                          )}
                          {!isActiveBroadcast(j) && manage && (
                            <button title="Delete" onClick={() => handleDelete(j.id)} className={plainBtn}><Trash size={12} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
