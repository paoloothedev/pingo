import { useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import {
  ArrowLeft, Check, Checks, CheckCircle, ArrowCounterClockwise, ChatCircleText, DownloadSimple, File as FileIcon, MagnifyingGlass, MapPin,
  PaperPlaneRight, Plus, Prohibit, Spinner, UserPlus, Warning, X,
} from '@phosphor-icons/react'
import {
  getChats, getChat, getChatMessages, getChatMedia, markChatRead, sendChatMessage, updateChat, createContactFromChat, openChat,
  getProjectMembers, getLeads, getCurrentProjectId,
} from '../api'
import { can } from '../permissions'

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'unread', label: 'Unread' },
  { id: 'mine', label: 'Mine' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'done', label: 'Done' },
]

const chatTitle = (c) => c.name || (c.phone ? `+${c.phone}` : 'Unknown number')

function listTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const days = (now - d) / 86400000
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const msgTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const dayLabel = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

export default function Inbox({ chatId, user, showToast, goView, onUnreadChange }) {
  const [filter, setFilter] = useState('open')
  const [search, setSearch] = useState('')
  const [chats, setChats] = useState(null)
  const [waStatus, setWaStatus] = useState(null)
  const [members, setMembers] = useState([])
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [changed, setChanged] = useState({ tick: 0, chatId: null })
  const canSend = can(user, 'campaigns.send')
  const listSeq = useRef(0)

  const loadChats = useCallback(async () => {
    const seq = ++listSeq.current
    try {
      const r = await getChats({ filter, q: search.trim(), limit: 100 })
      if (seq === listSeq.current) setChats(r.chats)
    } catch (err) { showToast(err.message, true) }
  }, [filter, search, showToast])

  useEffect(() => {
    const t = setTimeout(loadChats, search ? 250 : 0)
    return () => clearTimeout(t)
  }, [loadChats, search])

  useEffect(() => { getProjectMembers().then(setMembers).catch(() => {}) }, [])

  // Live updates: the server says which chat changed; the list and open thread reload themselves
  const reloadList = useRef(loadChats)
  reloadList.current = loadChats
  useEffect(() => {
    const pid = getCurrentProjectId()
    const s = io(window.location.origin, { withCredentials: true })
    s.on('connect', () => s.emit('join_project', pid))
    s.on('wa_status', (p) => { if (!p.projectId || p.projectId === pid) setWaStatus(p) })
    let timer = null
    s.on('wa_inbox', (p) => {
      if (p.projectId !== pid) return
      setChanged(prev => ({ tick: prev.tick + 1, chatId: p.chatId }))
      clearTimeout(timer)
      timer = setTimeout(() => { reloadList.current(); onUnreadChange?.() }, 300)
    })
    return () => { clearTimeout(timer); s.emit('leave_project', pid); s.disconnect() }
  }, [onUnreadChange])

  const open = (id) => goView(`inbox/${id}`)
  const afterChatChange = () => { loadChats(); onUnreadChange?.() }
  const disconnected = waStatus && !waStatus.ready

  return (
    <div className="-mt-2">
      <div className="flex h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-6rem)] min-h-[420px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {/* Chat list */}
        <aside className={`${chatId ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 shrink-0 md:border-r border-zinc-200 dark:border-zinc-800 min-w-0`}>
          <div className="px-3 pt-3 pb-2 space-y-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Inbox</h1>
              {canSend && (
                <button onClick={() => setNewChatOpen(true)} className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
                  <Plus size={12} weight="bold" /> New chat
                </button>
              )}
            </div>
            <div className="relative">
              <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names, numbers, messages"
                className="w-full h-8 pl-8 pr-2 rounded-lg text-xs border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
            </div>
            <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-0.5">
              {FILTERS.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={`px-2.5 h-6 shrink-0 rounded-full text-[11px] font-medium transition-colors ${
                  filter === f.id ? 'bg-emerald-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}>{f.label}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {chats === null && <div className="p-6 flex justify-center"><Spinner size={18} className="animate-spin text-zinc-400" /></div>}
            {chats?.length === 0 && (
              <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                {search ? 'Nothing matches that search.' : filter === 'open' ? 'No conversations yet. New WhatsApp messages will appear here.' : 'No chats here.'}
              </p>
            )}
            {chats?.map(c => (
              <button key={c.id} onClick={() => open(c.id)} className={`w-full text-left px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800/70 transition-colors ${
                c.id === chatId ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              }`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span dir="auto" className={`truncate text-xs ${c.unread ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'font-medium text-zinc-800 dark:text-zinc-200'}`}>{chatTitle(c)}</span>
                  <span className={`shrink-0 text-[10px] ${c.unread ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-zinc-400'}`}>{listTime(c.last_message_at)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span dir="auto" className="flex-1 min-w-0 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                    {c.last_direction === 'out' && <span className="text-zinc-400">You: </span>}{c.last_text || ' '}
                  </span>
                  {c.assigned_name && <span className="shrink-0 max-w-[70px] truncate px-1.5 h-4 leading-4 rounded text-[9px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">{c.assigned_name}</span>}
                  {c.unread > 0 && <span className="shrink-0 min-w-4 h-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-semibold flex items-center justify-center">{c.unread}</span>}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Conversation */}
        <section className={`${chatId ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
          {chatId
            ? <Thread key={chatId} chatId={chatId} user={user} canSend={canSend} disconnected={disconnected} members={members} changed={changed}
                showToast={showToast} goView={goView} onChatChange={afterChatChange} />
            : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
                <ChatCircleText size={32} className="text-zinc-300 dark:text-zinc-600" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Pick a conversation. Every message in and out is saved here.</p>
              </div>
            )}
        </section>
      </div>
      {newChatOpen && <NewChat close={() => setNewChatOpen(false)} onOpened={(id) => { setNewChatOpen(false); open(id) }} />}
    </div>
  )
}

function Thread({ chatId, user, canSend, disconnected, members, changed, showToast, goView, onChatChange }) {
  const [chat, setChat] = useState(null)
  const [messages, setMessages] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)
  const scroller = useRef(null)
  const stickToBottom = useRef(true)

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([getChat(chatId), getChatMessages(chatId, { limit: 100 })])
      setChat(c)
      // Keep older pages already loaded; the latest page replaces what it covers (statuses change)
      setMessages(prev => {
        if (!prev) return r.messages
        const fresh = new Set(r.messages.map(m => m.id))
        const first = r.messages[0]?.at ?? Infinity
        return [...prev.filter(m => m.at < first && !fresh.has(m.id)), ...r.messages]
      })
      setHasMore(prev => prev || r.has_more)
      if (c.unread > 0) { await markChatRead(chatId); onChatChange() }
    } catch (err) { showToast(err.message, true); setMessages(prev => prev || []) }
  }, [chatId, onChatChange, showToast])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (changed.chatId === chatId) load() }, [changed.tick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stickToBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = scroller.current
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const loadOlder = async () => {
    setLoadingOlder(true)
    const el = scroller.current
    const height = el.scrollHeight
    stickToBottom.current = false
    try {
      const r = await getChatMessages(chatId, { limit: 100, before: messages[0].at })
      setMessages(prev => [...r.messages, ...prev])
      setHasMore(r.has_more)
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - height })
    } catch (err) { showToast(err.message, true) }
    setLoadingOlder(false)
  }

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    stickToBottom.current = true
    try {
      await sendChatMessage(chatId, body)
      setText('')
      await load()
      onChatChange()
    } catch (err) { setSendError(err.message) } // the typed text stays in the box
    setSending(false)
  }

  const change = async (data) => {
    try {
      setChat(await updateChat(chatId, data))
      onChatChange()
    } catch (err) { showToast(err.message, true) }
  }

  const addContact = async () => {
    try {
      const r = await createContactFromChat(chatId)
      showToast('Contact saved')
      await load()
      onChatChange()
      return r
    } catch (err) { showToast(err.message, true) }
  }

  if (!chat || !messages) return <div className="flex-1 flex items-center justify-center"><Spinner size={18} className="animate-spin text-zinc-400" /></div>

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <button onClick={() => goView('inbox')} className="md:hidden w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Back to chats"><ArrowLeft size={16} /></button>
        <div className="flex-1 min-w-[120px]">
          {chat.lead_id
            ? <button dir="auto" onClick={() => goView(`contact/${chat.lead_id}`)} className="block max-w-full truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100 hover:text-emerald-600 dark:hover:text-emerald-400">{chatTitle(chat)}</button>
            : <div dir="auto" className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{chatTitle(chat)}</div>}
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
            {chat.phone ? `+${chat.phone}` : 'WhatsApp hid this number'}
            {chat.lead_id && chat.whatsapp_name && chat.whatsapp_name !== chat.name ? ` · ~${chat.whatsapp_name}` : ''}
          </div>
        </div>
        {!chat.lead_id && chat.phone && can(user, 'leads.edit') && (
          <button onClick={addContact} className={headerBtn}><UserPlus size={13} /> Add contact</button>
        )}
        {canSend ? (
          <>
            <select value={chat.assigned_to || ''} onChange={e => change({ assigned_to: e.target.value || null })} aria-label="Assign chat"
              className="h-7 max-w-[130px] px-1.5 rounded-lg text-[11px] border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300">
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.username}</option>)}
            </select>
            {chat.status === 'open'
              ? <button onClick={() => change({ status: 'done' })} className={headerBtn}><CheckCircle size={13} /> Done</button>
              : <button onClick={() => change({ status: 'open' })} className={headerBtn}><ArrowCounterClockwise size={13} /> Reopen</button>}
          </>
        ) : chat.assigned_name && <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{chat.assigned_name}</span>}
      </header>

      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-1 bg-zinc-50 dark:bg-zinc-950/40">
        {hasMore && messages.length > 0 && (
          <div className="flex justify-center pb-2">
            <button onClick={loadOlder} disabled={loadingOlder} className="px-3 h-6 rounded-full text-[11px] font-medium bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}
        {messages.length === 0 && <p className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">No messages yet. Your first message follows the same safety rules as a broadcast.</p>}
        {messages.map((m, i) => {
          const newDay = i === 0 || new Date(messages[i - 1].at).toDateString() !== new Date(m.at).toDateString()
          return (
            <div key={m.id}>
              {newDay && <div className="flex justify-center py-2"><span className="px-2 h-5 leading-5 rounded-full text-[10px] bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{dayLabel(m.at)}</span></div>}
              <Bubble m={m} />
            </div>
          )
        })}
      </div>

      {chat.do_not_contact && (
        <div className="px-3 py-2 flex items-center gap-2 text-[11px] border-t border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
          <Prohibit size={13} className="shrink-0" /> This contact opted out. Clear "Do not contact" on their contact page to message them again.
        </div>
      )}
      {disconnected && canSend && (
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-[11px] border-t border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
          <Warning size={13} className="shrink-0" /> WhatsApp isn't connected, so messages can't be sent.
          <button onClick={() => goView('settings?tab=whatsapp')} className="font-medium underline underline-offset-2">Connect it</button>
        </div>
      )}
      {canSend ? (
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-2">
          {sendError && (
            <div className="mb-2 flex items-start gap-1.5 px-2 py-1.5 rounded-lg text-[11px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
              <Warning size={13} className="shrink-0 mt-px" /><span className="flex-1">{sendError}</span>
              <button onClick={() => setSendError(null)} aria-label="Dismiss"><X size={12} /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea dir="auto" rows={1} value={text} onChange={e => setText(e.target.value)} disabled={chat.do_not_contact} maxLength={4000}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
              placeholder="Write a message. Enter sends it on WhatsApp."
              className="flex-1 min-w-0 max-h-32 min-h-[36px] resize-y px-3 py-2 rounded-lg text-xs border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50" />
            <button onClick={send} disabled={!text.trim() || sending || chat.do_not_contact} aria-label="Send"
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 transition-colors">
              {sending ? <Spinner size={15} className="animate-spin" /> : <PaperPlaneRight size={15} weight="fill" />}
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">You can read this chat, but your role can't send WhatsApp messages.</p>
      )}
    </>
  )
}

const headerBtn = 'inline-flex items-center gap-1 px-2 h-7 rounded-lg text-[11px] font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors'

function senderLabel(m) {
  if (m.source === 'broadcast') return m.job_name ? `Broadcast · ${m.job_name}` : 'Broadcast'
  if (m.source === 'phone') return 'From the phone'
  return m.sent_by || null
}

function Bubble({ m }) {
  const out = m.direction === 'out'
  const label = out ? senderLabel(m) : null
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] md:max-w-[70%] px-2.5 py-1.5 rounded-xl text-xs shadow-sm ${
        out ? 'bg-emerald-100 dark:bg-emerald-900/40 text-zinc-900 dark:text-zinc-100 rounded-br-sm' : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-sm'
      }`}>
        {label && <div className="mb-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">{label}</div>}
        {m.deleted_at && <div className="mb-0.5 flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400"><Prohibit size={10} /> Deleted on WhatsApp. Kept here.</div>}
        <MessageBody m={m} />
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          {m.edited_at && <span title={m.original_text ? `Original: ${m.original_text}` : undefined}>Edited</span>}
          <span>{msgTime(m.at)}</span>
          {out && <Ticks status={m.status} />}
        </div>
      </div>
    </div>
  )
}

function Ticks({ status }) {
  if (status === 0) return <span title="WhatsApp rejected this message"><Warning size={12} className="text-red-500" /></span>
  if (status >= 4) return <span title="Read"><Checks size={12} className="text-sky-500" /></span>
  if (status === 3) return <span title="Delivered"><Checks size={12} /></span>
  return <span title="Sent"><Check size={12} /></span>
}

function MessageBody({ m }) {
  const isMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(m.type)
  return (
    <>
      {isMedia && <Media m={m} />}
      {m.type === 'location' && m.text && (
        <a href={`https://www.google.com/maps?q=${encodeURIComponent(m.text)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 underline underline-offset-2">
          <MapPin size={13} /> Open location
        </a>
      )}
      {m.type === 'contact' && <div className="text-zinc-500 dark:text-zinc-400 text-[11px]">Shared contact</div>}
      {m.type === 'poll' && <div className="text-zinc-500 dark:text-zinc-400 text-[11px]">Poll</div>}
      {m.type === 'other' && !m.text && <div className="italic text-zinc-500 dark:text-zinc-400 text-[11px]">This type of message can only be seen on the phone.</div>}
      {m.text && m.type !== 'location' && <p dir="auto" className="whitespace-pre-wrap break-words">{m.text}</p>}
    </>
  )
}

const MEDIA_NAMES = { image: 'Photo', video: 'Video', audio: 'Voice message', document: 'Document', sticker: 'Sticker' }

// Files sent by strangers: only images and audio/video players are shown inline, documents are downloaded
function Media({ m }) {
  const autoLoad = m.type === 'image' || m.type === 'sticker'
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const name = m.media_name || MEDIA_NAMES[m.type]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const blob = await getChatMedia(m.id)
      const u = URL.createObjectURL(blob)
      setUrl(u)
      return u
    } catch { setError(true) } finally { setLoading(false) }
  }, [m.id])

  useEffect(() => { if (autoLoad && m.media_state === 'saved') load() }, [autoLoad, m.media_state, load])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const note = (t) => <div className="flex items-center gap-1.5 text-[11px] italic text-zinc-500 dark:text-zinc-400"><FileIcon size={13} /> {name}: {t}</div>
  if (m.media_state === 'pending') return note('downloading…')
  if (m.media_state === 'too_large') return note('over 25 MB, not saved. See it on the phone.')
  if (m.media_state !== 'saved' || error) return note('not available here. See it on the phone.')

  if (m.type === 'image' || m.type === 'sticker') {
    if (!url) return <div className="w-40 h-28 rounded-lg bg-zinc-200 dark:bg-zinc-700 animate-pulse" />
    return <a href={url} download={name}><img src={url} alt={name} className={`rounded-lg mb-1 object-contain ${m.type === 'sticker' ? 'w-28 h-28' : 'max-h-72 max-w-full'}`} /></a>
  }
  if (url && m.type === 'audio') return <audio src={url} controls autoPlay className="max-w-full h-9 mb-1" />
  if (url && m.type === 'video') return <video src={url} controls autoPlay className="max-h-72 max-w-full rounded-lg mb-1" />
  const download = async () => {
    const u = url || await load()
    if (!u) return
    const a = document.createElement('a')
    a.href = u
    a.download = name
    a.click()
  }
  return (
    <button onClick={m.type === 'document' ? download : load} disabled={loading} className="flex items-center gap-1.5 mb-1 px-2 h-8 rounded-lg text-[11px] font-medium bg-black/5 dark:bg-white/10 max-w-full">
      {loading ? <Spinner size={13} className="animate-spin" /> : <DownloadSimple size={13} />}
      <span dir="auto" className="truncate">{m.type === 'document' ? name : `Play ${name.toLowerCase()}`}</span>
    </button>
  )
}

function NewChat({ close, onOpened }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    const term = q.trim()
    if (!term) { setResults([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await getLeads({ search: term, limit: 8, status: 'active' })
        setResults((r.leads || r.items || r.data || r || []).filter(l => l.phone))
      } catch {}
    }, 200)
    return () => clearTimeout(t)
  }, [q])

  const go = async (data) => {
    setError(null)
    try { onOpened((await openChat(data)).id) } catch (err) { setError(err.message) }
  }
  const typedNumber = /^[+\d][\d\s()-]{6,}$/.test(q.trim())

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 bg-black/40" onClick={close}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 h-11 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">New chat</h2>
          <button onClick={close} aria-label="Close" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"><X size={15} /></button>
        </div>
        <div className="p-3">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Contact name, or a number with country code"
            onKeyDown={e => { if (e.key === 'Enter' && typedNumber) go({ phone: q.trim() }) }}
            className="w-full h-9 px-3 rounded-lg text-xs border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
          {error && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
          <div className="mt-2 max-h-64 overflow-y-auto">
            {typedNumber && (
              <button onClick={() => go({ phone: q.trim() })} className="w-full text-left px-2 py-2 rounded-lg text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">Chat with {q.trim()}</button>
            )}
            {results.map(l => (
              <button key={l.id} onClick={() => go({ lead_id: l.id })} className="w-full text-left px-2 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <div dir="auto" className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{l.name}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{l.phone}</div>
              </button>
            ))}
            {q.trim() && !typedNumber && results.length === 0 && <p className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">No contact with a phone number matches.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
