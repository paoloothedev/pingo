import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { io } from 'socket.io-client'
import { WhatsappLogo, Plugs, PlugsConnected, SignOut, Warning } from '@phosphor-icons/react'
import { getCurrentProjectId } from '../api'
import { canI } from '../permissions'

export default function WhatsAppPage({ showToast }) {
  const [socket, setSocket] = useState(null)
  const [waStatus, setWaStatus] = useState('disconnected')
  const [qr, setQR] = useState(null)
  const [restrictionReason, setRestrictionReason] = useState(null)
  const [lastError, setLastError] = useState(null)
  const [phone, setPhone] = useState(null)
  const socketRef = useRef(null)
  const projectIdRef = useRef(getCurrentProjectId())

  useEffect(() => {
    projectIdRef.current = getCurrentProjectId()
    const pid = projectIdRef.current
    if (!pid) return

    const s = io(window.location.origin, { withCredentials: true })
    socketRef.current = s
    setSocket(s)

    s.on('connect', () => {
      s.emit('join_project', pid)
    })

    s.on('wa_status', (payload) => {
      // Ignore statuses from other projects
      if (payload.projectId && payload.projectId !== pid) return
      setWaStatus(payload.status)
      setQR(payload.qr)
      setRestrictionReason(payload.restrictionReason || null)
      setLastError(payload.lastError || null)
      setPhone(payload.phone || null)
    })

    return () => {
      s.emit('leave_project', pid)
      s.disconnect()
    }
  }, [])

  const pid = () => projectIdRef.current

  const handleInit = async () => { socket?.emit('wa_init', { projectId: pid() }) }
  const handleDisconnect = async () => { socket?.emit('wa_disconnect', { projectId: pid() }) }
  const handleLogout = async () => {
    if (!window.confirm('Log out this WhatsApp number? LeadDesk remembers it: if you link it again later, its warm-up, health and limits come back.')) return
    socket?.emit('wa_logout', { projectId: pid() })
  }

  const statusConfig = {
    disconnected: { dot: 'bg-zinc-400', label: 'Disconnected', icon: Plugs },
    qr_ready: { dot: 'bg-amber-500', label: 'Scan QR Code', icon: WhatsappLogo },
    connecting: { dot: 'bg-blue-500', label: 'Connecting...', icon: WhatsappLogo },
    connected: { dot: 'bg-emerald-500', label: 'Connected', icon: PlugsConnected },
    error: { dot: 'bg-red-500', label: 'Error', icon: Plugs },
    restricted: { dot: 'bg-red-500', label: 'Restricted', icon: Warning },
  }

  const config = statusConfig[waStatus] || statusConfig.disconnected
  const StatusIcon = config.icon

  return (
    <div className="max-w-[1400px] mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-900/50"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Connection</h2>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Each project has its own WhatsApp</span>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <span className={`w-3 h-3 rounded-full ${config.dot}`} />
          <StatusIcon size={18} className="text-zinc-400 dark:text-zinc-500" />
          <span className="text-sm text-zinc-900 dark:text-zinc-100">{config.label}</span>
          {waStatus === 'connected' && phone && <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">+{phone}</span>}
        </div>

        {waStatus === 'restricted' && restrictionReason && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4"
          >
            <div className="flex items-start gap-2.5">
              <Warning size={16} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Account Restricted</p>
                <p className="text-xs text-red-600 dark:text-red-300 leading-relaxed">{restrictionReason}</p>
              </div>
            </div>
          </motion.div>
        )}

        {waStatus === 'disconnected' && lastError && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
            <Warning size={16} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">{lastError}</p>
          </div>
        )}

        {waStatus === 'qr_ready' && qr && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 inline-block mb-4"
          >
            <img src={qr} alt="QR Code" className="w-48 h-48" />
          </motion.div>
        )}

        {canI('whatsapp.control') && waStatus !== 'connected' && waStatus !== 'restricted' && (
          <button onClick={handleInit}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors active:scale-[0.98]">
            <PlugsConnected size={14} weight="fill" />
            {waStatus === 'disconnected' ? 'Connect WhatsApp' : 'Retry'}
          </button>
        )}
        {canI('whatsapp.control') && (waStatus === 'connected' || waStatus === 'restricted') && (
          <div className="flex items-center gap-2">
            <button onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors active:scale-[0.98]">
              <Plugs size={14} />
              Disconnect
            </button>
            <button onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-xs font-medium border border-red-200 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 transition-colors active:scale-[0.98]">
              <SignOut size={14} />
              Logout
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
