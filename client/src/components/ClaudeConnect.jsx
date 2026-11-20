import { useState, useEffect } from 'react'
import { Copy, Check, Trash, Plugs, Warning } from '@phosphor-icons/react'
import { getApiTokens, createApiToken, deleteApiToken } from '../api'
import { copyText } from '../clipboard'

const inputCls = 'h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40'

function Section({ title, desc, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{title}</h2>
      {desc && <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed max-w-[65ch]">{desc}</p>}
      {children}
    </div>
  )
}

function CopyField({ value, showToast }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    if (await copyText(value)) { setDone(true); setTimeout(() => setDone(false), 1500) }
    else showToast('Could not copy — select the text and copy it manually.', true)
  }
  return (
    <div className="flex items-start gap-2 min-w-0">
      <code className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-800 dark:text-zinc-200 break-all select-all">{value}</code>
      <button onClick={copy} title="Copy"
        className="shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
        {done ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function ClaudeConnect({ showToast }) {
  const [tokens, setTokens] = useState([])
  const [name, setName] = useState('Claude')
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => getApiTokens().then(setTokens).catch(() => {})
  useEffect(() => { load() }, [])

  const create = async () => {
    setBusy(true)
    try {
      const t = await createApiToken(name.trim() || 'Claude')
      setCreated(t)
      load()
    } catch (e) { showToast(e.message || 'Failed to create the connection.', true) }
    setBusy(false)
  }

  const revoke = async (t) => {
    if (!confirm(`Disconnect "${t.name}"? Anything using this link stops working.`)) return
    try {
      await deleteApiToken(t.id)
      if (created?.id === t.id) setCreated(null)
      load()
      showToast('Connection removed.')
    } catch (e) { showToast(e.message || 'Failed.', true) }
  }

  const url = created ? `${window.location.origin}/mcp/${created.token}` : ''
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname)

  return (
    <div className="space-y-5">
      <Section title="Connect Claude" desc="Let Claude work in LeadDesk for you: read your contacts, write a message for each one, run Google Maps scrapes, update stages, tags, deals and more. Claude acts as you, with your permissions and workspaces.">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Connection name" className={`${inputCls} w-full sm:w-56`} />
          <button onClick={create} disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] disabled:opacity-50">
            <Plugs size={13} /> {busy ? 'Creating…' : 'Create connection link'}
          </button>
        </div>

        {created && (
          <div className="mt-4 space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Copy this link now — it is shown only once.</p>
            <CopyField value={url} showToast={showToast} />
            <div className="text-xs text-zinc-600 dark:text-zinc-300 space-y-2 leading-relaxed">
              <p><span className="font-semibold text-zinc-800 dark:text-zinc-100">claude.ai / Claude app:</span> Settings → Connectors → Add custom connector → paste the link.</p>
              <p className="font-semibold text-zinc-800 dark:text-zinc-100">Claude Code:</p>
              <CopyField value={`claude mcp add --transport http leaddesk ${url}`} showToast={showToast} />
            </div>
            {isLocal && (
              <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <Warning size={14} className="shrink-0 mt-0.5" />
                This address only works on your network. For claude.ai, open LeadDesk from its public address and create the link there.
              </p>
            )}
          </div>
        )}

        <p className="flex gap-1.5 mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          <Warning size={14} className="shrink-0 mt-0.5" />
          Anyone with the link can use LeadDesk as you. Keep it private; if it leaks, remove it below.
        </p>
      </Section>

      <Section title="Active connections">
        {tokens.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">No connections yet.</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {tokens.map(t => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">{t.name}</div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {t.prefix}… · created {new Date(t.created_at).toLocaleDateString()} · {t.last_used_at ? `last used ${new Date(t.last_used_at).toLocaleString()}` : 'never used'}
                  </div>
                </div>
                <button onClick={() => revoke(t)} title="Remove"
                  className="shrink-0 p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors">
                  <Trash size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
