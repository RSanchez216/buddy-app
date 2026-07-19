// Multi-tier dedup matcher for the drivers upload. Lives outside the modal
// so the same logic drives the preview's match-method pill AND the commit
// routing decision.
//
// Tiers, in order:
//   1. id_match           — internal_id exact, existing.internal_id present
//   2. name_backfill      — full_name match (normalized) against a row whose
//                            internal_id is NULL (orphan backfill from PR 3's
//                            migration). Backfills internal_id on commit.
//   3. possible_duplicate — full_name match against a row whose internal_id
//                            differs from the upload's. Requires user
//                            resolution (merge / keep separate / skip).
//   4. name_ambiguous     — multiple Tier-2 candidates. Requires resolution.
//   5. new                — no match; INSERT.

export function normalizeName(name) {
  if (!name) return ''
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim()
}

export function matchExistingDriver(uploadRow, allExistingDrivers) {
  const uploadId = uploadRow.internal_id ? String(uploadRow.internal_id) : null
  const uploadName = normalizeName(uploadRow.full_name)

  // Tier 1 — exact internal_id match
  if (uploadId) {
    const byId = allExistingDrivers.find(d =>
      d.internal_id && String(d.internal_id) === uploadId
    )
    if (byId) {
      return { existing: byId, method: 'id_match', confidence: 'high' }
    }
  }

  // Tier 2 — name match where existing has NO internal_id (backfill candidate)
  const nameMatchesNoId = allExistingDrivers.filter(d =>
    !d.internal_id && d.full_name && normalizeName(d.full_name) === uploadName
  )
  if (nameMatchesNoId.length === 1) {
    return { existing: nameMatchesNoId[0], method: 'name_backfill', confidence: 'high' }
  }
  if (nameMatchesNoId.length > 1) {
    return { existing: null, method: 'name_ambiguous', confidence: 'low', candidates: nameMatchesNoId }
  }

  // Tier 3 — name match where existing HAS a different internal_id (namesake risk)
  if (uploadId) {
    const nameMatchesDifferentId = allExistingDrivers.filter(d =>
      d.internal_id && String(d.internal_id) !== uploadId
        && d.full_name && normalizeName(d.full_name) === uploadName
    )
    if (nameMatchesDifferentId.length > 0) {
      return { existing: null, method: 'possible_duplicate', confidence: 'medium', candidates: nameMatchesDifferentId }
    }
  }

  // Tier 4 — no match
  return { existing: null, method: 'new', confidence: 'high' }
}

// Field-level merge payload for an UPDATE. Categories:
//   REFRESH-ALWAYS — operational fields refresh from TMS every upload (truck/
//     trailer assignment, last_seen_in_upload_at). Phone/email/carrier fall
//     back only when the upload value is null/undefined so a blank in TMS
//     doesn't wipe known contact info.
//   DEFINITION    — TMS is authoritative when it has a value; existing kept
//     when upload is null.
//   BACKFILL-ONLY — identity fields filled in only when the existing row is
//     null (never overwritten). internal_id, full_name, hired_at.
//   PRESERVE-ALWAYS — current_status / status_changed_at / termination_reason /
//     notes. Not in the payload at all; caller handles re-activation separately
//     when the existing row is inactive/terminated.
//
// Home address (city/state/full address/zip) refreshes on every re-import so a
// driver who moves gets an updated address, using the same ?? fallback as
// phone/email so a blank in TMS never wipes a known address. home_lat/home_lng
// are NEVER written here — a DB trigger resolves them from geo_places whenever
// home_city + home_state change.
//
// All null|empty-string values on uploadRow should already be normalized to
// null by the parser (cleanStr returns null for ''). ?? falls back on null
// and undefined; that's the contract this function relies on.
export function buildUpdatePayload(existingDriver, uploadRow, userId) {
  return {
    // REFRESH-ALWAYS (operational)
    truck_assignment_raw:   uploadRow.truck_assignment_raw,
    trailer_assignment_raw: uploadRow.trailer_assignment_raw,
    phone:                  uploadRow.phone   ?? existingDriver.phone,
    email:                  uploadRow.email   ?? existingDriver.email,
    carrier:                uploadRow.carrier ?? existingDriver.carrier,
    last_seen_in_upload_at: new Date().toISOString(),

    // DEFINITION (TMS-authoritative)
    driver_type:        uploadRow.driver_type        ?? existingDriver.driver_type,
    compensation_raw:   uploadRow.compensation_raw   ?? existingDriver.compensation_raw,
    compensation_type:  uploadRow.compensation_type  ?? existingDriver.compensation_type,
    compensation_value: uploadRow.compensation_value ?? existingDriver.compensation_value,
    referred_by:        uploadRow.referred_by        ?? existingDriver.referred_by,
    temporary_license:  uploadRow.temporary_license  ?? existingDriver.temporary_license,
    missing_op:         uploadRow.missing_op         ?? existingDriver.missing_op,

    // HOME ADDRESS (refresh-always; blank in TMS never wipes a known value).
    // No home_lat/home_lng — the DB trigger owns coordinates.
    home_city:         uploadRow.home_city         ?? existingDriver.home_city,
    home_state:        uploadRow.home_state        ?? existingDriver.home_state,
    home_full_address: uploadRow.home_full_address ?? existingDriver.home_full_address,
    home_zip:          uploadRow.home_zip          ?? existingDriver.home_zip,

    // Termination date from "Job date removed". Refreshes when TMS reports one;
    // a blank keeps the existing value. The re-activation path in driversCommit
    // overrides this to null after the payload is built.
    terminated_at: uploadRow.terminated_at ?? existingDriver.terminated_at,

    // BACKFILL-ONLY (identity)
    internal_id:   existingDriver.internal_id ?? uploadRow.internal_id,
    full_name:     existingDriver.full_name   ?? uploadRow.full_name,
    hired_at:      existingDriver.hired_at    ?? uploadRow.hired_at,

    // Audit
    updated_by: userId || null,
  }
}
