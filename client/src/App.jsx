import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Navigate, useParams, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Sidebar from './components/Sidebar'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import LeadsTable from './components/LeadsTable'
import DeadList from './components/DeadList'
import Campaigns from './components/Campaigns'
import CampaignPage from './components/CampaignPage'
import BroadcastPage from './components/BroadcastPage'
import Settings from './components/Settings'
import Import from './components/Import'
import LeadModal from './components/LeadModal'
import Toast from './components/Toast'
import ClockWidget from './components/ClockWidget'
import Login from './components/Login'
import GoogleMapsScraper from './components/GoogleMapsScraper'
import ProjectPicker from './components/ProjectPicker'
import DealsBoard from './components/DealsBoard'
import CompaniesList from './components/CompaniesList'
import ContactPage from './components/ContactPage'
import CompanyPage from './components/CompanyPage'
import GlobalSearch from './components/GlobalSearch'
import Duplicates from './components/Duplicates'
import Inbox from './components/Inbox'
import FileLibrary from './components/FileLibrary'
import { setCurrentUser, can } from './permissions'
import { getStats, getStages, getTags, getCampaigns, getSettings, getProjects, setCurrentProjectId, getSetupStatus, getInboxUnread } from './api'
import SetupWizard from './components/SetupWizard'
import Tour, { tourSeen } from './components/Tour'

const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
}

const VIEWS = ['dashboard', 'inbox', 'leads', 'deals', 'companies', 'contact', 'company', 'duplicates', 'scraper', 'campaigns', 'broadcast', 'dead', 'files', 'settings', 'import']
// Record pages highlight their list in the sidebar
const NAV_PARENT = { contact: 'leads', company: 'companies', duplicates: 'leads', broadcast: 'campaigns' }

export default function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true')
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(async data => {
        setUser(data)
        if (!data) setSetupNeeded((await getSetupStatus()).needed)
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => {
      const next = !prev
      localStorage.setItem('darkMode', next)
      document.documentElement.classList.toggle('dark', next)
      return next
    })
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {}
    setUser(null)
    setCurrentProjectId(null)
  }, [])

  setCurrentUser(user)

  if (!authChecked) return null

  if (setupNeeded && !user) {
    return <SetupWizard onDone={(u) => { setSetupNeeded(false); setUser(u); navigate(`/p/${u.project_id}/dashboard`, { replace: true }) }} />
  }

  if (!user) {
    return <Login onLogin={setUser} />
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProjectPicker
            user={user}
            onLogout={handleLogout}
            darkMode={darkMode}
            toggleDarkMode={toggleDarkMode}
          />
        }
      />
      <Route
        path="/p/:projectId/*"
        element={
          <ProjectShell
            user={user}
            onLogout={handleLogout}
            darkMode={darkMode}
            toggleDarkMode={toggleDarkMode}
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function ProjectShell({ user, onLogout, darkMode, toggleDarkMode }) {
  const { projectId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  // Set project id SYNCHRONOUSLY during render — before any child effects fire.
  // (Child useEffects run before parent useEffects, so setting it only in an
  // effect causes a race where the first data fetches go out without the header.)
  setCurrentProjectId(projectId)

  const [refreshId, setRefreshId] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [stats, setStats] = useState(null)
  const [stages, setStages] = useState([])
  const [tags, setTags] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [leadModalOpen, setLeadModalOpen] = useState(false)
  const [editingLeadId, setEditingLeadId] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)
  const [timezone, setTimezone] = useState(() => localStorage.getItem('timezone') || 'UTC')
  const [project, setProject] = useState(null)
  const [projectError, setProjectError] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [showCompanies, setShowCompanies] = useState(false)
  const [touring, setTouring] = useState(false)
  const [unreadChats, setUnreadChats] = useState(0)
  const toastTimer = useRef(null)

  // Derive view from path: /p/:projectId/dashboard → 'dashboard'
  const pathParts = location.pathname.split('/')
  const rawView = pathParts[3] || 'dashboard'
  const view = VIEWS.includes(rawView) ? rawView : 'dashboard'
  const recordId = pathParts[4] || null

  // Verify project exists (header already set during render above)
  useEffect(() => {
    let cancelled = false
    getProjects()
      .then(list => {
        if (cancelled) return
        const p = list.find(x => x.id === projectId)
        if (!p) {
          setProjectError('Workspace not found')
          navigate('/', { replace: true })
        } else {
          setProject(p)
          setProjectError(null)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId, navigate])

  // First visit: show the tour once the menu has rendered
  useEffect(() => {
    if (tourSeen()) return
    const t = setTimeout(() => setTouring(true), 900)
    return () => clearTimeout(t)
  }, [])

  // Unread chats for the menu badge
  const seesInbox = can(user, 'whatsapp.view')
  const loadUnread = useCallback(async () => {
    try { setUnreadChats((await getInboxUnread()).chats) } catch {}
  }, [])
  useEffect(() => {
    if (!seesInbox) return
    loadUnread()
    const t = setInterval(loadUnread, 30000)
    return () => clearInterval(t)
  }, [seesInbox, projectId, loadUnread])

  const showToast = useCallback((msg, warn = false) => {
    setToastMsg({ msg, warn })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200)
  }, [])

  const refresh = useCallback(() => {
    setRefreshId(r => r + 1)
  }, [])

  // Refresh data when project or view changes
  useEffect(() => {
    refresh()
  }, [projectId, refresh])

  const loadStats = useCallback(async () => {
    try {
      const s = await getStats()
      setStats(s)
    } catch {}
  }, [])

  useEffect(() => { loadStats() }, [loadStats, refreshId])

  const loadStages = useCallback(async () => {
    try {
      const s = await getStages()
      setStages(s)
    } catch {}
  }, [])

  const loadTags = useCallback(async () => {
    try {
      const t = await getTags()
      setTags(t)
    } catch {}
  }, [])

  useEffect(() => { loadStages() }, [loadStages, refreshId])
  useEffect(() => { loadTags() }, [loadTags, refreshId])

  const loadCampaigns = useCallback(async () => {
    try {
      const c = await getCampaigns()
      setCampaigns(c)
    } catch {}
  }, [])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns, refreshId])

  useEffect(() => {
    (async () => {
      try {
        const s = await getSettings()
        setShowCompanies(s.show_companies === '1')
        if (s.timezone) {
          setTimezone(s.timezone)
          localStorage.setItem('timezone', s.timezone)
        }
      } catch {}
    })()
  }, [refreshId])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebarCollapsed', next)
      return next
    })
  }, [])

  const openMobileMenu = useCallback(() => setMobileMenuOpen(true), [])
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), [])

  const goView = useCallback((v) => {
    navigate(`/p/${projectId}/${v}`)
    refresh()
  }, [navigate, projectId, refresh])

  // Ctrl/Cmd+K opens global search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSearchPick = useCallback((kind, id) => {
    if (kind === 'contact') goView(`contact/${id}`)
    else if (kind === 'company') goView(`company/${id}`)
    else if (kind === 'deal') goView(`deals?deal=${id}`)
  }, [goView])

  const openLeadModal = useCallback((id) => {
    setEditingLeadId(id)
    setLeadModalOpen(true)
  }, [])

  const closeLeadModal = useCallback(() => {
    setLeadModalOpen(false)
    setEditingLeadId(null)
  }, [])

  const renderView = () => {
    switch (view) {
      case 'dashboard':
        return <Dashboard stats={stats} loadStats={loadStats} refreshId={refreshId} goView={goView} openLeadModal={openLeadModal} />
      case 'inbox':
        return <Inbox chatId={recordId} user={user} showToast={showToast} goView={goView} onUnreadChange={loadUnread} />
      case 'leads':
        return <LeadsTable user={user} stages={stages} tags={tags} campaigns={campaigns} refreshId={refreshId} openLeadModal={openLeadModal} showToast={showToast} refresh={refresh} goView={goView} />
      case 'duplicates':
        return <Duplicates user={user} showToast={showToast} goView={goView} refresh={refresh} />
      case 'companies':
        return <CompaniesList user={user} refreshId={refreshId} showToast={showToast} goView={goView} />
      case 'contact':
        return <ContactPage id={recordId} user={user} stages={stages} refreshId={refreshId} showToast={showToast} goView={goView} openLeadModal={openLeadModal} />
      case 'company':
        return <CompanyPage id={recordId} user={user} refreshId={refreshId} showToast={showToast} goView={goView} />
      case 'deals':
        return <DealsBoard user={user} refreshId={refreshId} showToast={showToast} goView={goView} />
      case 'scraper':
        return <GoogleMapsScraper showToast={showToast} refresh={refresh} goView={goView} />
      case 'dead':
        return <DeadList stages={stages} tags={tags} campaigns={campaigns} refreshId={refreshId} openLeadModal={openLeadModal} showToast={showToast} refresh={refresh} />
      case 'campaigns':
        return recordId
          ? <CampaignPage id={recordId} stages={stages} showToast={showToast} refresh={refresh} goView={goView} />
          : <Campaigns refreshId={refreshId} showToast={showToast} refresh={refresh} goView={goView} />
      case 'broadcast':
        return <BroadcastPage id={recordId} showToast={showToast} goView={goView} />
      case 'settings':
        return <Settings user={user} stages={stages} loadStages={loadStages} tags={tags} loadTags={loadTags} refreshId={refreshId} showToast={showToast} refresh={refresh} />
      case 'files':
        return <FileLibrary showToast={showToast} user={user} />
      case 'import':
        return <Import showToast={showToast} refresh={refresh} goView={goView} />
      default:
        return null
    }
  }

  if (projectError) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">{projectError}</p>
      </div>
    )
  }

  return (
    <div>
      <Sidebar
        view={view === 'company' && !showCompanies ? 'leads' : (NAV_PARENT[view] || view)}
        goView={goView}
        showToast={showToast}
        refresh={refresh}
        stats={stats}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        sidebarCollapsed={sidebarCollapsed}
        toggleSidebar={toggleSidebar}
        mobileMenuOpen={mobileMenuOpen}
        closeMobileMenu={closeMobileMenu}
        user={user}
        onLogout={onLogout}
        project={project}
        openSearch={() => setSearchOpen(true)}
        showCompanies={showCompanies}
        unreadChats={unreadChats}
        openTour={() => setTouring(true)}
      />
      <Layout sidebarCollapsed={sidebarCollapsed} openMobileMenu={openMobileMenu}>
        <ClockWidget timezone={timezone} />
        {user?.default_password && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <span className="flex-1 min-w-[200px]">You are still using the default admin password. Anyone who finds this site can log in.</span>
            <button onClick={() => goView('settings?tab=account')} className="font-medium underline underline-offset-2">Change password</button>
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div
            key={view === 'inbox' ? 'inbox' : view + (recordId || '')}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </Layout>

      {leadModalOpen && (
        <LeadModal leadId={editingLeadId} stages={stages} tags={tags} close={closeLeadModal} showToast={showToast} refresh={refresh} />
      )}

      {touring && <Tour close={() => setTouring(false)} />}
      <GlobalSearch open={searchOpen} close={() => setSearchOpen(false)} onPick={onSearchPick} />
      <Toast msg={toastMsg} />
    </div>
  )
}
