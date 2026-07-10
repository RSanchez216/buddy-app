// Data layer for the Boardroom — the owner-facing command center. Read-only
// against the existing profitability stack: load_profit_rollup() for the
// pulse, concentration, and leaderboards; the Lane Map's data layer for the
// best-paying-lane insight; the Contribution view's data layer for the
// (clearly partial) contribution spread. No schema changes, nothing existing
// modified.
//
// Everything here is real, live data. Net margin is NOT computable yet
// (driver pay / fuel / insurance aren't in the DB) and is never estimated —
// the page renders that gap as a roadmap, not a number.

import { supabase } from '../../../../lib/supabase'
import { elapsedDays, shiftYmd, spanDays } from '../spotlight/spotlightShared'
import { aggregateLanes, fetchLaneLegs, pickPayers } from '../lanes/laneData'
import { fetchContribution, fetchTeamByDriver } from '../contribution/contributionData'

// ── Fetch legs with truck_id for ownership join ───────────────────────────
async function fetchLegsForPulse({ from, to, basis = 'delivery' }) {
  const dateCol = basis === 'pickup' ? 'pickup_date' : 'delivery_date'
  const out = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('v_load_leg_profit')
      .select('leg_id, truck_id, is_projected, leg_revenue, leg_total_miles, ' + dateCol)
      .gte(dateCol, from).lte(dateCol, to)
      .order(dateCol, { ascending: true }).order('leg_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ── Fetch ownership map for all trucks ────────────────────────────────────
async function fetchOwnershipMap() {
  const { data, error } = await supabase
    .from('fleet_equipment_cost')
    .select('id, etype, ownership_stage')
  if (error) throw error
  const map = new Map()
  for (const r of data || []) {
    if (r.etype === 'truck') {
      map.set(r.id, r.ownership_stage || 'unknown')
    }
  }
  return map
}

// ── Calculate pulse with ownership split ──────────────────────────────────
function calculatePulseWithOwnership(legs, ownershipMap) {
  const company = { realized: 0, projected: 0, realizedLoads: 0, bookedLoads: 0 }
  const ownerOp = { realized: 0, projected: 0, realizedLoads: 0, bookedLoads: 0 }

  for (const leg of legs || []) {
    const ownership = ownershipMap.get(leg.truck_id) || 'unknown'
    const bucket = ownership === 'driver_owned' ? ownerOp : company
    const revenue = Number(leg.leg_revenue) || 0

    if (leg.is_projected) {
      bucket.projected += revenue
      bucket.bookedLoads += 1
    } else {
      bucket.realized += revenue
      bucket.realizedLoads += 1
    }
  }

  return {
    company,
    ownerOp,
    total: {
      realized: company.realized + ownerOp.realized,
      projected: company.projected + ownerOp.projected,
      realizedLoads: company.realizedLoads + ownerOp.realizedLoads,
      bookedLoads: company.bookedLoads + ownerOp.bookedLoads,
    }
  }
}

// ── Period totals (same shape the Profitability week summary uses) ────────
export function aggregate(rows) {
  let loads = 0, realizedLoads = 0, bookedLoads = 0, miles = 0, realized = 0, projected = 0, activeEntities = 0
  for (const r of rows || []) {
    loads += Number(r.load_count || 0)
    realizedLoads += Number(r.realized_loads || 0)
    bookedLoads += Number(r.booked_loads || 0)
    miles += Number(r.total_miles || 0)
    realized += Number(r.realized_revenue || 0)
    projected += Number(r.projected_revenue || 0)
    if (Number(r.realized_loads || 0) > 0) activeEntities++
  }
  return { loads, realizedLoads, bookedLoads, miles, realized, projected, activeEntities, rpm: miles > 0 ? realized / miles : null }
}

// Week-over-week movement. isNew when there's nothing to compare against.
export function pctDelta(cur, prev) {
  cur = Number(cur) || 0; prev = Number(prev) || 0
  if (prev === 0) return cur > 0 ? { isNew: true } : { flat: true }
  const pct = (cur - prev) / prev * 100
  return { pct, dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat' }
}

const fmtRpm = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}/mi`)
const fmtK = (n) => {
  const v = Number(n) || 0
  return v >= 100000 ? `$${Math.round(v / 1000)}K` : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// ── Customer concentration ────────────────────────────────────────────────
// Share of loads uses load_count (realized + booked — "who we depend on"),
// matching the % of loads column on the Profitability Customers tab. Share
// of revenue uses realized + projected for the same reason.
function buildConcentration(customerRows) {
  const rows = (customerRows || [])
    .filter(r => r.key_name)
    .map(r => ({
      name: r.key_name,
      loads: Number(r.load_count) || 0,
      revenue: (Number(r.realized_revenue) || 0) + (Number(r.projected_revenue) || 0),
    }))
  const totalLoads = rows.reduce((s, r) => s + r.loads, 0)
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  if (!totalLoads) return null
  for (const r of rows) {
    r.pctLoads = totalLoads > 0 ? r.loads / totalLoads * 100 : 0
    r.pctRevenue = totalRevenue > 0 ? r.revenue / totalRevenue * 100 : 0
  }
  rows.sort((a, b) => b.loads - a.loads)
  const top = rows[0]
  const top4Loads = rows.slice(0, 4).reduce((s, r) => s + r.pctLoads, 0)
  const top4Revenue = rows.slice(0, 4).reduce((s, r) => s + r.pctRevenue, 0)
  return { rows, totalLoads, totalRevenue, top, top4Loads, top4Revenue }
}

// ── Trailer-type rates + idle capacity ────────────────────────────────────
// $/mile per trailer type from the per-trailer rollup joined to
// trailers.trailer_type (the Spotlight's like-for-like benchmark). Idle =
// trailers with no realized load in the window.
function buildTrailerRead(trailerRows, trailers) {
  const typeById = new Map((trailers || []).map(t => [t.id, t.trailer_type]))
  const typeAgg = new Map()
  const activeIds = new Set()
  for (const r of trailerRows || []) {
    if (r.key_id && Number(r.realized_loads) > 0) activeIds.add(r.key_id)
    const ty = r.key_id ? typeById.get(r.key_id) : null
    if (!ty) continue
    const agg = typeAgg.get(ty) || { revenue: 0, miles: 0, loads: 0 }
    agg.revenue += Number(r.realized_revenue) || 0
    agg.miles += Number(r.total_miles) || 0
    agg.loads += Number(r.realized_loads) || 0
    typeAgg.set(ty, agg)
  }
  // Rate verdicts need real mileage behind them — a single 30-mile hop
  // shouldn't crown a trailer type.
  const types = [...typeAgg.entries()]
    .filter(([, a]) => a.miles >= 100)
    .map(([type, a]) => ({ type, rpm: a.revenue / a.miles, miles: a.miles, loads: a.loads }))
    .sort((a, b) => b.rpm - a.rpm)

  const idleByType = new Map()
  let idleTotal = 0
  for (const t of trailers || []) {
    if (activeIds.has(t.id)) continue
    idleTotal++
    const ty = t.trailer_type || 'Unclassified'
    idleByType.set(ty, (idleByType.get(ty) || 0) + 1)
  }
  const idleGroups = [...idleByType.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  return { types, idleGroups, idleTotal, trailerTotal: (trailers || []).length }
}

// ── Auto-insights ─────────────────────────────────────────────────────────
// Plain-English callouts DERIVED from the period's data — a live preview of
// BUDDY's future AI brain. Each one degrades to absent (never to a made-up
// number) when its source is empty.
function buildInsights({ pulse, concentration, trailerRead, payers, contribution, periodNoun }) {
  const out = []

  if (payers?.best) {
    const b = payers.best
    out.push({
      key: 'lane', tone: 'emerald', kicker: 'Best-paying lane',
      headline: `${b.origin} → ${b.destination}`,
      detail: `${fmtRpm(b.rpm)} across ${b.loads} load${b.loads === 1 ? '' : 's'} · avg ${Math.round(b.avgMiles)} mi`,
      to: '/fleet/profitability/lanes',
    })
  }

  if (pulse.cur.projected > 0) {
    out.push({
      key: 'pipeline', tone: 'cyan', kicker: 'Booked pipeline',
      headline: `${fmtK(pulse.cur.projected)} on the board`,
      detail: `${pulse.cur.bookedLoads.toLocaleString()} booked load${pulse.cur.bookedLoads === 1 ? '' : 's'} — revenue not yet earned`,
    })
  }

  if (concentration?.top && concentration.top.pctLoads >= 10) {
    out.push({
      key: 'concentration', tone: concentration.top.pctLoads >= 25 ? 'rose' : 'amber', kicker: 'Broker concentration',
      headline: `${concentration.top.name} = ${concentration.top.pctLoads.toFixed(0)}% of loads`,
      detail: `Top 4 brokers carry ${concentration.top4Loads.toFixed(0)}% — a dependency to watch`,
    })
  }

  if (trailerRead?.idleGroups?.length && trailerRead.idleGroups[0].count >= 3) {
    const g = trailerRead.idleGroups[0]
    out.push({
      key: 'idle', tone: 'rose', kicker: 'Idle capacity',
      headline: `${g.count} ${g.type} trailers ran $0 ${periodNoun}`,
      detail: `${trailerRead.idleTotal} of ${trailerRead.trailerTotal} trailers had no realized load in the window`,
    })
  }

  if (trailerRead?.types?.length >= 2) {
    const best = trailerRead.types[0]
    const worst = trailerRead.types[trailerRead.types.length - 1]
    out.push({
      key: 'rates', tone: 'violet', kicker: 'Equipment rates',
      headline: `${best.type} ${fmtRpm(best.rpm)} vs ${worst.type} ${fmtRpm(worst.rpm)}`,
      detail: 'realized $/mile by trailer type — like-for-like, this period',
    })
  }

  if (contribution?.top && contribution?.bottom && contribution.top.id !== contribution.bottom.id) {
    const sign = (v) => `${v < 0 ? '−' : '+'}${fmtK(Math.abs(v))}`
    out.push({
      key: 'contribution', tone: 'orange', kicker: 'Contribution spread · partial',
      headline: `${contribution.top.name} ${sign(contribution.top.contribution)} · ${contribution.bottom.name} ${sign(contribution.bottom.contribution)}`,
      detail: 'revenue − equipment − purchase, per truck — driver pay & fuel pending',
      to: '/fleet/profitability/contribution',
    })
  }

  return out
}

// ── The one fetch the page needs ──────────────────────────────────────────
// Everything in parallel: current + prior driver rollups (pulse + deltas +
// driver board), dispatcher and customer rollups, the trailer rollup +
// trailer masters (rates + idle), lane legs (best lane), and the truck
// contribution leaderboard. Lane legs and contribution are non-fatal — the
// Boardroom still opens if one of its deep wells is dry.
export async function fetchBoardroom({ from, to, basis = 'delivery' }) {
  const days = spanDays(from, to)
  const effDays = elapsedDays(from, to)
  const priorFrom = shiftYmd(from, -days)
  const priorTo = shiftYmd(to, -days)
  const rpc = (dimension, f, t) =>
    supabase.rpc('load_profit_rollup', { p_dimension: dimension, p_from: f, p_to: t, p_basis: basis })

  const [driver, driverPrior, dispatcher, customer, trailer, trailersRes, legs, legsForPulse, ownershipMap, contributionRes, teamByDriver] = await Promise.all([
    rpc('driver', from, to),
    rpc('driver', priorFrom, priorTo),
    rpc('dispatcher', from, to),
    rpc('customer', from, to),
    rpc('trailer', from, to),
    supabase.from('trailers').select('id, unit_number, trailer_type'),
    fetchLaneLegs({ from, to, basis }).catch(() => null),
    fetchLegsForPulse({ from, to, basis }).catch(() => null),
    fetchOwnershipMap().catch(() => new Map()),
    fetchContribution({ dimension: 'truck', from, to, basis }).catch(() => null),
    fetchTeamByDriver().catch(() => new Map()),
  ])
  if (driver.error) throw driver.error

  // The driver rollup keys on a team's PRIMARY and labels it with that person's
  // name; overlay the team name so the driver board reads "Arguijo / Estrada".
  const withTeamName = (rows) => (rows || []).map(r => {
    const t = r.key_id ? teamByDriver.get(r.key_id) : null
    return t ? { ...r, key_name: t.team_name, team_id: t.team_id } : r
  })
  const driverRows = withTeamName(driver.data)
  const pulse = { cur: aggregate(driverRows), prior: aggregate(driverPrior.data || []) }

  // Also calculate ownership-split pulse for the hero
  const legsForPrior = legsForPulse ? await fetchLegsForPulse({ from: priorFrom, to: priorTo, basis }).catch(() => []) : []
  const pulseWithOwnership = legsForPulse ? calculatePulseWithOwnership(legsForPulse, ownershipMap) : null
  const pulseWithOwnershipPrior = legsForPrior ? calculatePulseWithOwnership(legsForPrior, ownershipMap) : null

  const concentration = buildConcentration(customer.data)
  const trailerRead = buildTrailerRead(trailer.data, trailersRes.data)

  const laneAgg = legs ? aggregateLanes(legs, 'realized') : null
  const payers = laneAgg?.lanes?.length ? pickPayers(laneAgg.lanes) : null

  // Contribution spread: best and worst truck by partial contribution,
  // among trucks that actually have money moving (revenue or a known cost).
  let contribution = null
  if (contributionRes?.rows?.length) {
    const ranked = contributionRes.rows
      .filter(r => r.revenue > 0 || r.equipCost > 0 || r.purchase > 0)
      .sort((a, b) => b.contribution - a.contribution)
    if (ranked.length >= 2) contribution = { top: ranked[0], bottom: ranked[ranked.length - 1], count: ranked.length }
  }

  const periodNoun = days === 7 ? 'this week' : days >= 28 && days <= 31 ? 'this month' : 'this period'
  const insights = buildInsights({ pulse, concentration, trailerRead, payers, contribution, periodNoun })

  return {
    pulse,
    pulseWithOwnership,
    pulseWithOwnershipPrior,
    driverRows,
    dispatcherRows: dispatcher.data || [],
    concentration,
    trailerRead,
    lanes: laneAgg || null,
    contribution,
    insights,
    days,
    effDays,
  }
}
