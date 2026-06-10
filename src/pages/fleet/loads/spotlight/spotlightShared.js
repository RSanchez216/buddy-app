// Shared helpers for the Spotlight deck. Date helpers are deliberately
// duplicated from Profitability.jsx so this showcase route never touches
// the existing page.

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function thisWeek() {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7 // Monday = 0
  const mon = new Date(now); mon.setDate(now.getDate() - dow)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return { from: ymd(mon), to: ymd(sun) }
}
export function thisMonth() {
  const now = new Date()
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
}
// Parse a 'YYYY-MM-DD' as a LOCAL date (avoid the UTC shift of new Date(str)).
export function parseYmd(s) {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function shiftYmd(s, days) { const d = parseYmd(s); d.setDate(d.getDate() + days); return ymd(d) }
export function spanDays(from, to) {
  const a = parseYmd(from), b = parseYmd(to)
  if (!a || !b) return 0
  return Math.round((b - a) / 86400000) + 1
}
// Days of the window that have actually happened — a mid-week "This week"
// shouldn't count future days as idle. ISO strings compare lexically.
export function elapsedDays(from, to) {
  const today = ymd(new Date())
  if (to <= today) return spanDays(from, to)
  if (from > today) return 0
  return spanDays(from, today)
}
export function formatRange(from, to) {
  const a = parseYmd(from), b = parseYmd(to)
  if (!a || !b) return ''
  const sameYear = a.getFullYear() === b.getFullYear()
  const aStr = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  const bStr = b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${aStr} – ${bStr}`
}

export function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
export function fmtMoney2(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}
export function fmtNum(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
export function fmtRpm(n) {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`
}

// ── Avatar (no photo field on drivers yet) ──────────────────────────────
// Deterministic monogram: same driver always gets the same gradient. When a
// photo_url column lands, the card swaps in the image and this is the
// fallback.
export function monogram(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
export function nameHue(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

// ── Health signal ───────────────────────────────────────────────────────
// Revenue & utilization ONLY — no fuel / insurance / driver pay in BUDDY
// yet, so this is explicitly not a profit verdict. Inputs:
//   rpmRatio — driver $/mile vs their own trailer type's fleet average
//              (fleet-wide average when the type is unknown)
//   util     — active days / days in the selected window
// The score is the "weakest first" sort key: lower = weaker.
export function healthSignal({ realizedLoads, bookedLoads, rpm, benchmarkRpm, activeDays }, rangeDays) {
  const realized = Number(realizedLoads) || 0
  const booked = Number(bookedLoads) || 0
  if (!realized) {
    return booked > 0
      ? { level: 'idle', label: 'Booked only', score: 5, rpmRatio: null, util: 0 }
      : { level: 'idle', label: 'No loads', score: 0, rpmRatio: null, util: 0 }
  }
  const rpmRatio = benchmarkRpm > 0 && rpm != null ? Number(rpm) / benchmarkRpm : null
  const util = rangeDays > 0 ? Math.min((Number(activeDays) || 0) / rangeDays, 1) : 0
  const score = 10 + (rpmRatio == null ? 0.95 : Math.min(rpmRatio, 1.3)) * 60 + util * 40
  let level, label
  if ((rpmRatio != null && rpmRatio < 0.9) || util < 0.35) { level = 'weak'; label = 'Weak' }
  else if ((rpmRatio == null || rpmRatio >= 1.0) && util >= 0.6) { level = 'strong'; label = 'Strong' }
  else { level = 'watch'; label = 'Watch' }
  return { level, label, score, rpmRatio, util }
}

export const HEALTH_STYLES = {
  strong: { dot: 'bg-emerald-500', pill: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30', ring: 'ring-emerald-500/20' },
  watch:  { dot: 'bg-amber-500',   pill: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',       ring: 'ring-amber-500/20' },
  weak:   { dot: 'bg-rose-500',    pill: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',             ring: 'ring-rose-500/25' },
  idle:   { dot: 'bg-slate-400',   pill: 'bg-gray-100 dark:bg-slate-500/10 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-500/30',         ring: 'ring-slate-500/15' },
}

// ── Deck sort options ───────────────────────────────────────────────────
// "Weakest first" is the default — leadership opens the deck and the lowest
// performers are already front and center.
const numOrLast = (v, dir = 1) => (v == null ? Infinity : Number(v) * dir)
export const SORTS = [
  { key: 'weakest',     label: 'Weakest first',          fn: (a, b) => a.health.score - b.health.score || (Number(a.metrics.gross) - Number(b.metrics.gross)) },
  { key: 'rpm_asc',     label: '$/mile (low → high)',    fn: (a, b) => (a.metrics.rpm == null ? -1 : 0) - (b.metrics.rpm == null ? -1 : 0) || numOrLast(a.metrics.rpm) - numOrLast(b.metrics.rpm) },
  { key: 'idle_desc',   label: 'Most idle days',         fn: (a, b) => a.metrics.activeDays - b.metrics.activeDays || a.metrics.gross - b.metrics.gross },
  { key: 'gross_asc',   label: 'Gross (low → high)',     fn: (a, b) => a.metrics.gross - b.metrics.gross },
  { key: 'gross_desc',  label: 'Gross (high → low)',     fn: (a, b) => b.metrics.gross - a.metrics.gross },
  { key: 'booked_desc', label: 'Booked pipeline',        fn: (a, b) => b.metrics.booked - a.metrics.booked },
]
