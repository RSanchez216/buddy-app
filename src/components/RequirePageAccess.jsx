import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePageAccess } from '../contexts/PageAccessContext'

// RequirePageAccess: guard a route by its declared page key.
// - Admins always pass through
// - Non-admins: pass if they have access to this page, else redirect to the
//   first page they can reach (or /no-access)
//
// The route declares which page it guards via `pageKey` — either a canonical
// page_key ("idle_review") or a route ("fleet/profitability/lanes"); detail
// routes (…/:id) pass their parent's key. hasPageAccess() resolves either form
// to a my_pages() row and checks membership (membership == access). We key off
// this declared value rather than the URL so a child route (e.g. lanes) is
// never approved by a parent the user happens to have (e.g. profitability).
// Access is derived from the shared my_pages() result (PageAccessProvider) —
// no per-guard network calls.
export default function RequirePageAccess({ pageKey: propPageKey, children }) {
  const { profile, loading, isAdmin } = useAuth()
  const { pages, pagesLoaded, hasPageAccess } = usePageAccess()

  // Still loading auth, or (non-admin) the shared pages haven't arrived yet
  if (loading || !profile || (!isAdmin && !pagesLoaded)) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  // Admin always has access
  if (isAdmin) {
    return children
  }

  // Non-admin: access to the page this route declares
  if (hasPageAccess(propPageKey)) {
    return children
  }

  // No access — redirect to first accessible page or no-access screen
  const firstAccessibleRoute = pages?.[0]?.route || null
  return <Navigate to={firstAccessibleRoute || '/no-access'} replace />
}
