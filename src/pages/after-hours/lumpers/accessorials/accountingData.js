// Data layer for the Accessorials tab on Money to recover — the chase-and-collect
// side. Every DB object is live (accessorials_summary / accessorials_list /
// accessorial_soft_matches / accessorial_payroll_text / confirm_accessorial_collected)
// and no migration ships with this phase.
//
// The vocabulary (types, doc types, status chips) and the two writes the board
// also performs (record_broker_response, document upload/signed URLs) come from
// the board's accessorialData so both surfaces share ONE code path.

import { supabase } from '../../../../lib/supabase'

// Types come from the accessorial_types lookup, so the filter chips here show
// whatever a manager added on the board — never a hardcoded three.
export { statusMeta, typeLabel, docTypeLabel, DOC_TYPES, RESPONSES,
  fetchAccessorialTypes, fetchAccessorialDocs, signedDocUrl,
  recordBrokerResponse } from '../../shift-board/accessorialData'

export const STATUSES = [
  ['awaiting', 'Awaiting'],
  ['approved', 'Approved'],
  ['collected', 'Collected'],
  ['denied', 'Denied'],
]

// ── Reads ───────────────────────────────────────────────────────────────────
export async function fetchAccessorialsSummary(from, to) {
  const { data, error } = await supabase.rpc('accessorials_summary', { p_from: from, p_to: to })
  if (error) throw error
  return data || null
}

// Filtering is the RPC's job — statuses/types/query all narrow server-side, so
// the client never holds rows it isn't showing. Empty arrays mean "no filter".
export async function fetchAccessorialsList({ from, to, statuses, types, query }) {
  const { data, error } = await supabase.rpc('accessorials_list', {
    p_from: from ?? null,
    p_to: to ?? null,
    p_statuses: statuses?.length ? statuses : null,
    p_types: types?.length ? types : null,
    p_query: query?.trim() || null,
  })
  if (error) throw error
  return data || []
}

export async function fetchSoftMatches() {
  const { data, error } = await supabase.rpc('accessorial_soft_matches')
  if (error) throw error
  return data || []
}

export async function fetchPayrollText(start, end) {
  const { data, error } = await supabase.rpc('accessorial_payroll_text', {
    p_start: start, p_end: end, p_shift_id: null, p_limit: 25,
  })
  if (error) throw error
  return data || ''
}

// ── Writes ──────────────────────────────────────────────────────────────────
// The ONLY thing that records collection, and it refuses anyone who isn't an
// admin or manager. We surface that refusal verbatim rather than pre-judging the
// caller's role in the UI — the server is the authority.
export async function confirmCollected(id, amount, collectedOn) {
  const { data, error } = await supabase.rpc('confirm_accessorial_collected', {
    p_id: id, p_collected_amount: amount, p_collected_on: collectedOn ?? null,
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not confirm collection.')
  return data
}

// "Not related" — records the rejection so the pair stops being suggested.
// accessorial_soft_matches returns the rate change's figures but NOT its id, so
// resolve it from the request's load plus the exact detected_at it reported.
export async function dismissSoftMatch({ accessorialId, detectedAt, matchKind, delta, userId }) {
  const { data: req, error: e1 } = await supabase.from('accessorials')
    .select('load_id').eq('id', accessorialId).single()
  if (e1) throw e1
  if (!req?.load_id) throw new Error('That request has no load to match against.')

  const { data: rc, error: e2 } = await supabase.from('load_rate_changes')
    .select('id').eq('load_id', req.load_id).eq('detected_at', detectedAt).limit(1).maybeSingle()
  if (e2) throw e2
  if (!rc?.id) throw new Error('Could not find that rate change any more — reload the page.')

  const { error } = await supabase.from('accessorial_rate_matches').insert({
    accessorial_id: accessorialId,
    load_rate_change_id: rc.id,
    match_kind: matchKind,
    delta: delta ?? null,
    dismissed_at: new Date().toISOString(),
    dismissed_by: userId ?? null,
  })
  if (error) throw error
}

// ── Presentation ────────────────────────────────────────────────────────────
// 'Xh Ym'; null-safe. Whole hours read as '2h', not '2h 0m'.
export function fmtMinutes(mins) {
  if (mins == null || mins === '') return null
  const total = Math.max(0, Math.floor(Number(mins)))
  if (Number.isNaN(total)) return null
  const h = Math.floor(total / 60), m = total % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

// '3h 40m @ shipper · 2h free · $75/h'. Driven by whether the row actually has a
// billed clock, NOT by the type code — types are a lookup now, so a manager can
// add an hourly type that isn't called "detention" and it must read the same.
// Flat types have no clock, so the note carries the reason instead.
export function basisText(r) {
  const hourly = r.detained_minutes != null || r.rate_per_hour != null
  if (!hourly) return r.notes?.trim() || null
  const parts = []
  const det = fmtMinutes(r.detained_minutes)
  if (det) parts.push(r.location ? `${det} @ ${r.location}` : det)
  const free = fmtMinutes(r.free_minutes)
  if (free) parts.push(`${free} free`)
  if (r.rate_per_hour != null) parts.push(`$${Number(r.rate_per_hour).toLocaleString('en-US', { maximumFractionDigits: 2 })}/h`)
  return parts.length ? parts.join(' · ') : (r.notes?.trim() || null)
}

// How promptly a request was filed, measured against the load's delivery date.
// A NEGATIVE lag is legitimate — detention at the shipper is requested days before
// the load delivers — so it reads "filed before delivery", never "-1d late".
export function filingMeta(lag) {
  if (lag == null) return null
  const n = Number(lag)
  if (Number.isNaN(n)) return null
  if (n < 0) return { label: 'filed before delivery', cls: 'text-gray-500 dark:text-slate-400' }
  if (n === 0) return { label: 'same day', cls: 'text-emerald-600 dark:text-emerald-400 font-semibold' }
  if (n <= 3) return { label: `+${n}d`, cls: 'text-amber-600 dark:text-amber-400' }
  return { label: `+${n}d`, cls: 'text-red-600 dark:text-red-400 font-semibold' }
}

// How long a request has been outstanding, measured from event_date — the load's
// delivery date, never filed_at. Red past 21 to match the aging buckets above
// the table.
//
// days_awaiting goes NEGATIVE for a request raised before the load delivers
// (detention at the shipper does exactly that), so it reads "delivers in 3 days"
// rather than "-3d awaiting". Nothing is outstanding until the load has run.
export function awaitingMeta(days) {
  if (days == null) return null
  const n = Number(days)
  if (Number.isNaN(n)) return null
  if (n < 0) {
    const a = Math.abs(n)
    return { label: `delivers in ${a} day${a === 1 ? '' : 's'}`, cls: 'text-gray-400 dark:text-slate-500' }
  }
  if (n > 21) return { label: `${n}d awaiting`, cls: 'text-red-600 dark:text-red-400 font-semibold' }
  if (n >= 8) return { label: `${n}d awaiting`, cls: 'text-amber-600 dark:text-amber-400' }
  return { label: `${n}d awaiting`, cls: 'text-gray-400 dark:text-slate-500' }
}

export const MATCH_KIND = {
  exact:   { label: 'Exact', cls: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30' },
  partial: { label: 'Partial', cls: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30' },
  over:    { label: 'Over', cls: 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-500/30' },
}
export const matchKindMeta = (k) => MATCH_KIND[k] || MATCH_KIND.over
