import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Plus, SignOut, PencilSimple, Trash, Users, Megaphone, UserCircle, MagnifyingGlass, X, Check } from '@phosphor-icons/react'
import { getProjects, createProject, updateProject, deleteProject, setCurrentProjectId } from '../api'

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1']
const ICONS = ['📁', '🏢', '🚀', '💡', '🎯', '🏪', '☕', '🔧', '📊', '🌍', '🍕', '💼', '📞', '✉️', '🛒', '⚙️']

export default function ProjectPicker({ user, onLogout, darkMode, toggleDarkMode }) {
  const navigate = useNavigate()
  // Clear project header while on the picker (no project-scoped calls here)
  setCurrentProjectId(null)
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', color: COLORS[0], icon: ICONS[0] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const perms = user?.permissions || []
  const isAdmin = user?.role === 'admin'
  const canManage = isAdmin || perms.includes('projects.manage')
  const canEdit = canManage || perms.includes('settings.edit')

  const load = async () => {
    try {
      const list = await getProjects()
      // Someone given exactly one workspace has nothing to pick: go straight in
      if (!isAdmin && list.length === 1 && !perms.includes('projects.manage')) {
        navigate(`/p/${list[0].id}/dashboard`, { replace: true })
        return
      }
      setProjects(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], icon: ICONS[Math.floor(Math.random() * ICONS.length)] })
    setError('')
    setModalOpen(true)
  }

  const openEdit = (e, p) => {
    e.stopPropagation()
    setEditing(p)
    setForm({ name: p.name, color: p.color, icon: p.icon })
    setError('')
    setModalOpen(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name required'); return }
    setBusy(true)
    setError('')
    try {
      if (editing) {
        await updateProject(editing.id, form)
      } else {
        const { templateFrom, ...rest } = form
        await createProject(templateFrom ? { ...rest, templateFrom } : rest)
      }
      setModalOpen(false)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (e, p) => {
    e.stopPropagation()
    if (confirmDelete !== p.id) {
      setConfirmDelete(p.id)
      return
    }
    setBusy(true)
    try {
      await deleteProject(p.id)
      setConfirmDelete(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950">
      {/* Top bar */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.2)]" />
            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 tracking-tight">LeadDesk</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleDarkMode}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            <div className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800/60">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{user?.display_name || user?.username}</span>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium text-zinc-500 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <SignOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-8 py-10 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-2xl md:text-3xl font-semibold text-zinc-900 dark:text-zinc-50 tracking-tight mb-1">
            Your workspaces
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
            Pick a workspace — each client business has its own contacts, deals, campaigns and WhatsApp.
          </p>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0,1,2].map(i => (
                <div key={i} className="h-44 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Create new */}
              {canManage && <motion.button
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                onClick={openCreate}
                className="group h-44 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-emerald-400 dark:hover:border-emerald-500/60 flex flex-col items-center justify-center gap-3 text-zinc-400 hover:text-emerald-500 transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 group-hover:bg-emerald-500/10 flex items-center justify-center transition-colors">
                  <Plus size={24} weight="bold" />
                </div>
                <span className="text-xs font-medium">New workspace</span>
              </motion.button>}

              {/* Project cards */}
              <AnimatePresence>
                {projects.map((p, i) => (
                  <motion.button
                    key={p.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ delay: 0.08 + i * 0.05 }}
                    onClick={() => navigate(`/p/${p.id}/dashboard`)}
                    className="group relative h-44 rounded-2xl overflow-hidden text-left border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5"
                  >
                    {/* Color accent bar */}
                    <div className="absolute top-0 left-0 right-0 h-1" style={{ background: p.color }} />

                    <div className="p-5 pt-6 flex flex-col h-full">
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: p.color + '22' }}>
                          {p.icon || '📁'}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {canEdit && <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => openEdit(e, p)}
                            onKeyDown={(e) => e.key === 'Enter' && openEdit(e, p)}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            title="Edit workspace"
                          >
                            <PencilSimple size={13} />
                          </span>}
                          {canManage && <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => handleDelete(e, p)}
                            onKeyDown={(e) => e.key === 'Enter' && handleDelete(e, p)}
                            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                              confirmDelete === p.id
                                ? 'text-red-500 bg-red-50 dark:bg-red-900/30'
                                : 'text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                            title={confirmDelete === p.id ? 'Click again to confirm delete' : 'Delete workspace'}
                          >
                            {confirmDelete === p.id ? <Check size={13} /> : <Trash size={13} />}
                          </span>}
                        </div>
                      </div>

                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-0.5 truncate">{p.name}</h3>

                      <div className="mt-auto flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Users size={12} />
                          {p.leadCount ?? 0} contacts
                        </span>
                        <span className="flex items-center gap-1">
                          <Megaphone size={12} />
                          {p.campaignCount ?? 0} campaigns
                        </span>
                        <span className="flex items-center gap-1">
                          <UserCircle size={12} />
                          {p.clientCount ?? 0} customers
                        </span>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}

          {projects.length === 0 && !loading && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-4">
              {canManage
                ? 'Create your first workspace to get started.'
                : "You haven't been added to any workspace yet — ask your agency admin to give you access."}
            </p>
          )}
        </motion.div>
      </main>

      {/* Create/Edit modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {editing ? 'Edit workspace' : 'New workspace'}
                </h2>
                <button onClick={() => setModalOpen(false)} className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X size={16} />
                </button>
              </div>

              {error && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Pizza Roma (client)"
                    autoFocus
                    className="w-full h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Icon</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ICONS.map(ic => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, icon: ic }))}
                        className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all ${
                          form.icon === ic
                            ? 'bg-zinc-100 dark:bg-zinc-800 ring-2 ring-emerald-500 scale-105'
                            : 'bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, color: c }))}
                        className={`w-7 h-7 rounded-full transition-all ${
                          form.color === c ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 scale-110' : 'hover:scale-110'
                        }`}
                        style={{ background: c, '--tw-ring-color': c }}
                      />
                    ))}
                  </div>
                </div>

                {!editing && projects.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Copy setup from</label>
                    <select value={form.templateFrom || ''} onChange={e => setForm(f => ({ ...f, templateFrom: e.target.value }))}
                      className="w-full h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500">
                      <option value="">Start fresh (default stages & pipeline)</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
                    </select>
                    <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">Copies stages, tags, message templates, pipelines, custom fields and settings — never contacts or deals.</p>
                  </div>
                )}

                {/* Preview */}
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl" style={{ background: form.color + '22' }}>
                    {form.icon}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{form.name || 'Workspace name'}</div>
                    <div className="text-[10px] text-zinc-400">Preview</div>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="flex-1 h-10 rounded-lg text-xs font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !form.name.trim()}
                    className="flex-1 h-10 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busy ? 'Saving...' : editing ? 'Save changes' : 'Create workspace'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
