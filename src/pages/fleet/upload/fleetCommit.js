import { supabase } from '../../../lib/supabase'

// commitFleetRows({ kind, rows, allDrivers, userId })
//   rows is the post-preview state: each row carries the parsed fields plus
//   the user-approved ownership_stage + classification reason. Rows with
//   `skip: true` are excluded.
//
// Returns { inserted, updated, errors, newRows, updatedRows }
//
// Update semantics: preserves user-managed fields (ownership_stage, notes,
// operational_status, ownership_stage_started_at) UNLESS the user changed
// the stage in the preview (row.overrode_stage === true), in which case
// stage + history are updated too.
//
// PRESERVE-ALWAYS contract: any column intentionally left out of
// buildBasePayload + the conditional override block stays untouched on
// UPDATE. Do NOT add `operational_status`, `notes`, or `ownership_stage`
// to the base payload — an "Inactive" unit must survive every Monday
// upload (the whole reason the column exists). New columns that the
// TMS file owns can be added to buildBasePayload; new user-managed
// columns must NOT be added there.
//
// Insert semantics: writes the row + an Initial Classification history
// entry for any stage other than 'unclassified'. operational_status
// uses the column default ('active') so new inserts come in active.

const BATCH_INSERT = 200

function buildBasePayload(row, isTrailer) {
  const out = {
    unit_number: row.unit_number,
    vin: row.vin,
    status: row.status,
    equipment_owner_raw: row.equipment_owner_raw,
    driver_assignment_raw: row.driver_assignment_raw,
    driver_id: row.driver_id,
    year: row.year,
    make: row.make,
    model: row.model,
    license_plate: row.license_plate,
    license_state: row.license_state,
    transponder: row.transponder,
    lessee: row.lessee,
  }
  if (isTrailer) {
    out.trailer_type = row.trailer_type || null
    out.annual_inspection_expiration_date = row.annual_inspection_expiration_date || null
  }
  return out
}

export async function commitFleetRows({ kind, rows, userId }) {
  const isTrailer = kind === 'trailer'
  const table = isTrailer ? 'trailers' : 'trucks'
  const fkKey = isTrailer ? 'trailer_id' : 'truck_id'

  const active = (rows || []).filter(r => !r.skip)
  if (active.length === 0) return { inserted: 0, updated: 0, errors: [], newRows: [], updatedRows: [] }

  // VIN dedup lookup (everything we're about to write)
  const vins = active.map(r => r.vin)
  const { data: existingData, error: existingErr } = await supabase
    .from(table)
    .select('id, vin, ownership_stage')
    .in('vin', vins)
  if (existingErr) {
    return { inserted: 0, updated: 0, errors: [existingErr.message], newRows: [], updatedRows: [] }
  }
  const existingByVin = new Map((existingData || []).map(e => [e.vin, e]))

  const toInsert = []
  const toUpdate = []
  for (const row of active) {
    const existing = existingByVin.get(row.vin)
    if (existing) {
      toUpdate.push({ row, existing })
    } else {
      toInsert.push(row)
    }
  }

  const errors = []
  const newRows = []
  const updatedRows = []

  // ── INSERTS (batched) ────────────────────────────────────────────────
  for (let i = 0; i < toInsert.length; i += BATCH_INSERT) {
    const slice = toInsert.slice(i, i + BATCH_INSERT)
    const payloads = slice.map(row => ({
      ...buildBasePayload(row, isTrailer),
      ownership_stage: row.ownership_stage || 'unclassified',
      ownership_stage_started_at: new Date().toISOString(),
      created_by: userId || null,
      updated_by: userId || null,
    }))
    const { data: inserted, error: insErr } = await supabase
      .from(table)
      .insert(payloads)
      .select('id, vin, ownership_stage, driver_id')
    if (insErr) {
      errors.push(`Insert batch ${i / BATCH_INSERT}: ${insErr.message}`)
      continue
    }
    for (const r of inserted || []) {
      newRows.push(r)
    }
    // Ownership-history events for non-unclassified inserts
    const histPayloads = (inserted || [])
      .filter(r => r.ownership_stage && r.ownership_stage !== 'unclassified')
      .map(r => {
        const src = slice.find(s => s.vin === r.vin)
        return {
          equipment_type: kind,
          [fkKey]: r.id,
          truck_id: kind === 'truck' ? r.id : null,
          trailer_id: kind === 'trailer' ? r.id : null,
          from_stage: null,
          to_stage: r.ownership_stage,
          driver_id: r.driver_id,
          reason: `${src?.classification_reason || 'Initial classification'} (via upload)`,
          created_by: userId || null,
        }
      })
    if (histPayloads.length > 0) {
      const { error: histErr } = await supabase
        .from('equipment_ownership_history')
        .insert(histPayloads)
      if (histErr) errors.push(`History insert: ${histErr.message}`)
    }
  }

  // ── UPDATES (parallel; each row carries its own VIN target) ──────────
  const updateTasks = toUpdate.map(async ({ row, existing }) => {
    const payload = {
      ...buildBasePayload(row, isTrailer),
      updated_by: userId || null,
    }
    if (row.overrode_stage && row.ownership_stage && row.ownership_stage !== existing.ownership_stage) {
      payload.ownership_stage = row.ownership_stage
      payload.ownership_stage_started_at = new Date().toISOString()
    }
    const { error: upErr } = await supabase.from(table).update(payload).eq('id', existing.id)
    if (upErr) {
      errors.push(`Update VIN ${row.vin}: ${upErr.message}`)
      return
    }
    updatedRows.push({ id: existing.id, vin: row.vin })

    // History event if stage changed
    if (row.overrode_stage && row.ownership_stage && row.ownership_stage !== existing.ownership_stage) {
      await supabase.from('equipment_ownership_history').insert({
        equipment_type: kind,
        truck_id: kind === 'truck' ? existing.id : null,
        trailer_id: kind === 'trailer' ? existing.id : null,
        from_stage: existing.ownership_stage,
        to_stage: row.ownership_stage,
        driver_id: row.driver_id,
        reason: 'Reclassified via upload override',
        created_by: userId || null,
      })
    }
  })
  await Promise.all(updateTasks)

  return {
    inserted: newRows.length,
    updated: updatedRows.length,
    errors,
    newRows,
    updatedRows,
  }
}
