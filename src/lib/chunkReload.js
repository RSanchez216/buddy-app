import { lazy } from 'react'

// Recover from stale content-hashed Vite chunks after a deploy. When a user
// keeps the app open across a deploy, an old chunk filename 404s and the
// dynamic import() throws — blanking the page. These helpers auto-reload into
// the new build (once, loop-guarded) instead.

const RELOAD_KEY = 'buddy-chunk-reload'
const RELOAD_WINDOW_MS = 10000

// The usual chunk-load failure messages across browsers/bundlers.
const CHUNK_ERR_RE = /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module/i

export function isChunkLoadError(err) {
  if (!err) return false
  const msg = typeof err === 'string' ? err : (err.message || err.name || '')
  return CHUNK_ERR_RE.test(String(msg))
}

// Reload to the new build at most once per RELOAD_WINDOW_MS. If we already
// reloaded very recently, don't loop — offer a manual refresh banner instead
// (buddy:needs-refresh, handled by UpdateBanner).
export function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < RELOAD_WINDOW_MS) {
      window.dispatchEvent(new CustomEvent('buddy:needs-refresh'))
      return
    }
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable (private mode etc.) — fall through to a single
    // reload; the browser's own error state prevents a tight loop.
  }
  window.location.reload()
}

// Wrap a React.lazy factory so a chunk-load failure forces one reload instead
// of throwing (which would blank the route). Returns a never-resolving promise
// after triggering the reload so Suspense simply keeps showing its fallback.
export function lazyWithReload(factory) {
  return lazy(() =>
    factory().catch((err) => {
      if (isChunkLoadError(err)) {
        reloadOnce()
        return new Promise(() => {})
      }
      throw err
    })
  )
}

// One-time startup wiring: Vite's preload-failure event, plus clearing the loop
// guard once we've been running stably so future deploys still auto-recover.
// (The RELOAD_WINDOW_MS guard also auto-expires, so this is belt-and-suspenders.)
export function initChunkReload() {
  window.addEventListener('vite:preloadError', (e) => {
    e?.preventDefault?.()
    reloadOnce()
  })
  setTimeout(() => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last >= RELOAD_WINDOW_MS) sessionStorage.removeItem(RELOAD_KEY)
    } catch { /* ignore */ }
  }, RELOAD_WINDOW_MS + 2000)
}
