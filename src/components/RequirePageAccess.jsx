import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// RequirePageAccess: guard a route by page_key
// - Admins always pass through
// - Non-admins: pass if they have access to this page_key, else redirect to first accessible page
// - If no accessible pages exist, redirect to /no-access
export default function RequirePageAccess({ pageKey: propPageKey, children }) {
  const { profile, loading, isAdmin } = useAuth()
  const location = useLocation()
  const [hasAccess, setHasAccess] = useState(null)
  const [firstAccessibleRoute, setFirstAccessibleRoute] = useState(null)
  const [accessLoading, setAccessLoading] = useState(true)

  // Resolve the canonical page_key from my_pages() by matching the current route
  const resolvePageKey = (pages, pathname) => {
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

  useEffect(() => {
    if (!profile || loading) return

    const checkAccess = async () => {
      try {
        // Fetch all pages to resolve the canonical page_key for this route
        const { data: allPages, error: pagesErr } = await supabase.rpc('my_pages')
        if (pagesErr) {
          console.error('my_pages fetch failed:', pagesErr)
          setHasAccess(false)
          setAccessLoading(false)
          return
        }

        const resolvedPageKey = resolvePageKey(allPages, location.pathname)

        // Check if user has access to this specific page
        const { data: hasIt, error: accessErr } = await supabase.rpc(
          'has_page_access',
          { page_key: resolvedPageKey }
        )

        if (accessErr) {
          console.error('Page access check failed:', accessErr)
          setHasAccess(false)
        } else {
          setHasAccess(hasIt === true)
        }

        // Admins don't need the fallback, but use the pages we already fetched
        if (!isAdmin) {
          const first = allPages?.[0]
          setFirstAccessibleRoute(first?.route || null)
        }
      } catch (e) {
        console.error('Access check error:', e)
        setHasAccess(false)
      } finally {
        setAccessLoading(false)
      }
    }

    checkAccess()
  }, [profile, loading, location.pathname, isAdmin])

  // Still loading auth or access info
  if (loading || accessLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  // Admin always has access
  if (isAdmin) {
    return children
  }

  // Non-admin: check access
  if (hasAccess) {
    return children
  }

  // No access — redirect to first accessible page or no-access screen
  if (firstAccessibleRoute) {
    return <Navigate to={firstAccessibleRoute} replace />
  }

  return <Navigate to="/no-access" replace />
}
