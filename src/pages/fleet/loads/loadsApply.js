import { supabase } from '../../../lib/supabase'
import { normName } from './loadsParse'

// Loads ingest — Phase 2 stage + apply layer. stageBatch persists a built
// plan into the staging tables; loadPendingBatch reconstructs a plan from
// the staged rows (so a page refresh resumes the review); applyBatch
// writes approved loads through to loads/load_legs and marks the batch
// applied. The staged rows are the single source of truth for both review
// and apply, so the fresh-upload and resume paths behave identically.

const CHUNK = 200

// Stable key for a user-confirmed link to an unmatched entity. Drivers key
// on normalized name; trucks/trailers on the raw unit text. Shared by the
// review UI (when the user picks a link) and apply (when it's consumed).
export function linkKey(type, raw) {
  return `${type}:${type === 'driver' ? normName(raw) : String(raw)}`
}

// ── stage ───────────────────────────────────────────────────────────────
export async function stageBatch({ plan, counts, filename, userId }) {
  const total = plan.reduce((n, p) => n + p.legs.length, 0)
  const { data: batch, error } = await supabase.from('load_import_batches')
    .insert({ filename: filename || null, status: 'pending_review', total_rows: total, counts, uploaded_by: userId || null })
    .select('id').single()
  if (error || !batch) return { error: error || new Error('Could not create import batch') }

  const rows = []
  for (const p of plan) {
    p.legs.forEach((leg, i) => {
      rows.push({
        batch_id: batch.id,
        row_index: leg.row_index,
        load_number: p.load_number,
        classification: leg.classification,
        is_status_flag: p.is_status_flag,
        decision: 'approved',
        raw: leg.raw,
        // Header parsed/resolved ride on the first leg of each load.
        parsed: i === 0 ? { leg: leg.parsed, header: p.header } : { leg: leg.parsed },
        resolved: i === 0
          ? { leg: leg.resolved, existing_leg_id: leg.existing_leg_id, header: p.resolved, existing_load_id: p.existing_load_id }
          : { leg: leg.resolved, existing_leg_id: leg.existing_leg_id },
        diff: i === 0 ? [...p.header_diffs, ...leg.diffs] : leg.diffs,
      })
    })
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error: insErr } = await supabase.from('load_import_rows').insert(rows.slice(i, i + CHUNK))
    if (insErr) return { error: insErr }
  }
  return { batchId: batch.id }
}

// Reconstruct a plan (same shape buildPlan returns) from staged rows.
function planFromRows(rows) {
  rows.sort((a, b) => a.row_index - b.row_index)
  const byLoad = new Map()
  for (const r of rows) {
    if (!byLoad.has(r.load_number)) byLoad.set(r.load_number, [])
    byLoad.get(r.load_number).push(r)
  }
  const plan = []
  for (const [load_number, rs] of byLoad) {
    const head = rs.find(r => r.parsed?.header) || rs[0]
    const header = head.parsed?.header || { load_number }
    const resolvedHeader = head.resolved?.header || { customer: {}, dispatcher: {}, carrier: {} }
    const existing_load_id = head.resolved?.existing_load_id ?? null
    const header_diffs = (head.diff || []).filter(d => d.scope === 'header')
    const legs = rs.map((r, i) => ({
      leg_seq: i + 1,
      row_index: r.row_index,
      raw: r.raw,
      existing_leg_id: r.resolved?.existing_leg_id ?? null,
      classification: r.classification,
      diffs: (r.diff || []).filter(d => d.scope === 'leg'),
      parsed: r.parsed?.leg || {},
      resolved: r.resolved?.leg || {},
    }))
    const classification = !existing_load_id
      ? 'new'
      : (header_diffs.length || legs.some(l => l.classification === 'updated' || l.classification === 'new_leg'))
        ? 'updated' : 'unchanged'
    plan.push({
      load_number, existing_load_id, classification,
      is_status_flag: head.is_status_flag,
      decision: head.decision,
      header, header_diffs, resolved: resolvedHeader, legs,
    })
  }
  return plan
}

// ── load the open (pending_review) batch + its plan, if any ──────────────
export async function loadPendingBatch() {
  const { data: batch } = await supabase.from('load_import_batches')
    .select('*').eq('status', 'pending_review').order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
  if (!batch) return { batch: null, plan: [] }
  const { data: rows } = await supabase.from('load_import_rows').select('*').eq('batch_id', batch.id)
  return { batch, plan: planFromRows(rows || []), counts: batch.counts || {} }
}

export async function discardBatch(batchId) {
  const { error } = await supabase.from('load_import_batches')
    .update({ status: 'discarded' }).eq('id', batchId)
  return { error }
}

// ── apply ────────────────────────────────────────────────────────────────
// decisions: Map(load_number -> 'approved' | 'skipped')
// linkOverrides: Map(`${type}:${normRaw}` -> fleet uuid) for unmatched
//   driver/truck/trailer the user linked on the review screen.
export async function applyBatch({ batchId, decisions, linkOverrides }) {
  const now = () => new Date().toISOString()
  const { data: rows, error: rowsErr } = await supabase.from('load_import_rows').select('*').eq('batch_id', batchId)
  if (rowsErr) return { error: rowsErr }
  const plan = planFromRows(rows || [])

  // 1) Create to-create customers / dispatchers (distinct by normalized name).
  const newCustomers = new Map(), newDispatchers = new Map()
  for (const p of plan) {
    const c = p.resolved.customer, d = p.resolved.dispatcher
    if (c?.match_status === 'to_create' && c.name) newCustomers.set(normName(c.name), c.name)
    if (d?.match_status === 'to_create' && d.name) newDispatchers.set(normName(d.name), d.name)
  }
  if (newCustomers.size) {
    const { error } = await supabase.from('customers').insert([...newCustomers.values()].map(name => ({ name })))
    if (error && !/duplicate|unique/i.test(error.message || '')) return { error }
  }
  if (newDispatchers.size) {
    const { error } = await supabase.from('dispatchers').insert([...newDispatchers.values()].map(name => ({ name })))
    if (error && !/duplicate|unique/i.test(error.message || '')) return { error }
  }

  // Re-read entity maps (includes the just-created rows).
  const [{ data: custs }, { data: disps }] = await Promise.all([
    supabase.from('customers').select('id, name'),
    supabase.from('dispatchers').select('id, name'),
  ])
  const custByName = new Map((custs || []).map(c => [normName(c.name), c.id]))
  const dispByName = new Map((disps || []).map(d => [normName(d.name), d.id]))

  const linkFor = (type, raw, resolvedId) => {
    if (resolvedId) return resolvedId
    if (raw == null) return null
    return linkOverrides?.get(linkKey(type, raw)) ?? null
  }

  let appliedLoads = 0, appliedLegs = 0
  for (const p of plan) {
    const decision = decisions?.get(p.load_number) || 'approved'
    if (decision === 'skipped') continue
    if (p.classification === 'unchanged') continue   // idempotent no-op

    const h = p.header
    const customer_id = p.resolved.customer?.id || (p.resolved.customer?.name ? custByName.get(normName(p.resolved.customer.name)) : null) || null
    const dispatcher_id = p.resolved.dispatcher?.id || (p.resolved.dispatcher?.name ? dispByName.get(normName(p.resolved.dispatcher.name)) : null) || null
    const carrier_id = p.resolved.carrier?.id || null   // carriers never auto-created

    let loadId = p.existing_load_id
    const commonFields = {
      customer_load_number: h.customer_load_number ?? null,
      customer_id, dispatcher_id, carrier_id,
      status: h.status ?? 'Unknown',
      load_type: h.load_type ?? null,
      num_picks: h.num_picks ?? null, num_drops: h.num_drops ?? null,
      pu_info: h.pu_info ?? null, del_info: h.del_info ?? null,
      pickup_date: h.pickup_date ?? null, delivery_date: h.delivery_date ?? null,
      linehaul: h.linehaul ?? null, weight: h.weight ?? null, commodity: h.commodity ?? null,
      is_team_load: !!h.is_team_load,
      last_imported_at: now(),
    }

    if (loadId) {
      // Existing → update watched + non-note fields. NEVER touch notes.
      const { error } = await supabase.from('loads').update(commonFields).eq('id', loadId)
      if (error) return { error }
    } else {
      // New → insert full row incl. notes (write-once) + first_imported_at.
      const { data: inserted, error } = await supabase.from('loads').insert({
        load_number: p.load_number,
        ...commonFields,
        load_notes: h.load_notes ?? null,
        load_instructions: h.load_instructions ?? null,
        invoice_notes: h.invoice_notes ?? null,
        first_imported_at: now(),
      }).select('id').single()
      if (error || !inserted) return { error: error || new Error(`Insert failed for load ${p.load_number}`) }
      loadId = inserted.id
    }
    appliedLoads++

    // Legs: update matched, insert new.
    for (const leg of p.legs) {
      const lp = leg.parsed
      const driver_id  = linkFor('driver',  lp.driver_raw,  leg.resolved?.driver?.id)
      const truck_id   = linkFor('truck',   lp.truck_raw,   leg.resolved?.truck?.id)
      const trailer_id = linkFor('trailer', lp.trailer_raw, leg.resolved?.trailer?.id)
      const legFields = {
        driver_raw: lp.driver_raw, truck_raw: lp.truck_raw ?? null, trailer_raw: lp.trailer_raw ?? null,
        driver_id, truck_id, trailer_id,
        empty_miles: lp.empty_miles ?? null, loaded_miles: lp.loaded_miles ?? null, total_miles: lp.total_miles ?? null,
        last_imported_at: now(),
      }
      if (leg.existing_leg_id) {
        const { error } = await supabase.from('load_legs').update(legFields).eq('id', leg.existing_leg_id)
        if (error) return { error }
      } else {
        const { error } = await supabase.from('load_legs').insert({ load_id: loadId, leg_seq: leg.leg_seq, ...legFields })
        if (error) return { error }
      }
      appliedLegs++
    }
  }

  const { error: doneErr } = await supabase.from('load_import_batches')
    .update({ status: 'applied', applied_at: now() }).eq('id', batchId)
  if (doneErr) return { error: doneErr }

  return { appliedLoads, appliedLegs }
}
