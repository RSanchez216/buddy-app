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

// Priority-group order + presentation. Collapsed groups render as a one-line
// count + reason; hidden entirely when their count is 0. The `uncovered`
// priority splits into two groups by whether a dispatcher raised it.
export const GROUPS = [
  { key: 'raised',           heading: 'Raised by dispatch',            tone: 'red',    expanded: true,  reason: 'raised by a dispatcher — needs coverage now' },
  { key: 'uncovered',        heading: 'Uncovered',                     tone: 'orange', expanded: true,  reason: 'no coverage detected' },
  { key: 'due',              heading: 'Paperwork or checkpoints due',  tone: 'amber',  expanded: true,  reason: 'paperwork or a checkpoint is due' },
  { key: 'idle',             heading: 'Idle 4+ days',                  tone: 'muted',  expanded: false, reason: "sitting 4+ days — nothing booked" },
  { key: 'team_covered',     heading: 'Covered by teammate',           tone: 'muted',  expanded: false, reason: 'partner is hauling — nothing to do' },
  { key: 'never_dispatched', heading: 'Never dispatched',              tone: 'muted',  expanded: false, reason: 'no load on record yet' },
  { key: 'todo',             heading: 'All other active drivers',      tone: 'plain',  expanded: false, reason: 'active with a load, nothing flagged' },
  { key: 'reviewed',         heading: 'Reviewed this shift',           tone: 'plain',  expanded: false, reason: 'already checked off this shift' },
]

// Which visual group a board row belongs to.
export function groupKeyFor(row) {
  if (row.priority === 'uncovered') return row.open_request_id ? 'raised' : 'uncovered'
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
export async function logActivity({ shiftId, type, loadId, loadNumber, driverId, note, userId }) {
  const { error } = await supabase.from('shift_activities').insert({
    shift_id: shiftId, activity_type: type,
    load_id: loadId ?? null, load_number: loadNumber ?? null, driver_id: driverId ?? null,
    note: note ?? null, user_id: userId ?? null, occurred_at: new Date().toISOString(),
  })
  if (error) throw error
}
// status on help_requests is GENERATED — set handled_at/handled_by only.
export async function markRequestHandled(requestId, userId) {
  const { error } = await supabase.from('help_requests')
    .update({ handled_at: new Date().toISOString(), handled_by: userId ?? null }).eq('id', requestId)
  if (error) throw error
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
