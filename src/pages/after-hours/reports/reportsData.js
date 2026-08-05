// Data layer for After Hours › Shift Reports. Three live RPCs, no SQL here:
//   after_hours_shift_list(start, end)      — one object per shift, newest first
//   after_hours_associate_rollup(start, end)— one object per associate
//   after_hours_shift_detail(shift_id)      — lazy, only for an expanded row
//
// The list RPC powers BOTH the week tiles and the history table: it is fetched
// once per week and everything else is derived from that array. In particular the
// tiles are NOT after_hours_week_summary — that uses a different lumper window,
// and two totals on one screen that disagree is worse than no totals.

import { supabase } from '../../../lib/supabase'
// Shared with the Shift Board so both surfaces convert Chicago wall-clock the
// same way, DST included.
import { chicagoLocalToISO } from '../shift-board/shiftBoardData'

// ── Shift types ─────────────────────────────────────────────────────────────
// Display labels only. `shift_type` is a filter and grouping key, so the stored
// values are never renamed — this map is the sole place they're prettified.
export const SHIFT_TYPE_LABEL = {
  shift_1: 'Shift 1',
  shift_2: 'Shift 2',
  weekend_day: 'Weekend day',
  weekend_night: 'Weekend night',
}
export const shiftTypeLabel = (t) => SHIFT_TYPE_LABEL[t] || (t ? String(t).replace(/_/g, ' ') : '—')

// Stable display order for the coverage grid's rows; anything unknown falls to
// the end in encounter order rather than being dropped.
const TYPE_ORDER = ['shift_1', 'shift_2', 'weekend_day', 'weekend_night']
export function orderShiftTypes(types) {
  const known = TYPE_ORDER.filter(t => types.includes(t))
  return [...known, ...types.filter(t => !TYPE_ORDER.includes(t))]
}

// ── Chicago week maths ──────────────────────────────────────────────────────
// Monday–Sunday in America/Chicago. Deliberately NOT the browser's local
// midnight: an associate in another timezone (or anyone up past 11pm Central)
// would otherwise land on the wrong week from the one the RPCs bucket by.
export function todayChicago() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}
export function addDays(ymd, n) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  const p = (x) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}
// The Mon–Sun week containing `ymd` (defaults to today in Chicago).
export function weekOf(ymd) {
  const t = ymd || todayChicago()
  const [y, m, d] = t.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1
  const start = addDays(t, -back)
  return { start, end: addDays(start, 6) }
}
export const shiftWeek = (week, n) => weekOf(addDays(week.start, n * 7))
export const isCurrentWeek = (week) => week.start === weekOf().start
// The seven 'YYYY-MM-DD' days of a week.
export const daysOf = (week) => Array.from({ length: 7 }, (_, i) => addDays(week.start, i))

// ── Formatting ──────────────────────────────────────────────────────────────
// Built from Y-M-D parts so there's no UTC day-shift on a date-only value.
export function fmtDay(ymd, opts = { month: 'short', day: 'numeric' }) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', opts)
}
export const fmtWeekday = (ymd) => fmtDay(ymd, { weekday: 'short' })
export function fmtRange(week) {
  const sameYear = week.start.slice(0, 4) === week.end.slice(0, 4)
  const a = fmtDay(week.start)
  const b = fmtDay(week.end, { month: 'short', day: 'numeric', year: 'numeric' })
  return sameYear ? `${a} – ${b}` : `${fmtDay(week.start, { month: 'short', day: 'numeric', year: 'numeric' })} – ${b}`
}
export function fmtClock(ts) {
  if (!ts) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(ts))
  } catch { return '—' }
}
export function fmtTs(ts) {
  if (!ts) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) + ' CT'
  } catch { return '—' }
}
export function money(n, dp = 0) {
  if (n == null) return '$0'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp })
}
// 3.7 → '3h 42m'. Hours arrive as a decimal from the RPC.
export function fmtHours(h) {
  if (h == null) return '—'
  const n = Number(h)
  if (!Number.isFinite(n)) return '—'
  const whole = Math.floor(n)
  const mins = Math.round((n - whole) * 60)
  if (mins === 60) return `${whole + 1}h`
  return mins > 0 ? `${whole}h ${mins}m` : `${whole}h`
}
export const pct = (n) => `${Math.round(Number(n) || 0)}%`

// ── Reads ───────────────────────────────────────────────────────────────────
export async function fetchShiftList(start, end) {
  const { data, error } = await supabase.rpc('after_hours_shift_list', { p_start: start, p_end: end })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
export async function fetchAssociateRollup(start, end) {
  const { data, error } = await supabase.rpc('after_hours_associate_rollup', { p_start: start, p_end: end })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
// Lazy — one call per expanded row, cached by the caller for the session. Never
// prefetched per row; avoiding that N+1 is why the list RPC carries the totals.
export async function fetchShiftDetail(shiftId) {
  const { data, error } = await supabase.rpc('after_hours_shift_detail', { p_shift_id: shiftId })
  if (error) throw error
  return data || null
}

// Activities recorded outside any shift. shift_id is nullable BY DESIGN — work
// done off-shift is still logged — so this is informational, never an error.
export async function fetchOrphanActivityCount(start, end) {
  // The window boundaries are Chicago wall-clock, converted with the offset in
  // force ON THOSE DATES — a hardcoded -05:00 is CDT and would be an hour out
  // every winter, which is exactly the sort of thing nobody notices in July.
  const { count, error } = await supabase.from('shift_activities')
    .select('id', { count: 'exact', head: true })
    .is('shift_id', null)
    .gte('occurred_at', chicagoLocalToISO(`${start}T00:00`))
    .lt('occurred_at', chicagoLocalToISO(`${addDays(end, 1)}T00:00`))
  if (error) throw error
  return count || 0
}

// ── Derivation ──────────────────────────────────────────────────────────────
const sum = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0)

// Every tile comes from the same array the history table renders, so the two can
// never disagree — that equality is an acceptance criterion.
export function deriveTotals(shifts) {
  const closed = shifts.filter(s => !s.is_open)
  // Reviewed % is averaged over CLOSED shifts only: an open shift is mid-count
  // and would drag the average down for no reason. Same rule the rollup uses.
  const reviewed = closed.filter(s => s.reviewed_pct != null)
  return {
    shifts: shifts.length,
    open: shifts.filter(s => s.is_open).length,
    hours: sum(shifts, 'hours'),
    avgReviewedPct: reviewed.length ? sum(reviewed, 'reviewed_pct') / reviewed.length : 0,
    booked: sum(shifts, 'loads_booked'),
    pods: sum(shifts, 'pods'),
    bols: sum(shifts, 'bols'),
    checkpoints: sum(shifts, 'checkpoints'),
    requestsRaised: sum(shifts, 'requests_raised'),
    requestsHandled: sum(shifts, 'requests_handled'),
    escalations: sum(shifts, 'escalations'),
    accessorialsClaimed: sum(shifts, 'accessorials_claimed'),
    accessorialsCollected: sum(shifts, 'accessorials_collected'),
    lumpersAmount: sum(shifts, 'lumpers_amount'),
    lumpersCount: sum(shifts, 'lumpers_count'),
  }
}

// The coverage grid, plus the gap rows the history table splices in.
//
// THE GAP RULE IS INFERRED — there is no roster. A missing cell is a GAP only
// when both hold:
//   1. the type ran on TWO OR MORE days in the range (one occurrence is not a
//      routine — a single Saturday shift can't condemn the other six days), and
//   2. the day falls BETWEEN that type's first and last occurrence (interior
//      gaps only, never leading or trailing).
// Everything else with no shift is simply NOT IN USE — which makes that legend
// state reachable, unlike the old "ran on any other day" rule.
export function buildCoverage(shifts, week) {
  const days = daysOf(week)
  const types = orderShiftTypes([...new Set(shifts.map(s => s.shift_type).filter(Boolean))])
  const byKey = new Map()
  for (const s of shifts) {
    const k = `${s.shift_type}|${s.shift_date}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(s)
  }
  const rows = types.map(type => {
    // Days this type actually ran, in calendar order (dates sort lexicographically).
    const ranDays = days.filter(d => (byKey.get(`${type}|${d}`) || []).length > 0)
    const routine = ranDays.length >= 2                    // one occurrence ≠ a routine
    const first = ranDays[0], last = ranDays[ranDays.length - 1]
    return {
      type,
      cells: days.map(day => {
        const found = byKey.get(`${type}|${day}`) || []
        if (found.length) {
          return { day, type, state: found.some(s => s.is_open) ? 'open' : 'covered', shifts: found }
        }
        // Interior gap only — leading/trailing days are "not in use", not misses.
        const interior = routine && day > first && day < last
        return { day, type, state: interior ? 'gap' : 'unused', shifts: [] }
      }),
    }
  })
  return { days, types, rows }
}

// Gap cells as synthetic history rows, so the table matches the strip cell for
// cell. Marked `is_gap` so nothing downstream mistakes them for shifts.
export function gapRows(coverage) {
  const out = []
  for (const row of coverage.rows) {
    for (const cell of row.cells) {
      if (cell.state === 'gap') out.push({ is_gap: true, shift_date: cell.day, shift_type: row.type, shift_id: `gap:${row.type}:${cell.day}` })
    }
  }
  return out
}

// Newest first by date, then by start time. Gap rows have no start time and sort
// after the real shifts on their day. Deterministic, so nothing reorders when a
// row is expanded.
export function sortHistory(rows) {
  return [...rows].sort((a, b) => {
    if (a.shift_date !== b.shift_date) return a.shift_date < b.shift_date ? 1 : -1
    if (!!a.is_gap !== !!b.is_gap) return a.is_gap ? 1 : -1
    return String(b.started_at || '').localeCompare(String(a.started_at || ''))
  })
}

// ── Timeline presentation ───────────────────────────────────────────────────
// Rendered off source + kind. An unrecognised kind gets a neutral dot and its raw
// value as the label rather than being dropped — new activity kinds land in the
// database before they land here.
const KIND_META = {
  load_booked: { label: 'Load booked', dot: 'bg-sky-500' },
  bol_collected: { label: 'BOL collected', dot: 'bg-slate-400' },
  pod_collected: { label: 'POD collected', dot: 'bg-slate-400' },
  broker_contacted: { label: 'Broker contacted', dot: 'bg-slate-400' },
  driver_assisted: { label: 'Driver assisted', dot: 'bg-slate-400' },
  escalated: { label: 'Escalated', dot: 'bg-rose-500' },
  rescan_requested: { label: 'Rescan requested', dot: 'bg-slate-400' },
  accessorial_raised: { label: 'Accessorial raised', dot: 'bg-violet-500' },
  request_handled: { label: 'Request handled', dot: 'bg-emerald-500' },
}
export function kindMeta(kind) {
  return KIND_META[kind] || {
    label: kind ? String(kind).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Activity',
    dot: 'bg-slate-400',
  }
}

// ── Export ──────────────────────────────────────────────────────────────────
const CSV_COLUMNS = [
  ['Date', r => r.shift_date],
  ['Shift', r => shiftTypeLabel(r.shift_type)],
  ['Associate', r => r.associate || ''],
  ['Status', r => (r.is_gap ? 'no shift logged' : r.is_open ? 'open' : r.status || 'closed')],
  ['Started', r => (r.started_at ? fmtTs(r.started_at) : '')],
  ['Ended', r => (r.ended_at ? fmtTs(r.ended_at) : '')],
  ['Hours', r => (r.hours == null ? '' : r.hours)],
  ['Active drivers', r => r.active_drivers],
  ['Reviewed', r => r.drivers_reviewed],
  ['Reviewed %', r => r.reviewed_pct],
  ['Flagged', r => r.drivers_flagged],
  ['Booked', r => r.loads_booked],
  ['PODs', r => r.pods],
  ['BOLs', r => r.bols],
  ['Checkpoints', r => r.checkpoints],
  ['Requests raised', r => r.requests_raised],
  ['Requests handled', r => r.requests_handled],
  ['Escalations', r => r.escalations],
  ['Accessorials', r => r.accessorials_count],
  ['Acc claimed', r => r.accessorials_claimed],
  ['Acc collected', r => r.accessorials_collected],
  ['Lumpers', r => r.lumpers_count],
  ['Lumpers amount', r => r.lumpers_amount],
  ['Handed to', r => r.handed_to || ''],
]
// A leading =, +, - or @ makes Excel treat a cell as a formula, so those are
// prefixed with a quote before quoting.
const csvCell = (v) => {
  if (v == null) return ''
  let s = String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
export function historyToCsv(rows) {
  const head = CSV_COLUMNS.map(c => csvCell(c[0])).join(',')
  const body = rows.map(r => CSV_COLUMNS.map(c => csvCell(r.is_gap && c[0] !== 'Date' && c[0] !== 'Shift' && c[0] !== 'Status' ? '' : c[1](r))).join(','))
  return [head, ...body].join('\r\n')
}
export function downloadCsv(filename, csv) {
  // BOM so Excel reads the UTF-8 correctly.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
