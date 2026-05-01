// Per-bank running-balance projection for the Payment Calendar.
//
// Inputs:
//   accounts: rows from funding_accounts with at minimum
//             { id, name, bank_name, last_four, current_balance, balance_as_of_date, is_active }
//   events:   rows from v_cash_flow_events (already filtered to the visible window)
//             with { event_date, direction, amount, funding_account_id, status }
//   viewEndISO: last day in the visible window (YYYY-MM-DD)
//
// Output:
//   {
//     // Per-account day-end balance timeline, keyed by account id.
//     // Only accounts with both current_balance and balance_as_of_date set
//     // appear here. Each timeline starts at balance_as_of_date and walks
//     // forward to viewEndISO.
//     timelines: {
//       [accountId]: { account, byDate: { [iso]: balance }, firstShortfall: { date, balance } | null }
//     },
//     // Quick lookup: list of (accountId, date, balance) for any day where
//     // the projected end-of-day balance was negative.
//     shortfallDays: Set<`${accountId}:${iso}`>,
//     // First time any account dipped below zero — used by right-rail "this week" warning.
//     // Worst account by end-of-week balance (most negative) when multiple shortfall.
//   }
//
// All math is plain client-side; no realtime subscriptions or server calls.

import { addDays, toISO } from './calendarUtils'

const UNASSIGNED = '__unassigned__'

function eventNet(ev) {
  const amt = Number(ev.amount || 0)
  return ev.direction === 'inflow' ? amt : -amt
}

// Compute a per-account balance timeline from balance_as_of_date through viewEndISO.
export function computeBalanceProjections(accounts, events, viewEndISO) {
  const timelines = {}
  const shortfallDays = new Set()

  for (const acc of accounts) {
    if (acc.current_balance == null || !acc.balance_as_of_date) continue
    if (!acc.is_active) continue

    const startISO = acc.balance_as_of_date
    const endISO = viewEndISO
    if (startISO > endISO) continue

    // Bucket events for this account by day
    const eventsByDay = {}
    for (const ev of events) {
      if (ev.funding_account_id !== acc.id) continue
      if (!ev.event_date) continue
      const k = ev.event_date
      eventsByDay[k] = (eventsByDay[k] || 0) + eventNet(ev)
    }

    let balance = Number(acc.current_balance)
    const byDate = {}
    let firstShortfall = null

    let cursor = new Date(`${startISO}T00:00:00`)
    const stop = new Date(`${endISO}T00:00:00`)
    while (cursor <= stop) {
      const iso = toISO(cursor)
      balance += (eventsByDay[iso] || 0)
      byDate[iso] = balance
      if (balance < 0 && firstShortfall === null) {
        firstShortfall = { date: iso, balance }
      }
      if (balance < 0) shortfallDays.add(`${acc.id}:${iso}`)
      cursor = addDays(cursor, 1)
    }

    timelines[acc.id] = { account: acc, byDate, firstShortfall }
  }

  return { timelines, shortfallDays }
}

// Bucket events by day → { [iso]: { totals: {inflow, outflow}, banks: { [accountId|UNASSIGNED]: {name, inflow, outflow, events} } } }
export function bucketByDayAndBank(events) {
  const byDay = {}
  for (const ev of events) {
    const k = ev.event_date
    if (!k) continue
    if (!byDay[k]) byDay[k] = { totals: { inflow: 0, outflow: 0 }, banks: {} }
    const accId = ev.funding_account_id || UNASSIGNED
    if (!byDay[k].banks[accId]) {
      byDay[k].banks[accId] = {
        accountId: ev.funding_account_id || null,
        name: ev.funding_account_name || (ev.funding_account_id ? '—' : 'Unassigned'),
        inflow: 0,
        outflow: 0,
        events: [],
      }
    }
    const bucket = byDay[k].banks[accId]
    bucket.events.push(ev)
    const amt = Number(ev.amount || 0)
    if (ev.direction === 'inflow') {
      byDay[k].totals.inflow += amt
      bucket.inflow += amt
    } else {
      byDay[k].totals.outflow += amt
      bucket.outflow += amt
    }
  }
  return byDay
}

// Sum events into per-bank totals for a date range (inclusive).
// Returns array of { accountId, name, inflow, outflow, net }, sorted by |net| desc.
export function sumByBankInRange(events, accounts, startISO, endISO) {
  const acc = {}
  for (const ev of events) {
    if (!ev.event_date) continue
    if (ev.event_date < startISO || ev.event_date > endISO) continue
    const id = ev.funding_account_id || UNASSIGNED
    if (!acc[id]) {
      acc[id] = {
        accountId: ev.funding_account_id || null,
        name: ev.funding_account_name || (ev.funding_account_id ? '—' : 'Unassigned'),
        inflow: 0, outflow: 0,
      }
    }
    const amt = Number(ev.amount || 0)
    if (ev.direction === 'inflow') acc[id].inflow += amt
    else acc[id].outflow += amt
  }

  // Fill in account display info from the funding_accounts table for any
  // account that had events but a missing name in the view (defensive).
  for (const a of accounts) {
    if (acc[a.id] && !acc[a.id].name) acc[a.id].name = a.name
  }

  return Object.values(acc)
    .map(b => ({ ...b, net: b.inflow - b.outflow }))
    .sort((x, y) => Math.abs(y.net) - Math.abs(x.net))
}

// Find the worst-affected account during [startISO, endISO]:
// the one that goes most negative by end of the range, with the date it
// first crossed zero. Returns null if no shortfall.
export function worstShortfallInRange(timelines, startISO, endISO) {
  let worst = null
  for (const [accountId, t] of Object.entries(timelines)) {
    if (!t.firstShortfall) continue
    if (t.firstShortfall.date > endISO) continue
    // Find lowest balance in the range
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
    if (bal < 0) {
      if (!worst || bal < worst.balance) worst = { account: t.account, balance: bal }
    }
  }
  return worst
}

// Did any account hit a shortfall on this exact day (regardless of cumulative)?
// Used to decorate the month-view dot.
export function anyShortfallOnDay(shortfallDays, dayISO) {
  for (const key of shortfallDays) {
    if (key.endsWith(`:${dayISO}`)) return true
  }
  return false
}
