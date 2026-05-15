import { supabase } from '../../../lib/supabase'

// commitDriverRows({ rows, terminations, userId })
//
// `rows`        — parsed + preview-vetted upload rows (non-skipped only)
// `terminations` — explicit decisions for drivers active in DB but missing
//                  from the upload. Shape: [{ driverId, action, reason }]
//                  where action ∈ 'terminate' | 'inactive' | 'on_leave' | 'keep_active'
// `userId`       — auth.uid() for created_by / updated_by stamps
//
// Returns { inserted, updated, reactivated, terminated, kept_active, errors }
//
// Update semantics: preserves user-managed fields (current_status,
// status_changed_at, terminated_at, termination_reason, notes) UNLESS the
// driver was previously inactive/terminated and is now appearing in the
// upload again — in which case it's a re-activation.
//
// Operational fields refresh from upload on every match. last_seen_in_upload_at
// is always stamped to now() for matched drivers.

const BATCH_INSERT = 200
const CHICAGO_TODAY = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

function buildOpPayload(row) {
  return {
    full_name: row.full_name,
    phone: row.phone,
    email: row.email,
    driver_type: row.driver_type,
    carrier: row.carrier,
    truck_assignment_raw: row.truck_assignment_raw,
    trailer_assignment_raw: row.trailer_assignment_raw,
    compensation_raw: row.compensation_raw,
    compensation_type: row.compensation_type,
    compensation_value: row.compensation_value,
    referred_by: row.referred_by,
    temporary_license: !!row.temporary_license,
    missing_op: row.missing_op,
    last_seen_in_upload_at: new Date().toISOString(),
  }
}

export async function commitDriverRows({ rows, terminations = [], userId }) {
  const active = (rows || []).filter(r => !r.skip)
  const result = { inserted: 0, updated: 0, reactivated: 0, terminated: 0, kept_active: 0, errors: [] }
  if (active.length === 0 && terminations.length === 0) return result

  // ── Dedup lookup by internal_id ──────────────────────────────────────
  const ids = active.map(r => r.internal_id).filter(Boolean)
  const { data: existingData, error: existingErr } = ids.length
    ? await supabase.from('drivers').select('id, internal_id, current_status').in('internal_id', ids)
    : { data: [], error: null }
  if (existingErr) { result.errors.push(existingErr.message); return result }
  const existingByInternalId = new Map((existingData || []).map(e => [e.internal_id, e]))

  const toInsert = []
  const toUpdate = []
  for (const row of active) {
    const existing = existingByInternalId.get(row.internal_id)
    if (existing) toUpdate.push({ row, existing })
    else toInsert.push(row)
  }

  // ── INSERTS (batched) ────────────────────────────────────────────────
  for (let i = 0; i < toInsert.length; i += BATCH_INSERT) {
    const slice = toInsert.slice(i, i + BATCH_INSERT)
    const payloads = slice.map(row => ({
      internal_id: row.internal_id,
      ...buildOpPayload(row),
      onboarded_at: row.onboarded_at,
      current_status: 'active',
      status_changed_at: new Date().toISOString(),
      created_by: userId || null,
      updated_by: userId || null,
    }))
    const { data: inserted, error } = await supabase
      .from('drivers').insert(payloads).select('id, internal_id')
    if (error) { result.errors.push(`Insert batch ${i/BATCH_INSERT}: ${error.message}`); continue }
    result.inserted += (inserted || []).length

    if ((inserted || []).length > 0) {
      const histPayloads = inserted.map(d => ({
        driver_id: d.id,
        from_status: null,
        to_status: 'active',
        reason: 'Initial import via upload',
        created_by: userId || null,
      }))
      const { error: hErr } = await supabase.from('driver_status_history').insert(histPayloads)
      if (hErr) result.errors.push(`History insert (new): ${hErr.message}`)
    }
  }

  // ── UPDATES (parallel) ───────────────────────────────────────────────
  const updateTasks = toUpdate.map(async ({ row, existing }) => {
    const payload = { ...buildOpPayload(row), updated_by: userId || null }
    let isReactivation = false
    if (existing.current_status === 'inactive' || existing.current_status === 'terminated') {
      payload.current_status = 'active'
      payload.status_changed_at = new Date().toISOString()
      payload.terminated_at = null
      payload.termination_reason = null
      isReactivation = true
    }
    const { error } = await supabase.from('drivers').update(payload).eq('id', existing.id)
    if (error) { result.errors.push(`Update internal_id ${row.internal_id}: ${error.message}`); return }
    result.updated++
    if (isReactivation) {
      result.reactivated++
      await supabase.from('driver_status_history').insert({
        driver_id: existing.id,
        from_status: existing.current_status,
        to_status: 'active',
        reason: 'Re-activated — appeared in upload again',
        created_by: userId || null,
      })
    }
  })
  await Promise.all(updateTasks)

  // ── TERMINATIONS / status changes from preview's possibly-terminated section
  const termTasks = (terminations || []).map(async ({ driverId, action, reason }) => {
    if (action === 'keep_active') { result.kept_active++; return }
    const targetStatus = action === 'terminate' ? 'terminated'
                       : action === 'inactive'  ? 'inactive'
                       : action === 'on_leave'  ? 'on_leave'
                       : null
    if (!targetStatus) return

    const update = {
      current_status: targetStatus,
      status_changed_at: new Date().toISOString(),
      updated_by: userId || null,
    }
    if (targetStatus === 'terminated') {
      update.terminated_at = CHICAGO_TODAY()
      update.termination_reason = reason || null
    } else {
      update.terminated_at = null
    }
    const { error: upErr } = await supabase.from('drivers').update(update).eq('id', driverId)
    if (upErr) { result.errors.push(`Termination on ${driverId}: ${upErr.message}`); return }
    await supabase.from('driver_status_history').insert({
      driver_id: driverId,
      from_status: 'active',
      to_status: targetStatus,
      reason: reason || `Marked ${targetStatus} via upload review`,
      created_by: userId || null,
    })
    if (targetStatus === 'terminated') result.terminated++
  })
  await Promise.all(termTasks)

  return result
}
