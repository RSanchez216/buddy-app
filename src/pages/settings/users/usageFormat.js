// Formatting + date-range helpers shared by the Usage & Activity panel and the
// PDF/CSV reports. Timestamps render in America/Chicago so a report reads the
// same for everyone on the team regardless of the viewer's own timezone.

const TZ = 'America/Chicago'

// Seconds → "Xh Ym" / "Ym" (drops the hour when < 1h). 0 / null → "0m".
export function fmtActive(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// Compact seconds → "Xh Ym" but "<1m" for tiny non-zero spans (chart tooltips).
export function fmtActiveCompact(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s === 0) return '0m'
  if (s < 60) return '<1m'
  return fmtActive(s)
}

// Relative "last active": "just now", "5m ago", "2h ago", "3d ago", else a date.
export function fmtRelative(iso) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return fmtDayShort(iso)
}

// Time-of-day in Chicago, e.g. "9:41 AM".
export function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d)
  } catch { return '—' }
}

// "Jul 21" (Chicago). Accepts an ISO timestamp or a 'YYYY-MM-DD' date.
export function fmtDayShort(v) {
  const d = toDate(v)
  if (!d) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).format(d)
  } catch { return '—' }
}

// "Mon, Jul 21" (Chicago) — the sessions-table date column.
export function fmtDayLong(v) {
  const d = toDate(v)
  if (!d) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(d)
  } catch { return '—' }
}

// Single-letter weekday for the daily bar chart axis (Chicago).
export function fmtWeekdayLetter(v) {
  const d = toDate(v)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'narrow' }).format(d)
  } catch { return '' }
}

// A 'YYYY-MM-DD' string is built as a LOCAL date (no UTC-midnight day shift);
// anything else falls through to the native Date parser.
function toDate(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(v)
  return isNaN(d) ? null : d
}

// ── "Ended" badge (session outcome) ──────────────────────────────────────
export const ENDED_BADGE = {
  live:    { label: 'live now',    cls: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20' },
  signout: { label: 'signed out',  cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' },
  idle:    { label: 'idle 30m',    cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20' },
}
export function endedBadge(ended) {
  return ENDED_BADGE[ended] || { label: ended || '—', cls: 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30' }
}

// ── Date-range helpers (presets + custom) ────────────────────────────────
// Ranges are inclusive 'YYYY-MM-DD' strings in local time, matching the RPC's
// p_start / p_end.
export function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
export function todayYmd() {
  return ymd(new Date())
}
export function addDaysYmd(s, n) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return s
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + n)
  return ymd(d)
}
// '7' | '30' → inclusive window ending today (7 days = today + prior 6).
export function presetRange(days) {
  const end = todayYmd()
  const start = addDaysYmd(end, -(Number(days) - 1))
  return { start, end }
}
// Inclusive day count between two 'YYYY-MM-DD' (for "active days / N days").
export function daysInRange(start, end) {
  if (!start || !end) return 0
  const a = toDate(start), b = toDate(end)
  if (!a || !b) return 0
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}
export function rangeLabel(start, end) {
  return `${fmtDayShort(start)} – ${fmtDayShort(end)}`
}
