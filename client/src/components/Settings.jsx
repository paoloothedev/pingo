import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DownloadSimple, UploadSimple, FileCsv, ClipboardText,
  Tag, WhatsappLogo, Signpost, GearSix, UsersThree, Lock, UserCircle, ChartLine, Kanban, SlidersHorizontal, Plugs
} from '@phosphor-icons/react'
import { exportBackup, importBackup, exportCSV, getSettings, saveSetting, getStats } from '../api'
import TagsView from './Tags'
import Stages from './Stages'
import WhatsAppPage from './WhatsAppPage'
import MessageTemplates from './MessageTemplates'
import Accounts from './Accounts'
import DashboardConfig from './DashboardConfig'
import PipelineSettings from './PipelineSettings'
import CustomFieldsSettings from './CustomFieldsSettings'
import ClaudeConnect from './ClaudeConnect'
import WaSafety from './WaSafety'
import { can } from '../permissions'

const TIMEZONES = [
  'UTC',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Europe/Istanbul',
  'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka',
  'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Sydney', 'Pacific/Auckland',
]

const NAV = [
  { id: 'general', label: 'General', icon: GearSix, perms: ['settings.view', 'settings.edit'] },
  { id: 'account', label: 'Account', icon: UserCircle, perms: [] },
  { id: 'dashboard', label: 'Dashboard', icon: ChartLine, perms: ['settings.edit'] },
  { id: 'tags', label: 'Tags', icon: Tag, perms: ['tags.view', 'tags.edit'] },
  { id: 'stages', label: 'Stages', icon: Signpost, perms: ['stages.view', 'stages.edit'] },
  { id: 'pipelines', label: 'Pipelines', icon: Kanban, perms: ['settings.edit'] },
  { id: 'fields', label: 'Custom fields', icon: SlidersHorizontal, perms: ['settings.edit'] },
  { id: 'whatsapp', label: 'WhatsApp', icon: WhatsappLogo, perms: ['whatsapp.view', 'whatsapp.control', 'templates.view', 'templates.edit'] },
  { id: 'team', label: 'Team', icon: UsersThree, perms: ['accounts.view', 'accounts.manage'] },
  { id: 'backup', label: 'Backup', icon: ClipboardText, perms: ['settings.edit'] },
  { id: 'claude', label: 'Claude (MCP)', icon: Plugs, perms: [] },
]

export default function Settings({ user, ...props }) {
  const tabs = NAV.filter(item => can(user, ...item.perms))
  const [activeTab, setActiveTab] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab')
    return tabs.some(t => t.id === wanted) ? wanted : (tabs[0]?.id || 'account')
  })
  const [countryCode, setCountryCode] = useState('')
  const [showCompanies, setShowCompanies] = useState(false)
  const [timezone, setTimezone] = useState('UTC')
  const [metrics, setMetrics] = useState([])
  const jsonInputRef = useRef(null)
  const { showToast, refresh } = props

  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings()
        if (s.country_code) setCountryCode(s.country_code)
        setShowCompanies(s.show_companies === '1')
        if (s.timezone) setTimezone(s.timezone)
      } catch {}
      try {
        const stats = await getStats()
        if (stats.metrics) setMetrics(stats.metrics)
      } catch {}
    })()
  }, [])

  const handleSaveCountryCode = async () => {
    try {
      await saveSetting('country_code', countryCode.replace(/\D/g, ''))
      showToast('Country code saved.')
    } catch { showToast('Failed to save.', true) }
  }

  const handleExport = async () => {
    try {
      const data = await exportBackup()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `leaddesk-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Backup file downloaded.')
    } catch { showToast('Export failed.', true) }
  }

  const handleImportJSON = () => { jsonInputRef.current?.click() }

  const handleJSONFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.leads) { showToast('Invalid backup file.', true); return }
      if (!confirm('This will replace ALL current data with the backup. Continue?')) return
      await importBackup(data)
      showToast('Backup restored successfully.')
      refresh()
    } catch { showToast('Could not read that file.', true) }
    e.target.value = ''
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-5">
            <Section title="Timezone" desc="Set the timezone used for the clock widget and any time-based features.">
              <div className="flex items-center gap-3">
                <select value={timezone} onChange={e => setTimezone(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors">
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>)}
                </select>
                <button onClick={async () => {
                  try { await saveSetting('timezone', timezone); showToast('Timezone saved.') } catch { showToast('Failed.', true) }
                }} className="inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
                  Save
                </button>
              </div>
            </Section>
            <Section title="Menu" desc="Companies are only useful when one business has several contacts. Hiding the page keeps the data, and contacts still show their company.">
              <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                <input type="checkbox" checked={showCompanies} className="accent-emerald-500"
                  onChange={async e => {
                    const on = e.target.checked
                    setShowCompanies(on)
                    try { await saveSetting('show_companies', on ? '1' : '0'); refresh() }
                    catch { setShowCompanies(!on); showToast('Failed to save.', true) }
                  }} />
                Show Companies in the menu
              </label>
            </Section>
            <Section title="Phone Format" desc="Set your country code so imported phone numbers are formatted correctly.">
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-900 dark:text-zinc-100 font-medium">+</span>
                <input type="text" value={countryCode} onChange={e => setCountryCode(e.target.value.replace(/\D/g, ''))}
                  className="w-24 h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors"
                  placeholder="e.g. 20" />
                <button onClick={handleSaveCountryCode}
                  className="inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
                  Save
                </button>
              </div>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2">
                Example: 010 1234 5678 {countryCode ? `becomes +${countryCode} 101 234 5678` : 'will be formatted with your code'} during import.
              </p>
            </Section>
          </div>
        )
      case 'account': return <AccountProfile user={user} showToast={showToast} />
      case 'claude': return <ClaudeConnect showToast={showToast} />
      case 'tags': return <TagsView {...props} />
      case 'stages': return <Stages {...props} />
      case 'fields': return (
        <Section title="Custom fields" desc="Extra fields for contacts, companies and deals. They appear in forms and tables and can be used as filters.">
          <CustomFieldsSettings showToast={showToast} />
        </Section>
      )
      case 'pipelines': return (
        <Section title="Deal pipelines" desc="The stages deals move through. Win % drives the weighted forecast; 'Idle after' flags deals that stop moving.">
          <PipelineSettings showToast={showToast} />
        </Section>
      )
      case 'dashboard': return (
        <Section title="Dashboard Cards" desc="Customize which stat cards appear on the dashboard, their names, colors, and what data they show. Drag to reorder.">
          <DashboardConfig metrics={metrics} showToast={showToast} />
        </Section>
      )
      case 'whatsapp': return (
        <div className="space-y-5">
          <WhatsAppPage {...props} />
          {can(user, 'broadcast.view', 'campaigns.send', 'whatsapp.view') && (
            <WaSafety canEdit={can(user, 'broadcast.manage', 'settings.edit')} showToast={showToast} />
          )}
          <Section title="Message Templates" desc="Create reusable message templates for your WhatsApp campaigns. Use {{name}}, {{phone}}, {{email}} as variables.">
            <MessageTemplates {...props} />
          </Section>
        </div>
      )
      case 'team': return <Accounts {...props} />
      case 'backup': return (
        <Section title="Backup & Export" desc="Export your data as JSON or CSV, or restore a previous backup.">
          <div className="flex flex-wrap gap-3">
            <button onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
              <DownloadSimple size={14} /> Export JSON
            </button>
            <button onClick={exportCSV}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
              <FileCsv size={14} /> Export CSV
            </button>
            <button onClick={handleImportJSON}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
              <UploadSimple size={14} /> Import JSON
            </button>
          </div>
          <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={handleJSONFile} />
        </Section>
      )
      default: return null
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Configure your workspace, integrations, and accounts.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch md:items-start">
        <nav className="w-full md:w-48 shrink-0 md:sticky md:top-4">
          <div className="flex md:block gap-1 md:space-y-0.5 overflow-x-auto pb-1 md:pb-0">
            {tabs.map(item => {
              const Icon = item.icon
              const isActive = activeTab === item.id
              return (
                <button key={item.id} onClick={() => setActiveTab(item.id)}
                  className={`md:w-full shrink-0 whitespace-nowrap flex items-center gap-2.5 px-3 h-9 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                  }`}>
                  <Icon size={15} weight={isActive ? 'fill' : 'regular'} className="shrink-0" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function Section({ title, desc, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{title}</h2>
      {desc && <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed max-w-[65ch]">{desc}</p>}
      {children}
    </div>
  )
}

function AccountProfile({ user, showToast }) {
  const [name, setName] = useState(user?.display_name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [username, setUsername] = useState(user?.username || '')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/accounts/me', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ display_name: name, email, username }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast('Profile updated.')
    } catch (err) { showToast(err.message || 'Failed.', true) }
    setSaving(false)
  }

  const handleChangePassword = async () => {
    if (newPass !== confirmPass) { showToast('Passwords do not match.', true); return }
    if (newPass.length < 4) { showToast('Password too short.', true); return }
    try {
      const res = await fetch(`/api/accounts/${user.id}/change-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ password: newPass }),
      })
      if (!res.ok) throw new Error()
      showToast('Password changed.')
      setNewPass(''); setConfirmPass('')
    } catch { showToast('Failed to change password.', true) }
  }

  return (
    <div className="space-y-5">
      <Section title="Your Profile" desc="Manage your account details.">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Display Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
              className="w-full sm:w-80 h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors" />
          </div>
          <button onClick={handleSaveProfile} disabled={saving}
            className="inline-flex items-center px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </Section>

      <Section title="Change Password" desc="Update your account password.">
        <div className="flex flex-col sm:flex-row items-start gap-3">
          <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="New password"
            className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 w-52" />
          <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Confirm password"
            className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 w-52" />
          <button onClick={handleChangePassword} disabled={!newPass || !confirmPass}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] disabled:opacity-50">
            <Lock size={12} /> Update Password
          </button>
        </div>
      </Section>
    </div>
  )
}
