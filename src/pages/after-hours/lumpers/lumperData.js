// Data layer + formatting helpers for the Lumpers page. All DB objects
// (lumper_events, lumper_categories, lumper_summary, lumper_load_lookup, the
// lumper-documents bucket) already exist — this only reads/writes them.

import { supabase } from '../../../lib/supabase'

export const DOC_BUCKET = 'lumper-documents'

// Fixed column enums (check-constrained on the table). These are NOT the
// category lookup — categories always come from lumper_categories.
// charge_to: only valid when status = 'unpaid' ('broker' was removed).
export const CHARGE_TO = [
  ['driver', 'Driver'],
  ['company', 'Company'],
  ['dispatcher', 'Dispatcher'],
]
export const CHARGE_TO_DESC = {
  driver: 'Deducted on the next settlement.',
  company: 'MANAS eats the {total}.',
  dispatcher: 'Charged back to the dispatcher who booked it.',
}
export const RC_STATUS = [
  ['pending', 'Pending'],
  ['received', 'Received'],
  ['not_required', 'Not required'],
]

// Status model (status is now a normal text column: open|pending|paid|unpaid,
// NOT NULL DEFAULT 'open'). The dropdown shows a dot + label + description.
export const STATUS_OPTIONS = [
  { value: 'open',    label: 'Open',    dot: '#94A3B8', desc: 'Recorded. Broker is expected to pay. Nobody is chasing it yet.' },
  { value: 'pending', label: 'Pending', dot: '#F59E0B', desc: 'Reimbursement asked for. Waiting on the broker.' },
  { value: 'paid',    label: 'Paid',    dot: '#16A34A', desc: 'Broker paid in full. Case closed. Factoring buying the invoice does not count as paid.' },
  { value: 'unpaid',  label: 'Unpaid',  dot: '#DC2626', desc: 'Broker will not cover it. Opens a second field to pick who absorbs the cost.' },
]

// ── Fetches ────────────────────────────────────────────────────────────────
// Events in the window, newest first, with the joined display names. Single-FK
// embeds only (unambiguous); the recorder name is resolved client-side from the
// users map since lumper_events has three FKs into users.
const EVENT_SELECT = `
  id, event_date, load_id, load_number, carrier_id, customer_id, broker_name,
  dispatcher_id, dispatcher_name, driver_id, driver_name, state_code,
  category_id, amount, efs_fee, total_amount, efs_code, invoice_number,
  paid_by_user_id, paid_from_department_id, rc_status, charge_to,
  reimbursed_at, reimbursed_amount, resolved_at, status,
  revised_rc_number, accounting_notes, status_set_by, status_set_at,
  receipt_path, revised_rc_path, notes, created_by, recorded_by, recorded_by_name, source, created_at,
  carrier:carriers ( name ),
  customer:customers ( name ),
  dispatcher:dispatchers ( name ),
  driver:drivers ( full_name ),
  category:lumper_categories ( name )
`

export async function fetchLumperEvents({ start, end }) {
  const { data, error } = await supabase.from('lumper_events')
    .select(EVENT_SELECT)
    .gte('event_date', start).lte('event_date', end)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchSummary(start, end) {
  const { data, error } = await supabase.rpc('lumper_summary', { p_start: start, p_end: end })
  if (error) throw error
  return data || null
}

export async function fetchCategories() {
  const { data, error } = await supabase.from('lumper_categories')
    .select('id, name, sort_order, is_active').eq('is_active', true).order('sort_order')
  if (error) throw error
  return data || []
}

export async function loadLookup(loadNumber) {
  const { data, error } = await supabase.rpc('lumper_load_lookup', { p_load_number: loadNumber })
  if (error) throw error
  return data // jsonb: { found, drivers[], load_id, carrier_id, carrier_name, customer_id, broker_name, dispatcher_id, dispatcher_name, load_number }
}

// Reference lists for the drawer's editable pickers (all small).
export async function fetchRefLists() {
  const [carriers, dispatchers, drivers, users] = await Promise.all([
    supabase.from('carriers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('dispatchers').select('id, name').eq('is_active', true).order('name'),
    supabase.from('drivers').select('id, full_name').order('full_name'),
    supabase.from('users').select('id, full_name, department_id, status').eq('status', 'active').order('full_name'),
  ])
  return {
    carriers: carriers.data || [],
    dispatchers: dispatchers.data || [],
    drivers: (drivers.data || []).map(d => ({ id: d.id, name: d.full_name })),
    users: users.data || [],
  }
}

// Admin/manager add a category — next sort_order, returns the new row.
export async function addCategory(name) {
  const { data: max } = await supabase.from('lumper_categories')
    .select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const next = (max?.sort_order ?? 0) + 1
  const { data, error } = await supabase.from('lumper_categories')
    .insert({ name: name.trim(), sort_order: next, is_active: true }).select('id, name, sort_order, is_active').single()
  if (error) throw error
  return data
}

// ── Status ───────────────────────────────────────────────────────────────
// Status/charge_to are set ONLY through set_lumper_status (the permission check
// lives in the RPC). p_charge_to is required when status='unpaid', null
// otherwise; p_accounting_notes = null leaves the existing note untouched.
export async function setLumperStatus(id, status, chargeTo, accountingNotes) {
  const { error } = await supabase.rpc('set_lumper_status', {
    p_id: id,
    p_status: status,
    p_charge_to: chargeTo ?? null,
    p_accounting_notes: accountingNotes ?? null,
  })
  if (error) throw error
}

export const STATUS_META = {
  open:    { label: 'Open',    dot: '#94A3B8', pill: 'bg-gray-100 dark:bg-slate-700/50 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-600/40' },
  pending: { label: 'Pending', dot: '#F59E0B', pill: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20' },
  paid:    { label: 'Paid',    dot: '#16A34A', pill: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' },
  unpaid:  { label: 'Unpaid',  dot: '#DC2626', pill: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20' },
}
export function statusMeta(s) { return STATUS_META[s] || { label: s || '—', dot: '#94A3B8', pill: 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30' } }

// Timestamptz → 'Jul 28, 2026, 4:03 PM CT' (America/Chicago).
export function fmtChicagoTs(ts) {
  if (!ts) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) + ' CT'
  } catch { return '' }
}

// ── Formatting ─────────────────────────────────────────────────────────────
export function money(n, dp = 2) {
  if (n == null || n === '') return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp })
}

// Today's date in Chicago as 'YYYY-MM-DD'.
export function todayChicago() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

// Add/subtract whole days to a 'YYYY-MM-DD' (calendar math on the date parts —
// no time component, so no DST/UTC shift).
export function addDays(ymd, n) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  const p = (x) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

// Inclusive [today − days, today] window in CHICAGO time. A row dated exactly
// `days` ago is included (the fetch/RPC use event_date >= start), matching the
// server's `(now() AT TIME ZONE 'America/Chicago')::date` boundary. Fixes the
// off-by-one that dropped the boundary day (e.g. 90d missing 2026-04-29).
export function rangeForDays(days) {
  const end = todayChicago()
  return { start: addDays(end, -Number(days)), end }
}

// Whole days since a 'YYYY-MM-DD' date (Chicago basis). null-safe.
export function ageDays(dateStr) {
  if (!dateStr) return null
  const a = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00`)
  const b = Date.parse(`${todayChicago()}T00:00:00`)
  if (isNaN(a) || isNaN(b)) return null
  return Math.floor((b - a) / 86400000)
}

// 'Jul 28' (built from Y-M-D parts so there's no UTC day-shift).
export function fmtDate(dateStr, withYear = false) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
}

// 'YYYY-MM' → 'July 2026'.
export function fmtMonth(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})/)
  if (!m) return ym || ''
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// 'Aidina Tursunbekova' → 'Aidina T.'
export function firstLastInitial(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

// BY column: recorded_by_name if present, else the joined recorder's first
// name + last initial.
export function recorderLabel(row, usersById) {
  if (row.recorded_by_name) return row.recorded_by_name
  const u = row.recorded_by ? usersById?.get?.(row.recorded_by) : null
  return u ? firstLastInitial(u.full_name) : '—'
}

// Dispatcher display: prefer the joined dispatchers.name (via dispatcher_id),
// else the denormalized dispatcher_name (rendered muted by the caller).
export function dispatcherDisplay(row) {
  if (row.dispatcher?.name) return { name: row.dispatcher.name, muted: false }
  if (row.dispatcher_name) return { name: row.dispatcher_name, muted: true }
  return { name: '—', muted: true }
}
