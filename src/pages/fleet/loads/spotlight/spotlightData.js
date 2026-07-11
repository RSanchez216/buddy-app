// Data layer for the Spotlight deck. Read-only against the existing
// profitability stack: load_profit_rollup() for headline metrics,
// v_load_leg_profit for lanes, fleet_equipment_cost + driver_purchase_payments
// for the (clearly partial) contribution line. No schema changes.

import { supabase } from '../../../../lib/supabase'
import { elapsedDays, healthSignal, shiftYmd, spanDays } from './spotlightShared'

const DAYS_PER_MONTH = 30.4375 // 365.25 / 12 — used to prorate monthly equipment cost

function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows || []) {
    const k = r[key]
    if (k == null) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

// Fetch everything the deck needs for one period in one round trip:
// per-driver rollup, per-trailer rollup (for the like-for-like trailer-type
// benchmark), fleet masters, equipment carrying cost, and purchase payments
// overlapping the window. Lanes hydrate separately per focused card.
export async function fetchDriverDeck({ from, to, basis = 'delivery' }) {
  const days = spanDays(from, to)
  // Utilization is judged against days that have actually elapsed — a
  // mid-week "This week" doesn't count future days as idle. Equipment cost
  // proration still uses the full window (it accrues regardless).
  const effDays = elapsedDays(from, to)
  const [rollup, trailerRollup, driversRes, trucksRes, trailersRes, eqCostRes, purchasesRes, paymentsRes, payEstimateRes, teamsRes, contribInputsRes] = await Promise.all([
    supabase.rpc('load_profit_rollup', { p_dimension: 'driver', p_from: from, p_to: to, p_basis: basis }),
    supabase.rpc('load_profit_rollup', { p_dimension: 'trailer', p_from: from, p_to: to, p_basis: basis }),
    supabase.from('drivers').select('id, full_name, internal_id, current_status, driver_type, carrier, photo_path'),
    supabase.from('trucks').select('id, unit_number, driver_id, carrier, ownership_stage'),
    supabase.from('trailers').select('id, unit_number, driver_id, trailer_type, ownership_stage'),
    supabase.from('fleet_equipment_cost').select('etype, id, unit_number, cost_source, monthly_cost, weekly_cost'),
    supabase.from('driver_purchases').select('id, driver_id, payment_amount, payment_frequency, truck_number'),
    supabase.from('driver_purchase_payments')
      .select('driver_purchase_id, period_start, period_end, expected_amount, actual_amount, reconciled')
      .lte('period_start', to).gte('period_end', from),
    supabase.rpc('driver_pay_estimate_rollup', { p_from: from, p_to: to, p_basis: basis }),
    supabase.from('v_driver_current_team').select('driver_id, team_id, team_name, members'),
    supabase.rpc('driver_contribution_inputs', { p_from: from, p_to: to, p_basis: basis }),
  ])
  if (rollup.error) throw rollup.error
  if (payEstimateRes.error) throw payEstimateRes.error

  const drivers = driversRes.data || []
  const trucks = trucksRes.data || []
  const trailers = trailersRes.data || []
  const driversById = new Map(drivers.map(d => [d.id, d]))
  // Team overlay: driver_id → { team_id, team_name, members[] }. members is
  // ordered primary-first; enrich each with driver_type (the view omits it) so
  // the per-member strip and type pills read from one place.
  const teamByDriver = new Map((teamsRes.data || []).map(t => [t.driver_id, t]))
  const enrichMembers = (members) => (members || []).map(mem => ({
    ...mem,
    driver_type: driversById.get(mem.driver_id)?.driver_type || null,
  }))
  const trucksByDriver = groupBy(trucks, 'driver_id')
  const trailersByDriver = groupBy(trailers, 'driver_id')
  const costByUnit = new Map((eqCostRes.data || []).map(r => [`${r.etype}:${r.id}`, r]))
  const purchasesByDriver = groupBy(purchasesRes.data, 'driver_id')
  const paymentsByPurchase = groupBy(paymentsRes.data, 'driver_purchase_id')
  const payEstimateByDriver = new Map((payEstimateRes.data || []).map(r => [r.driver_id, r]))
  // Team-aware unit pay, keyed by the row's driver_id (a team collapses to the
  // primary's id). Overrides the per-driver pay estimate so a per-mile/flat team
  // shows both drivers' pay; solo/owner-op are unchanged.
  const unitPayByDriver = new Map((contribInputsRes.error ? [] : (contribInputsRes.data || [])).map(r => [r.driver_id, r]))

  // Like-for-like benchmark: $/mile per trailer type, from the same period's
  // per-trailer rollup joined to trailers.trailer_type. Realized legs only —
  // the rollup already excludes booked from revenue/miles sums.
  const typeByTrailerId = new Map(trailers.map(t => [t.id, t.trailer_type]))
  const typeAgg = new Map()
  let fleetRev = 0, fleetMiles = 0
  for (const r of trailerRollup.data || []) {
    const rev = Number(r.realized_revenue) || 0
    const miles = Number(r.total_miles) || 0
    fleetRev += rev; fleetMiles += miles
    const ty = r.key_id ? typeByTrailerId.get(r.key_id) : null
    if (!ty) continue
    const agg = typeAgg.get(ty) || { revenue: 0, miles: 0 }
    agg.revenue += rev; agg.miles += miles
    typeAgg.set(ty, agg)
  }
  const byType = new Map()
  for (const [ty, agg] of typeAgg) {
    if (agg.miles > 0) byType.set(ty, { rpm: agg.revenue / agg.miles, revenue: agg.revenue, miles: agg.miles })
  }
  const fleetRpm = fleetMiles > 0 ? fleetRev / fleetMiles : null

  function buildEntry({ driverId, rawName, row }) {
    const master = driverId ? driversById.get(driverId) : null
    const team = driverId ? teamByDriver.get(driverId) : null
    const myTrucks = driverId ? (trucksByDriver.get(driverId) || []) : []
    const myTrailers = driverId ? (trailersByDriver.get(driverId) || []) : []
    const trailerType = myTrailers.map(t => t.trailer_type).find(Boolean) || null

    // Equipment carrying cost — known monthly costs prorated to the window.
    // driver_owned units are a true $0 to the company; units the cost view
    // can't price (unclassified / owned with no loan link) count as unknown
    // and are flagged on the card rather than silently treated as free.
    let knownMonthly = 0, unknownUnits = 0
    const units = []
    for (const u of [...myTrucks.map(t => ({ ...t, etype: 'truck' })), ...myTrailers.map(t => ({ ...t, etype: 'trailer' }))]) {
      const cost = costByUnit.get(`${u.etype}:${u.id}`)
      const monthly = cost?.monthly_cost != null ? Number(cost.monthly_cost) : null
      const known = monthly != null || cost?.cost_source === 'driver_owned'
      if (monthly != null) knownMonthly += monthly
      else if (!known) unknownUnits++
      units.push({ etype: u.etype, unitNumber: u.unit_number, monthly, source: cost?.cost_source || 'unknown' })
    }
    const periodCost = knownMonthly * days / DAYS_PER_MONTH

    // Truck-purchase deduction: scheduled payments whose period overlaps the
    // selected window, across all of this driver's purchase contracts.
    let purchaseExpected = 0, purchasePayments = 0
    const myPurchases = driverId ? (purchasesByDriver.get(driverId) || []) : []
    for (const p of myPurchases) {
      for (const pay of paymentsByPurchase.get(p.id) || []) {
        purchaseExpected += Number(pay.expected_amount) || 0
        purchasePayments++
      }
    }

    const metrics = {
      loadCount: Number(row?.load_count) || 0,
      realizedLoads: Number(row?.realized_loads) || 0,
      bookedLoads: Number(row?.booked_loads) || 0,
      miles: Number(row?.total_miles) || 0,
      gross: Number(row?.realized_revenue) || 0,
      rpm: row?.realized_rpm == null ? null : Number(row.realized_rpm),
      activeDays: Number(row?.active_days) || 0,
      booked: Number(row?.projected_revenue) || 0,
    }

    const benchmarkRpm = trailerType && byType.has(trailerType) ? byType.get(trailerType).rpm : fleetRpm
    const benchmarkScope = trailerType && byType.has(trailerType) ? trailerType : 'fleet'

    // Estimated driver compensation — from driver_pay_estimate_rollup, with the
    // pay/earn overridden by the team-aware unit total when this driver's unit
    // is in driver_contribution_inputs (a team pays both drivers).
    const payEstimate = driverId ? payEstimateByDriver.get(driverId) : null
    const unitPay = driverId ? unitPayByDriver.get(driverId) : null

    return {
      id: driverId || `raw:${rawName}`,
      driverId,
      rawName: driverId ? null : rawName,
      // For a team the hero name is the team name; solo keeps the person's name.
      name: team?.team_name || master?.full_name || row?.key_name || rawName,
      teamId: team?.team_id || null,
      teamName: team?.team_name || null,
      members: team ? enrichMembers(team.members) : null,
      internalId: master?.internal_id || null,
      status: master?.current_status || null,
      driverType: master?.driver_type || null,
      carrier: master?.carrier || myTrucks.map(t => t.carrier).find(Boolean) || null,
      photoPath: master?.photo_path || null,
      trucks: myTrucks,
      trailers: myTrailers,
      trailerType,
      metrics,
      equipCost: { periodCost, knownMonthly, unknownUnits, units },
      purchase: { periodExpected: purchaseExpected, payments: purchasePayments, hasPurchase: myPurchases.length > 0 },
      benchmarkRpm,
      benchmarkScope,
      health: healthSignal({ ...metrics, benchmarkRpm }, effDays),
      payEstimate: payEstimate ? {
        loads: payEstimate.loads,
        // Team-aware unit total when available, else the per-driver estimate.
        estDriverPay: unitPay ? (Number(unitPay.est_unit_driver_pay) || 0) : (Number(payEstimate.est_driver_pay) || 0),
        estCompanyContribution: unitPay ? (Number(unitPay.est_unit_company_earn) || 0) : (Number(payEstimate.est_company_contribution) || 0),
        hasMissingComp: payEstimate.has_missing_comp || false,
        hasContract: payEstimate.has_contract || false,
        compType: payEstimate.comp_type || null,
        compValue: payEstimate.comp_value != null ? Number(payEstimate.comp_value) : null,
        compUniform: payEstimate.comp_uniform || false,
        // A team is one shared pool — its per-comp caption ("rate × miles") would
        // reflect only the primary, so mark it and let the caption fall back to
        // just the two values.
        isTeam: !!(unitPay && unitPay.team_id),
        linehaulRevenue: payEstimate.linehaul_revenue != null ? Number(payEstimate.linehaul_revenue) : 0,
        totalMiles: payEstimate.total_miles != null ? Number(payEstimate.total_miles) : 0,
      } : null,
    }
  }

  const entries = []
  const seenDriverIds = new Set()
  const seenTeams = new Set() // one card per team — the co-driver never doubles up
  for (const row of rollup.data || []) {
    if (!row.key_id && !row.key_name) continue
    const team = row.key_id ? teamByDriver.get(row.key_id) : null
    if (team?.team_id && seenTeams.has(team.team_id)) continue
    if (row.key_id) seenDriverIds.add(row.key_id)
    if (team?.team_id) seenTeams.add(team.team_id)
    entries.push(buildEntry({ driverId: row.key_id, rawName: row.key_name, row }))
  }
  // Active drivers with zero loads in the window don't appear in the rollup
  // at all — but they're exactly who "weakest first" should surface. Add
  // them as zero-metric entries. A team collapses to ONE card anchored to its
  // primary, so a co-driver never appears as its own card.
  for (const d of drivers) {
    if (d.current_status !== 'active' || seenDriverIds.has(d.id)) continue
    const team = teamByDriver.get(d.id)
    if (team?.team_id) {
      if (seenTeams.has(team.team_id)) continue
      seenTeams.add(team.team_id)
      const primaryId = team.members?.[0]?.driver_id || d.id // members are primary-first
      if (seenDriverIds.has(primaryId)) continue
      seenDriverIds.add(primaryId)
      entries.push(buildEntry({ driverId: primaryId, rawName: driversById.get(primaryId)?.full_name, row: null }))
      continue
    }
    entries.push(buildEntry({ driverId: d.id, rawName: d.full_name, row: null }))
  }

  return { entries, benchmarks: { byType, fleetRpm }, days, effDays }
}

// This driver's legs in the window — origin → destination, $, miles —
// straight from v_load_leg_profit. Matched drivers filter by driver_id;
// unmatched TMS names fall back to the raw string.
export async function fetchLanes({ driverId, rawName, from, to, basis = 'delivery' }) {
  const dateCol = basis === 'pickup' ? 'pickup_date' : 'delivery_date'
  let q = supabase.from('v_load_leg_profit')
    .select('leg_id, load_id, load_number, status, is_projected, pickup_date, delivery_date, origin, destination, leg_revenue, leg_total_miles, customer_name')
    .gte(dateCol, from).lte(dateCol, to)
    .order(dateCol, { ascending: true })
  q = driverId ? q.eq('driver_id', driverId) : q.is('driver_id', null).eq('driver_raw', rawName)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Recent-weeks trend: N consecutive 7-day windows ending at the selected
// range's end, one rollup call per window (each returns ALL drivers, so the
// whole deck's sparklines come from these few calls).
export async function fetchTrendWeeks({ to, basis = 'delivery', weeks = 8 }) {
  const calls = []
  for (let k = weeks - 1; k >= 0; k--) {
    const wTo = shiftYmd(to, -7 * k)
    const wFrom = shiftYmd(wTo, -6)
    calls.push(
      supabase.rpc('load_profit_rollup', { p_dimension: 'driver', p_from: wFrom, p_to: wTo, p_basis: basis })
        .then(res => ({ from: wFrom, to: wTo, rows: res.data || [] }))
    )
  }
  const results = await Promise.all(calls)
  return results.map(w => ({
    from: w.from,
    to: w.to,
    byKey: new Map(w.rows.map(r => [
      r.key_id || `raw:${r.key_name}`,
      { gross: Number(r.realized_revenue) || 0, rpm: r.realized_rpm == null ? null : Number(r.realized_rpm) },
    ])),
  }))
}
