import { useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { X } from '@phosphor-icons/react'

const SEEN_KEY = 'leaddesk_tour_done'

export function tourSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return true }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch {}
}

const STEPS = [
  { title: 'Welcome to LeadDesk', body: "Find businesses, message them safely on WhatsApp, and see who replies. Here's how it fits together." },
  { target: 'scraper', title: '1. Find businesses', body: 'Search Google Maps by keyword and area. Results can go straight into your contacts.' },
  { target: 'leads', title: '2. Review your contacts', body: "Filter by business type or tag. Mark a contact Verified once you've checked it's a good target. Each contact can also hold a personal message." },
  { target: 'campaigns', title: '3. Send and track', body: 'Group contacts into a campaign, then send or schedule a WhatsApp broadcast. Open any broadcast to see who got it and who replied.' },
  { target: 'inbox', title: '4. Talk to people', body: 'Every WhatsApp message, in and out, lands in the Inbox. Reply from here, assign a chat to a teammate, and mark it done.' },
  { target: 'settings', title: '5. Connect WhatsApp', body: 'Link your number under Settings → WhatsApp. New numbers warm up slowly to protect them from bans. Team members and the Claude connection are here too.' },
  { title: "You're all set", body: 'Start with the Maps Scraper. You can replay this from "Take the tour" at the bottom of the menu.' },
]

const CARD_WIDTH = 320

// Lightweight guided tour: highlights menu items. A step whose item isn't visible (no permission, or the mobile menu
// is closed) still shows, centred.
export default function Tour({ close }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const steps = STEPS.filter(s => !s.target || document.querySelector(`[data-tour="${s.target}"]`))
  const step = steps[i]

  const measure = useCallback(() => {
    const r = step.target ? document.querySelector(`[data-tour="${step.target}"]`)?.getBoundingClientRect() : null
    setRect(r && r.width > 0 && r.right > 0 && r.left < window.innerWidth ? r : null)
  }, [step])

  useLayoutEffect(measure, [measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const finish = useCallback(() => { markSeen(); close() }, [close])
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  const last = i === steps.length - 1
  const fits = rect && rect.right + 16 + CARD_WIDTH < window.innerWidth
  const cardStyle = fits
    ? { left: rect.right + 16, top: Math.max(16, Math.min(rect.top - 16, window.innerHeight - 240)), width: CARD_WIDTH }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: `min(${CARD_WIDTH}px, calc(100vw - 32px))` }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-label="Product tour">
      {rect
        ? <div className="fixed rounded-lg pointer-events-none transition-all duration-200" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
        : <div className="fixed inset-0 bg-black/55" />}
      <div className="fixed rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 shadow-xl" style={cardStyle}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{step.title}</h2>
          <button onClick={finish} aria-label="Close tour" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><X size={14} /></button>
        </div>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 mb-4">{step.body}</p>
        <div className="flex items-center justify-between">
          <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{i + 1} / {steps.length}</span>
          <div className="flex gap-2">
            {i > 0 && <button onClick={() => setI(i - 1)} className="px-3 h-8 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">Back</button>}
            <button onClick={() => (last ? finish() : setI(i + 1))} className="px-3 h-8 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600">{last ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
