// Per-bank running-balance projection for the Payment Calendar.
//
// Inflow attribution comes from the expected_inflow_deposits table — one
// inflow can split across multiple banks. Outflows (loan / invoice / custom /
// recurring) use the event row's funding_account_id directly.
//
// All math is plain client-side; no realtime subscriptions or server calls.

import { supabase } from '../../lib/supabase'
import { addDays, toISO } from './calendarUtils'

const UNASSIGNED = '__unassigned__'

// Fetch per-day per-account projected balances from the SQL function
// projected_balances(account_id, end_date). Returns the same shape as
// the legacy computeBalanceProjections() so consumers (PaymentCalendar,
// RightRail, week/month views) don't change:
//
//   { timelines: { [accountId]: { account, byDate: {iso: balance}, firstShortfall } },
//     shortfallDays: Set<`${accountId}:${iso}`> }
//
// The RPC computes flows server-side directly from loan_payments,
// custom_outflows, invoices, and expected_inflow_deposits — so this
// helper doesn't need events/depositsByInflow inputs. It only needs
// the account list (for active filtering + display metadata) and the
// view-end date.
//
// Performance: one RPC per active account, in parallel. 11 accounts ×
// ~5ms per call ≈ 50ms wall-clock. If the count grows we can change
// the function signature to take an array of accounts.
export async function fetchProjectedBalances(accounts, viewEndISO) {
  const timelines = {}
  const shortfallDays = new Set()
  const activeAccounts = (accounts || []).filter(a => a.is_active)
  if (activeAccounts.length === 0 || !viewEndISO) {
    return { timelines, shortfallDays }
  }
  const results = await Promise.all(activeAccounts.map(async acc => {
    const { data, error } = await supabase.rpc('projected_balances', {
      p_funding_account_id: acc.id,
      p_end_date: viewEndISO,
    })
    if (error) console.warn('projected_balances error for', acc.name, error.message)
    return { acc, rows: error ? [] : (data || []) }
  }))
  for (const { acc, rows } of results) {
    // Empty rows = no anchor entry yet for this account. The consumer
    // pattern is "timelines[id] missing → balance: null → 'balance
    // not set'" — preserve that by leaving the entry out.
    if (rows.length === 0) continue
    const byDate = {}
    let firstShortfall = null
    for (const r of rows) {
      const bal = Number(r.ending_balance)
      byDate[r.as_of_date] = bal
      if (bal < 0) {
        if (!firstShortfall) firstShortfall = { date: r.as_of_date, balance: bal }
        shortfallDays.add(`${acc.id}:${r.as_of_date}`)
      }
    }
    timelines[acc.id] = { account: acc, byDate, firstShortfall }
  }
  return { timelines, shortfallDays }
}

// ── Per-event "bank impacts" ────────────────────────────────────────────
// v_cash_flow_events already exposes inflows at the deposit grain — one
// row per expected_inflow_deposits row, with amount = d.amount and
// funding_account_id = d.funding_account_id. So every event maps to a
// single bank for a single amount; no parent-level re-aggregation here.
function eventImpacts(ev) {
  const key = ev.funding_account_id || UNASSIGNED
  return {
    byAccount: { [key]: Number(ev.amount || 0) },
    isInflow: ev.direction === 'inflow',
  }
}

// Pretty name for an account id, falling back through display sources.
function accountLabel(accountId, ev, accountsById) {
  if (!accountId) return 'Unassigned'
  // Prefer the canonical name from accountsById; if missing (e.g. inactive),
  // fall back to whatever the event row carried.
  if (accountsById && accountsById[accountId]) return accountsById[accountId].name
  if (ev?.funding_account_name) return ev.funding_account_name
  return '—'
}

// Bucket events by day, then by bank. Each event row in v_cash_flow_events
// already carries its own deposit-level funding_account_id and amount, so
// attribution is one event → one bank.
// Output shape:
//   { [iso]: { totals: {inflow, outflow}, banks: { [accountId|UNASSIGNED]: { accountId, name, inflow, outflow, events } } } }
export function bucketByDayAndBank(events, accounts) {
  const accountsById = Object.fromEntries((accounts || []).map(a => [a.id, a]))
  const byDay = {}

  for (const ev of events) {
    const iso = ev.event_date
    if (!iso) continue
    if (!byDay[iso]) byDay[iso] = { totals: { inflow: 0, outflow: 0 }, banks: {} }

    const { byAccount, isInflow } = eventImpacts(ev)
    for (const [key, amt] of Object.entries(byAccount)) {
      const bucket = byDay[iso].banks[key] || (byDay[iso].banks[key] = {
        accountId: key === UNASSIGNED ? null : key,
        name: accountLabel(key === UNASSIGNED ? null : key, ev, accountsById),
        inflow: 0,
        outflow: 0,
        events: [],
      })
      if (isInflow) {
        bucket.inflow += amt
        byDay[iso].totals.inflow += amt
      } else {
        bucket.outflow += amt
        byDay[iso].totals.outflow += amt
      }
    }

    // Attach the source event to the bank bucket(s) it touched, for chip
    // grouping by bank. An inflow that splits across N banks shows up under
    // each section.
    for (const key of Object.keys(byAccount)) {
      const bucket = byDay[iso].banks[key]
      if (bucket && !bucket.events.includes(ev)) bucket.events.push(ev)
    }
  }

  return byDay
}

// Sum events into per-bank totals for a date range (inclusive). Uses the
// same per-row attribution as bucketByDayAndBank (one event → one bank).
// Returns array of { accountId, name, inflow, outflow, net }, sorted by |net| desc.
export function sumByBankInRange(events, accounts, startISO, endISO) {
  const accountsById = Object.fromEntries((accounts || []).map(a => [a.id, a]))
  const acc = {}

  for (const ev of events) {
    if (!ev.event_date) continue
    if (ev.event_date < startISO || ev.event_date > endISO) continue
    const { byAccount, isInflow } = eventImpacts(ev)
    for (const [key, amt] of Object.entries(byAccount)) {
      if (!acc[key]) acc[key] = {
        accountId: key === UNASSIGNED ? null : key,
        name: accountLabel(key === UNASSIGNED ? null : key, ev, accountsById),
        inflow: 0, outflow: 0,
      }
      if (isInflow) acc[key].inflow += amt
      else acc[key].outflow += amt
    }
  }

  return Object.values(acc)
    .map(b => ({ ...b, net: b.inflow - b.outflow }))
    .sort((x, y) => {
      // Unassigned pinned to bottom
      if (!x.accountId && y.accountId) return 1
      if (x.accountId && !y.accountId) return -1
      return Math.abs(y.net) - Math.abs(x.net)
    })
}

// Compute per-account day-end balance timelines from balance_as_of_date
// forward to viewEndISO. Only considers active accounts with both
// current_balance and balance_as_of_date set.
//
// Output:
//   {
//     timelines: {
//       [accountId]: { account, byDate: {[iso]: balance}, firstShortfall: {date, balance}|null }
//     },
//     shortfallDays: Set<`${accountId}:${iso}`>
//   }
export function computeBalanceProjections(accounts, events, viewEndISO) {
  const timelines = {}
  const shortfallDays = new Set()

  // Pre-bucket per-day per-account net (signed) for fast walks
  // perAccountPerDay[accountId][iso] = net (in - out)
  const perAccountPerDay = {}
  for (const ev of events) {
    if (!ev.event_date) continue
    const { byAccount, isInflow } = eventImpacts(ev)
    for (const [key, amt] of Object.entries(byAccount)) {
      if (key === UNASSIGNED) continue // unassigned events excluded from projection
      if (!perAccountPerDay[key]) perAccountPerDay[key] = {}
      const day = perAccountPerDay[key][ev.event_date] || 0
      perAccountPerDay[key][ev.event_date] = day + (isInflow ? amt : -amt)
    }
  }

  for (const acc of accounts) {
    if (!acc.is_active) continue
    if (acc.current_balance == null || !acc.balance_as_of_date) continue
    const startISO = acc.balance_as_of_date
    if (startISO > viewEndISO) continue

    const dayNets = perAccountPerDay[acc.id] || {}
    let balance = Number(acc.current_balance)
    const byDate = {}
    let firstShortfall = null

    let cursor = new Date(`${startISO}T00:00:00`)
    const stop = new Date(`${viewEndISO}T00:00:00`)
    while (cursor <= stop) {
      const iso = toISO(cursor)
      balance += (dayNets[iso] || 0)
      byDate[iso] = balance
      if (balance < 0) {
        if (!firstShortfall) firstShortfall = { date: iso, balance }
        shortfallDays.add(`${acc.id}:${iso}`)
      }
      cursor = addDays(cursor, 1)
    }

    timelines[acc.id] = { account: acc, byDate, firstShortfall }
  }

  return { timelines, shortfallDays }
}

// Worst-affected account during [startISO, endISO]: most negative balance
// within the window, with the date it first crossed zero.
export function worstShortfallInRange(timelines, startISO, endISO) {
  let worst = null
  for (const t of Object.values(timelines)) {
    if (!t.firstShortfall) continue
    if (t.firstShortfall.date > endISO) continue
    let lowest = Infinity
    let firstNeg = null
    for (const [iso, bal] of Object.entries(t.byDate)) {
      if (iso < startISO || iso > endISO) continue
      if (bal < 0 && !firstNeg) firstNeg = iso
      if (bal < lowest) lowest = bal
    }
    if (lowest < 0) {
      const candidate = { account: t.account, lowest, firstNegDate: firstNeg || t.firstShortfall.date }
      if (!worst || candidate.lowest < worst.lowest) worst = candidate
    }
  }
  return worst
}

// Worst shortfall on or before a specific day, across all accounts.
// Used by the day-footer pill.
export function worstShortfallOnOrBefore(timelines, dayISO) {
  let worst = null
  for (const t of Object.values(timelines)) {
    if (!t.firstShortfall) continue
    if (t.firstShortfall.date > dayISO) continue
    const bal = t.byDate[dayISO]
    if (bal == null) continue
    if (bal < 0 && (!worst || bal < worst.balance)) worst = { account: t.account, balance: bal }
  }
  return worst
}

// Did any account hit a shortfall on this exact day?
export function anyShortfallOnDay(shortfallDays, dayISO) {
  for (const key of shortfallDays) {
    if (key.endsWith(`:${dayISO}`)) return true
  }
  return false
}
