import { motion } from 'framer-motion'
import { List } from '@phosphor-icons/react'

export default function Layout({ children, sidebarCollapsed, openMobileMenu }) {
  return (
    <div className="flex min-h-[100dvh] bg-zinc-50 dark:bg-zinc-950">
        <main className={`flex-1 min-w-0 transition-all duration-300 p-4 md:p-6 lg:p-8 pt-12 ${
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-60'
        }`}>
        <button
          onClick={openMobileMenu}
          className="md:hidden flex items-center justify-center w-9 h-9 mb-4 rounded-lg text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          aria-label="Open menu"
        >
          <List size={20} />
        </button>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  )
}
