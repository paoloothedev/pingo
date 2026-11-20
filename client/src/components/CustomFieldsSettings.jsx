import { useState, useEffect } from 'react'
import { Plus, Trash, CaretUp, CaretDown } from '@phosphor-icons/react'
import { getCustomFields, createCustomField, updateCustomField, deleteCustomField } from '../api'

const input = 'h-8 px-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500'
const ENTITIES = [['contact', 'Contacts'], ['company', 'Companies'], ['deal', 'Deals']]
const TYPES = [
  ['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['money', 'Money'], ['date', 'Date'],
  ['select', 'Dropdown'], ['multiselect', 'Multi-select'], ['checkbox', 'Checkbox'], ['url', 'Link'],
  ['email', 'Email'], ['phone', 'Phone'], ['user', 'Team member'],
]
const TYPE_LABEL = Object.fromEntries(TYPES)
const hasOptions = (t) => t === 'select' || t === 'multiselect'
const parseOptions = (s) => s.split(/[\n,]/).map(x => x.trim()).filter(Boolean)

export default function CustomFieldsSettings({ showToast }) {
  const [entity, setEntity] = useState('contact')
  const [fields, setFields] = useState({ contact: [], company: [], deal: [] })
  const [form, setForm] = useState({ label: '', type: 'text', options: '', required: false })

  const load = () => getCustomFields().then(setFields).catch(() => showToast('Could not load fields.', true))
  useEffect(() => { load() }, [])

  const list = fields[entity] || []
  const run = async (fn, ok) => {
    try { await fn(); if (ok) showToast(ok); await load() } catch (err) { showToast(err.message || 'Failed.', true) }
  }

  const add = () => {
    if (!form.label.trim()) { showToast('Give the field a name.', true); return }
    run(async () => {
      await createCustomField({ entity, label: form.label.trim(), type: form.type, required: form.required, options: hasOptions(form.type) ? parseOptions(form.options) : undefined })
      setForm({ label: '', type: 'text', options: '', required: false })
    }, 'Field added.')
  }
  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    run(async () => {
      await updateCustomField(list[i].id, { sort_order: j })
      await updateCustomField(list[j].id, { sort_order: i })
      // normalise the rest so orders stay unique
      await Promise.all(list.map((f, k) => (k !== i && k !== j && f.sort_order !== k) ? updateCustomField(f.id, { sort_order: k }) : null))
    })
  }
  const remove = (f) => {
    if (!confirm(`Delete "${f.label}"? Values stored in this field are deleted too.`)) return
    run(() => deleteCustomField(f.id), 'Field deleted.')
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {ENTITIES.map(([k, l]) => (
          <button key={k} onClick={() => setEntity(k)}
            className={`px-3 h-9 -mb-px text-xs font-medium border-b-2 transition-colors ${entity === k ? 'border-emerald-500 text-zinc-900 dark:text-zinc-100' : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}>
            {l} <span className="text-zinc-400 dark:text-zinc-500">({(fields[k] || []).length})</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 py-2">No custom fields yet. Add fields for anything you track that isn't built in — cuisine type, budget, contract end date…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {list.map((f, i) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <input defaultValue={f.label} key={`${f.id}-${f.label}`}
                onBlur={e => e.target.value.trim() && e.target.value !== f.label && run(() => updateCustomField(f.id, { label: e.target.value.trim() }), 'Renamed.')}
                className={`${input} w-44`} aria-label="Field label" />
              <span className="text-[11px] px-2 h-6 inline-flex items-center rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{TYPE_LABEL[f.type] || f.type}</span>
              <code className="text-[10px] text-zinc-400 dark:text-zinc-500" title="Key used in the API and filters (cf.key=value)">{f.key}</code>
              {hasOptions(f.type) && (
                <input defaultValue={f.options.join(', ')} key={`${f.id}-opts-${f.options.join('|')}`}
                  onBlur={e => { const o = parseOptions(e.target.value); if (o.join('|') !== f.options.join('|')) run(() => updateCustomField(f.id, { options: o }), 'Options saved.') }}
                  className={`${input} flex-1 min-w-[10rem]`} placeholder="Options, comma separated" aria-label="Options" />
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer select-none ml-auto">
                <input type="checkbox" checked={f.required} onChange={e => run(() => updateCustomField(f.id, { required: e.target.checked }))} className="accent-emerald-500 w-3.5 h-3.5" />
                Required
              </label>
              <div className="flex items-center">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="w-6 h-6 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30" aria-label="Move up"><CaretUp size={12} /></button>
                <button onClick={() => move(i, 1)} disabled={i === list.length - 1} className="w-6 h-6 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30" aria-label="Move down"><CaretDown size={12} /></button>
                <button onClick={() => remove(f)} className="w-6 h-6 inline-flex items-center justify-center text-zinc-400 hover:text-red-500" aria-label="Delete field"><Trash size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 flex flex-wrap items-center gap-2">
        <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New field name" className={`${input} w-44`} />
        <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={input} aria-label="Field type">
          {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {hasOptions(form.type) && (
          <input value={form.options} onChange={e => setForm(f => ({ ...f, options: e.target.value }))}
            placeholder="Options, comma separated" className={`${input} flex-1 min-w-[10rem]`} />
        )}
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} className="accent-emerald-500 w-3.5 h-3.5" />
          Required
        </label>
        <button onClick={add} className="inline-flex items-center gap-1 px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 ml-auto">
          <Plus size={12} weight="bold" /> Add field
        </button>
      </div>
    </div>
  )
}
