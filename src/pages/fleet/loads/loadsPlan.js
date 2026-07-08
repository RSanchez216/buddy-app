import { normName, normUnit, normalizeName, parseDriverCell } from './loadsParse'

// Loads ingest — Phase 2 plan layer. Takes parsed leg-rows + reference
// data + existing loads/legs and produces a review plan: one entry per
// load (header + legs), each leg/header carrying its resolved entities,
// watched-field diff, and classification. Pure: no DB, no React.
//
// Watched fields (the ONLY things that trigger "updated" + need approval):
//   header: linehaul, status, pickup_date, delivery_date
//   leg:    driver, truck, trailer, total_miles
// Notes are never compared here (write-once on first import — see apply).

const HEADER_FIELDS = [
  'customer_load_number', 'status', 'load_type', 'num_picks', 'num_drops',
  'pu_info', 'del_info', 'pickup_date', 'delivery_date',
  'linehaul', 'weight', 'commodity',
]


// numeric-aware, null-aware equality for diffing
function eqVal(a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  const na = Number(a), nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb
  return String(a) === String(b)
}

// Lightweight fuzzy: best candidate by shared-token ratio with a substring
// boost. Returns { id, name } above threshold, else null. Good enough to
// suggest a likely fleet/driver match in the review without pulling in a
// dependency or DB trigram.
function bestFuzzy(raw, candidates, keyFn, idFn, nameFn) {
  const q = normName(raw)
  if (!q) return null
  const qTokens = new Set(q.split(' ').filter(Boolean))
  let best = null, bestScore = 0
  for (const c of candidates) {
    const k = normName(keyFn(c))
    if (!k) continue
    const kTokens = new Set(k.split(' ').filter(Boolean))
    let shared = 0
    for (const t of qTokens) if (kTokens.has(t)) shared++
    const ratio = shared / Math.max(qTokens.size, kTokens.size)
    const sub = (k.includes(q) || q.includes(k)) ? 0.5 : 0
    const score = ratio + sub
    if (score > bestScore) { bestScore = score; best = c }
  }
  if (bestScore < 0.5) return null
  return { id: idFn(best), name: nameFn(best) }
}

// Resolve a person/company name by exact normName, returning matched id.
function matchByName(raw, index) {
  const k = normName(raw)
  return k ? (index.get(k) || null) : null
}

export function buildPlan({ rows, refs, existing }) {
  // Build lookup indexes once.
  // Drivers key on the punctuation-insensitive normalizeName so cosmetic
  // differences (hyphen vs space, accents, "(Baikozu)") resolve. If two
  // fleet drivers collapse to the same key, mark it ambiguous → leave
  // unmatched for manual review rather than guess.
  const driverByNorm = new Map() // key -> { id, ambiguous }
  for (const d of refs.drivers) {
    const k = normalizeName(d.full_name)
    if (!k) continue
    const ex = driverByNorm.get(k)
    if (!ex) driverByNorm.set(k, { id: d.id, ambiguous: false })
    else if (ex.id !== d.id) ex.ambiguous = true
  }
  // Primary driver key: the unique internal_id code that prefixes the TMS
  // "Driver" cell ("2080 - …"). Exact, guaranteed-unique — preferred over
  // name matching, which is fragile when two drivers share a first name.
  const driverByCode = new Map() // internal_id(string) -> { id, ambiguous }
  for (const d of refs.drivers) {
    const code = d.internal_id == null ? '' : String(d.internal_id).trim()
    if (!code) continue
    const ex = driverByCode.get(code)
    if (!ex) driverByCode.set(code, { id: d.id, ambiguous: false })
    else if (ex.id !== d.id) ex.ambiguous = true
  }
  const truckByUnit = new Map()
  for (const t of refs.trucks) truckByUnit.set(normUnit(t.unit_number), t.id)
  const trailerByUnit = new Map()
  for (const t of refs.trailers) trailerByUnit.set(normUnit(t.unit_number), t.id)
  const carrierByName = new Map()
  for (const c of refs.carriers) carrierByName.set(normName(c.name), c.id)
  const customerByName = new Map()
  // trailer_required per customer (default true) — drives the missing-trailer
  // "needs review" flag. Absent key → treated as true (requires a trailer).
  const customerTrailerReq = new Map()
  for (const c of refs.customers) {
    customerByName.set(normName(c.name), c.id)
    customerTrailerReq.set(normName(c.name), c.trailer_required !== false)
  }
  const dispatcherByName = new Map()
  for (const d of refs.dispatchers) dispatcherByName.set(normName(d.name), d.id)

  // Existing loads by load_number; existing legs grouped by load_id.
  const existingLoadByNumber = new Map()
  for (const l of existing.loads) existingLoadByNumber.set(l.load_number, l)
  const existingLegsByLoad = new Map()
  for (const lg of existing.legs) {
    if (!existingLegsByLoad.has(lg.load_id)) existingLegsByLoad.set(lg.load_id, [])
    existingLegsByLoad.get(lg.load_id).push(lg)
  }

  // Group file rows by load_number, preserving order.
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.load_number)) groups.set(r.load_number, [])
    groups.get(r.load_number).push(r)
  }

  // ── driver/truck/trailer leg resolver ──
  function resolveDriver(raw) {
    const { code, name } = parseDriverCell(raw)
    // 1) Code present → match on internal_id, exact and unique. The code is
    //    authoritative: if it has no (unambiguous) match we report unmatched
    //    rather than falling back to the name, which could link the wrong
    //    person. The fuzzy suggestion is advisory only (never auto-applied)
    //    so the reviewer can link it by hand.
    if (code) {
      const hit = driverByCode.get(code)
      if (hit && !hit.ambiguous) return { raw, code, id: hit.id, match_status: 'matched', suggestion: null }
      const sug = bestFuzzy(name || raw, refs.drivers, d => d.full_name, d => d.id, d => d.full_name)
      return { raw, code, id: null, match_status: 'unmatched', suggestion: sug }
    }
    // 2) No code → fall back to an exact, normalized full-name match only
    //    (symmetric normalize; ambiguous keys stay unmatched). Never
    //    first-name-only or fuzzy for the actual link.
    const key = normalizeName(name || raw)
    const hit = key ? driverByNorm.get(key) : null
    if (hit && !hit.ambiguous) return { raw, code: null, id: hit.id, match_status: 'matched', suggestion: null }
    const sug = bestFuzzy(name || raw, refs.drivers, d => d.full_name, d => d.id, d => d.full_name)
    return { raw, code: null, id: null, match_status: 'unmatched', suggestion: sug }
  }
  function resolveUnit(raw, index, candidates, nameKey) {
    if (raw == null) return { raw: null, id: null, match_status: 'blank', suggestion: null }
    const id = index.get(normUnit(raw)) || null
    if (id) return { raw, id, match_status: 'matched', suggestion: null }
    const sug = bestFuzzy(raw, candidates, c => c[nameKey], c => c.id, c => c[nameKey])
    return { raw, id: null, match_status: 'unmatched', suggestion: sug }
  }

  // Header value taken once per group: first non-null across legs (header
  // data repeats across a team load's rows; revenue/linehaul once).
  function headerVal(group, field) {
    for (const r of group) if (r[field] != null) return r[field]
    return null
  }

  const plan = []
  const toCreateCustomers = new Set()
  const toCreateDispatchers = new Set()
  const unmatchedKeys = new Set() // `${type}:${normalized raw}`

  for (const [loadNumber, group] of groups) {
    const existingLoad = existingLoadByNumber.get(loadNumber) || null

    // Header parsed values (once).
    const header = { load_number: loadNumber, is_team_load: group.length > 1 }
    for (const f of HEADER_FIELDS) header[f] = headerVal(group, f)
    // Notes captured once for first-import only (apply ignores on update).
    header.load_notes = headerVal(group, 'load_notes')
    header.load_instructions = headerVal(group, 'load_instructions')
    header.invoice_notes = headerVal(group, 'invoice_notes')

    // Entity resolution (header-scope).
    const custRaw = headerVal(group, 'customer_raw')
    const dispRaw = headerVal(group, 'dispatcher_raw')
    const carrRaw = headerVal(group, 'carrier_raw')
    const customer = custRaw
      ? { name: custRaw, id: matchByName(custRaw, customerByName),
          match_status: matchByName(custRaw, customerByName) ? 'matched' : 'to_create' }
      : { name: null, id: null, match_status: 'none' }
    const dispatcher = dispRaw
      ? { name: dispRaw, id: matchByName(dispRaw, dispatcherByName),
          match_status: matchByName(dispRaw, dispatcherByName) ? 'matched' : 'to_create' }
      : { name: null, id: null, match_status: 'none' }
    const carrier = carrRaw
      ? { name: carrRaw, id: matchByName(carrRaw, carrierByName),
          match_status: matchByName(carrRaw, carrierByName) ? 'matched' : 'unmatched' }
      : { name: null, id: null, match_status: 'none' }
    if (customer.match_status === 'to_create') toCreateCustomers.add(normName(custRaw))
    if (dispatcher.match_status === 'to_create') toCreateDispatchers.add(normName(dispRaw))

    // Header watched-field diff (existing only).
    const headerDiffs = []
    if (existingLoad) {
      for (const f of ['linehaul', 'status', 'pickup_date', 'delivery_date']) {
        if (!eqVal(existingLoad[f], header[f])) {
          headerDiffs.push({ scope: 'header', field: f, old: existingLoad[f] ?? null, new: header[f] ?? null })
        }
      }
    }

    // status flip to Canceled/TONU
    const newStatusNorm = normName(header.status)
    const isCancelTonu = newStatusNorm === 'canceled' || newStatusNorm === 'cancelled' || newStatusNorm === 'tonu'
    const statusChanged = !existingLoad || normName(existingLoad.status) !== newStatusNorm
    const is_status_flag = isCancelTonu && statusChanged

    // ── legs ──
    // Match file legs to existing legs by POSITION (leg_seq order), not by
    // driver name. A load can be re-dispatched (driver changes between
    // imports), so a name key would miss the match and the apply step would
    // insert a duplicate leg instead of updating in place — stranding the
    // old leg with its stale driver/trailer. Position is stable for the
    // one-row-per-leg TMS export and keeps apply's update deterministic.
    const existingLegs = existingLoad ? (existingLegsByLoad.get(existingLoad.id) || []) : []
    const existingBySeq = [...existingLegs].sort((a, b) => (a.leg_seq ?? 0) - (b.leg_seq ?? 0))

    const legs = group.map((r, idx) => {
      const driver = resolveDriver(r.driver_raw)
      const truck = resolveUnit(r.truck_raw, truckByUnit, refs.trucks, 'unit_number')
      const trailer = resolveUnit(r.trailer_raw, trailerByUnit, refs.trailers, 'unit_number')
      if (driver.match_status === 'unmatched') unmatchedKeys.add(`driver:${driver.code ? 'code:' + driver.code : normName(r.driver_raw)}`)
      if (truck.match_status === 'unmatched') unmatchedKeys.add(`truck:${normUnit(r.truck_raw)}`)
      if (trailer.match_status === 'unmatched') unmatchedKeys.add(`trailer:${normUnit(r.trailer_raw)}`)

      // Positional match: the idx-th file leg pairs with the idx-th existing leg.
      const existingLeg = existingLoad ? (existingBySeq[idx] || null) : null

      const legDiffs = []
      let legClass
      if (!existingLoad) {
        legClass = 'new'
      } else if (!existingLeg) {
        legClass = 'new_leg'
      } else {
        // Compare watched leg fields against the positionally-matched leg.
        // Driver is now compared in every case (a re-dispatch = update).
        if (normName(existingLeg.driver_raw) !== normName(r.driver_raw)) {
          legDiffs.push({ scope: 'leg', field: 'driver', old: existingLeg.driver_raw ?? null, new: r.driver_raw ?? null })
        }
        if (normUnit(existingLeg.truck_raw) !== normUnit(r.truck_raw)) {
          legDiffs.push({ scope: 'leg', field: 'truck', old: existingLeg.truck_raw ?? null, new: r.truck_raw ?? null })
        }
        if (normUnit(existingLeg.trailer_raw) !== normUnit(r.trailer_raw)) {
          legDiffs.push({ scope: 'leg', field: 'trailer', old: existingLeg.trailer_raw ?? null, new: r.trailer_raw ?? null })
        }
        if (!eqVal(existingLeg.total_miles, r.total_miles)) {
          legDiffs.push({ scope: 'leg', field: 'total_miles', old: existingLeg.total_miles ?? null, new: r.total_miles ?? null })
        }
        legClass = legDiffs.length ? 'updated' : 'unchanged'
      }

      return {
        leg_seq: idx + 1,
        row_index: r.row_index,
        raw: r.raw,
        existing_leg_id: existingLeg?.id ?? null,
        classification: legClass,
        diffs: legDiffs,
        parsed: {
          driver_raw: r.driver_raw, truck_raw: r.truck_raw, trailer_raw: r.trailer_raw,
          empty_miles: r.empty_miles, loaded_miles: r.loaded_miles, total_miles: r.total_miles,
        },
        resolved: { driver, truck, trailer },
      }
    })

    // Load-level classification.
    let classification
    if (!existingLoad) classification = 'new'
    else if (headerDiffs.length || legs.some(l => l.classification === 'updated' || l.classification === 'new_leg')) classification = 'updated'
    else classification = 'unchanged'

    // "Needs review" — advisory, non-blocking. Today the only reason is a
    // missing trailer on a non-Canceled load whose customer requires one. The
    // exemption is driven purely by customers.trailer_required: a customer
    // flagged trailer_required=false (e.g. Amazon) is exempt. A new / unmatched
    // customer (no map entry) defaults to requiring a trailer — safer to flag.
    // Structured as a reasons LIST so more checks (missing truck, zero miles, …)
    // can be added later.
    const custNorm = normName(custRaw)
    const customerRequiresTrailer = customerTrailerReq.get(custNorm) !== false
    const notCanceled = !(newStatusNorm === 'canceled' || newStatusNorm === 'cancelled')
    const someLegMissingTrailer = legs.some(l => l.parsed.trailer_raw == null || String(l.parsed.trailer_raw).trim() === '')
    const reviewReasons = []
    if (notCanceled && customerRequiresTrailer && someLegMissingTrailer) reviewReasons.push('Missing trailer')
    header.needs_review = reviewReasons.length > 0
    header.review_reasons = reviewReasons

    plan.push({
      load_number: loadNumber,
      existing_load_id: existingLoad?.id ?? null,
      classification,
      is_status_flag,
      header,
      header_diffs: headerDiffs,
      resolved: { customer, dispatcher, carrier },
      legs,
    })
  }

  const counts = {
    new: plan.filter(p => p.classification === 'new').length,
    updated: plan.filter(p => p.classification === 'updated').length,
    unchanged: plan.filter(p => p.classification === 'unchanged').length,
    // new legs only on EXISTING loads (legs of brand-new loads count under "new")
    new_legs: plan.reduce((n, p) => n + (p.existing_load_id ? p.legs.filter(l => l.classification === 'new_leg').length : 0), 0),
    new_customers: toCreateCustomers.size,
    new_dispatchers: toCreateDispatchers.size,
    unmatched: unmatchedKeys.size,
    status_flags: plan.filter(p => p.is_status_flag).length,
    needs_review: plan.filter(p => p.header.needs_review).length,
  }

  return { plan, counts }
}
