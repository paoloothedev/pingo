import { useState, useEffect } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { Plus, Trash, ListDashes, Eye, EyeSlash, Check } from '@phosphor-icons/react'

const PRESET_COLORS = [
  { name: 'Emerald', value: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400' },
  { name: 'Blue', value: 'bg-blue-500', textColor: 'text-blue-600 dark:text-blue-400' },
  { name: 'Violet', value: 'bg-violet-500', textColor: 'text-violet-600 dark:text-violet-400' },
  { name: 'Amber', value: 'bg-amber-500', textColor: 'text-amber-600 dark:text-amber-400' },
  { name: 'Rose', value: 'bg-rose-500', textColor: 'text-rose-600 dark:text-rose-400' },
  { name: 'Cyan', value: 'bg-cyan-500', textColor: 'text-cyan-600 dark:text-cyan-400' },
  { name: 'Zinc', value: 'bg-zinc-400', textColor: 'text-zinc-600 dark:text-zinc-400' },
  { name: 'Red', value: 'bg-red-400', textColor: 'text-red-600 dark:text-red-400' },
  { name: 'Teal', value: 'bg-teal-500', textColor: 'text-teal-600 dark:text-teal-400' },
  { name: 'Orange', value: 'bg-orange-500', textColor: 'text-orange-600 dark:text-orange-400' },
]

const DEFAULT_CARDS = [
  { id: '1', name: 'Total Leads', metric: 'total', color: 'bg-zinc-400', textColor: 'text-zinc-600 dark:text-zinc-400', enabled: true },
  { id: '2', name: 'Verified', metric: 'verified', color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400', enabled: true },
  { id: '3', name: 'Ready for Outreach', metric: 'readyForOutreach', color: 'bg-violet-500', textColor: 'text-violet-600 dark:text-violet-400', enabled: true },
  { id: '4', name: 'Qualified contacts', metric: 'activeClients', color: 'bg-blue-500', textColor: 'text-blue-600 dark:text-blue-400', enabled: true },
  { id: '5', name: 'Campaigns', metric: 'totalCampaigns', color: 'bg-amber-500', textColor: 'text-amber-600 dark:text-amber-400', enabled: true },
  { id: '6', name: 'Dead', metric: 'dead', color: 'bg-zinc-300 dark:bg-zinc-600', textColor: 'text-zinc-500 dark:text-zinc-400', enabled: true },
]

function MetricList({ label, items, selected, onSelect }) {
  if (!items?.length) return null
  return (
    <div>
      <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(m => (
          <button key={m.key} onClick={() => onSelect(m.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-medium transition-all ${
              selected === m.key
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
            }`}>
            {m.color && <span className={`w-2 h-2 rounded-full ${m.color}`} />}
            {m.label}
            {selected === m.key && <Check size={10} weight="bold" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function CardRow({ card, editingId, getMetricLabel, setEditingId, handleUpdate, toggleEnabled, handleDelete, pickEditMetric, grouped }) {
  return (
    <Reorder.Item key={card.id} value={card}>
      <div className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 transition-all ${!card.enabled ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-3 p-3">
          <ListDashes size={16} className="text-zinc-300 dark:text-zinc-600 shrink-0 cursor-grab" />
          <span className={`w-3 h-3 rounded-full shrink-0 ${card.color}`} />

          {editingId === card.id ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input type="text" value={card.name} onChange={e => handleUpdate(card.id, { name: e.target.value })}
                className="h-7 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:ring-1 focus:ring-emerald-500/40 w-36" />
              <div className="flex items-center gap-1">
                {PRESET_COLORS.map(c => (
                  <button key={c.value} onClick={() => handleUpdate(card.id, { color: c.value })} title={c.name}
                    className={`w-5 h-5 rounded-full ${c.value} transition-all ${card.color === c.value ? 'ring-2 ring-offset-1 ring-emerald-500 dark:ring-offset-zinc-900' : 'opacity-50 hover:opacity-100'}`} />
                ))}
              </div>
              <button onClick={() => setEditingId(null)}
                className="h-7 px-2 rounded text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shrink-0">
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{card.name}</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-2">{getMetricLabel(card.metric)}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => toggleEnabled(card.id)} title={card.enabled ? 'Hide' : 'Show'}
                  className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                  {card.enabled ? <Eye size={14} /> : <EyeSlash size={14} />}
                </button>
                <button onClick={() => setEditingId(card.id)} title="Edit"
                  className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors text-[11px] font-medium">
                  Edit
                </button>
                <button onClick={() => handleDelete(card.id)} title="Delete"
                  className="inline-flex items-center justify-center w-7 h-7 rounded text-red-400 hover:text-red-600 transition-colors">
                  <Trash size={14} />
                </button>
              </div>
            </>
          )}
        </div>

        {editingId === card.id && (
          <div className="px-3 pb-3 pt-0 space-y-3">
            <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
            <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1">Pick Metric</p>
            <div className="space-y-3">
              <MetricList label="General" items={grouped.stats} selected={card.metric} onSelect={(k) => pickEditMetric(card.id, k)} />
              {grouped.stages.length > 0 && <MetricList label="By Stage" items={grouped.stages} selected={card.metric} onSelect={(k) => pickEditMetric(card.id, k)} />}
              {grouped.tags.length > 0 && <MetricList label="By Tag" items={grouped.tags} selected={card.metric} onSelect={(k) => pickEditMetric(card.id, k)} />}
            </div>
          </div>
        )}
      </div>
    </Reorder.Item>
  )
}

function CardSection({ title, cards, editingId, getMetricLabel, setEditingId, handleUpdate, toggleEnabled, handleDelete, pickEditMetric, grouped, saveAll, cardsRef }) {
  if (!cards.length) return null
  const handleReorder = (newOrder) => {
    const others = cardsRef.current.filter(c => !cards.some(x => x.id === c.id))
    const merged = [...others.slice(0, others.length), ...newOrder]
    saveAll(merged)
  }
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      </div>
      <div className="p-3">
        <Reorder.Group axis="y" values={cards} onReorder={handleReorder} className="space-y-2">
          {cards.map(card => (
            <CardRow key={card.id} card={card} editingId={editingId} getMetricLabel={getMetricLabel}
              setEditingId={setEditingId} handleUpdate={handleUpdate} toggleEnabled={toggleEnabled}
              handleDelete={handleDelete} pickEditMetric={pickEditMetric} grouped={grouped} />
          ))}
        </Reorder.Group>
      </div>
    </div>
  )
}

export default function DashboardConfig({ metrics, showToast }) {
  const [cards, setCards] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [formName, setFormName] = useState('')
  const [formMetric, setFormMetric] = useState('total')
  const [formColor, setFormColor] = useState('bg-emerald-500')

  const cardsRef = { current: cards }

  useEffect(() => {
    const saved = localStorage.getItem('dashboard_cards_config')
    if (saved) {
      try { setCards(JSON.parse(saved)) } catch { setCards(DEFAULT_CARDS) }
    } else {
      setCards(DEFAULT_CARDS)
    }
  }, [])

  const save = (newCards) => {
    setCards(newCards)
    localStorage.setItem('dashboard_cards_config', JSON.stringify(newCards))
  }

  const handleUpdate = (id, updates) => {
    const newCards = cards.map(c => {
      if (c.id !== id) return c
      const updated = { ...c, ...updates }
      if (updates.color) {
        const colorObj = PRESET_COLORS.find(p => p.value === updates.color)
        if (colorObj) updated.textColor = colorObj.textColor
      }
      return updated
    })
    save(newCards)
  }

  const handleDelete = (id) => {
    save(cards.filter(c => c.id !== id))
    showToast('Card removed.')
  }

  const toggleEnabled = (id) => {
    handleUpdate(id, { enabled: !cards.find(c => c.id === id)?.enabled })
  }

  const getMetricLabel = (key) => {
    const m = metrics?.find(m => m.key === key)
    return m?.label || key
  }

  const grouped = {
    stats: (metrics || []).filter(m => m.type === 'stat'),
    stages: (metrics || []).filter(m => m.type === 'stage'),
    tags: (metrics || []).filter(m => m.type === 'tag'),
  }

  const getCardType = (card) => {
    if (card.metric.startsWith('stage:')) return 'stage'
    if (card.metric.startsWith('tag:')) return 'tag'
    return 'stat'
  }

  const cardGroups = {
    general: cards.filter(c => getCardType(c) === 'stat'),
    stages: cards.filter(c => getCardType(c) === 'stage'),
    tags: cards.filter(c => getCardType(c) === 'tag'),
  }

  const pickMetric = (key) => {
    setFormMetric(key)
    const m = metrics?.find(x => x.key === key)
    if (m?.color) setFormColor(m.color)
  }

  const pickEditMetric = (id, key) => {
    const m = metrics?.find(x => x.key === key)
    const updates = { metric: key }
    if (m?.color) updates.color = m.color
    handleUpdate(id, updates)
  }

  const handleAdd = () => {
    if (!formName.trim()) return
    const metric = metrics?.find(m => m.key === formMetric)
    const colorObj = PRESET_COLORS.find(c => c.value === formColor) || PRESET_COLORS[0]
    const newCard = {
      id: Date.now().toString(),
      name: formName.trim(),
      metric: formMetric,
      color: metric?.color || formColor,
      textColor: metric?.color ? (PRESET_COLORS.find(c => c.value === metric.color)?.textColor || colorObj.textColor) : colorObj.textColor,
      enabled: true,
    }
    save([...cards, newCard])
    setFormName(''); setFormMetric('total'); setFormColor('bg-emerald-500'); setShowAdd(false)
    showToast('Card added.')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Drag to reorder. Toggle visibility. Click edit to rename or change metric/color.</p>
        <button onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
          <Plus size={12} weight="bold" /> Add Card
        </button>
      </div>

      {showAdd && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900/50 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="text" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Card name"
              className="h-9 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 outline-none focus:ring-1 focus:ring-emerald-500/40" />
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Color:</span>
              {PRESET_COLORS.map(c => (
                <button key={c.value} onClick={() => setFormColor(c.value)} title={c.name}
                  className={`w-6 h-6 rounded-full ${c.value} transition-all ${formColor === c.value ? 'ring-2 ring-offset-2 ring-emerald-500 dark:ring-offset-zinc-900' : 'opacity-60 hover:opacity-100'}`} />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <MetricList label="General" items={grouped.stats} selected={formMetric} onSelect={pickMetric} />
            {grouped.stages.length > 0 && <MetricList label="By Stage" items={grouped.stages} selected={formMetric} onSelect={pickMetric} />}
            {grouped.tags.length > 0 && <MetricList label="By Tag" items={grouped.tags} selected={formMetric} onSelect={pickMetric} />}
          </div>

          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={!formName.trim()}
              className="inline-flex items-center px-4 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
              Add
            </button>
            <button onClick={() => setShowAdd(false)}
              className="inline-flex items-center px-4 h-8 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      <CardSection title="General" cards={cardGroups.general} editingId={editingId} getMetricLabel={getMetricLabel}
        setEditingId={setEditingId} handleUpdate={handleUpdate} toggleEnabled={toggleEnabled}
        handleDelete={handleDelete} pickEditMetric={pickEditMetric} grouped={grouped} saveAll={save} cardsRef={cardsRef} />

      {cardGroups.stages.length > 0 && (
        <CardSection title="By Stage" cards={cardGroups.stages} editingId={editingId} getMetricLabel={getMetricLabel}
          setEditingId={setEditingId} handleUpdate={handleUpdate} toggleEnabled={toggleEnabled}
          handleDelete={handleDelete} pickEditMetric={pickEditMetric} grouped={grouped} saveAll={save} cardsRef={cardsRef} />
      )}

      {cardGroups.tags.length > 0 && (
        <CardSection title="By Tag" cards={cardGroups.tags} editingId={editingId} getMetricLabel={getMetricLabel}
          setEditingId={setEditingId} handleUpdate={handleUpdate} toggleEnabled={toggleEnabled}
          handleDelete={handleDelete} pickEditMetric={pickEditMetric} grouped={grouped} saveAll={save} cardsRef={cardsRef} />
      )}

      {cards.length === 0 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center py-8">No cards configured. Add one above.</p>
      )}
    </div>
  )
}
