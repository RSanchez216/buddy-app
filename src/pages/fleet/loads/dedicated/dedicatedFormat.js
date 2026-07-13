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

// timestamptz → "MM/DD/YYYY · 3:42 PM" (local). Used by the drop/hook history.
export function fmtDateTime(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const date = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

// timestamptz → "MM/DD/YYYY" (local). Used by the Telegram message.
export function fmtDateMDY(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

// Format a recorded yard event into the fleet group's house Telegram message.
// Header is "#{truck} {driver}" (truck omitted if unresolved); trailer lines are
// conditional on a drop/pick being present; recipients join with single spaces.
// Plain text, no emoji.
export function formatTelegramMessage({ truckUnit, driverName, droppedUnit, pickedUnit, locationText, occurredAt, recipients }) {
  const truck = truckUnit ? String(truckUnit).trim().replace(/^#/, '') : ''
  const header = [truck ? `#${truck}` : '', (driverName || '').trim()].filter(Boolean).join(' ')
  const lines = [header, '']
  if (droppedUnit) lines.push(`Dropped trailer ${droppedUnit}`)
  if (pickedUnit) lines.push(`Picked up trailer ${pickedUnit}`)
  lines.push(`Location: ${locationText || ''}`)
  lines.push(`Date: ${fmtDateMDY(occurredAt)}`)
  lines.push('', (recipients || []).join(' '))
  return lines.join('\n')
}

// 'YYYY-MM-DD' → "Jul 6" — built from Y-M-D parts so there's no UTC-midnight
// day-early shift (same guard as the Lane Flow Map's stop dates).
export function fmtDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
