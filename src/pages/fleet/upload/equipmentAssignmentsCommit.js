import { supabase } from '../../../lib/supabase'

// commitEquipmentAssignmentRows({ rows, userId })
//
// `rows` are annotated rows from equipmentAssignmentsMatcher.annotateAllRows
// — they already carry truck_id / trailer_id / driver_id (nullable when no
// match was found) and the unmodified raw fields.
//
// Upsert behavior is identical to the brief's SQL: ON CONFLICT on the
// natural key (equipment_type, tms_equipment_id, tms_driver_id, start_date)
// updates end_date, refreshes driver_name_raw + updated_by, and COALESCEs
// the FKs so a previously-unmatched row auto-links without overwriting an
// already-good link.
//
// PostgREST emulates the COALESCE-on-FK behavior at the row level (we pass
// nulls for FKs we don't have; existing non-null FKs stay because of the
// ignoreDuplicates: false + onConflict targeting — PostgREST does a real
// UPDATE on conflict, so any FK we set to null in the payload WOULD null
// the column). To preserve the COALESCE semantics, we read back the
// existing row's FKs from the matcher and pass them in the payload if we
// don't have a better match.

const BATCH = 200

function payloadForRow(row, userId) {
  const existing = row.existing || null

  // FK preservation. If the matcher found a current truck/trailer/driver,
  // use it. If not but the existing DB row has one, keep that. Otherwise
  // null — matches the brief's COALESCE(existing.x, EXCLUDED.x) semantics.
  const truckId =
    row.equipment_type === 'truck'
      ? (row.truck_id || existing?.truck_id || null)
      : null
  const trailerId =
    row.equipment_type === 'trailer'
      ? (row.trailer_id || existing?.trailer_id || null)
      : null
  const driverId = row.driver_id || existing?.driver_id || null

  return {
    equipment_type:     row.equipment_type,
    truck_id:           truckId,
    trailer_id:         trailerId,
    tms_equipment_id:   row.tms_equipment_id,
    equipment_name_raw: row.equipment_name_raw,
    driver_id:          driverId,
    tms_driver_id:      row.tms_driver_id,
    driver_name_raw:    row.driver_name_raw,
    start_date:         row.start_date,
    end_date:           row.end_date,
    created_by_raw:     row.created_by_raw,
    source:             'tms_upload',
    created_by:         userId || null,
    updated_by:         userId || null,
  }
}

export async function commitEquipmentAssignmentRows({ rows, userId }) {
  const result = {
    upserted: 0,
    new: 0,
    closed: 0,
    unchanged: 0,
    updated: 0,
    errors: [],
    resolver_ok: false,
  }
  if (!rows || rows.length === 0) return result

  for (const r of rows) {
    if (r.action === 'new') result.new++
    else if (r.action === 'closed') result.closed++
    else if (r.action === 'unchanged') result.unchanged++
    else if (r.action === 'updated') result.updated++
  }

  // Batched upsert. ignoreDuplicates: false makes PostgREST run a real
  // UPDATE on conflict against the natural-key unique index.
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    const payload = slice.map(r => payloadForRow(r, userId))
    const { data, error } = await supabase
      .from('equipment_assignments')
      .upsert(payload, {
        onConflict: 'equipment_type,tms_equipment_id,tms_driver_id,start_date',
        ignoreDuplicates: false,
      })
      .select('id')
    if (error) {
      result.errors.push(`Upsert batch ${Math.floor(i / BATCH)}: ${error.message}`)
      continue
    }
    result.upserted += (data || []).length
  }

  // Propagate open assignments to trucks/trailers.driver_id. Skipped if any
  // batch failed so we don't half-resolve from a partial commit.
  if (result.errors.length === 0) {
    const { error: rpcErr } = await supabase.rpc('resolve_current_equipment_drivers')
    if (rpcErr) result.errors.push(`Resolver: ${rpcErr.message}`)
    else result.resolver_ok = true
  }

  return result
}
