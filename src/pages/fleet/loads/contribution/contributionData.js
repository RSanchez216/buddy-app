// Data layer for the Contribution view. Read-only against the existing
// profitability stack: load_profit_rollup() for realized revenue & miles,
// fleet_equipment_cost for carrying cost, driver_purchase_payments for
// truck-purchase deductions. No schema changes, nothing existing modified.
//
// The margin shown here is PARTIAL by design: revenue − equipment carrying
// cost − purchase deduction. Driver pay, fuel, and insurance are not in the
// DB and are never estimated.

import { supabase } from '../../../../lib/supabase'
import { elapsedDays, spanDays } from '../spotlight/spotlightShared'

const DAYS_PER_MONTH = 30.4375 // 365.25 / 12 — prorates monthly carrying cost

// "#M100" / "M-100" / "m100" all collapse to "M100" so driver_purchases.
// truck_number (entered free-form) can match trucks.unit_number.
const normUnit = (s) => String(s || '').replace(/[^a-z0-9]/gi, '').toUpperCase()

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

function sumPayments(payments) {
  let total = 0, count = 0
  for (const p of payments || []) { total += Number(p.expected_amount) || 0; count++ }
  return { total, count }
}

function rollupMetrics(row) {
  return {
    loads: Number(row?.realized_loads) || 0,
    booked: Number(row?.booked_loads) || 0,
    miles: Number(row?.total_miles) || 0,
    revenue: Number(row?.realized_revenue) || 0,
    rpm: row?.realized_rpm == null ? null : Number(row.realized_rpm),
    activeDays: Number(row?.active_days) || 0,
  }
}

// contribution = revenue − equipment carrying cost − purchase deduction.
// Utilization is judged against elapsed days only (a mid-week "This week"
// doesn't count future days as idle); cost proration uses the full window
// because the cost accrues regardless.
function finishRow(base, { effDays }) {
  const contribution = base.revenue - base.equipCost - base.purchase
  return {
    ...base,
    contribution,
    cpm: base.miles > 0 ? contribution / base.miles : null,
    util: effDays > 0 ? Math.min(base.activeDays / effDays, 1) : null,
  }
}

function buildDriverRows({ rollupRows, drivers, trucks, trailers, costByUnit, purchases, paymentsByPurchase, days, effDays }) {
  const driversById = new Map(drivers.map(d => [d.id, d]))
  const trucksByDriver = groupBy(trucks, 'driver_id')
  const trailersByDriver = groupBy(trailers, 'driver_id')
  const purchasesByDriver = groupBy(purchases, 'driver_id')

  function build(driverId, rawName, row) {
    const master = driverId ? driversById.get(driverId) : null
    const myTrucks = driverId ? (trucksByDriver.get(driverId) || []) : []
    const myTrailers = driverId ? (trailersByDriver.get(driverId) || []) : []

    // Equipment carrying cost: every unit assigned to the driver, monthly
    // cost prorated to the window. driver_owned is a true $0 to the company;
    // anything the cost view can't price is counted as unknown and flagged,
    // never silently treated as free.
    let knownMonthly = 0, unknownUnits = 0, ownershipStage = 'unknown'
    const units = []
    const ownerships = new Set()
    for (const u of [...myTrucks.map(t => ({ ...t, etype: 'truck' })), ...myTrailers.map(t => ({ ...t, etype: 'trailer' }))]) {
      const cost = costByUnit.get(`${u.etype}:${u.id}`)
      const monthly = cost?.monthly_cost != null ? Number(cost.monthly_cost) : null
      if (monthly != null) knownMonthly += monthly
      else if (cost?.cost_source !== 'driver_owned') unknownUnits++
      if (cost?.ownership_stage) ownerships.add(cost.ownership_stage)
      units.push({ etype: u.etype, unitNumber: u.unit_number, monthly, source: cost?.cost_source || 'unknown' })
    }
    // If all trucks are driver-owned, ownership is driver_owned; otherwise use first ownership_stage found
    if (ownerships.has('driver_owned') && ownerships.size === 1) ownershipStage = 'driver_owned'
    else if (ownerships.size > 0) ownershipStage = [...ownerships][0]

    let purchase = 0, purchaseCount = 0
    for (const p of (driverId ? (purchasesByDriver.get(driverId) || []) : [])) {
      const s = sumPayments(paymentsByPurchase.get(p.id))
      purchase += s.total; purchaseCount += s.count
    }

    return finishRow({
      id: driverId || `raw:${rawName}`,
      name: master?.full_name || row?.key_name || rawName,
      sub: myTrucks.map(t => t.unit_number).filter(Boolean).join(' · ') || null,
      unmatched: !driverId,
      status: master && master.current_status !== 'active' ? master.current_status : null,
      ownershipStage,
      ...rollupMetrics(row),
      equipCost: knownMonthly * days / DAYS_PER_MONTH,
      equipMonthly: knownMonthly,
      unknownUnits,
      units,
      purchase,
      purchaseCount,
    }, { effDays })
  }

  const rows = []
  const seen = new Set()
  for (const r of rollupRows) {
    if (!r.key_id && !r.key_name) continue
    if (r.key_id) seen.add(r.key_id)
    rows.push(build(r.key_id, r.key_name, r))
  }
  // Active drivers with zero loads don't appear in the rollup, but their
  // equipment cost still accrues — they belong on this leaderboard most of all.
  for (const d of drivers) {
    if (d.current_status !== 'active' || seen.has(d.id)) continue
    rows.push(build(d.id, d.full_name, null))
  }
  return rows
}

function buildTruckRows({ rollupRows, drivers, trucks, eqCost, costByUnit, purchases, paymentsByPurchase, days, effDays }) {
  const trucksById = new Map(trucks.map(t => [t.id, t]))
  const driversById = new Map(drivers.map(d => [d.id, d]))
  const trucksByDriver = groupBy(trucks, 'driver_id')
  const trucksByNorm = new Map()
  for (const t of trucks) {
    const k = normUnit(t.unit_number)
    if (k && !trucksByNorm.has(k)) trucksByNorm.set(k, t.id)
  }

  // Purchase payments → truck: explicit unit-number match first, else the
  // purchasing driver's only assigned truck. Payments that can't be pinned
  // to a truck surface in the page footnote instead of being dropped silently.
  const purchaseByTruck = new Map()
  for (const p of purchases) {
    const s = sumPayments(paymentsByPurchase.get(p.id))
    if (!s.count) continue
    let truckId = trucksByNorm.get(normUnit(p.truck_number)) || null
    if (!truckId && p.driver_id) {
      const dt = trucksByDriver.get(p.driver_id) || []
      if (dt.length === 1) truckId = dt[0].id
    }
    if (!truckId) continue
    const agg = purchaseByTruck.get(truckId) || { total: 0, count: 0 }
    agg.total += s.total; agg.count += s.count
    purchaseByTruck.set(truckId, agg)
  }

  function build(truckId, rawName, row) {
    const master = truckId ? trucksById.get(truckId) : null
    const cost = truckId ? costByUnit.get(`truck:${truckId}`) : null
    const monthly = cost?.monthly_cost != null ? Number(cost.monthly_cost) : null
    const driver = master?.driver_id ? driversById.get(master.driver_id) : null
    const pur = (truckId && purchaseByTruck.get(truckId)) || null
    const flags = []
    if (cost?.is_total_loss) flags.push('total loss')
    else if (cost?.operational_status === 'inactive') flags.push('inactive')
    return finishRow({
      id: truckId || `raw:${rawName}`,
      name: master?.unit_number || row?.key_name || rawName,
      sub: driver?.full_name || null,
      unmatched: !truckId,
      status: flags[0] || null,
      ownershipStage: cost?.ownership_stage || 'unknown',
      ...rollupMetrics(row),
      equipCost: (monthly || 0) * days / DAYS_PER_MONTH,
      equipMonthly: monthly || 0,
      unknownUnits: monthly == null && cost?.cost_source !== 'driver_owned' ? 1 : 0,
      units: master ? [{ etype: 'truck', unitNumber: master.unit_number, monthly, source: cost?.cost_source || 'unknown' }] : [],
      purchase: pur?.total || 0,
      purchaseCount: pur?.count || 0,
    }, { effDays })
  }

  const rows = []
  const seen = new Set()
  for (const r of rollupRows) {
    if (!r.key_id && !r.key_name) continue
    if (r.key_id) seen.add(r.key_id)
    rows.push(build(r.key_id, r.key_name, r))
  }
  // Trucks with a known carrying cost but zero loads in the window still
  // burn money — exactly the negative contributors this view exists to flag.
  for (const c of eqCost) {
    if (c.etype !== 'truck' || c.monthly_cost == null || seen.has(c.id)) continue
    seen.add(c.id)
    rows.push(build(c.id, c.unit_number, null))
  }
  // …and trucks whose only activity is an in-window purchase payment.
  for (const truckId of purchaseByTruck.keys()) {
    if (seen.has(truckId)) continue
    seen.add(truckId)
    rows.push(build(truckId, trucksById.get(truckId)?.unit_number, null))
  }
  return rows
}

// One round trip for the whole leaderboard: rollup for the chosen dimension,
// fleet masters, carrying costs, and purchase payments overlapping the window.
export async function fetchContribution({ dimension, from, to, basis = 'delivery' }) {
  const days = spanDays(from, to)
  const effDays = elapsedDays(from, to)
  const [rollup, driversRes, trucksRes, trailersRes, eqCostRes, purchasesRes, paymentsRes] = await Promise.all([
    supabase.rpc('load_profit_rollup', { p_dimension: dimension, p_from: from, p_to: to, p_basis: basis }),
    supabase.from('drivers').select('id, full_name, internal_id, current_status, carrier'),
    supabase.from('trucks').select('id, unit_number, driver_id, carrier'),
    supabase.from('trailers').select('id, unit_number, driver_id, trailer_type'),
    supabase.from('fleet_equipment_cost').select('etype, id, unit_number, cost_source, ownership_stage, monthly_cost, operational_status, is_total_loss'),
    supabase.from('driver_purchases').select('id, driver_id, truck_number'),
    supabase.from('driver_purchase_payments')
      .select('driver_purchase_id, expected_amount')
      .lte('period_start', to).gte('period_end', from),
  ])
  if (rollup.error) throw rollup.error

  const ctx = {
    rollupRows: rollup.data || [],
    drivers: driversRes.data || [],
    trucks: trucksRes.data || [],
    trailers: trailersRes.data || [],
    eqCost: eqCostRes.data || [],
    costByUnit: new Map((eqCostRes.data || []).map(r => [`${r.etype}:${r.id}`, r])),
    purchases: purchasesRes.data || [],
    paymentsByPurchase: groupBy(paymentsRes.data, 'driver_purchase_id'),
    days,
    effDays,
  }
  const rows = dimension === 'truck' ? buildTruckRows(ctx) : buildDriverRows(ctx)

  // Realized revenue on loads with no truck/driver assigned at all — can't
  // be ranked, but it must not vanish from the fleet picture silently.
  const unassigned = { revenue: 0, miles: 0 }
  for (const r of ctx.rollupRows) {
    if (r.key_id || r.key_name) continue
    unassigned.revenue += Number(r.realized_revenue) || 0
    unassigned.miles += Number(r.total_miles) || 0
  }

  // Purchase payments due in the window that no listed row carries (departed
  // drivers, unmatched truck numbers). Shown as a footnote so the fleet total
  // is honest about what it excludes.
  const allPay = sumPayments(paymentsRes.data)
  const attributed = rows.reduce((s, r) => s + r.purchase, 0)
  const attributedCount = rows.reduce((s, r) => s + r.purchaseCount, 0)
  const unattributed = {
    amount: Math.max(0, allPay.total - attributed),
    count: Math.max(0, allPay.count - attributedCount),
  }

  return { rows, days, effDays, unattributed, unassigned }
}
