import { useState } from 'react'
import { motion } from 'framer-motion'
import { Tag, Signpost } from '@phosphor-icons/react'
import TagsView from './Tags'
import Stages from './Stages'

const TABS = [
  { id: 'tags', label: 'Tags', icon: Tag },
  { id: 'stages', label: 'Pipeline Stages', icon: Signpost },
]

export default function Manage(props) {
  const [activeTab, setActiveTab] = useState('tags')

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Manage</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Organize your pipeline with tags and stages.</p>
      </div>

      <div className="flex gap-1 mb-6 bg-zinc-100 dark:bg-zinc-900 rounded-xl p-1 border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-700'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {activeTab === 'tags' && <TagsView {...props} />}
        {activeTab === 'stages' && <Stages {...props} />}
      </motion.div>
    </div>
  )
}
