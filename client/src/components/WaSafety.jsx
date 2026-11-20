import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, Warning, X } from '@phosphor-icons/react'
import { getWaHealth, getWaLimits, getWaNumbers, saveWaLimits, setWarmupDays, dismissWaAlert } from '../api'

const LEVEL = {
  good: { label: 'Healthy', cls: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  warning: { label: 'Warning — half volume', cls: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' },
  danger: { label: 'Danger — 20 % volume', cls: 'text-orange-600 dark:text-orange-400', bar: 'bg-orange-500' },
  stopped: { label: 'Stopped (48 h)', cls: 'text-red-600 dark:text-red-400', bar: 'bg-red-500' },
}

const EVENT_LABELS = {
  disconnect: 'Disconnected', send_failed: 'Send failed', restricted: 'Account restricted', blocked: 'Blocked / reported',
  low_reply_rate: 'Low reply rate', low_delivery_rate: 'Low delivery rate', hard_stop: 'Hard stop', opt_out: 'Opt-out', number_linked: 'Number linked',
}

const FIELDS = [
  ['maxNewChatsPerDay', 'New chats per day', 'First message to a contact. Warm-up may allow fewer.'],
  ['maxMessagesPerHour', 'Messages per hour', ''],
  ['maxMessagesPerMinute', 'Messages per minute', ''],
  ['minDelaySec', 'Min gap between contacts (s)', ''],
  ['maxDelaySec', 'Max gap between contacts (s)', ''],
  ['windowStartHour', 'Send from (hour)', "Recipient's local time"],
  ['windowEndHour', 'Send until (hour)', ''],
  ['maxPerContactPerDay', 'Messages per contact per day', ''],
  ['maxUnansweredTouches', 'Stop after ignored messages', ''],
  ['maxSameTextCount', 'Max identical texts (7 days)', ''],
]
const TOGGLES = [
  ['warmup', 'Warm-up schedule for new numbers'],
  ['blockFridayMorning', 'No sending on Friday mornings'],
  ['contentRules', 'Content rules for first messages (no links/prices, ends with a question, opt-out line)'],
]

const inputCls = 'w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500'
const pct = (r) => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`)

function Card({ title, desc, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{title}</h2>
      {desc && <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed max-w-[65ch]">{desc}</p>}
      {children}
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 min-w-0">
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub && <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">{sub}</div>}
    </div>
  )
}

export default function WaSafety({ canEdit, showToast }) {
  const [health, setHealth] = useState(null)
  const [form, setForm] = useState(null)
  const [bounds, setBounds] = useState({})
  const [days, setDays] = useState('')
  const [saving, setSaving] = useState(false)
  const [numbers, setNumbers] = useState([])

  const loadHealth = useCallback(() => {
    getWaNumbers().then(setNumbers).catch(() => {})
    return getWaHealth().then(setHealth).catch(() => {})
  }, [])
  useEffect(() => {
    loadHealth()
    getWaLimits().then(r => { setForm(r.limits); setBounds(r.bounds) }).catch(() => {})
    const id = setInterval(loadHealth, 15000)
    return () => clearInterval(id)
  }, [loadHealth])

  const save = async () => {
    setSaving(true)
    try {
      const r = await saveWaLimits(form)
      setForm(r.limits)
      showToast('Sending limits saved.')
      loadHealth()
    } catch (e) { showToast(e.message || 'Failed to save.', true) }
    setSaving(false)
  }

  const applyWarmup = async () => {
    const n = Number(days)
    if (!Number.isFinite(n) || n < 0) { showToast('Enter the number of days.', true); return }
    try { setHealth(await setWarmupDays(n)); setDays(''); showToast('Warm-up updated.') }
    catch (e) { showToast(e.message || 'Failed.', true) }
  }

  if (!health) return null
  const lvl = LEVEL[health.level] || LEVEL.good

  return (
    <div className="space-y-5">
      <Card title={health.phone ? `Number health · +${health.phone}` : 'Number health'} desc="Anti-ban protection for this workspace's WhatsApp number. Problems raise the score; it drops 5 points an hour. At 85 sending stops for 48 hours.">
        {health.alert && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <Warning size={14} weight="fill" className="shrink-0 mt-0.5" />
            <span className="flex-1">{health.alert}</span>
            {canEdit && <button onClick={() => dismissWaAlert().then(setHealth).catch(() => {})} title="Dismiss" className="shrink-0"><X size={12} /></button>}
          </div>
        )}
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck size={22} weight="fill" className={lvl.cls} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-sm font-semibold ${lvl.cls}`}>{lvl.label}</span>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">score {health.score}/100</span>
            </div>
            <div className="mt-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className={`h-full ${lvl.bar}`} style={{ width: `${Math.max(2, health.score)}%` }} />
            </div>
            {health.paused_until && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">Resumes {new Date(health.paused_until).toLocaleString()}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="New chats today" value={`${health.today.new_chats} / ${health.today.new_chat_limit}`} />
          <Stat label="Messages today" value={health.today.sent} />
          <Stat label="Last hour" value={`${health.last_hour} / ${health.hour_limit}`} />
          <Stat label="Reply rate" value={pct(health.reply_rate)} sub={health.reply_sample ? `last ${health.reply_sample} new chats` : 'not enough data'} />
          <Stat label="Delivery rate" value={pct(health.delivery_rate)} sub={health.delivery_sample ? `last ${health.delivery_sample} messages` : 'not enough data'} />
          <Stat label="Warm-up" value={health.warmup.enabled ? (health.warmup.day === null ? 'not started' : `day ${health.warmup.day}`) : 'off'}
            sub={health.warmup.enabled ? `allows ${health.warmup.base_limit} new chats/day` : ''} />
        </div>
        {health.events.length > 0 && (
          <details className="mt-4">
            <summary className="text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer">Recent events ({health.events.length})</summary>
            <ul className="mt-2 space-y-1">
              {health.events.map((e, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                  <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-500">{new Date(e.at).toLocaleString()}</span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{EVENT_LABELS[e.type] || e.type}{e.points ? ` +${e.points}` : ''}</span>
                  {e.detail && <span className="truncate">{e.detail}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {numbers.length > 0 && (
        <Card title="Numbers" desc="Every number linked to this workspace. Link one again and its warm-up, health and limits come back; a new number starts its own warm-up.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-zinc-500 dark:text-zinc-400">
                  {['Number', 'Warm-up', 'Health', 'New chats/day', 'Sent', 'Replied', 'Last linked'].map(h => <th key={h} className="py-1.5 pr-4 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="tabular-nums text-zinc-700 dark:text-zinc-300">
                {numbers.map(n => (
                  <tr key={n.phone} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-4 whitespace-nowrap">+{n.phone}{n.is_current && <span className="ml-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">current</span>}</td>
                    <td className="py-1.5 pr-4 whitespace-nowrap">{n.warmup_day === null ? '—' : `day ${n.warmup_day}`}</td>
                    <td className="py-1.5 pr-4">{n.health}/100</td>
                    <td className="py-1.5 pr-4">{n.new_chats_per_day}</td>
                    <td className="py-1.5 pr-4">{n.sent}</td>
                    <td className="py-1.5 pr-4">{n.replied}</td>
                    <td className="py-1.5 pr-4 whitespace-nowrap">{n.last_linked_at ? new Date(n.last_linked_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canEdit && (
        <Card title="Number age" desc="A new number gets no new chats for 24 h, then 5, 8, 10… up to the daily cap over about two weeks. If this number has been used for outreach before, tell LeadDesk how long ago it started.">
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" min="0" value={days} onChange={e => setDays(e.target.value)} placeholder="Days" className={`${inputCls} w-28`} />
            <button onClick={applyWarmup} className="inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              Number has been in use for this many days
            </button>
          </div>
        </Card>
      )}

      {form && (
        <Card title="Sending limits" desc="Defaults follow community experience for unofficial WhatsApp clients. Values above the safe maximum are capped.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map(([k, label, hint]) => (
              <label key={k} className="block">
                <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                  {label}{bounds[k] ? <span className="text-zinc-400 dark:text-zinc-500"> · max {bounds[k][1]}</span> : null}
                </span>
                <input type="number" value={form[k]} disabled={!canEdit} onChange={e => setForm({ ...form, [k]: e.target.value })} className={`${inputCls} disabled:opacity-60`} />
                {hint && <span className="block text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">{hint}</span>}
              </label>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {TOGGLES.map(([k, label]) => (
              <label key={k} className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={!!form[k]} disabled={!canEdit} onChange={e => setForm({ ...form, [k]: e.target.checked })} className="accent-emerald-500 mt-0.5" />
                {label}
              </label>
            ))}
          </div>
          <label className="block mt-4">
            <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Opt-out line (added to first messages)</span>
            <input value={form.optOutLine} disabled={!canEdit} dir="auto" onChange={e => setForm({ ...form, optOutLine: e.target.value })} className={`${inputCls} disabled:opacity-60`} />
          </label>
          {canEdit && (
            <button onClick={save} disabled={saving}
              className="mt-4 inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 active:scale-[0.98]">
              {saving ? 'Saving…' : 'Save limits'}
            </button>
          )}
        </Card>
      )}
    </div>
  )
}
