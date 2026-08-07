// Data layer + helpers for the After Hours Shift Board. Every DB object is live
// (after_hours_board / start_shift / end_shift / the two summaries /
// shift_handoff_text / after_hours_settings). This only reads/writes them.
// Every count on the page comes from a query — nothing is stored as a typed total.

import { supabase } from '../../../lib/supabase'

export const SHIFT_TYPES = [
  { value: 'shift_1', name: 'Shift 1', window: '4 PM – 12 AM' },
  { value: 'shift_2', name: 'Shift 2', window: '12 AM – 8 AM' },
  { value: 'weekend_day', name: 'Weekend Day', window: '4 AM – 4 PM' },
  { value: 'weekend_night', name: 'Weekend Night', window: '4 PM – 4 AM' },
]
export const shiftName = (t) => SHIFT_TYPES.find(s => s.value === t)?.name || t || '—'
export const shiftWindow = (t) => SHIFT_TYPES.find(s => s.value === t)?.window || ''

// Priority-group presentation, keyed by group. The actual on-page ORDER comes
// from the RPC's `group_order` (read per row), never this array's sequence — so
// a group slots in correctly the moment a phase flag turns it on. Collapsed
// groups render as a one-line count + reason and hide entirely at 0. The
// `uncovered` priority splits into two groups by whether a dispatcher raised it.
// "Covered by teammate" is intentionally gone: those drivers are working, so
// they sit in All other active drivers with a team chip, not a group of their own.
// Reviewed drivers no longer split into their own group — the RPC keeps a ticked
// driver in its real priority (with checked_this_shift = true) and orders
// unchecked-first, so the denominator holds still while an associate works.
export const GROUPS = [
  { key: 'raised',           heading: 'Raised by dispatch',            tone: 'red',    expanded: true,  reason: 'raised by a dispatcher — needs coverage now' },
  { key: 'uncovered',        heading: 'Uncovered',                     tone: 'orange', expanded: true,  reason: 'no coverage detected' },
  { key: 'due',              heading: 'Paperwork or checkpoints due',  tone: 'amber',  expanded: true,  reason: 'paperwork or a checkpoint is due' },
  { key: 'idle',             heading: 'Idle 4+ days',                  tone: 'muted',  expanded: false, reason: "sitting 4+ days — nothing booked" },
  { key: 'todo',             heading: 'All other active drivers',      tone: 'plain',  expanded: false, reason: 'active with a load, nothing flagged' },
  { key: 'never_dispatched', heading: 'Never dispatched',              tone: 'muted',  expanded: false, reason: 'no load in BUDDY history' },
]
// Key → presentation, for lookup once rows are grouped and ordered by group_order.
export const GROUP_META = Object.fromEntries(GROUPS.map(g => [g.key, g]))

// Load lifecycle in transit order — never alphabetical (Billing must not precede
// Delivered). Drives the LOAD STATE column, its filter options and its sort. The
// value comes straight from the board RPC's `lifecycle`; it is never recomputed
// from load_status, which is billing-oriented and doesn't describe transit.
export const LIFECYCLE = [
  { key: 'upcoming',       label: 'Upcoming' },
  { key: 'picks_up_today', label: 'Picks up today' },
  { key: 'in_transit',     label: 'In transit' },
  { key: 'delivers_today', label: 'Delivers today' },
  { key: 'delivered',      label: 'Delivered' },
  { key: 'billing',        label: 'Billing' },
  { key: 'closed',         label: 'Closed' },
]
export const LIFECYCLE_RANK = Object.fromEntries(LIFECYCLE.map((l, i) => [l.key, i]))
export const lifecycleLabel = (k) => LIFECYCLE.find(l => l.key === k)?.label || k

// Which visual group a board row belongs to. `team_covered` no longer exists as
// a group — map any stragglers into the general active pool defensively so a row
// is never dropped for want of a matching group.
export function groupKeyFor(row) {
  if (row.priority === 'uncovered') return row.open_request_id ? 'raised' : 'uncovered'
  if (row.priority === 'team_covered' || row.priority === 'reviewed') return 'todo'
  return row.priority
}

// ── Fetches ────────────────────────────────────────────────────────────────
export async function fetchSettings() {
  const { data, error } = await supabase.from('after_hours_settings').select('*').limit(1).maybeSingle()
  if (error) throw error
  return data || {}
}

// The current user's open (un-ended) shift, if any.
export async function fetchOpenShift(userId) {
  if (!userId) return null
  const { data, error } = await supabase.from('after_hours_shifts')
    .select('id, shift_type, started_at, status')
    .eq('user_id', userId).is('ended_at', null)
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data || null
}

// Everyone currently on shift, oldest start first. More than one is normal —
// two are open in production right now — so nothing that consumes this may
// assume a single row. The viewer's own shift is in here too; the header sorts
// it first rather than filtering it out.
export async function fetchOpenShifts() {
  const { data, error } = await supabase.from('v_open_shifts')
    .select('shift_id, user_id, display_name, shift_type, started_at')
    .order('started_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Resumes an open shift instead of erroring → { resumed, shift_id, shift_type, started_at }.
export async function startShift(shiftType) {
  const { data, error } = await supabase.rpc('start_shift', { p_shift_type: shiftType })
  if (error) throw error
  return data
}
export async function endShift(shiftId, notes, handoffText, handedTo) {
  const { data, error } = await supabase.rpc('end_shift', {
    p_shift_id: shiftId, p_notes: notes ?? null, p_handoff_text: handoffText ?? null, p_handed_to: handedTo ?? null,
  })
  if (error) throw error
  return data
}
export async function fetchShiftSummary(shiftId) {
  const { data, error } = await supabase.rpc('after_hours_shift_summary', { p_shift_id: shiftId })
  if (error) throw error
  return data || null
}
export async function fetchWeekSummary(start, end) {
  const { data, error } = await supabase.rpc('after_hours_week_summary', { p_start: start, p_end: end })
  if (error) throw error
  return data || null
}
// Stops are parsed ONCE here, not on every render, and every component reads the
// parsed fields rather than the raw string. When after_hours_board is eventually
// changed to return these columns itself — which is what finally takes the raw
// strings off the wire — this mapping is the only thing that goes.
// Live board: call with only the shift id — byte-identical to before. A browse
// view passes the Mon–Sun window, which filters to loads overlapping it and
// re-bases the reference date (lifecycle/idle/days-since) to the week's end.
export async function fetchBoard(shiftId, weekStart = null, weekEnd = null) {
  const { data, error } = await supabase.rpc('after_hours_board', {
    p_shift_id: shiftId ?? null,
    ...(weekStart && weekEnd ? { p_week_start: weekStart, p_week_end: weekEnd } : {}),
  })
  if (error) throw error
  return (data || []).map(r => ({
    ...r,
    origin_city: stopCity(r.origin),
    origin_state: stopState(r.origin),
    destination_city: stopCity(r.destination),
    destination_state: stopState(r.destination),
  }))
}
// Broker + rate-con summary per load, in ONE request for the whole board (never
// per row). A companion RPC so after_hours_board's 40-column signature stays
// untouched. Returns Map<load_id, { broker, has_rules, detention_policy, … }>.
export async function fetchBoardBrokerMeta(loadIds) {
  const ids = [...new Set((loadIds || []).filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('after_hours_board_broker_meta', { p_load_ids: ids })
  if (error) throw error
  return new Map(Object.entries(data || {}))
}
// Same payload keyed by load_id, but derived from the shift_id server-side — so
// the board's initial load can fire it in parallel with after_hours_board rather
// than waiting to read load ids out of the board's rows. Byte-identical to
// fetchBoardBrokerMeta for the same shift. Keep the per-load-id function above
// for callers that already hold ids.
// Idle reason/note per driver, in ONE request for the whole board (never per
// row). Keyed by driver_id → { reason, note, started_on, days_on_reason, … }.
// Read-only; editing idle reasons lives on /fleet/profitability/idle.
export async function fetchBoardIdleMeta(driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('after_hours_board_idle_meta', { p_driver_ids: ids })
  if (error) throw error
  return new Map(Object.entries(data || {}))
}
// Same payload keyed by driver_id, derived from shift_id server-side — so the
// board's initial load can fire it in parallel instead of waiting to read driver
// ids out of the board's rows. Byte-identical to fetchBoardIdleMeta for the same
// shift. The per-driver-id version above stays for callers that hold ids.
export async function fetchBoardIdleMetaForShift(shiftId) {
  const { data, error } = await supabase.rpc('after_hours_board_idle_meta_for_shift', { p_shift_id: shiftId ?? null })
  if (error) throw error
  return new Map(Object.entries(data || {}))
}
// Broker-risk meta per load, derived from shift_id server-side so it can fire in
// parallel with the board (same pattern as the broker meta). Returns ONLY flagged
// loads — an absent load_id means the broker is clean. Matched on MC number.
export async function fetchBoardRiskMetaForShift(shiftId) {
  const { data, error } = await supabase.rpc('after_hours_board_risk_meta_for_shift', { p_shift_id: shiftId ?? null })
  if (error) throw error
  return new Map(Object.entries(data || {}))
}
// Broker risk for the expanded row's panel — one batched call for the whole
// board, keyed by load_id. Returns Map<load_id, row> where every flag is a real
// boolean, never an absent key.
//
// This is a VIEW behind an RPC, not a jsonb payload, and that distinction is the
// point: the older risk meta builds its object with jsonb_strip_nulls, so a
// falsy-computed flag disappears from the payload entirely. Testing presence
// against that shape mislabelled 1,204 loads once already. Read the booleans.
//
// Takes load ids rather than a shift id on purpose. Every *_for_shift meta RPC
// re-runs after_hours_board internally (~2.7s) to fire in parallel; the view
// itself measures 7.8ms over 200 loads, so a fifth copy of the board query would
// cost far more than the round trip it saves.
export async function fetchBoardBrokerRisk(loadIds) {
  const ids = [...new Set((loadIds || []).filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('after_hours_board_broker_risk', { p_load_ids: ids })
  if (error) throw error
  return new Map((data || []).map(r => [r.load_id, r]))
}

export async function fetchBoardBrokerMetaForShift(shiftId) {
  const { data, error } = await supabase.rpc('after_hours_board_broker_meta_for_shift', { p_shift_id: shiftId ?? null })
  if (error) throw error
  return new Map(Object.entries(data || {}))
}
// Tab headers with progress + tone, measured against the open shift (or since
// midnight Chicago when off-shift). Returns { raised, active, never } where each
// carries counts and a `tone` — use the tone as-is, don't recompute the colour.
export async function fetchBoardTabs(shiftId) {
  const { data, error } = await supabase.rpc('after_hours_board_tabs', { p_shift_id: shiftId ?? null })
  if (error) throw error
  return data || null
}
export async function fetchHandoffText(shiftId) {
  const { data, error } = await supabase.rpc('shift_handoff_text', { p_shift_id: shiftId })
  if (error) throw error
  return data || ''
}

// ── Writes ─────────────────────────────────────────────────────────────────
// Unique on (shift_id, driver_id) — upsert so re-ticking never duplicates.
export async function upsertDriverCheck({ shiftId, driverId, loadId, checkedBy, isOk, issueNote }) {
  const { error } = await supabase.from('shift_driver_checks').upsert({
    shift_id: shiftId, driver_id: driverId, load_id: loadId ?? null,
    checked_by: checkedBy ?? null, is_ok: isOk, issue_note: issueNote ?? null,
    checked_at: new Date().toISOString(),
  }, { onConflict: 'shift_id,driver_id' })
  if (error) throw error
}
export async function removeDriverCheck(shiftId, driverId) {
  const { error } = await supabase.from('shift_driver_checks').delete().eq('shift_id', shiftId).eq('driver_id', driverId)
  if (error) throw error
}
// Record a shift activity via the RPC — NEVER insert shift_activities directly.
// It finds the caller's open shift itself and attaches it when one is open
// (shift_id is nullable), so actions record who/when even off-shift.
// → { ok, id, attached_to_shift }. Types: load_booked, bol_collected,
// pod_collected, broker_contacted, driver_assisted, escalated, rescan_requested.
export async function logShiftActivity(type, loadId, driverId, note, escalatedTo, mentioned) {
  const { data, error } = await supabase.rpc('log_shift_activity', {
    p_activity_type: type, p_load_id: loadId ?? null, p_driver_id: driverId ?? null, p_note: note ?? null,
    p_escalated_to: escalatedTo ?? null, // null when mentions drive routing (first mention = primary)
    p_mentioned: mentioned && mentioned.length ? mentioned : null, // ordered user ids from @mentions
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not record the activity.')
  return data
}
// ── Shift log ──────────────────────────────────────────────────────────────
// Running notes: work done during the shift with no board row to hang it on —
// a broker call about nothing in particular, a systems outage, a message from
// Accounting. Stored as ordinary shift_activities rows, distinguished by
// load_id IS NULL rather than a new activity_type (the CHECK already allows
// 'note', and log_shift_activity now accepts it).
//
// The author embed must name the constraint: shift_activities has THREE foreign
// keys to users (user_id, escalated_to, acknowledged_by), so a bare users(...)
// embed is ambiguous and PostgREST rejects it.
export async function fetchShiftNotes(shiftId) {
  if (!shiftId) return []
  const { data, error } = await supabase.from('shift_activities')
    .select('id, note, occurred_at, user_id, author:users!shift_activities_user_id_fkey(full_name)')
    .eq('shift_id', shiftId)
    .eq('activity_type', 'note')
    .is('load_id', null)
    .order('occurred_at', { ascending: false })
  if (error) throw error
  // A row whose note was blanked would render as an empty bullet here and be
  // dropped by the handoff generator — filter so the two agree.
  return (data || [])
    .filter(r => (r.note || '').trim())
    .map(r => ({ id: r.id, note: r.note, at: r.occurred_at, user_id: r.user_id, author: r.author?.full_name || null }))
}

// Goes through the RPC like every other activity — it resolves the caller's open
// shift, so there is no shift id to pass and none to get wrong. Returns the new
// row's id for the 10s undo.
export async function addShiftNote(text) {
  return logShiftActivity('note', null, null, text)
}

// Active admins/managers (minus the caller) an escalation can be routed to.
export async function fetchEscalationRecipients() {
  const { data, error } = await supabase.rpc('escalation_recipients')
  if (error) throw error
  return data || []
}
// Recipient (or a manager) marks an escalation acknowledged; reason surfaced on refusal.
export async function acknowledgeEscalation(activityId) {
  const { data, error } = await supabase.rpc('acknowledge_escalation', { p_activity_id: activityId })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not acknowledge.')
  return data
}
// Ready-to-paste Telegram block for an escalation (reflects the live ack state).
export async function fetchEscalationCopyText(activityId) {
  const { data, error } = await supabase.rpc('escalation_copy_text', { p_activity_id: activityId })
  if (error) throw error
  return data || ''
}
// Per-driver action state for the shift: the activities logged (Book/POD/BOL/Esc)
// plus the OK/flag check. Drives the button states and the reopen-to-edit flow.
// Keyed by driver_id; `activities` is [{ id, type, note, load_number, at }].
export async function fetchRowActions(shiftId) {
  if (!shiftId) return []
  const { data, error } = await supabase.rpc('shift_row_actions', { p_shift_id: shiftId })
  if (error) throw error
  return data || []
}
// Edit / delete a single logged activity. Both are gated server-side to the
// logger or a manager; the RPC's `reason` is surfaced verbatim on refusal.
export async function updateShiftActivity(id, note, loadNumber) {
  const { data, error } = await supabase.rpc('update_shift_activity', { p_id: id, p_note: note ?? null, p_load_number: loadNumber ?? null })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not update the activity.')
  return data
}
export async function deleteShiftActivity(id) {
  const { data, error } = await supabase.rpc('delete_shift_activity', { p_id: id })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not remove the activity.')
  return data
}
// Remove a driver's OK/flag check row entirely (untick OK, or clear a flag).
export async function clearDriverCheck(shiftId, driverId) {
  const { error } = await supabase.rpc('clear_driver_check', { p_shift_id: shiftId, p_driver_id: driverId })
  if (error) throw error
}

// Whether the caller has an open shift (for the "not on shift" banner).
export async function fetchMyOpenShift() {
  const { data, error } = await supabase.rpc('my_open_shift')
  if (error) throw error
  return data || { shift_id: null }
}
// Marking a help request handled lives in ../requests/requestsData
// (markRequestHandled) so the board and the Requests page share one code path.

// ── Checkpoints (phase 3) ────────────────────────────────────────────────────
// The exception queue — the small set of loads whose checkpoint times are
// actually in question right now. Returns [] when the phase is off.
export async function fetchCheckpointExceptions() {
  const { data, error } = await supabase.rpc('checkpoint_exceptions')
  if (error) throw error
  return data || []
}
// Upsert (one row per load) via the RPC — NEVER write load_checkpoints directly
// (collected_count / pickup_minutes / delivery_minutes are GENERATED). Null args
// leave existing values alone. Returns { ok:true, pickup_minutes, delivery_minutes }
// or throws the RPC's reason verbatim (e.g. "pickup out is before pickup in").
export async function saveLoadCheckpoints({ loadId, pickupIn, pickupOut, deliveryIn, deliveryOut, notes, shiftId }) {
  const { data, error } = await supabase.rpc('save_load_checkpoints', {
    p_load_id: loadId,
    p_pickup_in: pickupIn ?? null,
    p_pickup_out: pickupOut ?? null,
    p_delivery_in: deliveryIn ?? null,
    p_delivery_out: deliveryOut ?? null,
    p_notes: notes ?? null,
    p_shift_id: shiftId ?? null,
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not save the times.')
  return data
}

// ── Formatting ─────────────────────────────────────────────────────────────
export function todayChicago() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}
export function addDaysYmd(ymd, n) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n)
  const p = (x) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}
// Monday-based week [start,end] containing today (Chicago).
export function thisWeekChicago() {
  return weekOfYmd(todayChicago())
}
// Mon–Sun week {start,end} containing an arbitrary 'YYYY-MM-DD'.
export function weekOfYmd(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=Sun
  const back = dow === 0 ? 6 : dow - 1
  const start = addDaysYmd(ymd, -back)
  return { start, end: addDaysYmd(start, 6) }
}
export const stepWeek = (week, n) => weekOfYmd(addDaysYmd(week.start, n * 7))
// 'Aug 3 – Aug 9' from a {start,end}.
export function fmtWeekRange(week) {
  const f = (v) => {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
  }
  return `${f(week.start)} – ${f(week.end)}`
}
// 'Wed 29 Jul' from a 'YYYY-MM-DD' or Date.
export function fmtDayLabel(v) {
  const d = v instanceof Date ? v : (() => { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date() })()
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
}
// Time-of-day in Chicago from a timestamptz, e.g. '2:14 PM'.
export function fmtClock(ts) {
  if (!ts) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) } catch { return '' }
}
export function fmtChicagoTs(ts) {
  if (!ts) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) + ' CT' } catch { return '' }
}
// 'Xh Ym' elapsed since a timestamptz.
// elapsedSince lived here. It floored to whole minutes and had no day component,
// so a 45-hour shift read '45h 18m' in the header while the reports said
// something else — two formatters for one quantity. Replaced entirely by
// fmtShiftDuration below; deleted rather than left in place, because the second
// one would inevitably be picked up again.

// ── Shift duration ──────────────────────────────────────────────────────────
// ONE formatter for every surface that prints how long a shift ran — the header
// pill, the Shift Reports detail block and the PDF — so the same shift can never
// print two different numbers.
//
// Computed from started_at and ended_at, never from a stored column: there isn't
// one, and there shouldn't be. `ended_at - started_at` is exact and cannot drift
// out of sync with the timestamps it describes.
//
// Shifts routinely run past midnight — of the last eight, three crossed a
// midnight and one ran 45 hours — so anything over a day gets a day component
// rather than an unreadable hour count.
//   under 24h → '7h 42m'
//   24h+      → '1d 21h 18m'
//   still open → measured to now, suffixed '(running)'
export function fmtShiftDuration(startedAt, endedAt) {
  if (!startedAt) return '—'
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return '—'
  const open = !endedAt
  const end = open ? Date.now() : new Date(endedAt).getTime()
  if (Number.isNaN(end)) return '—'

  // Rounded to the nearest minute, not truncated. The Aug 5 shift is
  // 21:17:51.5 — flooring prints 21h 17m and loses almost a whole minute for no
  // reason. Rounding the TOTAL before splitting it keeps the parts coherent:
  // 23h 59m 40s becomes 1440 minutes and reads '1d 0h 0m', never '24h 0m'.
  const mins = Math.max(0, Math.round((end - start) / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const core = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`
  return open ? `${core} (running)` : core
}

// 'Aug 5, 2:06 PM' / '2:06 PM' — Chicago, always.
const CT_DATE = { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }
const CT_TIME = { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }
const ctDay = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
const ctPart = (ts, withDate) => new Intl.DateTimeFormat('en-US', withDate ? { ...CT_DATE, ...CT_TIME } : CT_TIME).format(new Date(ts))

// The full span line:
//   same calendar day → '2:06 PM → 9:48 PM CT · 7h 42m'
//   across days       → 'Aug 5, 2:06 PM → Aug 7, 11:23 AM CT · 1d 21h 18m'
//   still open        → 'Aug 5, 2:06 PM → now CT · 1d 21h 18m (running)'
//
// The date is shown on BOTH ends whenever they differ, never just one: a lone
// '2:06 PM → 11:23 AM' reads as a nine-hour shift running backwards.
export function fmtShiftSpan(startedAt, endedAt) {
  if (!startedAt) return '—'
  const s = new Date(startedAt)
  if (Number.isNaN(s.getTime())) return '—'
  const dur = fmtShiftDuration(startedAt, endedAt)

  if (!endedAt) return `${ctPart(s, true)} → now CT · ${dur}`
  const e = new Date(endedAt)
  if (Number.isNaN(e.getTime())) return `${ctPart(s, true)} → — CT · ${dur}`

  const crossesDay = ctDay(s) !== ctDay(e)
  return `${ctPart(s, crossesDay)} → ${ctPart(e, crossesDay)} CT · ${dur}`
}
// ── Stop strings ────────────────────────────────────────────────────────────
// 'Pleasanton, TX, US (CST) …' → city 'Pleasanton', state 'TX'.
//
// These mirror the server helpers parse_stop_city / parse_stop_state rule for
// rule, and are verified equal against them across every board row. The old
// version just took the first two comma fields, which happily rendered a date
// fragment as a city on the malformed TMS records — hence the explicit rejects.
//
// NOTE: this is still parsed in the browser. Actually getting the raw strings
// off the wire (29% of the board payload) needs after_hours_board to return the
// parsed columns, which is a migration and out of scope here.
const stopField = (raw, n) => String(raw).split(',')[n - 1] ?? ''

// A real stop has a 2-letter state in the second comma field.
export function stopState(raw) {
  if (raw == null) return null
  const m = stopField(raw, 2).trim().match(/^[A-Za-z]{2}/)
  return m ? m[0] : null
}
export function stopCity(raw) {
  if (raw == null) return null
  if (!stopState(raw)) return null
  const first = stopField(raw, 1).trim()
  if (/\d{2}-\d{2}-\d{4}/.test(first)) return null   // a date, not a city
  if (['US', 'USA', 'CA', 'MX'].includes(first.toUpperCase())) return null
  return first || null
}
// 'Pleasanton, TX' for the row table; '' when the record won't parse.
export function cityOf(s) {
  const city = stopCity(s)
  if (!city) return ''
  const st = stopState(s)
  return st ? `${city}, ${st}` : city
}
export function money(n, dp = 0) {
  if (n == null) return '$0'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp })
}
// Whole minutes → 'Xh Ym' (or 'Ym'). null-safe; used for waiting time and the
// detained durations the RPC returns.
export function fmtDuration(mins) {
  if (mins == null || mins === '') return null
  const total = Math.max(0, Math.floor(Number(mins)))
  if (Number.isNaN(total)) return null
  const h = Math.floor(total / 60), m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
// ── Chicago ↔ datetime-local (checkpoint editor) ─────────────────────────────
// The editor shows Chicago wall-clock time regardless of the browser's own
// timezone. toChicagoLocalInput formats an instant into a 'YYYY-MM-DDTHH:mm'
// string for <input type="datetime-local">; chicagoLocalToISO reads that naive
// string back as America/Chicago and returns a UTC ISO string to send.
export function toChicagoLocalInput(d) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt)
  const g = (t) => p.find(x => x.type === t)?.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}
function chicagoOffsetMinutes(date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const g = (t) => Number(p.find(x => x.type === t)?.value)
  const asIfUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return (asIfUTC - date.getTime()) / 60000 // Chicago offset in minutes (e.g. -300 CDT, -360 CST)
}
export function chicagoLocalToISO(local) {
  if (!local) return null
  const asUTC = new Date(`${local}:00Z`) // treat the naive wall time as UTC first…
  if (isNaN(asUTC.getTime())) return null
  const offset = chicagoOffsetMinutes(asUTC) // …then correct by Chicago's offset at that time
  return new Date(asUTC.getTime() - offset * 60000).toISOString()
}

// ── PDF text sanitising ──────────────────────────────────────────────────────
// jsPDF's built-in fonts are WinAnsi (cp1252) only. Latin-1 plus the cp1252
// "smart punctuation" (em/en dash, bullet, middot, curly quotes…) all map to a
// single byte and render fine — verified against the encoder. Anything outside
// that repertoire (emoji 🌙 💰, the ⚠ dingbat) is written as raw UTF-16 bytes and
// comes out as mojibake, so we strip it from the PDF variant only. The Telegram
// copy keeps its emoji. Stripping a glyph also swallows the single space it left
// behind, so '🌙 AFTER-HOURS' becomes 'AFTER-HOURS', not ' AFTER-HOURS'.
const WINANSI_EXTRA = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
])
export function pdfSafeText(text) {
  let out = ''
  let swallow = false
  for (const ch of String(text ?? '')) { // iterates by code point (surrogate-safe)
    const cp = ch.codePointAt(0)
    if (cp <= 0xFF || WINANSI_EXTRA.has(cp)) {
      if (swallow && ch === ' ') { swallow = false; continue }
      out += ch; swallow = false
    } else {
      swallow = true // drop the un-encodable glyph and the space that trails it
    }
  }
  return out
}

// ── Copy-to-clipboard (plain text only — Telegram renders no tables/markdown) ─
export async function copyText(text) {
  await navigator.clipboard.writeText(text)
}
export function buildGroupCopy({ heading, rows, shiftLabel, dateLabel, filterLabel }) {
  const out = []
  out.push(`🌙 ${heading.toUpperCase()} — ${rows.length} driver${rows.length === 1 ? '' : 's'}`)
  out.push(`${dateLabel} · ${shiftLabel}`)
  if (filterLabel) out.push(`Filtered: ${filterLabel}`)
  out.push('')
  for (const r of rows.slice(0, 25)) {
    const disp = r.dispatcher_name ? ` · ${r.dispatcher_name}` : ''
    out.push(`• ${r.driver_name} — ${r.carrier_name || '—'}${disp}`)
    const o = cityOf(r.origin), d = cityOf(r.destination)
    if (r.team_name) out.push(`  covered — ${r.team_name}`)
    else if (o || d) out.push(`  ${o || '—'} → ${d || '—'}`)
    if (r.open_request_id && r.open_request_by) out.push(`  raised by ${r.open_request_by} ${fmtClock(r.open_request_at)}`)
  }
  if (rows.length > 25) out.push(`…and ${rows.length - 25} more`)
  return out.join('\n')
}
export function buildWeekCopy(week, dateLabel) {
  const w = week || {}
  return [
    `🌙 AFTER HOURS — WEEK ${w.range_start || ''} → ${w.range_end || ''}`,
    dateLabel,
    '',
    `Shifts logged: ${w.shifts_logged ?? 0}`,
    `Loads booked: ${w.loads_booked ?? 0}`,
    `PODs: ${w.pods ?? 0} · BOLs: ${w.bols ?? 0}`,
    `Checkpoints: ${w.checkpoints ?? 0} · Accessorials: ${w.accessorials_count ?? 0}`,
    `Lumpers: ${w.lumpers_count ?? 0} (${money(w.lumpers_amount)})`,
    `Requests raised: ${w.requests_raised ?? 0}`,
  ].join('\n')
}
