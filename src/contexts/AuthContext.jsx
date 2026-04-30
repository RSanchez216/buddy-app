import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    const { data } = await supabase
      .from('users')
      .select('*, departments(name)')
      .eq('id', userId)
      .single()

    // Block deactivated accounts: sign them out immediately so they can't
    // see any data from this point on. The UI surfaces accessError on /login.
    if (data && data.status === 'deactivated') {
      setAccessError('Your account has been deactivated. Contact your admin.')
      await supabase.auth.signOut()
      setProfile(null); setSession(null); setUser(null)
      setLoading(false)
      return
    }

    setProfile(data)
    setLoading(false)
  }

  const signIn = async (email, password) => {
    setAccessError('')
    return supabase.auth.signInWithPassword({ email, password })
  }

  const signOut = () => supabase.auth.signOut()

  // Re-fetch the public.users profile for the current session.
  // SetPassword calls this after flipping status='pending' → 'active' so
  // ProtectedRoute sees the new status and lets the user into the dashboard.
  async function refreshProfile() {
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    if (currentSession?.user) await loadProfile(currentSession.user.id)
  }

  // Convenience role flags (computed only when profile is loaded)
  const role = profile?.role || null
  const isAdmin = role === 'admin'
  const isManager = role === 'manager'
  const isViewer = role === 'viewer'
  // canEdit: admins + managers can mutate everything except user management
  const canEdit = isAdmin || isManager

  return (
    <AuthContext.Provider value={{
      session, user, profile, loading,
      role, isAdmin, isManager, isViewer, canEdit,
      accessError, setAccessError,
      signIn, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
