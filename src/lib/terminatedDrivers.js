import { supabase } from './supabase'

// Look up employment status for already-resolved driver uuids. This never adds
// a new matching path — the importer already resolved these ids by its own
// internal_id / TMS id / name matching; we only read current_status by id.
//
// Returns Map(id → { id, internal_id, full_name, terminated_at }) for the ones
// whose current_status = 'terminated'. A driver terminated then reactivated
// (status back to 'active') is excluded, so it won't warn.
export async function fetchTerminatedDrivers(driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('drivers')
    .select('id, internal_id, full_name, current_status, terminated_at')
    .in('id', ids)
  if (error) { console.error('Terminated-driver check failed:', error); return new Map() }
  const map = new Map()
  for (const d of data || []) if (d.current_status === 'terminated') map.set(d.id, d)
  return map
}

// Extract 'YYYY-MM-DD' from a date-only or timestamp string; null if unparseable.
function datePart(s) {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// Classify a staged load against a termination date, using the FILE's dates
// (the rows may be new, so BUDDY's copy can't be trusted). The pickup test is
// decisive — a load merely *delivered* after termination was already rolling;
// one *picked up* after termination means new work was accepted after leaving.
//   pickup > term                 → 'after'
//   pickup <= term < delivery      → 'in_transit'
//   delivery <= term / no dates    → 'before'
// Unknown pickup falls back to the delivery test so we never falsely escalate.
export function classifyLoad(pickupDate, deliveryDate, terminatedAt) {
  const t = datePart(terminatedAt)
  if (!t) return 'before'
  const p = datePart(pickupDate), d = datePart(deliveryDate)
  if (p && p > t) return 'after'
  if (d && d > t) return 'in_transit'
  return 'before'
}

// Whole days a date lands strictly after a termination date, else null.
export function daysAfterTermination(dateStr, terminatedAt) {
  const a = datePart(terminatedAt), b = datePart(dateStr)
  if (!a || !b || b <= a) return null
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000)
}
