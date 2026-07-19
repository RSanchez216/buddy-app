import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePageAccess } from '../contexts/PageAccessContext'

// Redirect "/" to the user's landing page. Reuses the shared my_pages() result
// (PageAccessProvider) — admins land on the Lane Map, everyone else on their
// first accessible page (or /no-access if they have none).
export default function SmartLanding() {
  const { profile, loading, isAdmin } = useAuth()
  const { pages, pagesLoaded } = usePageAccess()

  // Wait for auth to resolve
  if (loading || !profile) {
    return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  // Admins go to Lane Map
  if (isAdmin) {
    return <Navigate to="/fleet/profitability/lanes" replace />
  }

  // Non-admins: land on their first accessible page (from the shared list)
  if (!pagesLoaded) {
    return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  const landingRoute = pages.length ? pages[0].route : '/no-access'
  return <Navigate to={landingRoute} replace />
}
