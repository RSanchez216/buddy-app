import { useEffect, useState } from 'react'

function elapsed(since, now) {
  const s = Math.max(0, Math.round((now - since) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return `${m}m ago`
}

function LockIcon() {
  return (
    <svg className="w-5 h-5 shrink-0 text-amber-700 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export default function EditLockBanner({ editors, onViewOnly }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000) // refresh the "Xs ago"
    return () => clearInterval(id)
  }, [])

  if (!editors || editors.length === 0) return null
  const first = editors[0]
  const extra = editors.length - 1

  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <LockIcon />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-amber-800 dark:text-amber-300">
          {first.full_name} is editing this contract{extra > 0 ? ` (+${extra} more)` : ''}
        </div>
        <div className="text-xs text-amber-700/80 dark:text-amber-400/80">
          started {elapsed(first.editing_since, now)} · your changes may overwrite theirs
        </div>
      </div>
      {onViewOnly && (
        <button
          type="button"
          onClick={onViewOnly}
          className="whitespace-nowrap rounded-md border border-amber-300 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/15"
        >
          View only
        </button>
      )}
    </div>
  )
}
