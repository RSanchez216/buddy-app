import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePageAccess } from '../contexts/PageAccessContext'

// RequirePageAccess: guard a route by page_key
// - Admins always pass through
// - Non-admins: pass if they have access to this page_key, else redirect to first accessible page
// - If no accessible pages exist, redirect to /no-access
//
// Access is derived from the shared my_pages() result (PageAccessProvider) —
// no per-guard my_pages()/has_page_access() network calls. hasPageAccess()
// mirrors the has_page_access() SQL function exactly.
export default function RequirePageAccess({ pageKey: propPageKey, children }) {
  const { profile, loading, isAdmin } = useAuth()
  const { pages, pagesLoaded, hasPageAccess } = usePageAccess()
  const location = useLocation()

  // Resolve the canonical page_key from my_pages() by matching the current route
  const resolvePageKey = (pathname) => {
    if (!pages || pages.length === 0) return propPageKey

    // Remove leading slash for comparison
    const currentPath = pathname.startsWith('/') ? pathname.slice(1) : pathname

    // First, try exact match
    let match = pages.find(p => p.route === currentPath)
    if (match) return match.page_key

    // Fall back to longest matching prefix (for nested/detail routes)
    match = pages.reduce((best, page) => {
      const route = page.route || ''
      if (currentPath.startsWith(route) && (!best || route.length > best.route.length)) {
        return page
      }
      return best
    }, null)

    return match ? match.page_key : propPageKey
  }

  // Still loading auth, or (non-admin) the shared pages haven't arrived yet
  if (loading || !profile || (!isAdmin && !pagesLoaded)) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  // Admin always has access
  if (isAdmin) {
    return children
  }

  // Non-admin: derive access from the shared pages list
  if (hasPageAccess(resolvePageKey(location.pathname))) {
    return children
  }

  // No access — redirect to first accessible page or no-access screen
  const firstAccessibleRoute = pages?.[0]?.route || null
  if (firstAccessibleRoute) {
    return <Navigate to={firstAccessibleRoute} replace />
  }

  return <Navigate to="/no-access" replace />
}
