import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Trash } from '@phosphor-icons/react'
import { getCompany, createCompany, updateCompany, deleteCompany, getProjectMembers, getCustomFields } from '../api'
import CustomFieldInputs from './CustomFieldInputs'

const input = 'w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors'
const label = 'block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5'
const TEXT = [
  ['name', 'Name', 'sm:col-span-2'], ['website', 'Website'], ['domain', 'Domain'], ['industry', 'Industry'], ['size', 'Size'],
  ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address', 'sm:col-span-2'], ['city', 'City'], ['country', 'Country'],
]

export default function CompanyModal({ companyId, close, showToast, onSaved, canDelete = true }) {
  const [form, setForm] = useState({ name: '', website: '', domain: '', industry: '', size: '', phone: '', email: '', address: '', city: '', country: '', notes: '' })
  const [ownerId, setOwnerId] = useState('')
  const [custom, setCustom] = useState({})
  const [members, setMembers] = useState([])
  const [fieldDefs, setFieldDefs] = useState([])
  const [loading, setLoading] = useState(!!companyId)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getProjectMembers().then(setMembers).catch(() => {})
    getCustomFields('company').then(setFieldDefs).catch(() => {})
    if (!companyId) return
    getCompany(companyId).then(c => {
      setForm(Object.fromEntries(Object.keys(form).map(k => [k, c[k] || ''])))
      setOwnerId(c.owner_id || ''); setCustom(c.custom || {})
    }).catch(() => { showToast('Could not load company.', true); close() })
      .finally(() => setLoading(false))
  }, [companyId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { showToast('Company name is required.', true); return }
    setBusy(true)
    const data = { ...form, name: form.name.trim(), custom }
    if (ownerId || companyId) data.owner_id = ownerId || null
    try {
      const saved = companyId ? await updateCompany(companyId, data) : await createCompany(data)
      showToast(companyId ? 'Company updated.' : 'Company created.')
      onSaved?.(saved)
      close()
    } catch (err) { showToast(err.message || 'Failed to save company.', true) }
    finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm(`Delete "${form.name}"? Its contacts and deals are kept, just unlinked.`)) return
    try {
      await deleteCompany(companyId)
      showToast('Company deleted.')
      onSaved?.(null)
      close()
    } catch (err) { showToast(err.message || 'Failed to delete.', true) }
  }

  if (loading) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={close}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 250, damping: 25 }}
        className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[88vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 h-14 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{companyId ? 'Edit company' : 'New company'}</h2>
          <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            {TEXT.map(([k, l, cls]) => (
              <div key={k} className={cls || ''}>
                <label className={label}>{l}</label>
                <input autoFocus={k === 'name'} value={form[k]} onChange={e => set(k, e.target.value)} className={input}
                  placeholder={k === 'website' ? 'https://…' : k === 'size' ? 'e.g. 11–50' : ''} />
              </div>
            ))}
            <div>
              <label className={label}>Owner</label>
              <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className={input}>
                <option value="">{companyId ? 'Nobody' : 'Me (default)'}</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
              </select>
            </div>
            <CustomFieldInputs defs={fieldDefs} values={custom} members={members} onChange={(k, v) => setCustom(c => ({ ...c, [k]: v }))} />
            <div className="sm:col-span-2">
              <label className={label}>Notes</label>
              <textarea rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} className={`${input} h-auto py-2 resize-y`} />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-6 h-16 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          <div>
            {companyId && canDelete && (
              <button onClick={remove} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
                <Trash size={13} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className="px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50">Cancel</button>
            <button onClick={save} disabled={busy} className="px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.98] disabled:opacity-50">
              {busy ? 'Saving…' : companyId ? 'Save changes' : 'Create company'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
