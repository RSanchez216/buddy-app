import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePageAccess } from '../contexts/PageAccessContext'

// Page-level activity logging. Feeds the server-side usage RPCs
// (user_usage_summary / all_users_usage) that power the Users → Usage & Activity
// reports. Everything here is fire-and-forget — it must never block navigation
// or surface an error to the user. No content, no keystrokes: page-level only.
//
// Three signals (kind):
//   • 'view'      — one per route change (the destination's page_key)
//   • 'heartbeat' — every ~60s, ONLY while the tab is actually being used
//                   (visible AND focused) so "active time" means working, not
//                   tab-open
//   • 'signout'   — handled in AuthContext.signOut, not here
//
// The server computes idle-capped active time from these, so a tab left open
// overnight can't inflate it.

const HEARTBEAT_MS = 60 * 1000 // ~1 min while focused
const DEDUPE_MS = 1000         // skip a repeat 'view' for the same route < 1s apart

export function usePageActivity() {
  const location = useLocation()
  const { profile } = useAuth()
  const { pages } = usePageAccess()
  const uid = profile?.id ?? null

  // Resolve a pathname → page_key using the SAME my_pages() rows the nav/access
  // layer uses (route match, slashes normalized on both sides). No match → null
  // (the RPC then keys off the raw route instead).
  const resolveKey = useCallback((pathname) => {
    const norm = (s) => (s || '').replace(/^\/+/, '').replace(/\/+$/, '')
    const p = norm(pathname)
    const hit = pages.find(pg => norm(pg.route) === p)
    return hit ? hit.page_key : null
  }, [pages])

  // Keep the resolver + current page in refs so the heartbeat closure always
  // reads the latest values without re-arming its interval each render.
  const resolveRef = useRef(resolveKey)
  useEffect(() => { resolveRef.current = resolveKey }, [resolveKey])
  const routeRef = useRef(location.pathname)
  const lastViewRef = useRef({ route: null, at: 0 })

  const log = useCallback((kind, pageKey, route) => {
    if (!uid) return
    // Thenable-with-two-args so a rejected request is swallowed too.
    try {
      supabase.rpc('log_page_activity', { p_page_key: pageKey ?? null, p_route: route, p_kind: kind })
        .then(() => {}, () => {})
    } catch { /* never let logging throw into the render path */ }
  }, [uid])

  // ── 'view' on every route change (deduped) ──────────────────────────────
  useEffect(() => {
    if (!uid) return
    const now = Date.now()
    const last = lastViewRef.current
    if (last.route === location.pathname && now - last.at < DEDUPE_MS) return
    lastViewRef.current = { route: location.pathname, at: now }

    routeRef.current = location.pathname
    log('view', resolveRef.current(location.pathname), location.pathname)
  }, [location.pathname, uid, log])

  // ── heartbeat while the tab is visible AND focused ──────────────────────
  useEffect(() => {
    if (!uid) return
    let timer = null
    const focusedAndVisible = () =>
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      document.hasFocus()

    const beat = () => {
      // Resolve the page_key fresh each beat so it self-corrects once my_pages()
      // has loaded (the first view may have fired before it was ready).
      if (focusedAndVisible()) log('heartbeat', resolveRef.current(routeRef.current), routeRef.current)
    }
    const start = () => { if (!timer) timer = setInterval(beat, HEARTBEAT_MS) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    // Pause when the tab is hidden or the window loses focus; resume on focus.
    const sync = () => { focusedAndVisible() ? start() : stop() }

    sync()
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [uid, log])
}
