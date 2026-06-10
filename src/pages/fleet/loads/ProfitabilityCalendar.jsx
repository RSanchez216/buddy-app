import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'

// Planner-style weekly calendar: drivers as rows, days as columns, loads as
// multi-day chips. Read-only utilization view — booking/timing/detention stay
// in the TMS. Sort by weekly realized gross desc; search filters by driver name.

function parseLocalYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function daysBetween(from, to) {
  const a = parseLocalYmd(from); a.setHours(0, 0, 0, 0)
  const b = parseLocalYmd(to); b.setHours(0, 0, 0, 0)
  return Math.round((b - a) / 86400000)
}

function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtNum(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtShortDate(s) {
  if (!s) return '—'
  const [, m, d] = String(s).split('-').map(Number)
  return `${m}/${d}`
}

const IN_TRANSIT_STATUSES = ['at shipper', 'at receiver', 'delayed', 'in transit', 'out for delivery']
function chipVariant(status, is_projected) {
  if (is_projected) return 'booked'
  if (IN_TRANSIT_STATUSES.some(t => (status || '').toLowerCase().includes(t))) return 'in_transit'
  return 'realized'
}

// Compute grid position for a chip: which day columns it spans.
function chipGeometry(leg, weekStart, weekEnd) {
  const pickupDay = daysBetween(weekStart, leg.pickup_date)
  const deliveryDay = daysBetween(weekStart, leg.delivery_date || leg.pickup_date)
  const colStart = Math.max(0, Math.min(6, pickupDay))
  const colEnd = Math.max(0, Math.min(6, deliveryDay))
  return {
    colStart,
    colEnd,
    clippedLeft:  leg.pickup_date < weekStart,
    clippedRight: (leg.delivery_date || leg.pickup_date) > weekEnd,
  }
}

// Greedy track assignment: sort chips by colStart, pack into the first available
// track (no two chips share a day on the same track).
function assignTracks(chips) {
  const sorted = [...chips].sort((a, b) => a.colStart - b.colStart)
  const trackEnds = []
  return sorted.map(chip => {
    let t = trackEnds.findIndex(end => end < chip.colStart)
    if (t === -1) { t = trackEnds.length; trackEnds.push(chip.colEnd + 1) }
    else trackEnds[t] = chip.colEnd + 1
    return { ...chip, track: t }
  })
}

// Summarize a driver's week: trips, miles, gross, rpm, booked, idle days.
// Only realized legs count for trips/miles/gross (basis_date in week).
function driverSummary(legs, weekStart, weekEnd, basis = 'delivery') {
  const basisDate = l => l[`${basis}_date`] || l.delivery_date
  const realized = legs.filter(l => !l.is_projected && basisDate(l) >= weekStart && basisDate(l) <= weekEnd)
  const booked = legs.filter(l => l.is_projected)
  const realDays = new Set(realized.map(basisDate))
  const trips = new Set(realized.map(l => l.load_id)).size
  const miles = realized.reduce((s, l) => s + Number(l.leg_total_miles || 0), 0)
  const gross = realized.reduce((s, l) => s + Number(l.leg_revenue || 0), 0)
  const rpm = miles > 0 ? gross / miles : null
  const bookedCount = new Set(booked.map(l => l.load_id)).size
  const bookedRevenue = booked.reduce((s, l) => s + Number(l.leg_revenue || 0), 0)
  const idleDays = 7 - realDays.size
  return { trips, miles, gross, rpm, bookedCount, bookedRevenue, idleDays }
}

export default function ProfitabilityCalendar({ weekStart, weekEnd, basis = 'delivery' }) {
  const toast = useToast()
  const [legs, setLegs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      let q = supabase.from('v_load_leg_profit')
        .select('leg_id,load_id,load_number,driver_id,driver_display,truck_display,trailer_display,pickup_date,delivery_date,leg_revenue,leg_total_miles,linehaul,status,is_projected,origin,destination')
        .not('status', 'ilike', 'canceled')
      if (basis === 'pickup') {
        q = q.gte('pickup_date', weekStart).lte('pickup_date', weekEnd)
      } else {
        q = q.gte('delivery_date', weekStart).lte('delivery_date', weekEnd)
      }
      const { data, error } = await q
      if (error) { toast.error("Couldn't load calendar", error); setLoading(false); return }
      setLegs(data || [])
      setLoading(false)
    })()
  }, [weekStart, weekEnd, toast, basis])

  // Group by driver; keyed by driver_id || driver_display
  const drivers = useMemo(() => {
    const map = new Map()
    for (const leg of legs) {
      const key = leg.driver_id || leg.driver_display
      if (!map.has(key)) {
        map.set(key, {
          key, display: leg.driver_display, truck: leg.truck_display, trailer: leg.trailer_display,
          legs: []
        })
      }
      map.get(key).legs.push(leg)
    }
    // Sort by weekly realized gross descending
    return Array.from(map.values()).sort((a, b) => {
      const aGross = driverSummary(a.legs, weekStart, weekEnd, basis).gross
      const bGross = driverSummary(b.legs, weekStart, weekEnd, basis).gross
      return bGross - aGross
    })
  }, [legs, weekStart, weekEnd, basis])

  // Filter by search
  const filtered = useMemo(
    () => drivers.filter(d => d.display.toLowerCase().includes(search.toLowerCase())),
    [drivers, search]
  )

  // Footer: week totals (sum all drivers' summaries)
  const weekTotals = useMemo(() => {
    const allLegs = filtered.flatMap(d => d.legs)
    return driverSummary(allLegs, weekStart, weekEnd, basis)
  }, [filtered, weekStart, weekEnd, basis])

  // Day labels (Mon–Sun); today highlight
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekStartDate = parseLocalYmd(weekStart); weekStartDate.setHours(0, 0, 0, 0)
  const dayLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartDate); d.setDate(d.getDate() + i)
    const isToday = d.getTime() === today.getTime()
    return {
      date: d,
      label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }),
      isToday,
    }
  })

  if (loading) {
    return (
      <div className={`${S.card} overflow-hidden`}>
        <div className="flex items-center justify-center py-20">
          <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Search + Legend */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Filter drivers…"
            className={`${S.input} w-full md:max-w-xs`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-slate-700 dark:bg-slate-600" />
            <span>Realized</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-400 dark:bg-amber-500" />
            <span>Booked</span>
          </div>
          <span>· Canceled excluded</span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className={`${S.card} max-h-[70vh] overflow-auto`}>
        <div className="inline-block min-w-full" style={{ display: 'grid', gridTemplateColumns: '180px repeat(7, minmax(80px, 1fr)) 200px', gap: '0.5px', backgroundColor: '#f3f4f6', padding: '0.5px' }}>
          {/* Header row (top-left corner, day headers, summary header) */}
          <div className="sticky top-0 left-0 z-30 bg-gray-50 dark:bg-[#0d0d1f] border-b border-gray-200 dark:border-white/5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-400" />
          {dayLabels.map(day => (
            <div key={day.date.toISOString()} className={`sticky top-0 z-20 text-center px-2 py-2 text-xs font-semibold border-b border-gray-200 dark:border-white/5 ${
              day.isToday ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-gray-50 dark:bg-[#0d0d1f] text-gray-600 dark:text-slate-400'
            }`}>
              {day.label}
            </div>
          ))}
          <div className="sticky top-0 right-0 z-30 bg-gray-50 dark:bg-[#0d0d1f] border-b border-gray-200 dark:border-white/5 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-400">Summary</div>

          {/* Driver rows */}
          {filtered.map(driver => {
            const summary = driverSummary(driver.legs, weekStart, weekEnd, basis)
            const trucks    = [...new Set(driver.legs.map(l => l.truck_display).filter(Boolean))]
            const trailers  = [...new Set(driver.legs.map(l => l.trailer_display).filter(Boolean))]
            const truckLabel   = trucks.length === 1 ? trucks[0] : trucks.length > 1 ? `varies (${trucks.length})` : '—'
            const trailerLabel = trailers.length === 1 ? trailers[0] : trailers.length > 1 ? `varies (${trailers.length})` : '—'
            const chips = assignTracks(
              driver.legs.map(leg => ({
                ...leg,
                ...chipGeometry(leg, weekStart, weekEnd),
                variant: chipVariant(leg.status, leg.is_projected),
              }))
            )
            const maxTrack = chips.length === 0 ? 0 : Math.max(...chips.map(c => c.track))
            return (
              <div key={driver.key} className="contents">
                {/* Driver cell (sticky left) */}
                <div className="sticky left-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-white/[0.03] px-3 py-3 text-xs font-medium text-gray-900 dark:text-slate-200 min-h-[80px]" style={{ minWidth: '180px' }}>
                  <div className="truncate">{driver.display}</div>
                  <div className="text-[10px] text-gray-500 dark:text-slate-500 mt-0.5 truncate" title={trucks.length > 1 ? trucks.join(', ') : undefined}>{truckLabel}</div>
                  <div className="text-[10px] text-gray-500 dark:text-slate-500 truncate" title={trailers.length > 1 ? trailers.join(', ') : undefined}>{trailerLabel || '—'}</div>
                </div>

                {/* Chips area (7 columns, stacked by track) */}
                <div className="col-span-7 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-white/[0.03] p-0.5 relative" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, minHeight: `${36 * (maxTrack + 1) + 8}px` }}>
                  {/* Day dividers (sentinel cells define row height) */}
                  {dayLabels.map((_, i) => (
                    <div key={i} style={{ gridColumn: i + 1, minHeight: 36 }} className="border-r border-gray-200 dark:border-white/5" />
                  ))}
                  {/* Load chips */}
                  {chips.map(chip => {
                    const baseClass = chip.variant === 'booked'
                      ? 'bg-amber-400 dark:bg-amber-500 text-slate-900'
                      : 'bg-slate-700 dark:bg-slate-600 text-white'
                    return (
                      <div
                        key={chip.leg_id}
                        style={{ gridColumn: `${chip.colStart + 1} / span ${Math.max(1, chip.colEnd - chip.colStart + 1)}` }}
                        className={`relative ${baseClass} rounded overflow-hidden text-[10px] font-medium ${chip.clippedLeft ? 'rounded-l-none' : ''} ${chip.clippedRight ? 'rounded-r-none' : ''}`}
                      >
                        {chip.clippedLeft && (
                          <span
                            title={`Pickup: ${chip.pickup_date}`}
                            className="absolute left-0 top-0 bottom-0 flex items-center px-1 bg-sky-500 text-white text-[10px] font-bold rounded-l"
                          >◀</span>
                        )}
                        <div className={`px-1 py-0.5 ${chip.clippedLeft ? 'ml-5' : ''} ${chip.clippedRight ? 'mr-5' : ''}`}>
                          <div className="truncate">{chip.load_number} · {fmtMoney(chip.linehaul)}</div>
                          <div className="text-[9px] opacity-80 truncate">{chip.origin} → {chip.destination}</div>
                          <div className="text-[9px] opacity-70 truncate" title={`PU ${chip.pickup_date} → DEL ${chip.delivery_date || chip.pickup_date}`}>
                            PU {fmtShortDate(chip.pickup_date)} → DEL {fmtShortDate(chip.delivery_date || chip.pickup_date)}
                          </div>
                        </div>
                        {chip.clippedRight && (
                          <span
                            title={`Delivery: ${chip.delivery_date}`}
                            className="absolute right-0 top-0 bottom-0 flex items-center px-1 bg-sky-500 text-white text-[10px] font-bold rounded-r"
                          >▶</span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Summary cell (sticky right) */}
                <div className="sticky right-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-white/[0.03] px-3 py-3 text-[11px] text-gray-600 dark:text-slate-400 min-h-[80px] grid grid-cols-2 gap-2" style={{ minWidth: '200px' }}>
                  <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{fmtNum(summary.trips)}</span><span>trips</span></div>
                  <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{fmtNum(summary.miles)}</span><span>miles</span></div>
                  <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{fmtMoney(summary.gross)}</span><span>gross</span></div>
                  <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{summary.rpm ? `$${summary.rpm.toFixed(2)}` : '—'}</span><span>$/mi</span></div>
                  {summary.bookedCount > 0 && (
                    <div className="col-span-2 text-amber-700 dark:text-amber-400 font-medium text-[10px] pt-0.5 border-t border-amber-200 dark:border-amber-500/30">
                      {fmtMoney(summary.bookedRevenue)} booked
                    </div>
                  )}
                  {summary.idleDays > 0 && summary.trips > 0 && (
                    <div className="col-span-2 text-gray-500 dark:text-slate-500 text-[10px] pt-0.5 border-t border-gray-200 dark:border-white/10">
                      {summary.idleDays} {summary.idleDays === 1 ? 'day' : 'days'} w/o delivery
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Footer row (week totals) */}
          {filtered.length > 0 && (
            <>
              <div className="bg-gray-50 dark:bg-[#0d0d1f] border-t-2 border-gray-200 dark:border-white/10 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-400">Totals · {filtered.length} drivers</div>
              {dayLabels.map((_, i) => (
                <div key={i} className="bg-gray-50 dark:bg-[#0d0d1f] border-t-2 border-gray-200 dark:border-white/10 border-r border-gray-200 dark:border-white/5" />
              ))}
              <div className="bg-gray-50 dark:bg-[#0d0d1f] border-t-2 border-gray-200 dark:border-white/10 px-3 py-2 text-[11px] text-gray-600 dark:text-slate-400 grid grid-cols-2 gap-2">
                <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{fmtNum(weekTotals.trips)}</span><span>trips</span></div>
                <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{fmtNum(weekTotals.miles)}</span><span>miles</span></div>
                <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{fmtMoney(weekTotals.gross)}</span><span>gross</span></div>
                <div><span className="block text-xs font-semibold text-gray-900 dark:text-slate-200">{weekTotals.rpm ? `$${weekTotals.rpm.toFixed(2)}` : '—'}</span><span>$/mi</span></div>
                {weekTotals.bookedRevenue > 0 && (
                  <div className="col-span-2 text-amber-700 dark:text-amber-400 font-medium text-[10px] pt-0.5 border-t border-amber-200 dark:border-amber-500/30">
                    {fmtMoney(weekTotals.bookedRevenue)} booked
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {filtered.length === 0 && !loading && (
        <div className={`${S.card} text-center py-8 text-gray-400 dark:text-slate-600 text-sm`}>
          No drivers with loads this week.
        </div>
      )}
    </div>
  )
}
