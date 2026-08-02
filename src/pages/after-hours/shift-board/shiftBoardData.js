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
export async function fetchBoard(shiftId) {
  const { data, error } = await supabase.rpc('after_hours_board', { p_shift_id: shiftId ?? null })
  if (error) throw error
  return data || []
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
export async function logShiftActivity(type, loadId, driverId, note, escalatedTo) {
  const { data, error } = await supabase.rpc('log_shift_activity', {
    p_activity_type: type, p_load_id: loadId ?? null, p_driver_id: driverId ?? null, p_note: note ?? null,
    p_escalated_to: escalatedTo ?? null, // when set, the RPC writes a notification row
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not record the activity.')
  return data
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
  const t = todayChicago()
  const [y, m, d] = t.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=Sun
  const back = dow === 0 ? 6 : dow - 1
  return { start: addDaysYmd(t, -back), end: addDaysYmd(t, 6 - back) }
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
export function elapsedSince(ts) {
  if (!ts) return '—'
  const ms = Date.now() - new Date(ts).getTime()
  if (isNaN(ms) || ms < 0) return '0m'
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
// 'Pleasanton, TX, US (CST) …' → 'Pleasanton, TX'.
export function cityOf(s) {
  if (!s) return ''
  const parts = String(s).split(',')
  if (parts.length < 2) return String(s).trim()
  return `${parts[0].trim()}, ${parts[1].trim()}`
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
