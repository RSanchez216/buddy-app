// Data layer for the Lane Flow Map. Reads coordinates from v_lane_geo
// which joins with the geo_places table (US cities with lat/lng). Lanes are
// directional origin → destination aggregates; coordinates are DB-backed,
// not from static lookup. Missing cities/coordinates stay in the leaderboard
// but off the map, and coverage stats reflect actual geocoding success.

import { supabase } from '../../../../lib/supabase'
import { trailerTypeColor } from '../spotlight/spotlightShared'

// Load statuses to exclude from best/worst ranking (e.g., TONU, cancellations).
// Match is case-sensitive on the load's status value. Add more as needed.
export const EXCLUDED_STATUSES = ['Tonu']

// All legs in the window, paginated past Supabase's 1000-row cap so a
// long custom range can't silently truncate. Reads from v_lane_geo which
// provides DB-backed coordinates (origin_lat, origin_lng, dest_lat, dest_lng)
// from the geo_places table.
export async function fetchLaneLegs({ from, to, basis = 'delivery' }) {
  const dateCol = basis === 'pickup' ? 'pickup_date' : 'delivery_date'
  const out = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('v_lane_geo')
      .select('leg_id, load_id, load_number, status, is_tonu, is_projected, load_phase, pickup_date, delivery_date, origin, destination, leg_revenue, leg_total_miles, leg_loaded_miles, leg_empty_miles, customer_name, dispatcher_id, dispatcher_name, driver_display, trailer_id, trailer_display, effective_trailer_id, effective_trailer_unit, effective_trailer_type, trailer_inferred, origin_lat, origin_lng, dest_lat, dest_lng')
      .gte(dateCol, from).lte(dateCol, to)
      .order(dateCol, { ascending: true }).order('leg_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  // combine_group_id and trailer_required live on v_load_leg_profit (not
  // v_lane_geo), so stamp the two rare buckets onto the legs: combined loads
  // and own-trailer (trailer_required=false, e.g. Amazon) loads. Two tiny reads
  // (each returns only a handful of rows); unstamped legs stay undefined (→
  // non-combined / trailer-required everywhere downstream).
  try {
    const [combos, ownTrailer] = await Promise.all([
      supabase.from('v_load_leg_profit').select('leg_id, combine_group_id')
        .not('combine_group_id', 'is', null).gte(dateCol, from).lte(dateCol, to),
      supabase.from('v_load_leg_profit').select('leg_id')
        .eq('trailer_required', false).gte(dateCol, from).lte(dateCol, to),
    ])
    if (!combos.error && combos.data?.length) {
      const groupByLeg = new Map(combos.data.map(c => [c.leg_id, c.combine_group_id]))
      for (const leg of out) {
        const gid = groupByLeg.get(leg.leg_id)
        if (gid) leg.combine_group_id = gid
      }
    }
    if (!ownTrailer.error && ownTrailer.data?.length) {
      const ownLegs = new Set(ownTrailer.data.map(r => r.leg_id))
      for (const leg of out) if (ownLegs.has(leg.leg_id)) leg.trailer_required = false
    }
  } catch { /* non-fatal: combine/Amazon styling just won't apply this load */ }

  return out
}

// Region/state revenue rollup for the "Lanes by region & state" geo map.
// Built client-side off v_lane_geo (grouped by origin/dest region or state)
// rather than the lane_geo_rollup RPC: that RPC filters to legs with
// leg_total_miles > 0, which silently drops a no-mileage leg's revenue from
// its region tile (a single zero-mile Midwest leg made Midwest under-report
// vs. the true origin revenue). Region membership comes straight from
// v_lane_geo.origin_region / dest_region (derived from state_region), so the
// tiles can't diverge from the DB. Gross and load counts include every leg
// that has a region/state; $/mi still uses only legs with positive miles so
// the rate isn't distorted by the zero-mile legs. Date window mirrors the
// RPC: coalesce(delivery_date, pickup_date) within [from, to]. Returns rows
// shaped like the RPC's output ({ unit, legs, gross, avg_rev_per_load, rpm }).
// trailerType (optional): single trailer-type filter for the region/state map,
// matching lane_geo_rollup's 6th-arg semantics — a named type filters on
// effective_trailer_type; 'Unknown' matches legs with a NULL effective type
// (COALESCE(effective_trailer_type,'Unknown')); null/undefined = all types. We
// filter here rather than via the RPC so the zero-mile-revenue fix above holds.
export async function fetchLaneGeoRollup({ from, to, basis = 'origin', grain = 'region', phases = ['in_transit', 'delivered'], trailerType = null }) {
  const unitCol = grain === 'state'
    ? (basis === 'destination' ? 'dest_state' : 'origin_state')
    : (basis === 'destination' ? 'dest_region' : 'origin_region')

  const rows = []
  for (let page = 0; ; page++) {
    let query = supabase.from('v_lane_geo')
      .select(`${unitCol}, leg_id, leg_revenue, leg_total_miles`)
      .in('load_phase', phases)
      // coalesce(delivery_date, pickup_date) BETWEEN from AND to
      .or(`and(delivery_date.gte.${from},delivery_date.lte.${to}),and(delivery_date.is.null,pickup_date.gte.${from},pickup_date.lte.${to})`)
    if (trailerType === UNKNOWN_TYPE) query = query.is('effective_trailer_type', null)
    else if (trailerType) query = query.eq('effective_trailer_type', trailerType)
    const { data, error } = await query
      .order('leg_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }

  const acc = new Map()
  for (const r of rows) {
    const unit = r[unitCol]
    if (unit == null) continue // genuinely no state/region → excluded (as the RPC did)
    let a = acc.get(unit)
    if (!a) { a = { unit, legs: 0, gross: 0, milesRev: 0, miles: 0 }; acc.set(unit, a) }
    const rev = Number(r.leg_revenue) || 0
    const mi = Number(r.leg_total_miles) || 0
    a.legs += 1
    a.gross += rev
    if (mi > 0) { a.miles += mi; a.milesRev += rev }
  }
  return [...acc.values()].map(a => ({
    unit: a.unit,
    legs: a.legs,
    gross: Math.round(a.gross),
    avg_rev_per_load: a.legs ? Math.round(a.gross / a.legs) : null,
    rpm: a.miles > 0 ? Math.round((a.milesRev / a.miles) * 100) / 100 : null,
  }))
}

// ── Trailer types ───────────────────────────────────────────────────────
// Type classification now uses v_lane_geo.effective_trailer_type — the linked
// trailer, or the one inferred from the driver's assignment window when the load
// has no linked trailer. So we no longer recompute from trailer_id; "Unknown" is
// only when effective_trailer_type is genuinely NULL (no covering assignment).
export const UNKNOWN_TYPE = 'Unknown'
// Own-trailer customers (Amazon et al.) legitimately have no trailer — bucketed
// separately so genuine gaps don't hide inside Unknown. Driven off the
// trailer_required flag, not a customer name, so new own-trailer customers stay
// correct; the label can stay "Amazon" for now.
export const AMAZON_TYPE = 'Amazon'

// Bucket each leg's display type: the effective trailer if present; else Amazon
// when the load doesn't require a trailer (trailer_required === false); else a
// genuine Unknown (trailer required but none linked/inferred).
export function resolveLegTypes(legs) {
  return (legs || []).map(l => ({
    ...l,
    trailer_type: l.effective_trailer_type || (l.trailer_required === false ? AMAZON_TYPE : UNKNOWN_TYPE),
  }))
}

// Trailer-type → color for the Lane Map chips + "Color: type" arcs. Reads the
// one shared palette (spotlightShared) so every type matches the Trailer Type
// Trends chart exactly — no separate Lane Map palette. Amazon keeps its indigo;
// the synthetic Unknown bucket (and any unmatched type) falls through to the
// shared slate fallback (#475569).
export function makeTypeColorMap(types) {
  const m = new Map()
  for (const t of new Set(types)) {
    if (t) m.set(t, trailerTypeColor(t))
  }
  // Guarantee the two synthetic buckets resolve even when absent from `types`.
  m.set(AMAZON_TYPE, trailerTypeColor(AMAZON_TYPE))
  m.set(UNKNOWN_TYPE, trailerTypeColor(UNKNOWN_TYPE))
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
  // "real" = confirmed-non-TONU (is_tonu !== true: keep NULL + false, drop only
  // true). Rates ($/mi, avg mi) use the real sums; dollars/counts use all.
  let realRevenue = 0, realMiles = 0

  for (const leg of legs) {
    const origin = String(leg.origin || '').trim()
    const destination = String(leg.destination || '').trim()
    const revenue = Number(leg.leg_revenue) || 0
    const miles = Number(leg.leg_total_miles) || 0
    const real = leg.is_tonu !== true
    totRevenue += revenue; totMiles += miles
    if (real) { realRevenue += revenue; realMiles += miles }

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
        realRevenue: 0, realMiles: 0, realLegs: 0, realEmptyMiles: 0, realLoadedMiles: 0,
        ...(byType ? { trailerType: type } : {}),
      }
      byLane.set(key, lane)
    }
    lane.loads++; lane.revenue += revenue; lane.miles += miles
    if (real) {
      lane.realRevenue += revenue; lane.realMiles += miles; lane.realLegs++
      // Effective (override-aware) empty — the deadhead the system actually
      // counts. `miles` is leg_total_miles = COALESCE(override, total), so a load
      // corrected to loaded-only yields 0 empty; falls back to raw when total is
      // missing. Same formula as the miles-review list + Miles & Performance.
      const loaded = Number(leg.leg_loaded_miles) || 0
      const rawEmpty = Number(leg.leg_empty_miles) || 0
      const effTotal = miles > 0 ? miles : (loaded + rawEmpty)
      lane.realEmptyMiles += Math.max(0, effTotal - loaded)
      lane.realLoadedMiles += loaded
    }
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
    // $/mi and avg mi EXCLUDE TONU (real freight only). A lane whose only
    // activity was a confirmed TONU has null rate/miles → renders "—".
    lane.rpm = lane.realMiles > 0 ? lane.realRevenue / lane.realMiles : null
    lane.avgMiles = lane.realLegs > 0 ? lane.realMiles / lane.realLegs : null
    // Deadhead signals over the lane's real (TONU-excluded) legs: average empty
    // miles per load (the tiering signal) + empty share of total (tooltip only).
    lane.avgEmptyPerLoad = lane.realLegs > 0 ? lane.realEmptyMiles / lane.realLegs : null
    lane.deadheadPct = lane.realMiles > 0 ? lane.realEmptyMiles / lane.realMiles : null
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

  // Aggregate legs to load level for best/worst load ranking
  const byLoad = new Map()
  for (const leg of legs) {
    const loadId = leg.load_id
    if (!byLoad.has(loadId)) {
      byLoad.set(loadId, {
        load_id: loadId,
        load_number: leg.load_number,
        status: leg.status,
        is_tonu: leg.is_tonu ?? null, // shared across a load's legs
        legs: [],
        revenue: 0,
        miles: 0,
        trailer_type: leg.trailer_type || UNKNOWN_TYPE,
      })
    }
    const load = byLoad.get(loadId)
    load.legs.push(leg)
    load.revenue += Number(leg.leg_revenue) || 0
    load.miles += Number(leg.leg_total_miles) || 0
  }

  // Compute metrics and derive lane from first→last leg
  const loads = [...byLoad.values()].map(load => ({
    ...load,
    rpm: load.miles > 0 ? load.revenue / load.miles : null,
    // Lane = origin of first leg → destination of last leg (ordered by seq or appearance)
    origin: load.legs[0]?.origin || '',
    destination: load.legs[load.legs.length - 1]?.destination || '',
    // Miles-editor targets a single leg. Expose leg_id only for single-leg loads
    // (the common case); loaded/empty summed for the editor's context display.
    leg_id: load.legs.length === 1 ? load.legs[0].leg_id : null,
    loaded_miles: load.legs.reduce((s, l) => s + (Number(l.leg_loaded_miles) || 0), 0),
    empty_miles: load.legs.reduce((s, l) => s + (Number(l.leg_empty_miles) || 0), 0),
    total_miles: load.miles,
  }))

  // Confirmed-TONU loads in scope — drives the "+N TONU excluded" footnote.
  const tonuLoads = loads.filter(l => l.is_tonu === true).length

  return {
    lanes,
    loads,
    cities: [...byCity.values()],
    totals: {
      legs: legs.length,
      // Distinct loads (a multi-leg load is one load) — for the LOADS KPI.
      // Revenue/miles include TONU; $/mi excludes it (real sums).
      loads: byLoad.size,
      // Actual moved freight — distinct loads excluding confirmed TONU
      // (is_tonu IS NOT TRUE). This is the headline LOADS number; TONU shows
      // as a separate "+N TONU" sub-note.
      loadsMoved: byLoad.size - tonuLoads,
      lanes: lanes.length,
      revenue: totRevenue,
      miles: totMiles,
      rpm: realMiles > 0 ? realRevenue / realMiles : null,
      tonuLoads,
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

// Best/worst individual loads, ranked by the specified metric.
// metric: 'revenue' | 'rpm' | 'loads' (loads defaults to 'rpm')
// Returns { best, worst } or null if no loads.
export function pickLoads(loads, metric = 'rpm') {
  if (!loads || !loads.length) return null

  // 'loads' is a count and doesn't rank a single load; default to rpm
  const rankBy = metric === 'loads' ? 'rpm' : metric

  // Filter based on metric: revenue has no restrictions; rpm excludes 0-mile loads
  let candidates = loads
  if (rankBy === 'rpm') {
    candidates = loads.filter(l => l.miles > 0 && l.rpm != null)
  }
  if (!candidates.length) return null

  let best, worst
  if (rankBy === 'revenue') {
    // Sort by revenue (ascending), then pick min and max
    const sorted = [...candidates].sort((a, b) => (a.revenue ?? 0) - (b.revenue ?? 0))
    worst = sorted[0]
    best = sorted[sorted.length - 1]
  } else {
    // rpm: sort by rpm (ascending)
    const sorted = [...candidates].sort((a, b) => (a.rpm ?? 0) - (b.rpm ?? 0))
    worst = sorted[0]
    best = sorted[sorted.length - 1]
  }

  return { best, worst }
}

// Best/worst individual loads by both revenue and rpm metrics simultaneously.
// Excludes loads with statuses in the exclusion list (e.g., TONU).
// Minimum mileage for a load to qualify for the $/mi best/worst cards. Below
// this, $/mi is noise — a sub-mile yard move can read $240/mi and isn't a lane
// verdict. Applies ONLY to the two $/mi cards; the revenue cards are unfiltered.
export const MIN_MILES_FOR_RPM_CARD = 50

// Returns { bestByRevenue, worstByRevenue, bestByRpm, worstByRpm } or null if no loads.
export function pickAllLoadMetrics(loads, excludedStatuses = []) {
  if (!loads || !loads.length) return null

  // Filter out excluded statuses (case-sensitive) AND confirmed TONUs
  // (is_tonu === true). A confirmed TONU can never headline a best/worst card;
  // worst-by-revenue then rolls to the next real load.
  const candidates = loads.filter(l => !excludedStatuses.includes(l.status) && l.is_tonu !== true)
  if (!candidates.length) return null

  // By revenue (no mileage restriction)
  const byRevenue = [...candidates].sort((a, b) => (a.revenue ?? 0) - (b.revenue ?? 0))
  const bestByRevenue = byRevenue[byRevenue.length - 1]
  const worstByRevenue = byRevenue[0]

  // By rpm — require a minimum mileage so sub-mile outliers can't headline
  // (and to avoid divide-by-zero on 0-mile loads).
  const validForRpm = candidates.filter(l => l.miles >= MIN_MILES_FOR_RPM_CARD && l.rpm != null)
  let bestByRpm = null, worstByRpm = null
  if (validForRpm.length > 0) {
    const byRpm = [...validForRpm].sort((a, b) => (a.rpm ?? 0) - (b.rpm ?? 0))
    worstByRpm = byRpm[0]
    bestByRpm = byRpm[byRpm.length - 1]
  }

  return { bestByRevenue, worstByRevenue, bestByRpm, worstByRpm }
}
