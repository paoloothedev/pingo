import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowUpRight, CheckCircle, Circle, UploadSimple, ListPlus, ChartLine, GearSix } from '@phosphor-icons/react'

function ago(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  const days = Math.floor(hrs / 24)
  return days + 'd ago'
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
          <div className="skeleton h-3 w-20 mb-3" />
          <div className="skeleton h-7 w-16" />
        </div>
      ))}
    </div>
  )
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } }
}

export default function Dashboard({ stats, loadStats, refreshId, goView, openLeadModal }) {
  const [dashCards, setDashCards] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard_cards_config')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })
  const [showCustomize, setShowCustomize] = useState(false)

  useEffect(() => {
    loadStats()
  }, [loadStats, refreshId])

  const { generalCards, stageCards, tagCards } = useMemo(() => {
    if (!dashCards) return { generalCards: [], stageCards: [], tagCards: [] }
    const enabled = dashCards.filter(c => c.enabled)
    const general = []
    const stages = []
    const tags = []
    for (const c of enabled) {
      let value = 0
      let resolvedColor = c.color
      if (c.metric.startsWith('stage:')) {
        const stageId = c.metric.replace('stage:', '')
        const stage = stats?.stageBreakdown?.find(s => s.id === stageId)
        value = stage?.count ?? 0
        if (stage?.color) resolvedColor = stage.color
        stages.push({ ...c, value, resolvedColor })
      } else if (c.metric.startsWith('tag:')) {
        const tagId = c.metric.replace('tag:', '')
        const tag = stats?.tagBreakdown?.find(t => t.id === tagId)
        value = tag?.total ?? 0
        if (tag?.color) resolvedColor = tag.color
        tags.push({ ...c, value, resolvedColor })
      } else {
        value = stats?.[c.metric] ?? 0
        general.push({ ...c, value, resolvedColor })
      }
    }
    return { generalCards: general, stageCards: stages, tagCards: tags }
  }, [stats, dashCards])

  if (!stats) return <StatsSkeleton />

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Dashboard</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Your outreach pipeline at a glance.</p>
        </div>
        <button onClick={() => goView('settings')}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
          <GearSix size={12} />
          Customize Cards
        </button>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-8"
      >
        {generalCards.map(s => (
          <motion.div
            key={s.id}
            variants={itemVariants}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900/50 transition-all duration-200"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className={`w-2 h-2 rounded-full ${s.color}`} />
              <span className={`text-[11px] font-medium uppercase tracking-wider ${s.textColor}`}>{s.name}</span>
            </div>
            <div className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {s.value}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {stageCards.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 100, damping: 20 }}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden mb-8"
        >
          <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">By Stage</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
            {stageCards.map(s => (
              <motion.div
                key={s.id}
                variants={itemVariants}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900/50 transition-all duration-200"
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`w-2 h-2 rounded-full`} style={{ background: s.resolvedColor }} />
                  <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: s.resolvedColor }}>{s.name}</span>
                </div>
                <div className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {s.value}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {tagCards.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 100, damping: 20 }}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden mb-8"
        >
          <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">By Tag</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
            {tagCards.map(s => (
              <motion.div
                key={s.id}
                variants={itemVariants}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900/50 transition-all duration-200"
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <span className={`w-2 h-2 rounded-full`} style={{ background: s.resolvedColor }} />
                  <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: s.resolvedColor }}>{s.name}</span>
                </div>
                <div className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {s.value}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 100, damping: 20 }}
          className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Verification Progress</h2>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{stats.verifiedPercent ?? 0}%</span>
          </div>
          <div className="h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden mb-3">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${stats.verifiedPercent || 0}%` }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
              className="h-full rounded-full bg-emerald-500"
            />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{stats.verified ?? 0} verified</span>
            <span className="mx-1.5">&middot;</span>
            {stats.unverified ?? 0} unverified
            <span className="mx-1.5">&middot;</span>
            {stats.total ?? 0} total active
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, type: 'spring', stiffness: 100, damping: 20 }}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50"
        >
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            <button onClick={() => goView('import')}
              className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
              <UploadSimple size={14} weight="bold" />
              Import contacts
            </button>
            <button onClick={() => goView('leads')}
              className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors active:scale-[0.98]">
              <ListPlus size={14} />
              Browse contacts
            </button>
            <button onClick={() => openLeadModal(null)}
              className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors active:scale-[0.98]">
              <Circle size={14} />
              Add contact
            </button>
            <button onClick={() => goView('campaigns')}
              className="w-full flex items-center gap-2.5 px-3 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors active:scale-[0.98]">
              <ChartLine size={14} />
              Campaigns
            </button>
          </div>
        </motion.div>
      </div>

      {stats.outreach && (
        <button onClick={() => goView('campaigns')} className="w-full text-left mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 hover:border-emerald-500/30 transition-colors">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">WhatsApp outreach · last 30 days</h2>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{stats.outreach.running} sending · {stats.outreach.scheduled} scheduled</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[['Sent', stats.outreach.sent, 'text-zinc-900 dark:text-zinc-100'], ['Delivered', stats.outreach.delivered, 'text-sky-600 dark:text-sky-400'], ['Replied', stats.outreach.replied, 'text-emerald-600 dark:text-emerald-400']].map(([label, n, cls]) => (
              <div key={label}>
                <div className={`text-2xl font-semibold tabular-nums ${cls}`}>{n}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
              </div>
            ))}
          </div>
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {stats.recentImports?.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 100, damping: 20 }}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent Imports</h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {stats.recentImports.map(log => (
                <div key={log.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-xs text-zinc-900 dark:text-zinc-100 font-medium truncate">{log.filename || 'CSV import'}</div>
                    <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{ago(log.created_at)}</div>
                  </div>
                  <div className="flex items-center gap-2.5 text-[11px] shrink-0">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{log.added}</span>
                    {log.skipped > 0 && <span className="text-amber-600 dark:text-amber-400">{log.skipped} skip</span>}
                    {log.updated > 0 && <span className="text-blue-600 dark:text-blue-400">{log.updated} upd</span>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {stats.recentActivity?.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, type: 'spring', stiffness: 100, damping: 20 }}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recent Activity</h2>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {stats.recentActivity.slice(0, 10).map(a => (
                <div key={a.id} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-xs text-zinc-900 dark:text-zinc-100 font-medium">{a.entity_name || a.entity_type}</span>
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{a.action}</span>
                  </div>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">{ago(a.created_at)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {stats.tagBreakdown?.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 100, damping: 20 }}
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden mb-8"
        >
          <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tags</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="text-left py-2.5 px-5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Tag</th>
                  <th className="text-left py-2.5 px-5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Total</th>
                  <th className="text-left py-2.5 px-5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Verified</th>
                  <th className="text-left py-2.5 px-5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Unverified</th>
                </tr>
              </thead>
              <tbody>
                {stats.tagBreakdown.map(t => (
                  <tr key={t.id} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors cursor-pointer"
                    onClick={() => goView('leads')}>
                    <td className="py-3 px-5">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium text-white" style={{ background: t.color }}>{t.name}</span>
                    </td>
                    <td className="py-3 px-5 text-xs text-zinc-900 dark:text-zinc-100 font-medium">{t.total || 0}</td>
                    <td className="py-3 px-5 text-xs text-emerald-600 dark:text-emerald-400">{t.verified_count || 0}</td>
                    <td className="py-3 px-5 text-xs text-zinc-500 dark:text-zinc-400">{t.unverified_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  )
}
