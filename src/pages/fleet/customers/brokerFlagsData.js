import { supabase } from '../../../lib/supabase'

// Broker flags — the manual warnings Accounting records against a broker, plus
// the factor's credit stops. Two tables on purpose:
//
//   broker_flags          identity / payment / billing / other. Persist until
//                         somebody resolves them.
//   broker_credit_events  the credit stop. Already had the right shape
//                         (active_from / resolved_on, factor, limits) and
//                         already feeds the shift board, so it is NOT copied
//                         into broker_flags — that would be two sources of
//                         truth for one fact. The profile merges them into one
//                         list; the reader never sees the split.
//
// Everything here matches on mc_number. Broker names differ between the credit
// list and the customer record often enough that name matching has already
// produced confident nonsense on this data.

export const FLAG_CATEGORIES = [
  { key: 'identity', label: 'Identity', hint: 'impersonation, double-brokering, spoofed domains' },
  { key: 'payment', label: 'Payment', hint: 'slow or non-payment' },
  { key: 'billing', label: 'Billing', hint: 'paperwork conditions for getting paid' },
  { key: 'other', label: 'Other', hint: "anything that doesn't fit the three above" },
]
export const categoryLabel = (k) => FLAG_CATEGORIES.find(c => c.key === k)?.label || k

// Every flag for a broker, active and resolved, newest first. History is never
// hidden: a broker flagged twice in six months is exactly what someone needs to
// see, and that is only visible if resolving archives rather than deletes.
export async function fetchBrokerFlags(mcNumber) {
  if (!mcNumber) return []
  const { data, error } = await supabase.from('broker_flags')
    .select('id, mc_number, category, headline, body, checklist, verify_phone, verify_email, source, note, active_from, resolved_on, resolved_note, created_at')
    .eq('mc_number', mcNumber)
    .order('resolved_on', { ascending: true, nullsFirst: true })
    .order('active_from', { ascending: false })
  if (error) throw error
  return data || []
}

// The picked list. Custom reasons added by anyone show up here for everyone
// afterwards — that is the point of storing them rather than free-typing each
// time.
export async function fetchFlagReasons() {
  const { data, error } = await supabase.from('broker_flag_reasons')
    .select('id, category, headline, body, checklist, is_custom')
    .eq('is_active', true)
    .order('is_custom', { ascending: true })
    .order('headline', { ascending: true })
  if (error) throw error
  return data || []
}

// A custom reason. Category is required by the CHECK constraint and by the UI —
// a reason with no category can't be offered in any list, so it would be
// written and never seen again.
export async function createFlagReason({ category, headline, body, userId }) {
  if (!category) throw new Error('Pick a category first.')
  if (!String(headline || '').trim()) throw new Error('Give the reason a headline.')
  const { data, error } = await supabase.from('broker_flag_reasons')
    .insert({
      category,
      headline: String(headline).trim(),
      body: String(body || '').trim() || null,
      is_custom: true,
      created_by: userId ?? null,
    })
    .select('id, category, headline, body, checklist, is_custom')
    .single()
  if (error) throw error
  return data
}

// The wording is COPIED onto the flag, not referenced through reason_id.
// Editing a reason later must not silently rewrite what was recorded against a
// real broker months ago.
export async function createBrokerFlag({
  mcNumber, category, reasonId, headline, body, checklist,
  verifyPhone, verifyEmail, source, note, activeFrom, userId,
}) {
  if (!mcNumber) throw new Error('This customer has no MC number.')
  if (!category) throw new Error('Pick a category.')
  if (!String(headline || '').trim()) throw new Error('Pick a reason.')
  const { data, error } = await supabase.from('broker_flags')
    .insert({
      mc_number: mcNumber,
      category,
      reason_id: reasonId ?? null,
      headline: String(headline).trim(),
      body: String(body || '').trim() || null,
      checklist: checklist?.length ? checklist : null,
      verify_phone: String(verifyPhone || '').trim() || null,
      verify_email: String(verifyEmail || '').trim() || null,
      source: String(source || '').trim() || 'Accounting',
      note: String(note || '').trim() || null,
      ...(activeFrom ? { active_from: activeFrom } : {}),
      created_by: userId ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function updateBrokerFlag(id, patch) {
  const { error } = await supabase.from('broker_flags')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Resolve, never delete. The row moves to history and stays readable.
export async function resolveBrokerFlag(id, { note, userId, on }) {
  const { error } = await supabase.from('broker_flags')
    .update({
      resolved_on: on || new Date().toISOString().slice(0, 10),
      resolved_note: String(note || '').trim() || null,
      resolved_by: userId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

// ── Credit stops ────────────────────────────────────────────────────────────
// Separate table, same list in the UI.
export async function fetchBrokerCreditEvents(mcNumber) {
  if (!mcNumber) return []
  const { data, error } = await supabase.from('broker_credit_events')
    .select('id, mc_number, factor, event_type, active_from, resolved_on, new_limit_usd, prior_limit_usd, exceeded_by_usd, reason, source')
    .eq('mc_number', mcNumber)
    .order('active_from', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createCreditStop({ mcNumber, factor, activeFrom, newLimit, priorLimit, reason, userId }) {
  if (!mcNumber) throw new Error('This customer has no MC number.')
  if (!factor) throw new Error('Which factor pulled the credit?')
  const { error } = await supabase.from('broker_credit_events').insert({
    mc_number: mcNumber,
    factor,
    event_type: 'no_credit',
    active_from: activeFrom || new Date().toISOString().slice(0, 10),
    new_limit_usd: newLimit === '' || newLimit == null ? null : Number(newLimit),
    prior_limit_usd: priorLimit === '' || priorLimit == null ? null : Number(priorLimit),
    reason: String(reason || '').trim() || null,
    source: 'Accounting',
    created_by: userId ?? null,
  })
  if (error) throw error
}

// A credit stop ENDS when the factor lifts it — the wording is "lift", not
// "resolve", because the decision was never ours to make.
export async function liftCreditStop(id, { on } = {}) {
  const { error } = await supabase.from('broker_credit_events')
    .update({ resolved_on: on || new Date().toISOString().slice(0, 10) })
    .eq('id', id)
  if (error) throw error
}

// Days a stop has been running — from the date parts, in Chicago, matching every
// other elapsed count in the app.
export function daysRunning(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const t = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!t) return null
  return Math.round((Date.UTC(+t[1], +t[2] - 1, +t[3]) - then) / 86400000)
}
