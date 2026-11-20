import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, PaperPlaneTilt, Spinner, Plus, Trash, CalendarBlank, Warning, CheckCircle, ArrowLeft, ShieldCheck } from '@phosphor-icons/react'
import { getTemplates, createJob, estimateJob } from '../api'

const VARIABLES = ['{{message}}', '{{name}}', '{{phone}}', '{{email}}', '{{notes}}', '{{location}}']

// <input type="datetime-local"> value for a timestamp, in local time
function toLocalInput(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtWhen(ts) {
  return new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function etaText(est) {
  if (!est) return ''
  if (est.blocked || est.days === null) return 'Cannot finish: the number has no sending allowance (warm-up day 0 or health pause).'
  if (est.days <= 1) return 'About 1 day.'
  return `About ${est.days} days (anti-ban limits spread the sends).`
}

export default function WhatsAppSend({ leads, campaignId, campaignName, close, showToast, initialMessages, title, defaultMode, onCreated }) {
  const [name, setName] = useState('')
  const [messages, setMessages] = useState(initialMessages?.length ? initialMessages : [''])
  const [sending, setSending] = useState(false)
  const [templates, setTemplates] = useState([])
  const [step, setStep] = useState('compose')
  const [review, setReview] = useState(null)
  const [checking, setChecking] = useState(false)
  const [mode, setMode] = useState(defaultMode || 'now')
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 60 * 60 * 1000))

  useEffect(() => {
    (async () => { try { const t = await getTemplates(); setTemplates(t) } catch {} })()
  }, [])

  const validMessages = messages.filter(m => m.trim())
  const scheduledAt = mode === 'schedule' ? new Date(when).getTime() : null
  const payload = () => ({
    campaignId: campaignId || null,
    name: name.trim() || campaignName || null,
    message: validMessages.length === 1 ? validMessages[0] : JSON.stringify(validMessages),
    leads: leads.map(l => ({ id: l.id })),
    scheduledAt,
  })

  const runCheck = async () => {
    if (!validMessages.length) { showToast('Write at least one message.', true); return }
    if (mode === 'schedule' && !(scheduledAt > Date.now())) { showToast('Pick a time in the future.', true); return }
    setChecking(true)
    try {
      setReview(await estimateJob(payload()))
      setStep('review')
    } catch (err) { showToast(err.message || 'Could not check the broadcast.', true) }
    setChecking(false)
  }

  // Re-check when the schedule changes on the review step (the ETA depends on the start time)
  useEffect(() => {
    if (step !== 'review') return
    if (mode === 'schedule' && !(scheduledAt > Date.now())) return
    const t = setTimeout(() => { estimateJob(payload()).then(setReview).catch(() => {}) }, 300)
    return () => clearTimeout(t)
  }, [mode, when]) // eslint-disable-line

  const handleTemplate = (id, msgIndex) => {
    const t = templates.find(x => x.id === id)
    if (t) updateMessage(msgIndex, t.content)
  }
  const addMessage = () => setMessages([...messages, ''])
  const removeMessage = (i) => { if (messages.length > 1) setMessages(messages.filter((_, idx) => idx !== i)) }
  const updateMessage = (i, val) => setMessages(prev => prev.map((m, idx) => idx === i ? val : m))

  const handleCreateJob = async () => {
    setSending(true)
    try {
      const job = await createJob(payload())
      const seq = validMessages.length > 1 ? ` (${validMessages.length} messages each)` : ''
      showToast(job.status === 'scheduled'
        ? `Scheduled for ${fmtWhen(job.scheduled_at)}: ${job.eligible} contacts${seq}.`
        : `Broadcast started for ${job.eligible} contacts${seq}. Anti-ban limits pace it automatically.`)
      close()
      onCreated?.(job)
    } catch (err) { showToast(err.message || 'Failed to create job.', true) }
    setSending(false)
  }

  const blocked = review && (review.problems.length > 0 || review.eligible === 0)
  const skippedByReason = review ? Object.entries(review.skipped.reduce((m, s) => ({ ...m, [s.reason]: (m[s.reason] || 0) + 1 }), {})) : []
  const btnSecondary = 'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]'
  const btnPrimary = 'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors active:scale-[0.98]'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={close}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 250, damping: 25 }}
        className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-lg flex flex-col shadow-xl max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title || 'Send WhatsApp'} · {leads.length} {leads.length === 1 ? 'contact' : 'contacts'}
          </h2>
          <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {step === 'compose' ? (
          <div className="px-6 py-5 overflow-y-auto flex-1">
            {!campaignId && leads.length > 1 && (
              <div className="mb-4">
                <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Broadcast name (optional)</label>
                <input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="e.g. Khobar cafes, first message"
                  className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500" />
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {messages.length > 1 ? `Message ${i + 1} of ${messages.length}` : 'Message'}
                  </label>
                  {messages.length > 1 && (
                    <button onClick={() => removeMessage(i)} className="text-zinc-400 hover:text-red-500 transition-colors">
                      <Trash size={12} />
                    </button>
                  )}
                </div>
                {templates.length > 0 && (
                  <select value="" onChange={e => { handleTemplate(e.target.value, i); e.target.value = '' }}
                    className="w-full h-8 px-3 mb-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[10px] text-zinc-500 dark:text-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
                    <option value="">Fill from template...</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                <textarea value={msg} onChange={e => updateMessage(i, e.target.value)} rows={3} dir="auto"
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors"
                  placeholder="Type your message here..." />
              </div>
            ))}

            <button onClick={addMessage}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors mb-3">
              <Plus size={12} weight="bold" />
              Add message step
            </button>

            <div className="flex flex-wrap gap-1 mb-2">
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500 self-center">Variables:</span>
              {VARIABLES.map(v => (
                <button key={v} onClick={() => {
                  const last = messages.length - 1
                  updateMessage(last, messages[last] + (messages[last] && !messages[last].endsWith(' ') ? ' ' : '') + v)
                }}
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                  {v}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mb-4 px-1 leading-relaxed">
              <span className="font-mono">{'{{message}}'}</span> = the message saved on each contact (e.g. written by Claude). Spintax like <span className="font-mono">{'{Hi|Hello}'}</span> adds variation.
            </p>

            <WhenPicker mode={mode} setMode={setMode} when={when} setWhen={setWhen} />

            <div className="flex gap-3 mt-5">
              <button onClick={close} className={btnSecondary}>Cancel</button>
              <button onClick={runCheck} disabled={checking || !validMessages.length} className={btnPrimary}>
                {checking ? <><Spinner size={14} className="animate-spin" /> Checking…</> : <><ShieldCheck size={14} weight="fill" /> Review</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
            {review.problems.length > 0 ? (
              <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-3 space-y-1.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400"><Warning size={14} weight="fill" /> Fix these before sending</p>
                {review.problems.map(p => (
                  <p key={p.code} className="text-xs text-red-700 dark:text-red-300">
                    {p.message}{p.count && p.code !== 'similar' ? ` (${p.count} ${p.count === 1 ? 'contact' : 'contacts'})` : ''}
                  </p>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle size={14} weight="fill" /> Content checks passed.</p>
            )}

            <dl className="grid grid-cols-3 gap-2">
              {[['Will message', review.eligible], ['New chats', review.new_chats], ['Follow-ups', review.follow_ups]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2">
                  <dt className="text-[10px] text-zinc-500 dark:text-zinc-400">{k}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{v}</dd>
                </div>
              ))}
            </dl>

            {skippedByReason.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Skipped ({review.skipped.length})</p>
                <ul className="space-y-0.5">
                  {skippedByReason.map(([reason, n]) => (
                    <li key={reason} className="text-xs text-zinc-600 dark:text-zinc-300">{n} × {reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Estimated time</p>
              <p className={`text-xs ${review.estimate.blocked ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300'}`}>{etaText(review.estimate)}</p>
            </div>

            <WhenPicker mode={mode} setMode={setMode} when={when} setWhen={setWhen} />

            <div className="flex gap-3">
              <button onClick={() => setStep('compose')} className={btnSecondary}><ArrowLeft size={13} /> Edit</button>
              <button onClick={handleCreateJob} disabled={sending || blocked} className={btnPrimary}>
                {sending ? <><Spinner size={14} className="animate-spin" /> Saving…</>
                  : mode === 'schedule'
                    ? <><CalendarBlank size={14} weight="fill" /> Schedule</>
                    : <><PaperPlaneTilt size={14} weight="fill" /> Start broadcast</>}
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 text-center">
              Runs in the background with anti-ban pacing. Track it under Broadcasts.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function WhenPicker({ mode, setMode, when, setWhen }) {
  const opt = (m, label) => (
    <button onClick={() => setMode(m)}
      className={`flex-1 h-8 rounded-md text-xs font-medium transition-colors ${mode === m
        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}>
      {label}
    </button>
  )
  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">When</p>
      <div className="flex gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800">
        {opt('now', 'Send now')}
        {opt('schedule', 'Schedule')}
      </div>
      {mode === 'schedule' && (
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} min={toLocalInput(Date.now())}
          className="mt-2 w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 [color-scheme:light] dark:[color-scheme:dark]" />
      )}
    </div>
  )
}
