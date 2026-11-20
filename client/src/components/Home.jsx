import { motion } from 'framer-motion'
import { MapPin, Megaphone, Users, EnvelopeSimple, ChartLine, GearSix, ArrowRight, GithubLogo, Heart } from '@phosphor-icons/react'

const FEATURES = [
  { icon: MapPin, title: 'Google Maps Hub', desc: 'Import leads from Google Maps and manage outreach from one place.', color: 'bg-blue-500' },
  { icon: Megaphone, title: 'WhatsApp Campaigns', desc: 'Send bulk WhatsApp messages with delay control and tracking.', color: 'bg-emerald-500' },
  { icon: EnvelopeSimple, title: 'Personal messages', desc: 'Connect Claude to write and schedule a tailored message for every contact.', color: 'bg-amber-500' },
  { icon: Users, title: 'Client Management', desc: 'Convert leads to clients and track your sales pipeline.', color: 'bg-violet-500' },
  { icon: ChartLine, title: 'Analytics Dashboard', desc: 'Track your outreach performance with real-time stats.', color: 'bg-rose-500' },
  { icon: GearSix, title: 'Fully Customizable', desc: 'Stages, tags, permissions — configure it for any business.', color: 'bg-zinc-500' },
]

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } }
}

const item = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } }
}

export default function Home({ goView }) {
  return (
    <div className="max-w-[1200px] mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="text-center py-12 mb-10"
      >
        <div className="flex items-center justify-center gap-3 mb-6">
          <span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.15)]" />
          <span className="font-bold text-2xl text-zinc-900 dark:text-zinc-100 tracking-tight">LeadDesk</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mb-4 max-w-[600px] mx-auto leading-tight">
          Outreach CRM for modern teams
        </h1>
        <p className="text-lg text-zinc-500 dark:text-zinc-400 max-w-[500px] mx-auto mb-8 leading-relaxed">
          Find leads on Google Maps, run safe WhatsApp campaigns and track every reply, all from one dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => goView('dashboard')}
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <ChartLine size={16} weight="bold" />
            Go to Dashboard
          </button>
          <button onClick={() => goView('leads')}
            className="inline-flex items-center gap-2 px-6 h-11 rounded-xl text-sm font-semibold border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors active:scale-[0.98]">
            Browse Leads
            <ArrowRight size={14} />
          </button>
        </div>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10"
      >
        {FEATURES.map(f => {
          const Icon = f.icon
          return (
            <motion.div
              key={f.title}
              variants={item}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50 hover:shadow-md transition-shadow"
            >
              <div className={`w-10 h-10 rounded-lg ${f.color} flex items-center justify-center mb-3`}>
                <Icon size={20} weight="fill" className="text-white" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{f.title}</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">{f.desc}</p>
            </motion.div>
          )
        })}
      </motion.div>

      <div className="text-center pb-8 space-y-4">
        <div className="flex items-center justify-center gap-4">
          <a href="https://github.com/paoloothedev/leaddesk" target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
            <GithubLogo size={14} /> Star on GitHub
          </a>
          <a href="https://paypal.me/youssef.mohamad.abdallah" target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors active:scale-[0.98]">
            <Heart size={14} weight="fill" /> Donate via PayPal
          </a>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Open-source outreach CRM &middot; Self-hosted &middot; No vendor lock-in
          </p>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Built by <a href="https://paoloothedev.com" target="_blank" rel="noopener" className="text-zinc-500 dark:text-zinc-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors underline underline-offset-2">PaoloTheDev</a> &middot; MIT License
          </p>
        </div>
      </div>
    </div>
  )
}
