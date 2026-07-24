import { supabase } from '../../../../lib/supabase'
import { withTimeout } from '../../../../lib/withTimeout'

// Dispatcher Scorecard — data + pure derivations. All aggregation lives in
// three Postgres RPCs; this module only wraps the calls, does period math for
// the selector/stepper, formats money/metrics, and computes the client-side
// "read" labels + focus cards from the returned rows.

// ── period math (local, no UTC drift) ────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STEP_MONTHS = { month: 1, quarter: 3, half: 6, year: 12 }
const pad = (n) => String(n).padStart(2, '0')
const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

export function todayISO() {
  const n = new Date()
  return toISO(n.getFullYear(), n.getMonth() + 1, n.getDate())
}
function parts(iso) {
  const [y, m] = String(iso).split('-').map(Number)
  return { y, m }
}
// First month of the grain's window that contains the anchor.
function startMonth(grain, m) {
  if (grain === 'year') return 1
  if (grain === 'half') return m <= 6 ? 1 : 7
  if (grain === 'quarter') return m - ((m - 1) % 3)
  return m // month
}
// Canonical anchor to send the RPC: first day of the target window (any date
// inside the window is accepted; the window start is unambiguous).
export function anchorForRpc(grain, anchorISO) {
  const { y, m } = parts(anchorISO)
  return toISO(y, startMonth(grain, m), 1)
}
export function periodLabel(grain, anchorISO) {
  const { y, m } = parts(anchorISO)
  const sm = startMonth(grain, m)
  if (grain === 'year') return `${y}`
  if (grain === 'month') return `${MON[sm - 1]} ${y}`
  const span = grain === 'quarter' ? 2 : 5
  return `${MON[sm - 1]} – ${MON[sm + span - 1]} ${y}`
}
export function stepAnchor(grain, anchorISO, dir) {
  const { y, m } = parts(anchorISO)
  const sm = startMonth(grain, m)
  const d = new Date(y, sm - 1 + dir * STEP_MONTHS[grain], 1)
  return toISO(d.getFullYear(), d.getMonth() + 1, 1)
}
export function isCurrentPeriod(grain, anchorISO) {
  return anchorForRpc(grain, anchorISO) >= anchorForRpc(grain, todayISO())
}

// Half-open bounds of the grain's window + the list of month-starts inside it
// (1 for month, 3/6/12 for quarter/half/year). Used to roll monthly reviews up
// across a multi-month period and to render one pip per constituent month.
export function periodBounds(grain, anchorISO) {
  const start = anchorForRpc(grain, anchorISO)
  const end = stepAnchor(grain, start, 1) // first day of the next window
  const months = []
  let cur = start
  while (cur < end) { months.push(cur); cur = stepAnchor('month', cur, 1) }
  return { start, end, months }
}

// Short month label from a 'YYYY-MM-01' period_month (e.g. "May").
export function monthShort(iso) {
  const { m } = parts(iso)
  return MON[m - 1] || ''
}

// Compact period label for PDF header/filename: "May 2026" · "Q2 2026" ·
// "H1 2026" · "2026" (the on-screen stepper keeps the month-span label).
export function periodLabelShort(grain, anchorISO) {
  const { y, m } = parts(anchorISO)
  const sm = startMonth(grain, m)
  if (grain === 'year') return `${y}`
  if (grain === 'month') return `${MON[sm - 1]} ${y}`
  if (grain === 'quarter') return `Q${Math.floor((sm - 1) / 3) + 1} ${y}`
  if (grain === 'half') return `H${sm <= 6 ? 1 : 2} ${y}`
  return periodLabel(grain, anchorISO)
}

// ── formatting ───────────────────────────────────────────────────────────────
export function money(n) {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3)}k`
  return `$${Math.round(n).toLocaleString('en-US')}`
}
export function perDriver(n) {
  if (n == null) return '—'
  return Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`
}
export const rpm = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`)
export const int = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'))
export const pct = (n) => (n == null ? null : `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`)

// ── queries ──────────────────────────────────────────────────────────────────
// Timeout lives in the shared kit (src/lib/withTimeout), defaulting to 20s —
// comfortably above the slowest grain (year ~4s) yet bounded so a hung request
// surfaces the retry UI instead of spinning forever. The kit rejects at `ms`
// even when the transport ignores the abort, so the hang-safe behavior stays in
// one place. Call sites still pass `signal => builder.abortSignal(signal)`.
export async function fetchScorecard(grain, anchorISO) {
  const { data, error } = await withTimeout(signal =>
    supabase.rpc('dispatcher_scorecard', { p_grain: grain, p_anchor: anchorForRpc(grain, anchorISO) }).abortSignal(signal))
  if (error) throw error
  return data || []
}
export async function fetchDeskDrivers(deskId, grain, anchorISO) {
  const { data, error } = await withTimeout(signal =>
    supabase.rpc('dispatcher_desk_drivers', { p_desk: deskId, p_grain: grain, p_anchor: anchorForRpc(grain, anchorISO) }).abortSignal(signal))
  if (error) throw error
  return data || []
}
export async function fetchAmazonBookers(grain, anchorISO) {
  const { data, error } = await withTimeout(signal =>
    supabase.rpc('amazon_team_bookers', { p_grain: grain, p_anchor: anchorForRpc(grain, anchorISO) }).abortSignal(signal))
  if (error) throw error
  return data || []
}
// Every driver terminated in the period, with the run they booked through their
// desk. One call for the whole period — do NOT loop dispatcher_desk_drivers.
export async function fetchDepartures(grain, anchorISO) {
  const { data, error } = await withTimeout(signal =>
    supabase.rpc('dispatcher_departures', { p_grain: grain, p_anchor: anchorForRpc(grain, anchorISO) }).abortSignal(signal))
  if (error) throw error
  return data || []
}

// ── monthly review sign-off (dispatcher_reviews) ─────────────────────────────
// desk_key convention: desk_id::text for normal desks, the literal 'amazon' for
// the Amazon Team row (its desk_id is null). Used both to key the RPC and to
// merge review rows back onto the scorecard desks.
export function deskKeyOf(desk) {
  return desk?.is_amazon_team ? 'amazon' : String(desk?.desk_id)
}
export async function fetchReviews(monthStart) {
  const { data, error } = await withTimeout(signal =>
    supabase.from('dispatcher_reviews')
      .select('desk_key, reviewed, note, reviewed_by, reviewed_at')
      .eq('period_month', monthStart)
      .abortSignal(signal))
  if (error) throw error
  return data || []
}
// All monthly reviews within a half-open [start, end) period — for the
// multi-month roll-up on the Quarter/Half/Year views.
export async function fetchReviewsRange(start, end) {
  const { data, error } = await withTimeout(signal =>
    supabase.from('dispatcher_reviews')
      .select('desk_key, period_month, reviewed, note')
      .gte('period_month', start).lt('period_month', end)
      .abortSignal(signal))
  if (error) throw error
  return data || []
}
export async function setDispatcherReview(deskKey, monthStart, reviewed, note) {
  const { data, error } = await withTimeout(signal =>
    supabase.rpc('set_dispatcher_review', {
      p_desk_key: deskKey, p_period_month: monthStart, p_reviewed: reviewed, p_note: note ?? null,
    }).abortSignal(signal))
  if (error) throw error
  return data
}
// Resolve reviewer display names for the "Reviewed · by {name}" line.
export async function fetchUserNames(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  if (!unique.length) return {}
  const { data } = await supabase.from('users').select('id, full_name, email').in('id', unique)
  const m = {}
  ;(data || []).forEach(u => { m[u.id] = u.full_name || u.email || 'A manager' })
  return m
}

// ── reference floors (from non-Amazon rows) ──────────────────────────────────
export const churnRate = (d) => (d.turnover || 0) / Math.max(d.drivers_period || 0, 1)

export function computeFloors(desks) {
  const g = desks.reduce((s, d) => s + Number(d.gross || 0), 0)
  const mi = desks.reduce((s, d) => s + Number(d.miles || 0), 0)
  const dm = desks.reduce((s, d) => s + Number(d.driver_months || 0), 0)
  const grossSorted = desks.map(d => Number(d.gross || 0)).sort((a, b) => b - a)
  const q1Idx = Math.max(0, Math.floor(grossSorted.length * 0.25) - 1)
  return {
    floorRpm: mi > 0 ? g / mi : 0,
    floorPd: dm > 0 ? g / dm : 0,
    maxRpm: desks.reduce((mx, d) => Math.max(mx, Number(d.rpm || 0)), 0),
    topQuartileGross: grossSorted[q1Idx] ?? Infinity, // desk is top-quartile if gross >= this
    medianGross: grossSorted[Math.floor(grossSorted.length / 2)] ?? 0,
  }
}

// ── the "read": leaderboard pill + drawer analysis ───────────────────────────
// tone drives chip/pill colors and the drawer's left border.
export function deskRead(d, floors, { inProgress = false } = {}) {
  const cr = churnRate(d)
  const topTier = Number(d.gross) >= floors.topQuartileGross
  const lowChurn = cr < 0.4
  const rpmGap = floors.floorRpm - Number(d.rpm || 0)
  // A partial (in-progress) period compares partial-vs-full, so the delta is
  // misleading — never let it drive the read while the period is still open.
  const delta = (inProgress || d.gross_delta_pct == null) ? null : Number(d.gross_delta_pct)

  let label, tone
  if (cr >= 2.0) { label = 'Retention risk'; tone = 'red' }
  else if (cr >= 1.0 && !topTier) { label = 'Watch churn'; tone = 'amber' }
  else if (rpmGap >= 0.20) { label = 'Pricing gap'; tone = 'red' }
  else if (delta != null && delta <= -20) { label = 'Down vs prior'; tone = 'amber' }
  else if (topTier && Number(d.rpm) >= floors.floorRpm && lowChurn) { label = 'Model desk'; tone = 'green' }
  else if (Number(d.rpm) >= floors.maxRpm - 1e-9) { label = 'Top RPM'; tone = 'green' }
  else { label = 'Steady'; tone = 'green' }

  return { label, tone, analysis: readAnalysis(label, d, floors) }
}

function readAnalysis(label, d, floors) {
  const cr = churnRate(d)
  const rpmGap = floors.floorRpm - Number(d.rpm || 0)
  switch (label) {
    case 'Retention risk':
    case 'Watch churn':
      return `Books ${money(d.gross)} but can't hold drivers — ${int(d.turnover)} left against ${int(d.drivers_period)} held, roughly ${cr.toFixed(1)}× the floor's churn. Retention is the story.`
    case 'Pricing gap':
      return `Volume is healthy but RPM is ${rpm(d.rpm)}, about ${rpm(rpmGap)} under the ${rpm(floors.floorRpm)} floor. At floor RPM this desk adds ≈${money(rpmGap * Number(d.miles || 0))} per period. Pricing is the lever.`
    case 'Down vs prior':
      return `Gross is down ${pct(d.gross_delta_pct)} vs the prior period. Worth a look at what changed — lanes, drivers, or volume.`
    case 'Model desk':
      return `Strong across the board — top-tier gross, pricing at/above the ${rpm(floors.floorRpm)} floor, low churn. No weak column.`
    case 'Top RPM':
      return `Best pricing on the floor at ${rpm(d.rpm)} vs the ${rpm(floors.floorRpm)} blended floor. Volume has room to grow behind that rate.`
    default:
      return `Holding steady — ${money(d.gross)} gross at ${rpm(d.rpm)} RPM with ${int(d.turnover)} departures. Nothing flashing.`
  }
}

// The 3 comparison chips shown under the analysis sentence.
export function readChips(d, floors) {
  const rpmDelta = Number(d.rpm || 0) - floors.floorRpm
  const turn = churnRate(d) * 100
  return [
    { label: 'RPM vs floor', value: `${rpmDelta >= 0 ? '+' : '−'}$${Math.abs(rpmDelta).toFixed(2)}`, tone: rpmDelta >= 0 ? 'green' : 'red' },
    { label: 'Departure rate', value: `${Math.round(turn)}%`, tone: turn <= 40 ? 'green' : turn <= 80 ? 'amber' : 'red' },
    { label: '$/driver·mo', value: perDriver(d.per_driver_month), tone: Number(d.per_driver_month || 0) >= floors.floorPd ? 'green' : 'amber' },
  ]
}

// ── focus cards (up to 4, each desk on its most severe flag only) ────────────
export function surfaceFocus(desks, floors, { inProgress = false } = {}) {
  const used = new Set()
  const cards = []
  const byGrossDesc = [...desks].sort((a, b) => Number(b.gross) - Number(a.gross))
  const topHalf = byGrossDesc.slice(0, Math.ceil(byGrossDesc.length / 2))

  // 1. High churn
  const churnPick = [...desks].filter(d => !used.has(d.desk_id))
    .sort((a, b) => churnRate(b) - churnRate(a))[0]
  if (churnPick && churnRate(churnPick) > 1.0) {
    used.add(churnPick.desk_id)
    cards.push({ desk: churnPick, tag: 'High churn', tone: 'red', reason: `${int(churnPick.turnover)} of ${int(churnPick.drivers_period)} drivers left this period.` })
  }

  // 2. Watch · low RPM (top-half by gross, furthest below floor, gap ≥ 0.15)
  const rpmPick = topHalf.filter(d => !used.has(d.desk_id))
    .sort((a, b) => Number(a.rpm) - Number(b.rpm))[0]
  if (cards.length < 4 && rpmPick && floors.floorRpm - Number(rpmPick.rpm) >= 0.15) {
    used.add(rpmPick.desk_id)
    const onTable = (floors.floorRpm - Number(rpmPick.rpm)) * Number(rpmPick.miles || 0)
    cards.push({ desk: rpmPick, tag: 'Watch · low RPM', tone: 'amber', reason: `RPM ${rpm(rpmPick.rpm)} vs ${rpm(floors.floorRpm)} floor — ${money(onTable)} on the table if it reached the floor.` })
  }

  // 3. Slipping (most negative delta; only for COMPLETED periods — a partial
  // period's delta is partial-vs-full and would flag everyone as slipping)
  const slipPick = inProgress ? null : desks.filter(d => !used.has(d.desk_id) && d.gross_delta_pct != null)
    .sort((a, b) => Number(a.gross_delta_pct) - Number(b.gross_delta_pct))[0]
  if (cards.length < 4 && slipPick && Number(slipPick.gross_delta_pct) < 0) {
    used.add(slipPick.desk_id)
    cards.push({ desk: slipPick, tag: 'Slipping', tone: 'amber', reason: `Gross down ${pct(slipPick.gross_delta_pct)} vs the prior period.` })
  }

  // 4. Top performer (highest gross not already shown)
  const topPick = byGrossDesc.find(d => !used.has(d.desk_id))
  if (cards.length < 4 && topPick) {
    used.add(topPick.desk_id)
    cards.push({ desk: topPick, tag: 'Top performer', tone: 'green', reason: `Highest gross this period at ${money(topPick.gross)}, ${rpm(topPick.rpm)} RPM.` })
  }

  // Fill remaining slots with next-highest-gross desks tagged "Solid".
  for (const d of byGrossDesc) {
    if (cards.length >= 4) break
    if (used.has(d.desk_id)) continue
    used.add(d.desk_id)
    cards.push({ desk: d, tag: 'Solid', tone: 'green', reason: `${money(d.gross)} gross at ${rpm(d.rpm)} RPM, ${int(d.turnover)} departures.` })
  }
  return cards
}

// Amazon booker strength vs the team RPM (from the Amazon scorecard row).
export function bookerTier(booker, teamRpm) {
  const r = Number(booker.rpm || 0)
  if (r >= teamRpm + 0.10) return 'strong'
  if (r <= teamRpm - 0.15) return 'weak'
  return 'mid'
}
