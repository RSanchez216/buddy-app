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

// ── Proactive new-build detection ────────────────────────────────────────────
// The handlers above are REACTIVE — they only fire when a lazy import() 404s
// (navigation after a deploy). They do nothing for the more dangerous case: a
// tab left open across a deploy on a page whose chunk is already in memory,
// where the user acts (e.g. a driver/loads import) on STALE code. Nothing
// 404s, so nothing recovers — the write may run old logic and silently not
// persist (or persist wrong).
//
// This watcher polls the deployed index.html, fingerprints the hashed asset
// filenames it references, and — when that set changes vs. what this tab booted
// with — fires the SAME buddy:needs-refresh banner (UpdateBanner) so the user
// is told to refresh BEFORE acting. It NEVER calls location.reload() itself: a
// mid-import user must not be reloaded out from under a half-filled form. The
// banner's Refresh button is the only reload on this path.

const BUILD_POLL_MS = 60_000
let knownFingerprint = null   // the asset set THIS tab is running
let buildNotified = false     // fire the banner at most once per detected build

async function deployedFingerprint() {
  const base = import.meta.env.BASE_URL || '/'
  const html = await fetch(base, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`index fetch ${r.status}`)
    return r.text()
  })
  // Every hashed JS/CSS asset index.html references, sorted → stable signature.
  // Vite content-hashes every chunk and bakes the hashed specifiers into their
  // importers, so ANY code change (even inside a lazy route chunk) cascades to a
  // changed filename here. A changed set ⇒ a real deploy.
  const assets = [...html.matchAll(/\/assets\/[A-Za-z0-9_\-.]+\.(?:js|css)/g)].map((m) => m[0])
  return assets.sort().join('|')
}

// Returns whether a newer build is pending (true ⇒ this tab is running stale
// code). Used both by the passive poll and by the click-time gate on the
// importers (ensureLatestBuild).
async function checkForNewBuild() {
  if (buildNotified) return true                 // already known stale
  if (!navigator.onLine) return false            // can't verify → treat as fresh, don't block
  let current
  try { current = await deployedFingerprint() } catch { return buildNotified } // network blip → retry next tick
  if (!current) return buildNotified
  if (knownFingerprint === null) { knownFingerprint = current; return false } // baseline (boot: deployed === running)
  if (current !== knownFingerprint) {
    buildNotified = true
    window.dispatchEvent(new CustomEvent('buddy:needs-refresh'))
    return true
  }
  return false
}

// Cheap synchronous read of the last-known state (no network).
export function isNewBuildPending() { return buildNotified }

// Fresh, click-time check with its own network round-trip — closes the ~60s
// poll-window race so the highest-consequence writes (the importers) never run
// on stale code. Returns true when a newer build is deployed.
export async function ensureLatestBuild() { return await checkForNewBuild() }

// One-time startup wiring for the proactive watcher. Poll only while the tab is
// visible + online so idle background tabs don't hammer the network, and
// re-check immediately whenever the tab regains focus.
export function startBuildWatch() {
  checkForNewBuild() // establish baseline
  setInterval(() => { if (!document.hidden) checkForNewBuild() }, BUILD_POLL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewBuild()
  })
}
