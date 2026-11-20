import { useState, useEffect } from 'react'
import { GithubLogo, Heart } from '@phosphor-icons/react'

export default function ClockWidget({ timezone }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const tz = timezone || 'UTC'

  const time = now.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  const date = now.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] hidden md:flex items-center gap-3 px-4 py-1.5 rounded-b-xl bg-zinc-900/90 backdrop-blur-md border border-zinc-800 border-t-0 shadow-lg">
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">{tz.replace('_', ' ')}</span>
      </div>
      <div className="w-px h-4 bg-zinc-700" />
      <span className="text-sm font-semibold text-zinc-100 tabular-nums tracking-wide">{time}</span>
      <div className="w-px h-4 bg-zinc-700" />
      <span className="text-[11px] text-zinc-400">{date}</span>
      <div className="w-px h-4 bg-zinc-700" />
      <a href="https://github.com/paoloothedev/leaddesk" target="_blank" rel="noopener"
        className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors">
        <GithubLogo size={13} /> Star
      </a>
      <a href="https://paoloothedev.com" target="_blank" rel="noopener"
        className="text-[11px] text-zinc-500 hover:text-emerald-400 transition-colors">
        paoloothedev.com
      </a>
    </div>
  )
}
