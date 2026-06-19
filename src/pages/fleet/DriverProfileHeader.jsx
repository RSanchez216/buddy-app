import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DriverTypePill, DriverStatusPill } from './fleetUtils'
import { nameHue, monogram } from './loads/spotlight/spotlightShared'

// Driver profile header with photo, name, status, and identifiers
export default function DriverProfileHeader({ driver }) {
  const [photoUrl, setPhotoUrl] = useState(null)
  const [loading, setLoading] = useState(false)

  // Load signed URL for the driver's photo if it exists
  useEffect(() => {
    if (driver?.photo_path) {
      setLoading(true)
      supabase.storage
        .from('driver-avatars')
        .createSignedUrl(driver.photo_path, 3600)
        .then(({ data, error }) => {
          if (!error && data?.signedUrl) {
            setPhotoUrl(data.signedUrl)
          }
          setLoading(false)
        })
    }
  }, [driver?.photo_path])

  const h = nameHue(driver?.full_name || '')
  const initialsGradient = `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 42) % 360} 68% 34%))`
  const truckLabel = driver?.truck_assignment_raw || '—'
  const trailerLabel = driver?.trailer_assignment_raw || 'no trailer'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 bg-gradient-to-r from-gray-50 to-white dark:from-slate-900/40 dark:to-slate-800/30 px-6 py-5">
      <div className="flex items-start gap-5">
        {/* Photo / Avatar */}
        <div className="shrink-0">
          {!loading && photoUrl ? (
            <img
              src={photoUrl}
              alt={driver?.full_name}
              className="w-24 h-32 object-cover rounded-lg ring-2 ring-orange-200 dark:ring-orange-500/30"
            />
          ) : (
            <div
              className="w-24 h-32 rounded-lg flex items-center justify-center text-3xl font-bold text-white ring-2 ring-orange-200 dark:ring-orange-500/30"
              style={{ background: initialsGradient }}
            >
              {monogram(driver?.full_name || '?')}
            </div>
          )}
        </div>

        {/* Info Block */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{driver?.full_name}</h2>
            {driver?.internal_id && (
              <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">
                #{driver.internal_id}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {driver?.current_status && <DriverStatusPill status={driver.current_status} />}
            {driver?.driver_type && <DriverTypePill type={driver.driver_type} />}
          </div>

          <p className="text-sm text-gray-600 dark:text-slate-400 mt-3 truncate">
            Driver #{driver?.internal_id || '—'} · Unit {truckLabel} · {trailerLabel}
            {driver?.carrier && <span> · {driver.carrier}</span>}
          </p>
        </div>
      </div>
    </div>
  )
}
