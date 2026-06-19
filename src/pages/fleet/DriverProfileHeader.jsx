import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DriverTypePill, DriverStatusPill } from './fleetUtils'
import { nameHue, monogram, fmtMoney, fmtRpm, fmtNum } from './loads/spotlight/spotlightShared'

// Driver profile header with photo, name, status, and quick stats
export default function DriverProfileHeader({ driver }) {
  const [photoUrl, setPhotoUrl] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load photo signed URL and 7-day metrics
  useEffect(() => {
    (async () => {
      setLoading(true)

      // Load signed URL if photo exists
      if (driver?.photo_path) {
        const { data } = await supabase.storage
          .from('driver-avatars')
          .createSignedUrl(driver.photo_path, 3600)
        if (data?.signedUrl) {
          setPhotoUrl(data.signedUrl)
        }
      }

      // Load 7-day metrics
      if (driver?.id) {
        const to = new Date().toISOString().split('T')[0]
        const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

        const res = await supabase.rpc('load_profit_rollup', {
          p_dimension: 'driver',
          p_from: from,
          p_to: to,
          p_basis: 'delivery',
        })

        if (res.data) {
          const driverMetric = res.data.find(r => r.key_id === driver.id)
          if (driverMetric) {
            setMetrics({
              gross: Number(driverMetric.realized_revenue) || 0,
              rpm: driverMetric.realized_rpm == null ? null : Number(driverMetric.realized_rpm),
              loads: Number(driverMetric.realized_loads) || 0,
            })
          }
        }
      }
      setLoading(false)
    })()
  }, [driver?.photo_path, driver?.id])

  const h = nameHue(driver?.full_name || '')
  const initialsGradient = `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 42) % 360} 68% 34%))`
  const truckLabel = driver?.truck_assignment_raw || '—'
  const trailerLabel = driver?.trailer_assignment_raw || 'no trailer'

  // Status ring color
  const statusRingColor =
    driver?.current_status === 'active' ? '#16a34a' :
    ['contract', 'leased'].includes(driver?.current_status) ? '#b45309' :
    '#6b7280'

  return (
    <div
      className="rounded-xl border overflow-hidden shadow-sm bg-gradient-to-r from-[#fff3e9] via-[#fff7f0] to-white dark:from-[#0d0d1f] dark:via-[#0d0d1f] dark:to-[#0d0d1f] border-gray-200 dark:border-white/5"
      style={{
        position: 'relative',
      }}
    >
      {/* Orange left accent bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          background: 'linear-gradient(#f97316,#ea580c)',
        }}
      />

      {/* Content row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '22px', padding: '22px 26px' }}>
        {/* Photo with status ring */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              width: '116px',
              height: '148px',
              borderRadius: '18px',
              padding: '3px',
              background: `linear-gradient(135deg, ${statusRingColor}40, ${statusRingColor}20)`,
              position: 'relative',
            }}
          >
            {!loading && photoUrl ? (
              <img
                src={photoUrl}
                alt={driver?.full_name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: '50% 22%',
                  borderRadius: '15px',
                  border: '3px solid white',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '15px',
                  border: '3px solid white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  fontWeight: 'bold',
                  color: 'white',
                  background: initialsGradient,
                }}
              >
                {monogram(driver?.full_name || '?')}
              </div>
            )}
          </div>
          {/* Status dot */}
          <div
            style={{
              position: 'absolute',
              right: '-3px',
              bottom: '-3px',
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              background: statusRingColor,
              border: '3px solid white',
            }}
          />
        </div>

        {/* Identity block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
            <h2 className="text-slate-900 dark:text-slate-100" style={{ fontSize: '24px', fontWeight: '700', letterSpacing: '-0.01em', margin: 0 }}>
              {driver?.full_name}
            </h2>
            {driver?.internal_id && (
              <span
                className="dark:bg-slate-800 dark:text-slate-300"
                style={{
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  color: '#94a3b8',
                  background: '#f1f5f9',
                  padding: '2px 8px',
                  borderRadius: '6px',
                }}
              >
                {driver.internal_id}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', margin: '11px 0 9px' }}>
            {driver?.current_status && <DriverStatusPill status={driver.current_status} />}
            {driver?.driver_type && <DriverTypePill type={driver.driver_type} />}
          </div>

          <p className="text-slate-500 dark:text-slate-400" style={{ fontSize: '13px', margin: 0 }}>
            Driver #{driver?.internal_id || '—'} · Unit {truckLabel} · {trailerLabel}
            {driver?.carrier && ` · ${driver.carrier}`}
          </p>
        </div>

        {/* Quick stats */}
        <div
          className="dark:border-slate-700/40"
          style={{
            display: 'flex',
            flexShrink: 0,
            alignSelf: 'stretch',
            alignItems: 'center',
            borderLeft: '1px solid #eef1f5',
            paddingLeft: '20px',
            marginLeft: '10px',
            gap: 0,
          }}
        >
          <StatCell label="Gross (7d)" value={metrics ? fmtMoney(metrics.gross) : '—'} highlight />
          <StatCell label="$/Mile" value={metrics ? (metrics.rpm ? fmtRpm(metrics.rpm) : '—') : '—'} />
          <StatCell label="Loads" value={metrics ? fmtNum(metrics.loads) : '—'} />
          <StatCell label="Comp" value={driver?.compensation_value ? `${driver.compensation_value}%` : '—'} />
        </div>
      </div>
    </div>
  )
}

function StatCell({ label, value, highlight }) {
  return (
    <div
      className="dark:border-slate-700/40"
      style={{
        padding: '0 18px',
        borderRight: '1px solid #eef1f5',
      }}
    >
      <div className="text-slate-500 dark:text-slate-400" style={{ fontSize: '9.5px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, margin: 0 }}>
        {label}
      </div>
      <div
        className={highlight ? 'text-orange-600 dark:text-orange-500' : 'text-slate-900 dark:text-slate-100'}
        style={{
          fontFamily: 'monospace',
          fontSize: '19px',
          fontWeight: 600,
          marginTop: '5px',
        }}
      >
        {value}
      </div>
    </div>
  )
}
