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
