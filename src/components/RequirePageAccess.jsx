import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// RequirePageAccess: guard a route by page_key
// - Admins always pass through
// - Non-admins: pass if they have access to this page_key, else redirect to first accessible page
// - If no accessible pages exist, redirect to /no-access
export default function RequirePageAccess({ pageKey, children }) {
  const { profile, loading, isAdmin } = useAuth()
  const [hasAccess, setHasAccess] = useState(null)
  const [firstAccessibleRoute, setFirstAccessibleRoute] = useState(null)
  const [accessLoading, setAccessLoading] = useState(true)

  useEffect(() => {
    if (!profile || loading) return

    const checkAccess = async () => {
      try {
        // Check if user has access to this specific page
        const { data: hasIt, error: accessErr } = await supabase.rpc(
          'has_page_access',
          { page_key: pageKey }
        )

        if (accessErr) {
          console.error('Page access check failed:', accessErr)
          setHasAccess(false)
        } else {
          setHasAccess(hasIt === true)
        }

        // Admins don't need the fallback, but fetch it anyway for consistency
        if (!isAdmin) {
          const { data: pages, error: pagesErr } = await supabase.rpc('my_pages')
          if (pagesErr) {
            console.error('my_pages fetch failed:', pagesErr)
            setFirstAccessibleRoute(null)
          } else {
            const first = pages?.[0]
            setFirstAccessibleRoute(first?.route || null)
          }
        }
      } catch (e) {
        console.error('Access check error:', e)
        setHasAccess(false)
      } finally {
        setAccessLoading(false)
      }
    }

    checkAccess()
  }, [profile, loading, pageKey, isAdmin])

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
