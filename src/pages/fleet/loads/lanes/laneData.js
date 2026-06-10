// Data layer for the Lane Flow Map. Read-only against v_load_leg_profit
// (Canceled already excluded there). Lanes are directional origin →
// destination aggregates; coordinates come from laneCityCoords.json, a
// static lookup generated once by scripts/geocode-lane-cities.mjs — no
// geocoding API is called at render time. Labels that never geocoded
// (e.g. a bare "FL") keep their lane in the leaderboard but stay off the
// map, and the coverage note says how many legs are drawable.

import { supabase } from '../../../../lib/supabase'
import coordsJson from './laneCityCoords.json'

export const CITY_COORDS = coordsJson.cities

// All legs in the window, paginated past Supabase's 1000-row cap so a
// long custom range can't silently truncate.
export async function fetchLaneLegs({ from, to, basis = 'delivery' }) {
  const dateCol = basis === 'pickup' ? 'pickup_date' : 'delivery_date'
  const out = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('v_load_leg_profit')
      .select('leg_id, load_id, load_number, status, is_projected, pickup_date, delivery_date, origin, destination, leg_revenue, leg_total_miles, customer_name')
      .gte(dateCol, from).lte(dateCol, to)
      .order(dateCol, { ascending: true }).order('leg_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// legs → { lanes, cities, totals, coverage } for one view (realized|booked).
export function aggregateLanes(allLegs, view) {
  const legs = (allLegs || []).filter(l => (view === 'booked' ? l.is_projected : !l.is_projected))
  const byLane = new Map()
  const byCity = new Map()
  let geocodedLegs = 0
  let totRevenue = 0, totMiles = 0

  for (const leg of legs) {
    const origin = String(leg.origin || '').trim()
    const destination = String(leg.destination || '').trim()
    const revenue = Number(leg.leg_revenue) || 0
    const miles = Number(leg.leg_total_miles) || 0
    totRevenue += revenue; totMiles += miles

    const key = `${origin} → ${destination}`
    let lane = byLane.get(key)
    if (!lane) {
      const oCoord = CITY_COORDS[origin] || null
      const dCoord = CITY_COORDS[destination] || null
      lane = {
        key, origin, destination, oCoord, dCoord,
        geocoded: !!(oCoord && dCoord),
        loads: 0, revenue: 0, miles: 0, legs: [],
      }
      byLane.set(key, lane)
    }
    lane.loads++; lane.revenue += revenue; lane.miles += miles
    lane.legs.push(leg)
    if (lane.geocoded) geocodedLegs++

    for (const [city, coord] of [[origin, lane.oCoord], [destination, lane.dCoord]]) {
      if (!coord) continue
      let c = byCity.get(city)
      if (!c) { c = { city, coord, revenue: 0, touches: 0 }; byCity.set(city, c) }
      c.revenue += revenue; c.touches++
    }
  }

  const lanes = [...byLane.values()]
  for (const lane of lanes) {
    lane.rpm = lane.miles > 0 ? lane.revenue / lane.miles : null
    lane.avgMiles = lane.loads > 0 ? lane.miles / lane.loads : 0
  }

  return {
    lanes,
    cities: [...byCity.values()],
    totals: {
      legs: legs.length,
      lanes: lanes.length,
      revenue: totRevenue,
      miles: totMiles,
      rpm: totMiles > 0 ? totRevenue / totMiles : null,
    },
    coverage: legs.length > 0 ? geocodedLegs / legs.length : null,
  }
}

// ── Scales ──────────────────────────────────────────────────────────────
function lerpHex(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
const RPM_STOPS = ['#f43f5e', '#fbbf24', '#34d399'] // weak → mid → strong $/mile
export const RPM_NULL_COLOR = '#64748b'

function quantile(sorted, p) {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Sequential $/mile color, domain clamped to the p10–p90 of the current
// lanes so one outlier lane doesn't flatten everything else to mid-tones.
export function makeRpmScale(lanes) {
  const vals = lanes.map(l => l.rpm).filter(v => v != null).sort((a, b) => a - b)
  const lo = quantile(vals, 0.1), hi = quantile(vals, 0.9)
  const colorAt = (t) => (t <= 0.5 ? lerpHex(RPM_STOPS[0], RPM_STOPS[1], t * 2) : lerpHex(RPM_STOPS[1], RPM_STOPS[2], (t - 0.5) * 2))
  return {
    domain: [lo, hi],
    color: (rpm) => {
      if (rpm == null) return RPM_NULL_COLOR
      if (hi <= lo) return RPM_STOPS[1]
      return colorAt(Math.min(1, Math.max(0, (rpm - lo) / (hi - lo))))
    },
    colorAt,
  }
}

// Arc thickness — sqrt so a 10× lane reads ~3× thicker, not 10×. The same
// normalized weight also drives arc opacity, so heavy lanes pop and the
// long tail of single-load lanes recedes instead of shouting at full volume.
export const WIDTH_RANGE = [1.1, 7]
export function makeWidthScale(lanes, weightKey) {
  const vals = lanes.map(l => Math.sqrt(Math.max(0, l[weightKey])))
  const lo = Math.min(...vals, Infinity), hi = Math.max(...vals, -Infinity)
  const [wMin, wMax] = WIDTH_RANGE
  return (lane) => {
    if (!isFinite(lo) || hi <= lo) return (wMin + wMax) / 2
    return wMin + ((Math.sqrt(Math.max(0, lane[weightKey])) - lo) / (hi - lo)) * (wMax - wMin)
  }
}

// Best/worst payer candidates: $/mile on a 1-load yard move (0.8 miles,
// $240/mi) isn't a lane verdict, and lanes with un-geocodable labels are
// data-quality suspects — neither should headline. Relax tier by tier so
// a sparse week still shows something.
export function pickPayers(lanes) {
  const tiers = [
    (l) => l.rpm != null && l.loads >= 2 && l.avgMiles >= 50 && l.geocoded,
    (l) => l.rpm != null && l.avgMiles >= 50 && l.geocoded,
    (l) => l.rpm != null,
  ]
  for (const fit of tiers) {
    const priced = lanes.filter(fit)
    if (!priced.length) continue
    let best = priced[0], worst = priced[0]
    for (const l of priced) {
      if (l.rpm > best.rpm) best = l
      if (l.rpm < worst.rpm) worst = l
    }
    return { best, worst, strict: fit === tiers[0] }
  }
  return null
}
