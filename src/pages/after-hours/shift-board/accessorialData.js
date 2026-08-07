// Data layer for the Accessorials phase of the After Hours Shift Board. Every DB
// object here is live: raise_accessorial / record_broker_response /
// load_accessorials, the accessorials + accessorial_documents tables and the
// private `accessorial-documents` bucket. No migration ships with this phase.
//
// Two rules the DB enforces and this module never fights:
//   • `accessorials.status` is GENERATED — it is read, never written.
//   • Marking a request collected is Accounting's (confirm_accessorial_collected,
//     gated on is_admin_or_manager). It is deliberately absent from this module,
//     so the board cannot offer it.

import { supabase } from '../../../lib/supabase'

export const DOC_BUCKET = 'accessorial-documents'

// ── Vocabulary ──────────────────────────────────────────────────────────────
// Types come from the accessorial_types table, NEVER a hardcoded list — managers
// add their own and they must be usable immediately. `basis` decides the form:
// 'hourly' bills a detained clock, 'flat' is a single agreed amount, so the time
// and rate fields disappear for it.
// Labels are also needed by rows rendered far from the picker (the board column,
// the Accounting table), which hold a code and nothing else. Every fetch refreshes
// this cache so typeLabel() works anywhere without prop-drilling the list; the
// fetch is always in the same round trip as the rows, so it is warm before they
// render.
let TYPE_CACHE = []

export async function fetchAccessorialTypes() {
  const { data, error } = await supabase.from('accessorial_types')
    .select('code, label, basis, default_free_minutes, default_rate, sort_order')
    .eq('is_active', true)
    .order('sort_order').order('label')
  if (error) throw error
  TYPE_CACHE = data || []
  return TYPE_CACHE
}

export const typeLabel = (code) => typeLabelFrom(TYPE_CACHE, code)
export const typeBasis = (code) => TYPE_CACHE.find(t => t.code === code)?.basis || 'flat'
export const isFlatType = (code) => typeBasis(code) === 'flat'

// Managers only — the RPC enforces it and derives the code from the label.
export async function addAccessorialType({ label, basis, defaultFreeMinutes, defaultRate }) {
  const { data, error } = await supabase.rpc('add_accessorial_type', {
    p_label: label,
    p_basis: basis,
    p_default_free_minutes: defaultFreeMinutes ?? null,
    p_default_rate: defaultRate ?? null,
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not add the type.')
  return data
}

// Label lookup for rows rendered outside the panel (the board column, the
// Accounting tab), which hold a code but not the loaded type list. Falls back to
// title-casing the code so a type added after the page loaded still reads well.
export const typeLabelFrom = (types, code) =>
  types?.find(t => t.code === code)?.label
  || (code ? String(code).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—')

export const DOC_TYPES = [
  ['broker_email', 'Broker email'],
  ['revised_rate_con', 'Revised rate con'],
  ['screenshot', 'Screenshot'],
  ['bol', 'BOL'],
  ['other', 'Other'],
]
export const docTypeLabel = (t) => DOC_TYPES.find(x => x[0] === t)?.[1] || t || 'Document'

export const RESPONSES = [
  { value: 'approved', label: 'Approved', needsAmount: true,  hint: 'Broker agreed to the full amount.' },
  { value: 'partial',  label: 'Partial',  needsAmount: true,  hint: 'Broker agreed to part of it — enter what they said.' },
  { value: 'denied',   label: 'Denied',   needsAmount: false, hint: 'Broker refused. The request stays on record.' },
]

// Status chips. `collected` only ever arrives from Accounting — the board shows
// it but can never set it.
export const STATUS_META = {
  awaiting:  { label: 'Awaiting',  cls: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30' },
  approved:  { label: 'Approved',  cls: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30' },
  denied:    { label: 'Denied',    cls: 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-500/30' },
  collected: { label: 'Collected', cls: 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-300 dark:border-cyan-500/30' },
}
export const statusMeta = (s) => STATUS_META[s] || { label: s || '—', cls: 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-white/10' }
// Which request speaks for a load in the one-chip ACCESSORIAL column: something
// still awaiting a broker outranks one that's been answered or already banked.
const STATUS_RANK = { awaiting: 4, denied: 3, approved: 2, collected: 1 }

// ── The request maths ─────────────────────────────────────────────────────────
// (detained − free) billed by the hour, rounded UP to the next hour — the way
// brokers pay it, and the way raise_accessorial computes it server-side.
//
// The subtraction happens in MINUTES and only then converts to hours. Doing it
// in whole hours loses the remainder: 221 − 120 is 101 minutes, which is 2
// billable hours, but 3h − 2h truncates to 1 and then to 0.
//
// The hours are also independent of the rate. They used to share an early return
// with it, so a type whose default_rate is null (Detention has none) rendered
// "0 billable hours" until a rate was typed — and the amount never auto-filled,
// which meant every request was keyed by hand.
export function computeAmount(detainedMinutes, freeMinutes, ratePerHour) {
  const det = Number(detainedMinutes)
  const free = Number(freeMinutes)
  const rate = Number(ratePerHour)
  const safeFree = Number.isFinite(free) ? Math.max(0, free) : 0
  if (!Number.isFinite(det) || det <= 0) return { billableMinutes: 0, hours: 0, amount: 0 }

  const billableMinutes = Math.max(det - safeFree, 0)
  const hours = Math.ceil(billableMinutes / 60)
  const amount = Number.isFinite(rate) && rate > 0
    ? Math.round(hours * rate * 100) / 100
    : 0
  return { billableMinutes, hours, amount }
}

// Whole minutes between two instants; `b` null means "still sitting there", so
// it measures against now.
export function minutesBetween(a, b) {
  if (!a) return null
  const from = new Date(a).getTime()
  const to = b ? new Date(b).getTime() : Date.now()
  if (Number.isNaN(from) || Number.isNaN(to)) return null
  return Math.max(0, Math.round((to - from) / 60000))
}

// ── Reads ───────────────────────────────────────────────────────────────────
// This load's requests first (same_load = true), then the driver's requests on other
// loads. The panel renders those as two groups and never merges them.
export async function fetchLoadAccessorials(loadId, driverId) {
  if (!loadId) return []
  const { data, error } = await supabase.rpc('load_accessorials', {
    p_load_id: loadId, p_driver_id: driverId ?? null,
  })
  if (error) throw error
  return data || []
}

// One query behind the whole board's ACCESSORIAL column — 128 rows must not mean
// 128 round trips. Returns Map<load_id, { count, status, requested }>.
export async function fetchBoardAccessorials(loadIds) {
  const ids = [...new Set((loadIds || []).filter(Boolean))]
  const map = new Map()
  if (ids.length === 0) return map
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('accessorials')
      .select('id, load_id, status, accessorial_type, claimed_amount')
      .in('load_id', ids.slice(i, i + 150))
    if (error) throw error
    for (const a of data || []) {
      const cur = map.get(a.load_id) || { count: 0, status: null, requested: 0 }
      cur.count += 1
      cur.requested += Number(a.claimed_amount) || 0
      if (!cur.status || (STATUS_RANK[a.status] || 0) > (STATUS_RANK[cur.status] || 0)) cur.status = a.status
      map.set(a.load_id, cur)
    }
  }
  return map
}

// Broker rules extracted from the load's rate confirmation. Session-cached per
// load_id: expanding a row fires exactly one call, re-expanding fires none. The
// in-flight promise is shared so a double-open can't double-fetch.
const BROKER_RULES_CACHE = new Map()   // load_id → jsonb (or null)
const BROKER_RULES_INFLIGHT = new Map()
export async function fetchBrokerRules(loadId) {
  if (!loadId) return null
  if (BROKER_RULES_CACHE.has(loadId)) return BROKER_RULES_CACHE.get(loadId)
  let p = BROKER_RULES_INFLIGHT.get(loadId)
  if (!p) {
    p = supabase.rpc('load_broker_rules', { p_load_id: loadId })
      .then(({ data, error }) => {
        if (error) throw error
        BROKER_RULES_CACHE.set(loadId, data || null)
        BROKER_RULES_INFLIGHT.delete(loadId)
        return data || null
      })
      .catch(e => { BROKER_RULES_INFLIGHT.delete(loadId); throw e })
    BROKER_RULES_INFLIGHT.set(loadId, p)
  }
  return p
}
// Map a (possibly custom) accessorial type code → the matching rate-con policy.
// Detention/Layover/TONU each have a policy + sentence; anything else has none,
// which the callout renders as "not stated".
export function policyForType(rules, code) {
  if (!rules) return null
  const c = String(code || '').toLowerCase()
  if (c.includes('detention')) return { policy: rules.detention_policy, sentence: rules.detention_sentence }
  if (c.includes('layover')) return { policy: rules.layover_policy, sentence: rules.layover_sentence }
  if (c.includes('tonu')) return { policy: rules.tonu_policy, sentence: rules.tonu_sentence }
  return null
}

// This LOAD's stated accessorial terms for a type — never a broker-wide default.
// Any sub-object or field may be absent; the caller must treat each independently.
// free_minutes is preferred; free_hours is only used when it isn't stated.
export function termsForType(rules, code) {
  const t = rules?.accessorial_terms
  if (!t) return null
  const c = String(code || '').toLowerCase()
  const raw = c.includes('detention') ? t.detention : c.includes('layover') ? t.layover : c.includes('tonu') ? t.tonu : null
  if (!raw) return null
  const freeMinutes = raw.free_minutes != null ? raw.free_minutes
    : raw.free_hours != null ? Math.round(raw.free_hours * 60) : null
  return { ...raw, freeMinutes }
}

// ── Free time is entered in HOURS and stored in MINUTES ─────────────────────
// The industry says "two hours free". The input used to be labelled (MIN), and
// on load 2608-108 somebody typed 4 — four MINUTES of free time against 1,110
// detained, which billed 19 hours instead of 15 and over-claimed by $140.
export const hoursToMinutes = (h) => {
  // An EMPTY field is "not stated", not "zero free time" — Number('') is 0, and
  // returning 0 here would file a claim asserting the broker allows no free time
  // at all, and would replace "free window not stated" with a confident 0.
  if (h == null || String(h).trim() === '') return null
  const n = Number(h)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null
}
export const minutesToHours = (m) => {
  const n = Number(m)
  if (!Number.isFinite(n)) return ''
  const h = n / 60
  // 120 → '2', 90 → '1.5'. Never '2.0000000004'.
  return String(Math.round(h * 100) / 100)
}

// Nobody negotiates four minutes of free time. If a free-time value lands under
// half an hour while an hourly rate is set, it is almost certainly hours typed
// into a minutes box — the exact mistake that produced the $665 claim.
export const FREE_TIME_FLOOR_MIN = 30
export function freeTimeLooksLikeMinutes(freeMinutes, ratePerHour) {
  const f = Number(freeMinutes), r = Number(ratePerHour)
  if (!Number.isFinite(f) || f <= 0) return false
  if (!Number.isFinite(r) || r <= 0) return false
  return f < FREE_TIME_FLOOR_MIN
}

// Which terms apply to this load — rate con first, the broker's recorded
// defaults second, nothing third. One RPC so precedence lives in one place; the
// form never decides this for itself.
export async function fetchTermsForLoad(loadId, type, location) {
  if (!loadId || !type) return null
  const { data, error } = await supabase.rpc('broker_accessorial_terms_for_load', {
    p_load_id: loadId, p_type: type, p_location: location || 'any',
  })
  if (error) throw error
  return data || null
}

export async function fetchAccessorialDocs(accessorialId) {
  const { data, error } = await supabase.from('accessorial_documents')
    .select('id, doc_type, file_path, file_name, note, uploaded_at')
    .eq('accessorial_id', accessorialId)
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return data || []
}

// ── Writes ──────────────────────────────────────────────────────────────────
// p_load_id is required — the RPC refuses without it, and so do we, because a
// request belongs to a load and one driver commonly has several across loads.
// The amount is either CALCULATED or MANUAL, and the RPC decides which: pass a
// null amount with a detained clock and a rate and it computes (and reports
// amount_source:'calculated'); pass an amount and it takes that verbatim. With
// neither it refuses, and that refusal is the message the associate sees.
export async function raiseAccessorial({ loadId, type, amount, location, detainedMinutes, freeMinutes, ratePerHour, note }) {
  if (!loadId) throw new Error('An accessorial request must be tied to a load.')
  const { data, error } = await supabase.rpc('raise_accessorial', {
    p_load_id: loadId,
    p_accessorial_type: type,
    p_claimed_amount: amount ?? null,
    p_location: location ?? null,
    p_detained_minutes: detainedMinutes ?? null,
    p_free_minutes: freeMinutes ?? null,
    p_rate_per_hour: ratePerHour ?? null,
    p_note: note ?? null,
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not raise the request.')
  return data
}

// Records what the broker SAID — not collection. The RPC refuses once Accounting
// has closed the request and surfaces that as a reason we pass through verbatim.
export async function recordBrokerResponse(id, response, approvedAmount, note) {
  const { data, error } = await supabase.rpc('record_broker_response', {
    p_id: id,
    p_response: response,
    p_approved_amount: approvedAmount ?? null,
    p_note: note ?? null,
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || "Could not record the broker's answer.")
  return data
}

const sanitizeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_').slice(-80)

// Upload to the private bucket, then record the row. Any number, any type — the
// path is namespaced by request so two files of the same name never collide.
export async function uploadAccessorialDoc(accessorialId, docType, file, note, uploadedBy) {
  const path = `${accessorialId}/${docType}-${Date.now()}-${sanitizeName(file.name)}`
  const { error: upErr } = await supabase.storage.from(DOC_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (upErr) throw upErr
  const { error } = await supabase.from('accessorial_documents').insert({
    accessorial_id: accessorialId,
    doc_type: docType,
    file_path: path,
    file_name: file.name || null,
    note: note?.trim() || null,
    uploaded_by: uploadedBy ?? null,
  })
  if (error) throw error
  return path
}

// Private bucket → signed URL only, never getPublicUrl.
export async function signedDocUrl(path, seconds = 3600) {
  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data?.signedUrl || null
}

// ── Telegram copy (plain text — Telegram renders no tables or markdown) ──────
export function buildRequestCopy(c, money) {
  const out = []
  out.push(`💰 ${typeLabel(c.accessorial_type).toUpperCase()} — ${money(c.claimed_amount, 2)}`)
  out.push(`Load ${c.load_number || '—'} · ${c.driver_name || '—'}`)
  if (c.broker_name) out.push(`Broker: ${c.broker_name}`)
  out.push(`Status: ${statusMeta(c.status).label}${c.event_date ? ` · ${c.event_date}` : ''}`)
  if (c.approved_amount != null) out.push(`Broker approved: ${money(c.approved_amount, 2)}`)
  if (c.collected_amount != null) out.push(`Collected: ${money(c.collected_amount, 2)}`)
  if (c.broker_response_note) out.push(`Broker said: ${c.broker_response_note}`)
  out.push(`Evidence on file: ${c.doc_count ?? 0} document${(c.doc_count ?? 0) === 1 ? '' : 's'}`)
  if (c.requested_by_name) out.push(`Raised by ${c.requested_by_name}`)
  return out.join('\n')
}
