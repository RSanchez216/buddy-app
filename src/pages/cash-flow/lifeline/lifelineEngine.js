// Lifeline — pure ledger math. No queries, no React. Everything here is
// arithmetic between (a) real rows fetched once from Supabase and (b) the
// user's assumption dials. The split matters: outflows are real scheduled
// events; forward inflows are ALWAYS assumptions (verified: v_cash_flow_events
// carries no future inflow rows — inflows only appear once recorded).

import { addDays, isPaidStatus, startOfWeek, toISO } from '../calendarUtils'

// Transfers move money between our own accounts (the view emits both legs)
// and adjustments are reconciliation artifacts — neither is company-level
// cash in or out, so both sides of the ledger ignore them.
function isInternal(ev) {
  return ev.category === 'transfer'
    || ev.category === 'adjustment'
    || ev.reference_type === 'transfer_in'
    || ev.reference_type === 'transfer_out'
    || ev.reference_type === 'adjustment'
}

// Forward-looking real obligations: future-dated, not already paid, external.
export function filterForwardOutflows(rows, todayISO) {
  return (rows || []).filter(ev =>
    ev.direction === 'outflow'
    && ev.event_date >= todayISO
    && !isPaidStatus(ev.status)
    && !isInternal(ev)
  )
}

// ── Assumption defaults (computed from history, never invented) ────────────

// Trailing N-full-week average of recorded (non-transfer) inflows. History is
// lumpy — collections get batch-recorded — which is exactly why this number is
// presented as an editable assumption, not a forecast.
export function collectionsDefault({ inflowHistory, weeks = 6, realizedWeeklyRevenueMax = 0 }) {
  const total = (inflowHistory || [])
    .filter(ev => !isInternal(ev))
    .reduce((s, ev) => s + Number(ev.amount || 0), 0)
  let avg = total / weeks
  // Clamp to a sane band vs realized billed freight: you can't sustainably
  // collect (much) more than you bill. Only binds if history is wildly off.
  if (realizedWeeklyRevenueMax > 0) avg = Math.min(avg, realizedWeeklyRevenueMax * 1.2)
  return Math.max(0, Math.round(avg / 500) * 500)
}

// Driver-purchase recovery: expected weekly rate from the payment schedule,
// default dial = the rate actually collected recently (verified ≈ 3%, not the
// ~$32K/wk face value — defaulting to face value would fabricate cash).
export function recoveryDefaults(paymentRows, weeks = 6) {
  let expected = 0, actual = 0
  for (const r of (paymentRows || [])) {
    expected += Number(r.expected_amount || 0)
    actual += Number(r.actual_amount || 0)
  }
  const expectedWeekly = expected / weeks
  const pct = expected > 0 ? Math.round((actual / expected) * 100) : 0
  return { expectedWeekly: Math.round(expectedWeekly), defaultPct: Math.min(100, Math.max(0, pct)) }
}

// ── The ledger ──────────────────────────────────────────────────────────────
// Daily array from today through the horizon. Real outflows land on their
// actual event dates; assumed inflows spread evenly across each week's days
// (1/7 per day — visibly an assumption, and it naturally prorates the current
// partial week since days before today aren't in the ledger).
//
// Returns { days, weeks, breach, worst } where:
//   days:  [{ date, iso, outflow, inflow, catchup, balance, floorBalance, weekIdx }]
//   weeks: [{ start, end, label, outflow, inflow, catchup, net, startBalance,
//             endBalance, minBalance, events }]
//   breach: first day balance < 0 (or null) with its week's cause numbers
//   worst:  the lowest-balance day in the horizon
export function buildLedger({
  startCash,
  outflowEvents,        // already filtered via filterForwardOutflows
  horizonWeeks,
  collectionsPerWeek,   // assumption dial
  recoveryPct,          // assumption dial (0–100)
  expectedRecoveryWeekly,
  catchUp,              // past-due scenario toggle
  catchUpWeeks,
  pastDueTotal,
  today,
}) {
  const week0 = startOfWeek(today)
  const totalDays = horizonWeeks * 7
  const horizonEnd = addDays(week0, totalDays) // exclusive

  // Bucket real outflows by ISO date once.
  const outByDay = new Map()
  for (const ev of outflowEvents) {
    if (ev.event_date >= toISO(horizonEnd)) continue
    const amt = Number(ev.amount || 0)
    outByDay.set(ev.event_date, (outByDay.get(ev.event_date) || 0) + amt)
  }

  const inflowPerDay = (collectionsPerWeek + (recoveryPct / 100) * expectedRecoveryWeekly) / 7
  const catchupPerDay = catchUp && pastDueTotal > 0 && catchUpWeeks > 0
    ? pastDueTotal / catchUpWeeks / 7
    : 0

  const days = []
  let balance = startCash
  let floorBalance = startCash // honesty floor: real obligations, zero collections
  for (let d = new Date(today); d < horizonEnd; d = addDays(d, 1)) {
    const iso = toISO(d)
    const weekIdx = Math.floor((d - week0) / 86400000 / 7)
    const outflow = outByDay.get(iso) || 0
    const catchup = weekIdx < catchUpWeeks ? catchupPerDay : 0
    const inflow = inflowPerDay
    balance += inflow - outflow - (catchUp ? catchup : 0)
    floorBalance += -outflow - (catchUp ? catchup : 0)
    days.push({ date: new Date(d), iso, outflow, inflow, catchup: catchUp ? catchup : 0, balance, floorBalance, weekIdx })
  }

  // Weekly rollup (week 0 is partial — today through Sunday — by design).
  const weeks = []
  for (let w = 0; w < horizonWeeks; w++) {
    const wDays = days.filter(d => d.weekIdx === w)
    if (!wDays.length) continue
    const start = addDays(week0, w * 7)
    const outflow = wDays.reduce((s, d) => s + d.outflow, 0)
    const inflow = wDays.reduce((s, d) => s + d.inflow, 0)
    const catchup = wDays.reduce((s, d) => s + d.catchup, 0)
    const startISO = toISO(start)
    const endISO = toISO(addDays(start, 6))
    weeks.push({
      idx: w,
      start,
      end: addDays(start, 6),
      label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      outflow,
      inflow,
      catchup,
      net: inflow - outflow - catchup,
      startBalance: wDays[0].balance - (wDays[0].inflow - wDays[0].outflow - wDays[0].catchup),
      endBalance: wDays[wDays.length - 1].balance,
      minBalance: Math.min(...wDays.map(d => d.balance)),
      events: outflowEvents
        .filter(ev => ev.event_date >= startISO && ev.event_date <= endISO)
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
    })
  }

  // First zero-crossing → the breach beacon, with its week's honest cause.
  let breach = null
  const breachDay = days.find(d => d.balance < 0)
  if (breachDay) {
    const wk = weeks.find(w => w.idx === breachDay.weekIdx)
    breach = {
      date: breachDay.date,
      iso: breachDay.iso,
      dayIdx: days.indexOf(breachDay),
      weekLabel: wk?.label,
      obligations: (wk?.outflow || 0) + (wk?.catchup || 0),
      expected: wk?.inflow || 0,
    }
  }

  let worst = days[0]
  for (const d of days) if (d.balance < worst.balance) worst = d

  return { days, weeks, breach, worst, week0 }
}

// Runway in weeks until the first breach, one decimal; null = clear horizon.
export function runwayWeeks(breach, today) {
  if (!breach) return null
  return Math.max(0, Math.round(((breach.date - today) / 86400000 / 7) * 10) / 10)
}

// "Nice" axis ticks covering [min, max] with ~count steps.
export function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1 }
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2.5 : norm > 1 ? 2 : 1) * mag
  const ticks = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(v)
  return ticks
}
