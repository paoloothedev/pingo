import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  ChartLine, Users, Skull, Megaphone, GearSix, Upload,
  SidebarSimple, SunDim, MoonStars, DotsThree, SignOut, UserCircle, EnvelopeSimple, MagnifyingGlass, GithubLogo, SquaresFour, Handshake, Buildings, Compass, ChatCircleText, PaperclipHorizontal } from '@phosphor-icons/react'
import { can } from '../permissions'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: ChartLine, perms: ['dashboard.view', 'leads.view'] },
  { id: 'inbox', label: 'Inbox', icon: ChatCircleText, perms: ['whatsapp.view'] },
  { id: 'leads', label: 'Contacts', icon: Users, perms: ['leads.view'] },
  { id: 'companies', label: 'Companies', icon: Buildings, perms: ['leads.view'] },
  { id: 'deals', label: 'Deals', icon: Handshake, perms: ['deals.view'] },
  { id: 'scraper', label: 'Maps Scraper', icon: MagnifyingGlass, perms: ['leads.import'] },
  { id: 'campaigns', label: 'Campaigns', icon: Megaphone, perms: ['campaigns.view'] },
  { id: 'dead', label: 'Dead List', icon: Skull, perms: ['leads.view'] },
  { id: 'files', label: 'Files', icon: PaperclipHorizontal, perms: ['leads.view'] },
  { id: 'settings', label: 'Settings', icon: GearSix, perms: [] },
  { id: 'import', label: 'Import', icon: Upload, perms: ['leads.import'] },
]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.1 }
  }
}

const itemVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 120, damping: 20 } }
}

export default function Sidebar({ view, goView, stats, darkMode, toggleDarkMode, sidebarCollapsed, toggleSidebar, mobileMenuOpen, closeMobileMenu, user, onLogout, project, openSearch, showCompanies, openTour, unreadChats = 0 }) {
  const navigate = useNavigate()

  const goProjects = () => {
    closeMobileMenu()
    navigate('/')
  }

  return (
    <>
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden" onClick={closeMobileMenu} />
      )}
      <motion.aside
        initial={false}
        animate={{
          width: sidebarCollapsed ? 64 : 240,
        }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        className={`fixed left-0 top-0 z-50 flex flex-col bg-zinc-900 border-r border-zinc-800 min-h-[100dvh] overflow-hidden ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        {/* Project switcher / brand */}
        <button
          onClick={goProjects}
          className={`flex items-center h-14 border-b border-zinc-800 shrink-0 transition-colors hover:bg-zinc-800/50 ${
            sidebarCollapsed ? 'justify-center px-0' : 'px-5 gap-3'
          }`}
          title="All workspaces"
        >
          {project ? (
            <>
              <span
                className="w-6 h-6 rounded-md flex items-center justify-center text-sm shrink-0"
                style={{ background: (project.color || '#10b981') + '33' }}
              >
                {project.icon || '📁'}
              </span>
              {!sidebarCollapsed && (
                <span className="flex flex-col items-start min-w-0">
                  <span className="font-semibold text-xs text-zinc-100 tracking-tight truncate max-w-[140px]">{project.name}</span>
                  <span className="text-[9px] text-zinc-500 flex items-center gap-1">
                    <SquaresFour size={9} /> All workspaces
                  </span>
                </span>
              )}
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.2)]" />
              {!sidebarCollapsed && <span className="font-semibold text-sm text-zinc-100 tracking-tight">LeadDesk</span>}
            </>
          )}
        </button>

        {openSearch && (
          <div className="px-2 pt-3">
            <button onClick={openSearch} title="Search (Ctrl+K)"
              className={`w-full flex items-center h-9 rounded-lg text-sm text-zinc-400 bg-zinc-800/60 hover:bg-zinc-800 hover:text-zinc-200 transition-colors ${sidebarCollapsed ? 'justify-center px-0' : 'px-3 gap-2.5'}`}>
              <MagnifyingGlass size={16} className="shrink-0" />
              {!sidebarCollapsed && <><span className="flex-1 text-left text-xs">Search…</span><kbd className="text-[10px] text-zinc-500 border border-zinc-700 rounded px-1">Ctrl K</kbd></>}
            </button>
          </div>
        )}

        <motion.nav
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto"
        >
          {NAV_ITEMS.filter(item => (showCompanies || item.id !== 'companies')).filter(item => can(user, ...item.perms)).map(item => {
            const Icon = item.icon
            const isActive = view === item.id
            return (
              <motion.button
                key={item.id}
                data-tour={item.id}
                variants={itemVariants}
                onClick={() => { goView(item.id); closeMobileMenu() }}
                whileTap={{ scale: 0.97 }}
                className={`w-full flex items-center rounded-lg text-sm font-medium transition-colors relative ${
                  sidebarCollapsed ? 'justify-center h-10' : 'px-3 h-9 gap-2.5'
                } ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon size={18} weight={isActive ? 'fill' : 'regular'} className="shrink-0" />
                {!sidebarCollapsed && <span className="truncate text-xs">{item.label}</span>}
                {item.id === 'inbox' && unreadChats > 0 && (
                  <span className={`min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-semibold flex items-center justify-center ${sidebarCollapsed ? 'absolute top-0.5 right-1.5' : 'ml-auto'}`}>{unreadChats > 99 ? '99+' : unreadChats}</span>
                )}
                {isActive && !sidebarCollapsed && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-emerald-400"
                    transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                  />
                )}
              </motion.button>
            )
          })}
        </motion.nav>

        <div className={`px-2 pb-1 ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={toggleSidebar}
            className={`flex items-center rounded-lg transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 ${
              sidebarCollapsed ? 'justify-center w-10 h-10' : 'w-full px-3 h-9 gap-2.5 text-xs font-medium'
            }`}
            title="Toggle sidebar"
          >
            <SidebarSimple size={16} className="shrink-0" />
            {!sidebarCollapsed && <span>Collapse</span>}
          </button>
        </div>
        <div className={`px-2 pb-3 ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={toggleDarkMode}
            className={`flex items-center rounded-lg transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 ${
              sidebarCollapsed ? 'justify-center w-10 h-10' : 'w-full px-3 h-9 gap-2.5 text-xs font-medium'
            }`}
            title={darkMode ? 'Light mode' : 'Dark mode'}
          >
            {darkMode ? <SunDim size={16} className="shrink-0" /> : <MoonStars size={16} className="shrink-0" />}
            {!sidebarCollapsed && <span>{darkMode ? 'Light mode' : 'Dark mode'}</span>}
          </button>
        </div>

        {user && (
          <div className={`px-2 pb-3 border-t border-zinc-800 pt-3 ${sidebarCollapsed ? 'flex justify-center' : ''}`}>
            {!sidebarCollapsed && (
              <div className="px-1 mb-2">
                <div className="text-[11px] font-medium text-zinc-200 truncate">{user.display_name || user.username}</div>
                <div className="text-[10px] text-zinc-500 capitalize">{user.role}</div>
              </div>
            )}
            <button
              onClick={() => { closeMobileMenu(); openTour() }}
              className={`flex items-center rounded-lg transition-colors text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 ${
                sidebarCollapsed ? 'justify-center w-10 h-10' : 'w-full px-3 h-9 gap-2.5 text-xs font-medium'
              }`}
              title="Take the tour"
            >
              <Compass size={16} className="shrink-0" />
              {!sidebarCollapsed && <span>Take the tour</span>}
            </button>
            <button
              onClick={onLogout}
              className={`flex items-center rounded-lg transition-colors text-zinc-500 hover:text-red-400 hover:bg-zinc-800/50 ${
                sidebarCollapsed ? 'justify-center w-10 h-10' : 'w-full px-3 h-9 gap-2.5 text-xs font-medium'
              }`}
              title="Sign out"
            >
              <SignOut size={16} className="shrink-0" />
              {!sidebarCollapsed && <span>Sign out</span>}
            </button>
          </div>
        )}

        <div className={`px-2 pb-2 border-t border-zinc-800 pt-2 ${sidebarCollapsed ? 'hidden' : ''}`}>
          <div className="px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <a href="https://github.com/paoloothedev/leaddesk" target="_blank" rel="noopener"
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1">
                <GithubLogo size={11} /> v1.0.0
              </a>
            </div>
            <div className="text-[10px] text-zinc-600">
              by <a href="https://paoloothedev.com" target="_blank" rel="noopener" className="text-zinc-500 hover:text-emerald-400 transition-colors">PaoloTheDev</a>
            </div>
          </div>
        </div>


      </motion.aside>
    </>
  )
}
