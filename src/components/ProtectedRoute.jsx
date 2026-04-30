import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Routes that authenticated users can still hit (e.g. invitees who are
// signed in via the invite token but haven't set their password yet).
const PUBLIC_AUTH_ROUTES = ['/auth/set-password', '/auth/forgot-password']

export default function ProtectedRoute({ children }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#09091a] transition-colors">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-500 mx-auto mb-4" />
          <p className="text-gray-400 dark:text-slate-500 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  // Pending users (just clicked an invite link) must set a password before
  // they can use the rest of the app. The /auth/set-password route is outside
  // this guard, but if Supabase or the user navigates anywhere else first,
  // bounce them back here. This survives Supabase's own redirect quirks.
  if (profile?.status === 'pending' && !PUBLIC_AUTH_ROUTES.includes(location.pathname)) {
    return <Navigate to="/auth/set-password" replace />
  }

  return children
}
