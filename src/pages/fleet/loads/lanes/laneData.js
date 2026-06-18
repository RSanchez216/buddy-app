// Data layer for the Lane Flow Map. Reads coordinates from v_lane_geo
// which joins with the geo_places table (US cities with lat/lng). Lanes are
// directional origin → destination aggregates; coordinates are DB-backed,
// not from static lookup. Missing cities/coordinates stay in the leaderboard
// but off the map, and coverage stats reflect actual geocoding success.

import { supabase } from '../../../../lib/supabase'

// All legs in the window, paginated past Supabase's 1000-row cap so a
// long custom range can't silently truncate. Reads from v_lane_geo which
// provides DB-backed coordinates (origin_lat, origin_lng, dest_lat, dest_lng)
// from the geo_places table.
export async function fetchLaneLegs({ from, to, basis = 'delivery' }) {
  const dateCol = basis === 'pickup' ? 'pickup_date' : 'delivery_date'
  const out = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('v_lane_geo')
      .select('leg_id, load_id, load_number, status, is_projected, load_phase, pickup_date, delivery_date, origin, destination, leg_revenue, leg_total_miles, customer_name, dispatcher_id, dispatcher_name, driver_display, trailer_id, trailer_display, origin_lat, origin_lng, dest_lat, dest_lng')
      .gte(dateCol, from).lte(dateCol, to)
      .order(dateCol, { ascending: true }).order('leg_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ── Trailer types ───────────────────────────────────────────────────────
// Loads imports carry only a trailer number — the type lives on the trailer
// profile, and legs can gain a trailer days later via the weekly assignment
// upload. So the type is resolved live at render time (leg.trailer_id →
// trailers.trailer_type), never snapshotted at import.
export const UNKNOWN_TYPE = 'Unknown'

export async function fetchTrailerTypes() {
  const { data, error } = await supabase.from('trailers').select('id, trailer_type')
  if (error) throw error
  const byId = new Map()
  for (const t of data || []) byId.set(t.id, t.trailer_type || null)
  return byId
}

// Annotate legs with their live-resolved type. No trailer assigned yet, an
// unmatched trailer_id, or a typeless profile all bucket as "Unknown" —
// visible in every filter/leaderboard, never silently dropped.
export function resolveLegTypes(legs, typeById) {
  return (legs || []).map(l => ({
    ...l,
    trailer_type: (l.trailer_id != null && typeById?.get(l.trailer_id)) || UNKNOWN_TYPE,
  }))
}

// Categorical palette for trailer types — assigned to the sorted type list
// so the same type keeps its color across chips, badges, arcs, and legends.
// Unknown is always gray.
const TYPE_PALETTE = ['#38bdf8', '#fb923c', '#2dd4bf', '#c084fc', '#f472b6', '#facc15', '#4ade80', '#fb7185']
export const UNKNOWN_TYPE_COLOR = '#64748b'
export function makeTypeColorMap(types) {
  const m = new Map()
  const known = [...new Set(types)].filter(t => t && t !== UNKNOWN_TYPE).sort((a, b) => a.localeCompare(b))
  known.forEach((t, i) => m.set(t, TYPE_PALETTE[i % TYPE_PALETTE.length]))
  m.set(UNKNOWN_TYPE, UNKNOWN_TYPE_COLOR)
  return m
}

// legs → { lanes, cities, totals, coverage } for selected phases.
// Accepts either phases (array of 'booked'|'in_transit'|'delivered') or
// legacy view ('booked'|'realized'). With byType, lanes split per trailer
// type (key gains the type, rows carry trailerType + typeIndex) so every
// $/mi figure is type-pure; the default keeps the original one-row-per-lane
// shape (Boardroom relies on it).
export function aggregateLanes(allLegs, phaseOrView, { byType = false } = {}) {
  // Support both new phases array and legacy view string
  let legs
  if (Array.isArray(phaseOrView)) {
    const phases = phaseOrView
    legs = (allLegs || []).filter(l => phases.includes(l.load_phase))
  } else {
    // Legacy view parameter support (for Boardroom, etc.)
    const view = phaseOrView
    legs = (allLegs || []).filter(l => (view === 'booked' ? l.is_projected : !l.is_projected))
  }
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

    const type = byType ? (leg.trailer_type || UNKNOWN_TYPE) : null
    const key = byType ? `${origin} → ${destination} · ${type}` : `${origin} → ${destination}`
    let lane = byLane.get(key)
    if (!lane) {
      // Use DB-backed coordinates (origin_lat, origin_lng, dest_lat, dest_lng)
      // from v_lane_geo / geo_places table. Null if city not found.
      const oCoord = (leg.origin_lat != null && leg.origin_lng != null) ? [leg.origin_lat, leg.origin_lng] : null
      const dCoord = (leg.dest_lat != null && leg.dest_lng != null) ? [leg.dest_lat, leg.dest_lng] : null
      lane = {
        key, origin, destination, oCoord, dCoord,
        geocoded: !!(oCoord && dCoord),
        loads: 0, revenue: 0, miles: 0, legs: [],
        ...(byType ? { trailerType: type } : {}),
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

  if (byType) {
    // Same-corridor type rows get an index so the map can fan their arcs
    // apart instead of drawing them exactly on top of each other.
    const byPair = new Map()
    for (const lane of lanes) {
      const pair = `${lane.origin} → ${lane.destination}`
      if (!byPair.has(pair)) byPair.set(pair, [])
      byPair.get(pair).push(lane)
    }
    for (const group of byPair.values()) {
      group.sort((a, b) => b.revenue - a.revenue)
      group.forEach((l, i) => { l.typeIndex = i })
    }
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
export function lerpHex(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
const RPM_STOPS = ['#f43f5e', '#fbbf24', '#34d399'] // weak → mid → strong $/mile
export const RPM_NULL_COLOR = '#64748b'

export function quantile(sorted, p) {
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
    // Sort by rpm to clearly find max (best) and min (worst) — avoid any
    // confusion from mixed min/max logic in a single loop.
    const sorted = [...priced].sort((a, b) => (a.rpm ?? 0) - (b.rpm ?? 0))
    return {
      best: sorted[sorted.length - 1], // max rpm
      worst: sorted[0], // min rpm
      strict: fit === tiers[0],
    }
  }
  return null
}
