import { useState, useEffect } from 'react'
import { Plus, Trash, Pencil, Eye, EyeSlash } from '@phosphor-icons/react'
import { getProjects } from '../api'
import { ROLES, roleOf } from '../roles'

const PERMISSION_GROUPS = [
  { label: 'Dashboard', perms: ['dashboard.view'] },
  { label: 'Leads', perms: ['leads.view', 'leads.edit', 'leads.delete', 'leads.verify', 'leads.import'] },
  { label: 'Deals', perms: ['deals.view', 'deals.edit', 'deals.delete'] },
  { label: 'Campaigns', perms: ['campaigns.view', 'campaigns.edit', 'campaigns.delete', 'campaigns.send'] },
  { label: 'Templates', perms: ['templates.view', 'templates.edit'] },
  { label: 'Stages', perms: ['stages.view', 'stages.edit'] },
  { label: 'Tags', perms: ['tags.view', 'tags.edit'] },
  { label: 'Broadcast Jobs', perms: ['broadcast.view', 'broadcast.manage'] },
  { label: 'WhatsApp', perms: ['whatsapp.view', 'whatsapp.control'] },
  { label: 'Settings', perms: ['settings.view', 'settings.edit'] },
  { label: 'Accounts', perms: ['accounts.view', 'accounts.manage'] },
  { label: 'Workspaces', perms: ['projects.manage'] },
]

export default function Accounts({ showToast, refresh }) {
  const [accounts, setAccounts] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formUser, setFormUser] = useState('')
  const [formPass, setFormPass] = useState('')
  const [formName, setFormName] = useState('')
  const [formPerms, setFormPerms] = useState(ROLES[1].perms)
  const [formProjects, setFormProjects] = useState([])
  const [projects, setProjects] = useState([])
  const [showPass, setShowPass] = useState(false)

  const loadAccounts = async () => {
    try {
      const res = await fetch('/api/accounts', { credentials: 'include' })
      const data = await res.json()
      if (res.ok) setAccounts(data)
    } catch {}
  }

  useEffect(() => {
    loadAccounts()
    getProjects().then(setProjects).catch(() => {})
  }, [])

  const resetForm = () => {
    setFormUser(''); setFormPass(''); setFormName(''); setFormPerms(ROLES[1].perms); setFormProjects([]); setEditingId(null); setShowForm(false); setShowPass(false)
  }

  const togglePerm = (p) => {
    setFormPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  const toggleProject = (id) => {
    setFormProjects(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleGroup = (groupPerms) => {
    const allIn = groupPerms.every(p => formPerms.includes(p))
    if (allIn) {
      setFormPerms(prev => prev.filter(p => !groupPerms.includes(p)))
    } else {
      setFormPerms(prev => [...new Set([...prev, ...groupPerms])])
    }
  }

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: formUser, password: formPass, display_name: formName, permissions: formPerms, projectIds: formProjects }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast('Account created.')
      resetForm()
      loadAccounts()
    } catch (err) { showToast(err.message, true) }
  }

  const handleUpdate = async () => {
    try {
      const body = { display_name: formName, permissions: formPerms, projectIds: formProjects }
      if (formPass) body.password = formPass
      const res = await fetch(`/api/accounts/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast('Account updated.')
      resetForm()
      loadAccounts()
    } catch (err) { showToast(err.message, true) }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete account "${name}"?`)) return
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast('Account deleted.')
      loadAccounts()
    } catch (err) { showToast(err.message, true) }
  }

  const startEdit = (a) => {
    setEditingId(a.id)
    setFormUser(a.username)
    setFormPass('')
    setFormName(a.display_name)
    setFormPerms(a.permissions || [])
    setFormProjects(a.projectIds || [])
    setShowForm(true)
    setShowPass(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Accounts</h2>
        {!showForm && (
          <button onClick={() => { resetForm(); setShowForm(true) }}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <Plus size={12} weight="bold" /> Add Account
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50">
          <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            {editingId ? 'Edit Account' : 'New User Account'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Username</label>
              <input type="text" value={formUser} onChange={e => setFormUser(e.target.value)} disabled={!!editingId}
                className="w-full h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Password</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={formPass} onChange={e => setFormPass(e.target.value)}
                  placeholder={editingId ? 'Leave blank to keep' : 'At least 8 characters'}
                  className="w-full h-8 px-2.5 pr-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                  {showPass ? <EyeSlash size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">Display Name</label>
              <input type="text" value={formName} onChange={e => setFormName(e.target.value)}
                className="w-full h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              Workspaces <span className="font-normal text-zinc-400 dark:text-zinc-500">— pick one or more; this account can't see any others</span>
            </label>
            {projects.length === 0 ? (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">No workspaces yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {projects.map(p => {
                  const on = formProjects.includes(p.id)
                  return (
                    <button key={p.id} type="button" onClick={() => toggleProject(p.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-medium transition-colors ${
                        on ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                      }`}>
                      <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                      {p.icon} {p.name}
                    </button>
                  )
                })}
              </div>
            )}
            {formProjects.length === 0 && projects.length > 0 && (
              <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400">Pick at least one workspace, otherwise this account can log in but sees nothing.</p>
            )}
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-2">Role</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
              {ROLES.map(r => {
                const on = roleOf(formPerms)?.id === r.id
                return (
                  <button key={r.id} type="button" onClick={() => setFormPerms(r.perms)}
                    className={`text-left rounded-lg border p-2.5 transition-colors ${on ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                    <span className="block text-xs font-medium text-zinc-900 dark:text-zinc-100">{r.label}</span>
                    <span className="block text-[10px] leading-snug text-zinc-500 dark:text-zinc-400 mt-0.5">{r.desc}</span>
                  </button>
                )
              })}
            </div>
            <details open={!roleOf(formPerms)}>
              <summary className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer mb-2">
                Customize permissions{roleOf(formPerms) ? '' : ' (custom)'}
              </summary>
            <div className="space-y-2.5">
              {PERMISSION_GROUPS.map(group => {
                const allIn = group.perms.every(p => formPerms.includes(p))
                const someIn = group.perms.some(p => formPerms.includes(p))
                return (
                  <div key={group.label}>
                    <button onClick={() => toggleGroup(group.perms)}
                      className={`inline-flex items-center px-2 h-6 rounded text-[10px] font-medium transition-colors mr-2 ${
                        allIn ? 'bg-emerald-500 text-white' : someIn ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
                      }`}>
                      {group.label}
                    </button>
                    {group.perms.map(p => (
                      <button key={p} onClick={() => togglePerm(p)}
                        className={`inline-flex items-center px-2 h-6 rounded text-[10px] font-medium transition-colors mr-1 mb-1 ${
                          formPerms.includes(p) ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        }`}>
                        {p.split('.')[1]}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
            </details>
          </div>

          <div className="flex gap-2">
            <button onClick={editingId ? handleUpdate : handleCreate}
              disabled={!formUser || (!editingId && !formPass) || (formPass && formPass.length < 8) || (!editingId && !formProjects.length && projects.length > 0)}
              className="inline-flex items-center px-4 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed">
              {editingId ? 'Save Changes' : 'Create Account'}
            </button>
            <button onClick={resetForm}
              className="inline-flex items-center px-4 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                <th className="text-left py-2.5 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">User</th>
                <th className="text-left py-2.5 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Role</th>
                <th className="text-left py-2.5 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Workspaces</th>
                <th className="text-left py-2.5 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Permissions</th>
                <th className="text-left py-2.5 px-4 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                  <td className="py-2.5 px-4">
                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{a.display_name || a.username}</span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-1.5">@{a.username}</span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-medium ${
                      a.role === 'admin' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}>
                      {a.role === 'admin' ? 'Admin' : roleOf(a.permissions)?.label || 'Custom'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      {a.role === 'admin' ? 'All' : (a.projectIds || []).map(id => projects.find(p => p.id === id)?.name).filter(Boolean).join(', ') || '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex flex-wrap gap-0.5 max-w-[300px]">
                      {a.role === 'admin' ? (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">All permissions</span>
                      ) : a.permissions.length === 0 ? (
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">No permissions</span>
                      ) : a.permissions.slice(0, 6).map(p => (
                        <span key={p} className="inline-flex items-center px-1.5 h-4 rounded text-[9px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">{p}</span>
                      ))}
                      {a.permissions.length > 6 && (
                        <span className="text-[9px] text-zinc-400">+{a.permissions.length - 6} more</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex gap-1">
                      {a.role !== 'admin' && (
                        <>
                          <button onClick={() => startEdit(a)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
                            <Pencil size={10} />
                          </button>
                          <button onClick={() => handleDelete(a.id, a.username)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded border border-red-200 bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors">
                            <Trash size={10} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
