import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

// Proactive "new version available" banner. Compares the hashed entry-script
// filename in the live document (captured at startup) against the one in the
// freshly-fetched index.html; if it changed, a deploy happened and we offer a
// non-blocking refresh — so users update before hitting a broken chunk. Also
// shows on the buddy:needs-refresh event (reloadOnce's loop-guard fallback).

const MAIN_RE = /\/assets\/index-[\w-]+\.js/
const POLL_MS = 3 * 60 * 1000

function currentMain() {
  const el = [...document.querySelectorAll('script[type="module"][src]')]
    .map((s) => s.getAttribute('src') || '')
    .find((s) => MAIN_RE.test(s))
  return el ? (el.match(MAIN_RE)?.[0] || '') : ''
}

// The build that's actually running right now — captured once at module load.
const STARTUP_MAIN = currentMain()

async function fetchLatestMain() {
  try {
    const base = import.meta.env.BASE_URL || '/'
    const res = await fetch(`${base}index.html?ts=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return ''
    const html = await res.text()
    return html.match(MAIN_RE)?.[0] || ''
  } catch {
    return ''
  }
}

export default function UpdateBanner() {
  const [show, setShow] = useState(false)
  const location = useLocation()

  // Poll every few minutes + listen for the loop-guard fallback event.
  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!STARTUP_MAIN) return
      const latest = await fetchLatestMain()
      if (!cancelled && latest && latest !== STARTUP_MAIN) setShow(true)
    }
    check()
    const id = setInterval(check, POLL_MS)
    const onNeedsRefresh = () => setShow(true)
    window.addEventListener('buddy:needs-refresh', onNeedsRefresh)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener('buddy:needs-refresh', onNeedsRefresh)
    }
  }, [])

  // A route change is a natural moment to re-check.
  useEffect(() => {
    if (!STARTUP_MAIN) return
    let cancelled = false
    fetchLatestMain().then((latest) => {
      if (!cancelled && latest && latest !== STARTUP_MAIN) setShow(true)
    })
    return () => { cancelled = true }
  }, [location.pathname])

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
