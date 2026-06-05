// Match parsed equipment_assignments rows against current BUDDY state.
// Pure functions. The modal hydrates trucks / trailers / drivers / existing
// assignments once and passes them in.
//
// Matching tiers:
//   * Equipment — normalize Equipment Name and lookup against
//     trucks.unit_number (or trailers.unit_number). Normalization strips a
//     leading "#" + spaces and uppercases so "M90" matches "M90" and "#m90".
//   * Driver — Driver ID (text) → drivers.internal_id.
//
// Action tagging mirrors the brief's preview pills:
//   * new       — natural key not in existing assignments
//   * closed    — key exists; was open in DB, the upload has a non-null
//                  end_date
//   * unchanged — key exists; end_date matches (both null or both equal)
//   * updated   — key exists; some other field (FK fill, name refresh,
//                  end_date moved earlier/later but both non-null) changes.
//                  Lumped into the commit but called out for transparency.

import { normalizeUnitNumber } from './equipmentAssignmentsParser'

export function buildUnitIndex(units) {
  const m = new Map()
  for (const u of (units || [])) {
    const key = normalizeUnitNumber(u.unit_number)
    if (key) m.set(key, u)
  }
  return m
}

export function buildDriverByInternalIdIndex(drivers) {
  const m = new Map()
  for (const d of (drivers || [])) {
    if (d.internal_id) m.set(String(d.internal_id), d)
  }
  return m
}

// Existing assignments index keyed by the natural key:
//   `${equipment_type}::${tms_equipment_id}::${tms_driver_id ?? ''}::${start_date}`
// A null tms_driver_id is keyed as '' so historical rows where the driver
// ID was blank in the source still collide correctly on re-upload.
function natKey(row) {
  return [
    row.equipment_type,
    row.tms_equipment_id ?? '',
    row.tms_driver_id ?? '',
    row.start_date,
  ].join('::')
}

export function buildExistingAssignmentsIndex(existing) {
  const m = new Map()
  for (const a of (existing || [])) {
    m.set(natKey(a), a)
  }
  return m
}

// Annotate one parsed row with FK matches + an action label. Returns a new
// row object; doesn't mutate the input.
export function matchAssignmentRow(parsed, { unitsByKey, driversByInternalId, existingByNatKey }) {
  const unitKey = normalizeUnitNumber(parsed.equipment_name_raw)
  const unit    = unitKey ? unitsByKey.get(unitKey) : null
  const driver  = parsed.tms_driver_id ? driversByInternalId.get(String(parsed.tms_driver_id)) : null
  const existing = existingByNatKey.get(natKey(parsed))

  // Action tag (preview-only; the commit always upserts and lets the unique
  // index decide insert vs update).
  let action = 'new'
  if (existing) {
    const sameEnd =
      (existing.end_date == null && parsed.end_date == null)
      || (existing.end_date != null && parsed.end_date != null && existing.end_date === parsed.end_date)
    if (sameEnd) {
      // The FK might still backfill if a unit/driver got added since last
      // upload — flag that as 'updated' so the preview surfaces it.
      const willBackfillEquipment =
        unit && !(parsed.equipment_type === 'truck' ? existing.truck_id : existing.trailer_id)
      const willBackfillDriver = driver && !existing.driver_id
      action = (willBackfillEquipment || willBackfillDriver) ? 'updated' : 'unchanged'
    } else if (existing.end_date == null && parsed.end_date != null) {
      action = 'closed'
    } else {
      action = 'updated'
    }
  }

  return {
    ...parsed,
    truck_id:   parsed.equipment_type === 'truck'   ? (unit?.id || null) : null,
    trailer_id: parsed.equipment_type === 'trailer' ? (unit?.id || null) : null,
    driver_id:  driver?.id || null,
    matched_unit:   unit   || null,
    matched_driver: driver || null,
    existing,
    action,
  }
}

export function annotateAllRows(parsedRows, lookups) {
  return parsedRows.map(r => matchAssignmentRow(r, lookups))
}

export function summarizeCounts(annotated) {
  const c = { total: annotated.length, new: 0, closed: 0, unchanged: 0, updated: 0,
              unmatched_equipment: 0, unmatched_driver: 0 }
  for (const r of annotated) {
    c[r.action] = (c[r.action] || 0) + 1
    if (!r.truck_id && !r.trailer_id) c.unmatched_equipment++
    if (!r.driver_id && r.tms_driver_id) c.unmatched_driver++
  }
  return c
}
