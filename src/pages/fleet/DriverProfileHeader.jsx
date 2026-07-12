import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DriverTypePill, DriverStatusPill, fmtDate } from './fleetUtils'
import { nameHue, monogram, fmtMoney, fmtRpm, fmtNum } from './loads/spotlight/spotlightShared'
import PossiblyHomeChip from './PossiblyHomeChip'
import { useDriverContracts } from '../../hooks/useDriverContracts'
import BehindOnPurchaseChip from '../driver-purchases/components/BehindChip'

// Driver profile header with photo, name, status, quick stats, and load activity.
// `activity` is a driver_activity_snapshot row (or null): { currently_running,
// days_idle, last_origin, last_destination, last_delivery_date, … }.
export default function DriverProfileHeader({ driver, activity }) {
  const [photoUrl, setPhotoUrl] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [homeInfo, setHomeInfo] = useState(null) // { driverId, ...driver_possibly_home row }

  // When the driver is idle (not running), check whether their last delivery
  // was near home so the hero can show a "Possibly home" chip. Tag the result
  // with driverId so a stale fetch never renders against a different driver.
  const idle = !!activity && !activity.currently_running && activity.days_idle != null
  useEffect(() => {
    if (!driver?.id || !idle) return
    let cancelled = false
    supabase.rpc('driver_possibly_home', { p_driver_id: driver.id })
      .then(({ data }) => { if (!cancelled) setHomeInfo({ driverId: driver.id, ...(data?.[0] || {}) }) })
    return () => { cancelled = true }
  }, [driver?.id, idle])
  const currentHome = idle && homeInfo?.driverId === driver?.id ? homeInfo : null

  // Driver-purchase contracts + behind status, for the cross-surface links.
  const { hasContract, isBehind, totalPastDue, purchasesHref, contractHref } = useDriverContracts(driver?.id)

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', minWidth: 0 }}>
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
            {driver?.id && (
              <div className="shrink-0 flex items-center gap-2">
                <Link
                  to={`/fleet/profitability/spotlight?driver=${driver.id}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-orange-700 dark:text-orange-300 bg-white/70 dark:bg-white/5 border border-orange-300/70 dark:border-orange-500/30 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="8" strokeWidth={1.8} /><circle cx="12" cy="12" r="2.5" strokeWidth={1.8} /></svg>
                  View in Spotlight
                </Link>
                {hasContract && (
                  <Link
                    to={purchasesHref}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-cyan-700 dark:text-cyan-300 bg-white/70 dark:bg-white/5 border border-cyan-300/70 dark:border-cyan-500/30 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 7h6m-6 4h6m-6 4h4M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" /></svg>
                    Driver Purchases
                  </Link>
                )}
              </div>
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

          <ActivityCallout activity={activity} homeInfo={currentHome} />
          {isBehind && (
            <div className="mt-2">
              <BehindOnPurchaseChip href={contractHref} totalPastDue={totalPastDue} />
            </div>
          )}
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

// Load-activity callout — distinct from the employment-status pill. Running is
// the good, understated state ("On the road"); idle is highlighted amber so a
// sitting driver reads at a glance, with the last completed load beside it.
function ActivityCallout({ activity, homeInfo }) {
  if (activity?.currently_running) {
    return (
      <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/25">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        On the road
      </div>
    )
  }
  if (activity?.days_idle != null) {
    const d = activity.days_idle
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg bg-amber-100/70 dark:bg-amber-500/10 border border-amber-300/70 dark:border-amber-500/30 border-l-4 border-l-amber-500 dark:border-l-amber-400">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth={1.8} /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 7v5l3 2" /></svg>
          {d} day{d === 1 ? '' : 's'} idle
        </span>
        {activity.last_origin && activity.last_destination && (
          <span className="text-xs text-amber-700/90 dark:text-amber-200/80">
            <span className="font-semibold">Last load:</span> {activity.last_origin} → {activity.last_destination} · delivered {fmtDate(activity.last_delivery_date)}
          </span>
        )}
        {homeInfo?.possibly_home && <PossiblyHomeChip info={homeInfo} />}
      </div>
    )
  }
  return <p className="mt-2.5 text-xs italic text-slate-400 dark:text-slate-500">No completed loads</p>
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
