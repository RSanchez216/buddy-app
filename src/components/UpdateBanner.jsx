import { useEffect, useState } from 'react'

// "A new version is available" banner. Detection lives in the build watcher
// (lib/chunkReload → startBuildWatch), which fires buddy:needs-refresh when a
// newer deploy is detected; reloadOnce()'s loop-guard fallback fires the same
// event. This component only listens for that event and offers a non-blocking
// refresh — it never reloads on its own, so a mid-form user is never yanked
// out from under a half-filled import.
export default function UpdateBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onNeedsRefresh = () => setShow(true)
    window.addEventListener('buddy:needs-refresh', onNeedsRefresh)
    return () => window.removeEventListener('buddy:needs-refresh', onNeedsRefresh)
  }, [])

  if (!show) return null
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 rounded-2xl border border-orange-200 dark:border-orange-500/30 bg-white dark:bg-[#0d0d1f] px-4 py-2.5 shadow-2xl">
      <span className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
        A new version is available.
      </span>
      <button
        onClick={() => window.location.reload()}
        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-orange-500 hover:bg-orange-400 text-white transition-colors"
      >
        Refresh
      </button>
      <button
        onClick={() => setShow(false)}
        aria-label="Dismiss"
        className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
