import { formatDate, formatMoney, toDateInput, fromDateInput } from '../format'

const input = 'w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-1 focus:ring-emerald-500/40 focus:border-emerald-500 transition-colors'
const label = 'block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5'

// Form inputs for a set of custom field definitions. `values` is the entity's `custom` object;
// `onChange(key, value)` receives the new value (null clears). Renders nothing when there are no fields.
export default function CustomFieldInputs({ defs, values, onChange, members = [], currency = 'USD' }) {
  if (!defs?.length) return null
  return (
    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 pt-4 mt-1 border-t border-zinc-100 dark:border-zinc-800">
      {defs.map(d => (
        <div key={d.id} className={d.type === 'textarea' || d.type === 'multiselect' ? 'sm:col-span-2' : ''}>
          <label className={label}>
            {d.label}{d.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <FieldInput def={d} value={values?.[d.key]} onChange={v => onChange(d.key, v)} members={members} currency={currency} />
        </div>
      ))}
    </div>
  )
}

function FieldInput({ def, value, onChange, members, currency }) {
  const v = value ?? ''
  switch (def.type) {
    case 'textarea':
      return <textarea rows={3} value={v} onChange={e => onChange(e.target.value || null)} className={`${input} h-auto py-2 resize-y`} />
    case 'number':
      return <input type="number" step="any" value={v} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} className={input} />
    case 'money':
      return (
        <div className="relative">
          <input type="number" step="any" min="0" value={v} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} className={`${input} pr-12`} />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">{currency}</span>
        </div>
      )
    case 'date':
      return <input type="date" value={toDateInput(value)} onChange={e => onChange(fromDateInput(e.target.value))} className={input} />
    case 'checkbox':
      return (
        <label className="h-9 flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="accent-emerald-500 w-4 h-4" />
          {value ? 'Yes' : 'No'}
        </label>
      )
    case 'select':
      return (
        <select value={v} onChange={e => onChange(e.target.value || null)} className={input}>
          <option value="">—</option>
          {def.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'multiselect': {
      const set = new Set(Array.isArray(value) ? value : [])
      return (
        <div className="flex flex-wrap gap-1.5">
          {def.options.map(o => (
            <button key={o} type="button"
              onClick={() => { const n = new Set(set); n.has(o) ? n.delete(o) : n.add(o); onChange(n.size ? [...n] : null) }}
              className={`px-2.5 h-7 rounded-md text-[11px] font-medium transition-colors ${set.has(o) ? 'bg-emerald-500 text-white' : 'border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'}`}>
              {o}
            </button>
          ))}
        </div>
      )
    }
    case 'user':
      return (
        <select value={v} onChange={e => onChange(e.target.value || null)} className={input}>
          <option value="">—</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
        </select>
      )
    case 'url':
      return <input type="url" value={v} placeholder="https://…" onChange={e => onChange(e.target.value || null)} className={input} />
    case 'email':
      return <input type="email" value={v} onChange={e => onChange(e.target.value || null)} className={input} />
    default:
      return <input type="text" value={v} onChange={e => onChange(e.target.value || null)} className={input} />
  }
}

// Read-only display for tables and detail pages
export function formatCustomValue(def, value, { members = [], currency = 'USD' } = {}) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return ''
  switch (def.type) {
    case 'money': return formatMoney(value, currency)
    case 'number': return Number(value).toLocaleString()
    case 'date': return formatDate(value)
    case 'checkbox': return value ? 'Yes' : 'No'
    case 'multiselect': return value.join(', ')
    case 'user': { const m = members.find(x => x.id === value); return m ? (m.display_name || m.username) : '' }
    default: return String(value)
  }
}
