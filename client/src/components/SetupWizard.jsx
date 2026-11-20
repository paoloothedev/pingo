import { useState } from 'react'
import { ArrowRight, ArrowLeft, Warning, CheckCircle } from '@phosphor-icons/react'
import { completeSetup } from '../api'

const input = 'w-full h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500'
const label = 'block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5'
const primary = 'inline-flex items-center gap-1.5 px-4 h-10 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const STEPS = ['Your account', 'Your workspace', 'Before you send']

function guessTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

function timezones(current) {
  let list = []
  try { list = Intl.supportedValuesOf('timeZone') } catch {}
  return list.includes(current) ? list : [current, ...list]
}

// First run: creates the admin account and the first workspace. Replaces the old default admin/admin login.
export default function SetupWizard({ onDone }) {
  const [step, setStep] = useState(0)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [timezone, setTimezone] = useState(guessTimezone)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const accountError = !username.trim() ? 'Choose a username.'
    : password.length < 8 ? 'Use at least 8 characters for the password.'
    : password !== confirm ? "The passwords don't match." : ''

  const finish = async () => {
    setSaving(true)
    setError('')
    try {
      onDone(await completeSetup({ username: username.trim(), password, workspace: workspace.trim(), countryCode, timezone }))
    } catch (e) { setError(e.message || 'Setup failed.'); setSaving(false) }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-6">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.2)]" />
          <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 tracking-tight">Set up LeadDesk</span>
        </div>
        <div className="flex gap-1.5 mb-5">
          {STEPS.map((s, i) => <div key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'}`} />)}
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">Step {step + 1} of {STEPS.length}</p>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">{STEPS[step]}</h1>

          {step === 0 && (
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!accountError) setStep(1) }}>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">This is the admin account, with full access to everything.</p>
              <div><label className={label} htmlFor="s-user">Username</label><input id="s-user" className={input} value={username} autoFocus autoComplete="username" onChange={e => setUsername(e.target.value)} /></div>
              <div><label className={label} htmlFor="s-pass">Password</label><input id="s-pass" type="password" className={input} value={password} autoComplete="new-password" placeholder="At least 8 characters" onChange={e => setPassword(e.target.value)} /></div>
              <div><label className={label} htmlFor="s-conf">Repeat password</label><input id="s-conf" type="password" className={input} value={confirm} autoComplete="new-password" onChange={e => setConfirm(e.target.value)} /></div>
              {confirm && accountError && <p className="text-xs text-amber-600 dark:text-amber-400">{accountError}</p>}
              <div className="flex justify-end"><button type="submit" disabled={!!accountError} className={primary}>Continue <ArrowRight size={14} /></button></div>
            </form>
          )}

          {step === 1 && (
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (workspace.trim()) setStep(2) }}>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">A workspace holds one business's contacts, campaigns and WhatsApp number. You can add more later.</p>
              <div><label className={label} htmlFor="s-ws">Workspace name</label><input id="s-ws" className={input} value={workspace} autoFocus placeholder="e.g. My Company" onChange={e => setWorkspace(e.target.value)} /></div>
              <div>
                <label className={label} htmlFor="s-cc">Country calling code</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-500">+</span>
                  <input id="s-cc" className={`${input} w-24`} value={countryCode} inputMode="numeric" placeholder="20" onChange={e => setCountryCode(e.target.value.replace(/\D/g, ''))} />
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">Added to imported numbers that don't have one, so WhatsApp can reach them.</p>
              </div>
              <div>
                <label className={label} htmlFor="s-tz">Timezone</label>
                <select id="s-tz" className={input} value={timezone} onChange={e => setTimezone(e.target.value)}>
                  {timezones(timezone).map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="flex justify-between">
                <button type="button" onClick={() => setStep(0)} className="inline-flex items-center gap-1.5 px-3 h-10 text-sm text-zinc-500 dark:text-zinc-400"><ArrowLeft size={14} /> Back</button>
                <button type="submit" disabled={!workspace.trim()} className={primary}>Continue <ArrowRight size={14} /></button>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                <Warning size={16} weight="fill" className="shrink-0 mt-0.5" />
                <span>WhatsApp sending uses an unofficial client, which is against WhatsApp's terms. LeadDesk paces messages to lower the risk, but a number can still get banned. Use one you can afford to lose, and only message people you have a good reason to contact.</span>
              </div>
              <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="accent-emerald-500 mt-0.5" />
                I understand this risk
              </label>
              <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <li className="flex gap-2"><CheckCircle size={14} className="text-emerald-500 shrink-0" /> Admin account: {username}</li>
                <li className="flex gap-2"><CheckCircle size={14} className="text-emerald-500 shrink-0" /> Workspace: {workspace}</li>
              </ul>
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              <div className="flex justify-between">
                <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1.5 px-3 h-10 text-sm text-zinc-500 dark:text-zinc-400"><ArrowLeft size={14} /> Back</button>
                <button onClick={finish} disabled={!accepted || saving} className={primary}>{saving ? 'Setting up…' : 'Finish setup'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
