import { supabase } from '../../../lib/supabase'
import { buildUpdatePayload } from './driversMatcher'

// commitDriverRows({ rows, terminations, userId })
//
// `rows`        — preview-vetted upload rows. Each row carries the matcher
//                  result on row.match = { method, existing, candidates? }
//                  and (for needs-resolution rows) a row.resolution =
//                  { action: 'merge_into' | 'keep_separate' | 'skip',
//                    target_id?: existing.id }.
// `terminations` — explicit decisions for drivers active in DB but missing
//                  from the upload. Shape: [{ driverId, action, reason }]
//                  where action ∈ 'terminate' | 'inactive' | 'on_leave' | 'keep_active'
// `userId`       — auth.uid() stamp.
//
// Returns { inserted, updated, backfilled, reactivated, terminated, kept_active, errors }

const BATCH_INSERT = 200
const CHICAGO_TODAY = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

// Decide what to do with a row given its match + resolution state.
// Returns { kind, existing? } where kind ∈ 'insert' | 'update' | 'skip'.
function decideRowAction(row) {
  const m = row.match
  if (!m) return { kind: 'insert' } // fallback (shouldn't happen if matcher ran)

  switch (m.method) {
    case 'id_match':
    case 'name_backfill':
      return { kind: 'update', existing: m.existing }
    case 'new':
      return { kind: 'insert' }
    case 'possible_duplicate':
    case 'name_ambiguous': {
      const r = row.resolution
      if (!r || r.action === 'skip') return { kind: 'skip' }
      if (r.action === 'keep_separate') return { kind: 'insert' }
      if (r.action === 'merge_into' && r.target_id) {
        const target = (m.candidates || []).find(c => c.id === r.target_id)
        if (target) return { kind: 'update', existing: target }
        return { kind: 'skip' }
      }
      return { kind: 'skip' }
    }
    default:
      return { kind: 'insert' }
  }
}

export async function commitDriverRows({ rows, terminations = [], userId }) {
  const result = { inserted: 0, updated: 0, backfilled: 0, reactivated: 0, terminated: 0, kept_active: 0, errors: [] }

  const active = (rows || []).filter(r => !r.skip)
  if (active.length === 0 && (!terminations || terminations.length === 0)) return result

  const toInsert = []
  const toUpdate = []
  for (const row of active) {
    const decision = decideRowAction(row)
    if (decision.kind === 'insert') toInsert.push(row)
    else if (decision.kind === 'update') toUpdate.push({ row, existing: decision.existing })
    // 'skip' falls through
  }

  // ── INSERTS (batched) ────────────────────────────────────────────────
  for (let i = 0; i < toInsert.length; i += BATCH_INSERT) {
    const slice = toInsert.slice(i, i + BATCH_INSERT)
    const payloads = slice.map(row => ({
      internal_id: row.internal_id,
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
      onboarded_at: row.onboarded_at,
      current_status: 'active',
      status_changed_at: new Date().toISOString(),
      last_seen_in_upload_at: new Date().toISOString(),
      created_by: userId || null,
      updated_by: userId || null,
    }))
    const { data: inserted, error } = await supabase
      .from('drivers').insert(payloads).select('id, internal_id')
    if (error) { result.errors.push(`Insert batch ${i / BATCH_INSERT}: ${error.message}`); continue }
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

  // ── UPDATES (parallel; field-level merge via buildUpdatePayload) ────
  const updateTasks = toUpdate.map(async ({ row, existing }) => {
    // Detect backfill: existing.internal_id was null and upload supplies one.
    const isBackfillingInternalId = !existing.internal_id && !!row.internal_id

    const payload = buildUpdatePayload(existing, row, userId)
    let isReactivation = false
    if (existing.current_status === 'inactive' || existing.current_status === 'terminated') {
      payload.current_status = 'active'
      payload.status_changed_at = new Date().toISOString()
      payload.terminated_at = null
      payload.termination_reason = null
      isReactivation = true
    }
    const { error } = await supabase.from('drivers').update(payload).eq('id', existing.id)
    if (error) {
      result.errors.push(`Update driver ${existing.id} (${row.full_name || row.internal_id}): ${error.message}`)
      return
    }
    result.updated++
    if (isBackfillingInternalId) result.backfilled++

    // Audit events
    const histRows = []
    if (isBackfillingInternalId) {
      histRows.push({
        driver_id: existing.id,
        from_status: existing.current_status || 'active',
        to_status: existing.current_status || 'active',
        reason: `Backfilled internal_id "${row.internal_id}" via upload`,
        created_by: userId || null,
      })
    }
    if (isReactivation) {
      histRows.push({
        driver_id: existing.id,
        from_status: existing.current_status,
        to_status: 'active',
        reason: 'Re-activated — appeared in upload again',
        created_by: userId || null,
      })
      result.reactivated++
    }
    if (histRows.length > 0) {
      await supabase.from('driver_status_history').insert(histRows)
    }
  })
  await Promise.all(updateTasks)

  // ── TERMINATIONS / status changes from preview decisions ─────────────
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
