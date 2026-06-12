import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function SmartLanding() {
  const { profile, loading, isAdmin } = useAuth()
  const [landingRoute, setLandingRoute] = useState(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const determineLanding = async () => {
      if (loading || !profile) return

      // Admins go to Lane Map
      if (isAdmin) {
        setLandingRoute('/fleet/profitability/lanes')
        setChecked(true)
        return
      }

      // Non-admins: fetch first accessible page
      try {
        const { data, error } = await supabase.rpc('my_pages')
        if (error || !data || data.length === 0) {
          setLandingRoute('/no-access')
        } else {
          setLandingRoute(data[0].route)
        }
      } catch (e) {
        console.error('Error determining landing page:', e)
        setLandingRoute('/no-access')
      }
      setChecked(true)
    }

    determineLanding()
  }, [profile, loading, isAdmin])

  if (!checked) {
    return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  return landingRoute ? <Navigate to={landingRoute} replace /> : null
}
