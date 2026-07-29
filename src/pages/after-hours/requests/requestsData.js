// Data layer + helpers for "Ask After-Hours" help requests and the Requests
// page. Every DB object is live (help_requests, help_request_driver_search,
// after_hours_shifts). status on help_requests is GENERATED — never written.

import { supabase } from '../../../lib/supabase'

// A global "open the Ask After-Hours form" signal so the header button, the
// Drivers row action and the driver profile can all reach the single modal
// mounted in Layout, without prop-drilling through the whole tree.
export const ASK_AFTER_HOURS_EVENT = 'buddy:ask-after-hours'
export function openAskAfterHours(prefill = null) {
  window.dispatchEvent(new CustomEvent(ASK_AFTER_HOURS_EVENT, { detail: prefill }))
}
// Fired after a request is raised / seen / handled so any open board or Requests
// page can reload in the background ("within one refresh").
export const REQUESTS_CHANGED_EVENT = 'buddy:requests-changed'
export function announceRequestsChanged() {
  window.dispatchEvent(new CustomEvent(REQUESTS_CHANGED_EVENT))
}

export const KINDS = [
  { value: 'uncovered', label: 'Uncovered', desc: 'No load — the driver needs coverage tonight.' },
  { value: 'needs_help', label: 'Needs help', desc: 'On a load, but something needs After-Hours to step in.' },
]
export const URGENCIES = [
  { value: 'urgent', label: 'Urgent', dot: '#DC2626' },
  { value: 'normal', label: 'Normal', dot: '#F59E0B' },
  { value: 'fyi', label: 'FYI', dot: '#94A3B8' },
]
export const kindLabel = (k) => KINDS.find(x => x.value === k)?.label || k || '—'
export const urgencyMeta = (u) => URGENCIES.find(x => x.value === u) || { value: u, label: u || '—', dot: '#94A3B8' }

// Request lifecycle badge (help_requests.status, a GENERATED column):
// new → orange, seen → amber, handled → green, dismissed → grey (not red — a
// dismissal isn't a failure state).
export const REQUEST_STATUS = {
  new:       { label: 'New',       cls: 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/25' },
  seen:      { label: 'Seen',      cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/25' },
  handled:   { label: 'Handled',   cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/25' },
  dismissed: { label: 'DISMISSED', cls: 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-600/40' },
}
export function requestStatusMeta(status) { return REQUEST_STATUS[status] || REQUEST_STATUS.new }

// Edit / dismiss / restore are the raiser's or a manager's to make. The RPCs
// enforce this too; this just decides what to show.
export function canManageRequest(r, meId, isManager) {
  return !!isManager || (!!meId && r?.raised_by === meId)
}

// Driver status badge (from current_status / driver_status_at_raise).
export const STATUS_BADGE = {
  active:     { label: 'ACTIVE',     cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/25' },
  terminated: { label: 'TERMINATED', cls: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/25' },
  inactive:   { label: 'INACTIVE',   cls: 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600/40' },
  suspended:  { label: 'SUSPENDED',  cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/25' },
}
export function statusBadge(s) {
  return STATUS_BADGE[s] || { label: String(s || 'unknown').toUpperCase(), cls: 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600/40' }
}
export const STATUS_LABEL = { active: 'active', terminated: 'terminated', inactive: 'inactive', suspended: 'suspended', lead: 'a lead', pre_hire: 'pre-hire', vacation: 'on vacation', archived: 'archived' }

// ── Fetches ────────────────────────────────────────────────────────────────
export async function searchHelpDrivers(query, scope, limit = 25) {
  const { data, error } = await supabase.rpc('help_request_driver_search', {
    p_query: query?.trim() || null, p_scope: scope || 'mine', p_limit: limit,
  })
  if (error) throw error
  return data || []
}

// Minimal driver row for a pre-filled entry point, so driver_status_at_raise is
// always captured even if the driver isn't in the picker results.
export async function fetchDriverBrief(driverId) {
  const { data, error } = await supabase.from('drivers')
    .select('id, full_name, current_status').eq('id', driverId).maybeSingle()
  if (error) throw error
  return data ? { driver_id: data.id, full_name: data.full_name, current_status: data.current_status, selectable: true } : null
}

// Effective date a driver reached its current (non-active) status — powers the
// "(since 12 Mar 2026)" line on the non-active warning. Prefers terminated_at.
export async function fetchStatusSince(driverId) {
  const { data } = await supabase.from('drivers')
    .select('terminated_at, status_changed_at').eq('id', driverId).maybeSingle()
  return data?.terminated_at || data?.status_changed_at || null
}

// Who's on tonight — open (un-ended) after-hours shifts, with the associate name.
export async function fetchOnShift() {
  const { data, error } = await supabase.from('after_hours_shifts')
    .select('id, user_id, shift_type, started_at, users:users!after_hours_shifts_user_id_fkey ( full_name )')
    .is('ended_at', null).order('started_at', { ascending: true })
  if (error) throw error
  return (data || []).map(s => ({ id: s.id, user_id: s.user_id, shift_type: s.shift_type, started_at: s.started_at, name: s.users?.full_name || 'Someone' }))
}

// One open shift id (if any) to stamp on a handled request.
export async function fetchOpenShiftId() {
  const { data } = await supabase.from('after_hours_shifts')
    .select('id').is('ended_at', null).order('started_at', { ascending: false }).limit(1).maybeSingle()
  return data?.id || null
}

const REQ_SELECT = 'id, driver_id, driver_name, load_id, kind, urgency, note, raised_by, raised_at, seen_at, seen_by, handled_at, handled_by, resolution, shift_id, driver_status_at_raise, status, dismissed_at, dismissed_by, dismissal_reason, last_edited_at, last_edited_by, created_at'

const PEOPLE_KEYS = ['raised_by', 'seen_by', 'handled_by', 'dismissed_by', 'last_edited_by']

// Resolve the actor uuids → names in one users fetch (several FKs into users
// make direct embeds ambiguous, so join client-side).
async function hydratePeople(rows) {
  const ids = new Set()
  for (const r of rows) { for (const k of PEOPLE_KEYS) if (r[k]) ids.add(r[k]) }
  if (!ids.size) return rows.map(r => ({ ...r }))
  const { data } = await supabase.from('users').select('id, full_name').in('id', [...ids])
  const byId = new Map((data || []).map(u => [u.id, u.full_name]))
  return rows.map(r => ({
    ...r,
    raised_by_name: byId.get(r.raised_by) || null,
    seen_by_name: byId.get(r.seen_by) || null,
    handled_by_name: byId.get(r.handled_by) || null,
    dismissed_by_name: byId.get(r.dismissed_by) || null,
    last_edited_by_name: byId.get(r.last_edited_by) || null,
  }))
}

export async function fetchMyRequests(userId) {
  if (!userId) return []
  const { data, error } = await supabase.from('help_requests')
    .select(REQ_SELECT).eq('raised_by', userId).order('raised_at', { ascending: false }).limit(100)
  if (error) throw error
  return hydratePeople(data || [])
}

// Incoming = not yet handled. Urgent pinned, then newest first (sorted client-side
// so the pin is stable regardless of raised_at).
export async function fetchIncoming() {
  const { data, error } = await supabase.from('help_requests')
    .select(REQ_SELECT).is('handled_at', null).order('raised_at', { ascending: false }).limit(200)
  if (error) throw error
  const rows = await hydratePeople(data || [])
  const rank = { urgent: 0, normal: 1, fyi: 2 }
  return rows.sort((a, b) => (rank[a.urgency] ?? 1) - (rank[b.urgency] ?? 1) || new Date(b.raised_at) - new Date(a.raised_at))
}

// ── Writes ─────────────────────────────────────────────────────────────────
export async function createHelpRequest({ driverId, driverName, loadId, kind, urgency, note, raisedBy, driverStatusAtRaise }) {
  const { data, error } = await supabase.from('help_requests').insert({
    driver_id: driverId,
    driver_name: driverName || null,
    load_id: loadId || null,
    kind,
    urgency: urgency || 'normal',
    note: note?.trim() || null,
    raised_by: raisedBy,
    driver_status_at_raise: driverStatusAtRaise || null,
  }).select('id').single()
  if (error) throw error
  announceRequestsChanged()
  return data
}

// status is GENERATED — set only the timestamp/actor columns.
export async function markRequestSeen(id, userId) {
  const { error } = await supabase.from('help_requests')
    .update({ seen_at: new Date().toISOString(), seen_by: userId }).eq('id', id).is('seen_at', null)
  if (error) throw error
  announceRequestsChanged()
}
export async function markRequestHandled(id, userId, resolution, shiftId) {
  const patch = { handled_at: new Date().toISOString(), handled_by: userId, resolution: resolution?.trim() || null }
  if (shiftId) patch.shift_id = shiftId
  const { error } = await supabase.from('help_requests').update(patch).eq('id', id)
  if (error) throw error
  announceRequestsChanged()
}

// Edit / dismiss / restore go through SECURITY DEFINER RPCs that enforce the
// rules and stamp attribution — NEVER write those columns directly. Each returns
// { ok: true } or { ok: false, reason }. On refusal we throw the reason verbatim
// so the caller can surface it as-is (two people can act on one row at once).
function rpcResult(data, fallback) {
  if (data && data.ok === false) throw new Error(data.reason || fallback)
  return data
}
export async function editHelpRequest(id, { kind, urgency, note }) {
  const { data, error } = await supabase.rpc('update_help_request', {
    p_id: id, p_kind: kind ?? null, p_urgency: urgency ?? null, p_note: note ?? null,
  })
  if (error) throw error
  rpcResult(data, 'Could not edit the request.')
  announceRequestsChanged()
  return data
}
export async function dismissHelpRequest(id, reason) {
  const { data, error } = await supabase.rpc('dismiss_help_request', { p_id: id, p_reason: reason?.trim() || null })
  if (error) throw error
  rpcResult(data, 'Could not dismiss the request.')
  announceRequestsChanged()
  return data
}
export async function restoreHelpRequest(id) {
  const { data, error } = await supabase.rpc('restore_help_request', { p_id: id })
  if (error) throw error
  rpcResult(data, 'Could not restore the request.')
  announceRequestsChanged()
  return data
}

// ── Formatting ─────────────────────────────────────────────────────────────
export function fmtClock(ts) {
  if (!ts) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) } catch { return '' }
}
export function fmtChicagoTs(ts) {
  if (!ts) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) + ' CT' } catch { return '' }
}
export function fmtDateCT(ts) {
  if (!ts) return ''
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ts)) } catch { return '' }
}
// 'Marat Osmonov' → 'Marat O.'
export function firstLastInitial(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}
// "how long ago the last load delivered" for the picker's muted line.
export function daysAgoPhrase(days) {
  if (days == null) return null
  const d = Number(days)
  if (Number.isNaN(d)) return null
  if (d < 0) return 'in transit'
  if (d === 0) return 'delivered today'
  return `${d} day${d === 1 ? '' : 's'} ago`
}
// Relative "20 minutes ago" for the duplicate warning / raised lines.
export function fmtAgo(ts) {
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
