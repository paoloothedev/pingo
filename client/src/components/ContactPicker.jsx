import { useState, useEffect } from 'react'
import { getTags, getStages, getCategories } from '../api'

const input = 'w-full h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors'
const label = 'block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1.5'

export const EMPTY_PICK = { count: 50, category: '', tagId: '', stageId: '', verifiedOnly: false }

export const pickBody = (v) => ({
  count: v.count, verifiedOnly: v.verifiedOnly,
  category: v.category || undefined, tagId: v.tagId || undefined, stageId: v.stageId || undefined,
})

// Which contacts to pull into a campaign.
export default function ContactPicker({ value, onChange }) {
  const [categories, setCategories] = useState([])
  const [tags, setTags] = useState([])
  const [stages, setStages] = useState([])
  const set = (patch) => onChange({ ...value, ...patch })

  useEffect(() => {
    getCategories().then(setCategories).catch(() => {})
    getTags().then(setTags).catch(() => {})
    getStages().then(setStages).catch(() => {})
  }, [])

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className={label}>How many</label>
          <input type="number" min="1" value={value.count} onChange={e => set({ count: parseInt(e.target.value) || 0 })} className={input} />
        </div>
        <div>
          <label className={label}>Business type</label>
          <select value={value.category} onChange={e => set({ category: e.target.value })} className={input}>
            <option value="">Any</option>
            {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Tag</label>
          <select value={value.tagId} onChange={e => set({ tagId: e.target.value })} className={input}>
            <option value="">Any</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name} ({t.lead_count || 0})</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Stage</label>
          <select value={value.stageId} onChange={e => set({ stageId: e.target.value })} className={input}>
            <option value="">Any</option>
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 mt-3 text-xs text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" checked={value.verifiedOnly} onChange={e => set({ verifiedOnly: e.target.checked })} className="accent-emerald-500" />
        Verified only (contacts you reviewed and approved)
      </label>
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">Only uses contacts with a valid phone that aren't in another campaign. Opted-out, "Not WhatsApp" and "MaybeClosed" contacts are left out.</p>
    </div>
  )
}
