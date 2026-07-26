import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const PageAccessContext = createContext({})

// Frontend display-name overrides — relabel a page in every UI surface (sidebar,
// Manage simple view, page-access screens) WITHOUT touching the DB. page_key /
// route (the access, bookmark, and RLS keys) are left untouched.
const LABEL_OVERRIDES = { miles_performance: 'Deadhead Analysis' }
const applyLabelOverrides = (rows) =>
  rows.map(p => (LABEL_OVERRIDES[p.page_key] ? { ...p, label: LABEL_OVERRIDES[p.page_key] } : p))

// Single source of truth for the current user's accessible pages. Calls
// my_pages() ONCE per app load and shares the rows with every consumer that
// used to fetch them independently — the sidebar (Layout), the landing
// redirect (SmartLanding), and every route guard (RequirePageAccess). This
// collapses the 3–4× my_pages() burst at boot into one round trip.
//
// Per-route access is derived from this list client-side, mirroring the
// has_page_access() SQL function, so no separate has_page_access() network
// call is made per guard. my_pages() already returns exactly the pages a
// non-admin can reach (admins get every page), so membership == access.
export function PageAccessProvider({ children }) {
  const { profile, loading, isAdmin } = useAuth()
  const [pages, setPages] = useState([])
  const [pagesLoaded, setPagesLoaded] = useState(false)

  const refreshPages = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_pages')
    if (error) console.error('Failed to load pages:', error)
    else setPages(applyLabelOverrides(data || []))
    setPagesLoaded(true)
  }, [])

  // Fetch once the auth profile is resolved. Keyed on the user id so a profile
  // refresh (e.g. nav_mode change) does not re-fetch; a different signed-in
  // user does. Clears on sign-out.
  useEffect(() => {
    if (loading) return
    if (!profile) { setPages([]); setPagesLoaded(false); return }
    refreshPages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, loading])

  // Mirror has_page_access(page_key): admins pass everything; otherwise the key
  // is accessible iff it matches a my_pages() row by page_key OR route — the
  // same canonical resolution the SQL function performs. Routes are compared
  // with leading slashes stripped on BOTH sides, since pages.route is stored as
  // "/fleet/..." while callers may pass a slash-stripped path (that mismatch,
  // plus the old `/${p.route}` double-slash, is what denied every route-style
  // key and blanked content pages for non-admins).
  const hasPageAccess = useCallback((key) => {
    if (isAdmin) return true
    if (!key) return false
    const norm = (s) => (s || '').replace(/^\/+/, '')
    const k = norm(key)
    return pages.some(p => p.page_key === key || norm(p.route) === k)
  }, [pages, isAdmin])

  return (
    <PageAccessContext.Provider value={{ pages, pagesLoaded, setPages, refreshPages, hasPageAccess }}>
      {children}
    </PageAccessContext.Provider>
  )
}

export const usePageAccess = () => useContext(PageAccessContext)
