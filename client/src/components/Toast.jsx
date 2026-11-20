import { CheckCircle, XCircle } from '@phosphor-icons/react'

export default function Toast({ msg }) {
  if (!msg) return null

  return (
    <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all duration-300 ${
      msg.warn
        ? 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
        : 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 shadow-diffusion dark:shadow-diffusion-dark'
    }`}>
      {msg.warn
        ? <XCircle size={18} weight="fill" className="text-red-500 shrink-0" />
        : <CheckCircle size={18} weight="fill" className="text-emerald-500 shrink-0" />
      }
      <span>{msg.msg}</span>
    </div>
  )
}
