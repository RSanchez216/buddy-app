import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()

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
  return children
}
