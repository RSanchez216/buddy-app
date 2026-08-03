// Data layer for the Accessorials phase of the After Hours Shift Board. Every DB
// object here is live: raise_accessorial / record_broker_response /
// load_accessorials, the accessorials + accessorial_documents tables and the
// private `accessorial-documents` bucket. No migration ships with this phase.
//
// Two rules the DB enforces and this module never fights:
//   • `accessorials.status` is GENERATED — it is read, never written.
//   • Marking a claim collected is Accounting's (confirm_accessorial_collected,
//     gated on is_admin_or_manager). It is deliberately absent from this module,
//     so the board cannot offer it.

import { supabase } from '../../../lib/supabase'

export const DOC_BUCKET = 'accessorial-documents'

// ── Vocabulary ──────────────────────────────────────────────────────────────
// `flat` types are a single agreed amount — there is no detained clock to bill,
// so the panel hides the time fields for them.
export const TYPES = [
  { value: 'detention', label: 'Detention', flat: false },
  { value: 'layover',   label: 'Layover',   flat: true  },
  { value: 'tonu',      label: 'TONU',      flat: true  },
]
export const typeLabel = (t) => TYPES.find(x => x.value === t)?.label || t || '—'
export const isFlatType = (t) => !!TYPES.find(x => x.value === t)?.flat

export const DOC_TYPES = [
  ['broker_email', 'Broker email'],
  ['revised_rate_con', 'Revised rate con'],
  ['screenshot', 'Screenshot'],
  ['bol', 'BOL'],
  ['other', 'Other'],
]
export const docTypeLabel = (t) => DOC_TYPES.find(x => x[0] === t)?.[1] || t || 'Document'

export const RESPONSES = [
  { value: 'approved', label: 'Approved', needsAmount: true,  hint: 'Broker agreed to the full claim.' },
  { value: 'partial',  label: 'Partial',  needsAmount: true,  hint: 'Broker agreed to part of it — enter what they said.' },
  { value: 'denied',   label: 'Denied',   needsAmount: false, hint: 'Broker refused. The claim stays on record.' },
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
// Which claim speaks for a load in the one-chip ACCESSORIAL column: something
// still awaiting a broker outranks one that's been answered or already banked.
const STATUS_RANK = { awaiting: 4, denied: 3, approved: 2, collected: 1 }

// ── The claim maths ─────────────────────────────────────────────────────────
// (detained − free) billed by the hour, rounded UP to the next hour — the way
// brokers pay it. Returns zeroes rather than NaN for a half-typed rate.
export function computeClaim(detainedMinutes, freeMinutes, ratePerHour) {
  const det = Number(detainedMinutes)
  const free = Number(freeMinutes)
  const rate = Number(ratePerHour)
  const safeFree = Number.isFinite(free) ? Math.max(0, free) : 0
  if (!Number.isFinite(det) || det <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return { billableMinutes: 0, hours: 0, amount: 0 }
  }
  const billableMinutes = Math.max(0, det - safeFree)
  const hours = Math.ceil(billableMinutes / 60)
  return { billableMinutes, hours, amount: Math.round(hours * rate * 100) / 100 }
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
// This load's claims first (same_load = true), then the driver's claims on other
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
// 128 round trips. Returns Map<load_id, { count, status, claimed }>.
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
      const cur = map.get(a.load_id) || { count: 0, status: null, claimed: 0 }
      cur.count += 1
      cur.claimed += Number(a.claimed_amount) || 0
      if (!cur.status || (STATUS_RANK[a.status] || 0) > (STATUS_RANK[cur.status] || 0)) cur.status = a.status
      map.set(a.load_id, cur)
    }
  }
  return map
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
// claim belongs to a load and one driver commonly has several across loads.
export async function raiseAccessorial({ loadId, type, amount, location, detainedMinutes, freeMinutes, ratePerHour, note }) {
  if (!loadId) throw new Error('A claim must be tied to a load.')
  const { data, error } = await supabase.rpc('raise_accessorial', {
    p_load_id: loadId,
    p_accessorial_type: type,
    p_claimed_amount: amount,
    p_location: location ?? null,
    p_detained_minutes: detainedMinutes ?? null,
    p_free_minutes: freeMinutes ?? null,
    p_rate_per_hour: ratePerHour ?? null,
    p_note: note ?? null,
  })
  if (error) throw error
  if (data && data.ok === false) throw new Error(data.reason || 'Could not raise the claim.')
  return data
}

// Records what the broker SAID — not collection. The RPC refuses once Accounting
// has closed the claim and surfaces that as a reason we pass through verbatim.
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
// path is namespaced by claim so two files of the same name never collide.
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
export function buildClaimCopy(c, money) {
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
