import { daysBucket } from './dedicatedData'

// Non-component helpers for the Dedicated Lanes page (kept out of the .jsx
// component files so fast refresh stays intact).

// Days-parked text grading (< 4d green · 4–9d amber · ≥ 10d red).
export const DAYS_TEXT = {
  green: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
}

export function daysClass(days) {
  return DAYS_TEXT[daysBucket(days)]
}

// 'YYYY-MM-DD' → "Jul 6" — built from Y-M-D parts so there's no UTC-midnight
// day-early shift (same guard as the Lane Flow Map's stop dates).
export function fmtDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
