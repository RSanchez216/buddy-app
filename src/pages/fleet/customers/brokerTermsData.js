import { supabase } from '../../../lib/supabase'

// A broker's standing accessorial terms. The fallback the request form uses when
// this load's rate confirmation says nothing — never an override of it.

export const TERM_TYPES = [
  { key: 'detention', label: 'Detention', hourly: true },
  { key: 'layover', label: 'Layover', hourly: false },
  { key: 'tonu', label: 'TONU', hourly: false },
  { key: 'other', label: 'Other', hourly: false },
]
export const TERM_LOCATIONS = [
  { key: 'any', label: 'Anywhere' },
  { key: 'shipper', label: 'At the shipper' },
  { key: 'receiver', label: 'At the receiver' },
]
export const termTypeLabel = (k) => TERM_TYPES.find(t => t.key === k)?.label || k
export const termLocationLabel = (k) => TERM_LOCATIONS.find(l => l.key === k)?.label || k
export const isHourly = (k) => !!TERM_TYPES.find(t => t.key === k)?.hourly

// Free time is entered in HOURS and stored in MINUTES — the same conversion the
// request form uses, for the same reason: "two hours free" typed into a box
// labelled minutes is how a claim went out $140 over.
export const hoursToMinutes = (h) => {
  const n = Number(h)
  return Number.isFinite(n) && n >= 0 && String(h).trim() !== '' ? Math.round(n * 60) : null
}
export const minutesToHours = (m) => {
  const n = Number(m)
  if (!Number.isFinite(n)) return ''
  return String(Math.round((n / 60) * 100) / 100)
}
export const FREE_TIME_FLOOR_MIN = 30

// Active and ended, active first, newest first within each.
export async function fetchBrokerTerms(customerId) {
  if (!customerId) return []
  const { data, error } = await supabase.from('broker_accessorial_terms')
    .select('id, customer_id, accessorial_type, location, free_minutes, rate_per_hour, block_minutes, max_amount, flat_amount, notice_hours, source, note, effective_from, effective_to, created_at')
    .eq('customer_id', customerId)
    .order('effective_to', { ascending: true, nullsFirst: true })
    .order('effective_from', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createBrokerTerms(t) {
  const hourly = isHourly(t.accessorialType)
  const freeMinutes = hoursToMinutes(t.freeHours)
  const rate = t.ratePerHour === '' || t.ratePerHour == null ? null : Number(t.ratePerHour)

  // The same guard the request form applies. Four minutes of free time is not a
  // term anyone negotiated.
  if (hourly && freeMinutes != null && rate != null && rate > 0 && freeMinutes < FREE_TIME_FLOOR_MIN) {
    throw new Error(`Free time of ${t.freeHours} hours is only ${freeMinutes} minutes. That looks like hours typed as minutes.`)
  }
  if (!t.customerId) throw new Error('No customer to attach these terms to.')
  if (!t.source?.trim()) throw new Error('Where do these terms come from?')
  // The CHECK constraint enforces this too; saying it here gives a sentence
  // rather than a constraint name.
  if (hourly && rate == null) throw new Error('Detention needs a rate per hour.')
  if (!hourly && t.accessorialType !== 'other' && (t.flatAmount === '' || t.flatAmount == null)) {
    throw new Error(`${termTypeLabel(t.accessorialType)} needs a flat amount.`)
  }

  const { error } = await supabase.from('broker_accessorial_terms').insert({
    customer_id: t.customerId,
    accessorial_type: t.accessorialType,
    location: t.location || 'any',
    free_minutes: hourly ? freeMinutes : null,
    rate_per_hour: hourly ? rate : null,
    block_minutes: Number(t.blockMinutes) > 0 ? Number(t.blockMinutes) : 60,
    max_amount: t.maxAmount === '' || t.maxAmount == null ? null : Number(t.maxAmount),
    flat_amount: hourly ? null : (t.flatAmount === '' || t.flatAmount == null ? null : Number(t.flatAmount)),
    notice_hours: t.noticeHours === '' || t.noticeHours == null ? null : Number(t.noticeHours),
    source: t.source.trim(),
    note: t.note?.trim() || null,
    ...(t.effectiveFrom ? { effective_from: t.effectiveFrom } : {}),
    created_by: t.userId ?? null,
  })
  if (error) throw error
}

// Ending terms sets effective_to. Never delete, never edit in place — a claim
// filed in July must still reconcile against what was true in July. The partial
// unique index only covers rows with a null effective_to, so ending one frees
// the slot for a replacement.
export async function endBrokerTerms(id, { on } = {}) {
  const { error } = await supabase.from('broker_accessorial_terms')
    .update({ effective_to: on || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// '2h free · $35/hour · 1h blocks · cap $500 · 24h notice' — one readable line.
export function termsSummary(t) {
  const bits = []
  if (t.free_minutes != null) bits.push(`${minutesToHours(t.free_minutes)}h free`)
  if (t.rate_per_hour != null) bits.push(`$${Number(t.rate_per_hour)}/hour`)
  if (t.flat_amount != null) bits.push(`$${Number(t.flat_amount)} flat`)
  if (t.block_minutes && t.block_minutes !== 60) bits.push(`${minutesToHours(t.block_minutes)}h blocks`)
  else if (t.block_minutes === 60) bits.push('1h blocks')
  if (t.max_amount != null) bits.push(`cap $${Number(t.max_amount)}`)
  if (t.notice_hours != null) bits.push(`${t.notice_hours}h notice`)
  return bits.join(' · ')
}
