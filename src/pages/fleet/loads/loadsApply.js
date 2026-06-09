import { supabase } from '../../../lib/supabase'
import { normName } from './loadsParse'

// Loads ingest — Phase 2 stage + apply layer. stageBatch persists a built
// plan into the staging tables; loadPendingBatch reconstructs a plan from
// the staged rows (so a page refresh resumes the review); applyBatch
// writes approved loads through to loads/load_legs and marks the batch
// applied. The staged rows are the single source of truth for both review
// and apply, so the fresh-upload and resume paths behave identically.

const CHUNK = 200
// Apply writes go out in batches of this size so a 500+ load import can't
// stall on one oversized request and so the progress bar advances per batch.
const BATCH_SIZE = 50
const chunked = (arr, n = BATCH_SIZE) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

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
// Batched, progress-reporting apply. onProgress({ phase, done, total }) fires
// after every batch resolves so the UI bar advances (React repaints between
// the awaited network calls). Phases respect FK order: customers →
// dispatchers → loads → legs → entity links.
//
// Idempotent / retry-safe: loads upsert on load_number (notes write-once —
// existing loads are updated WITHOUT touching the three notes columns); legs
// are matched against the CURRENT DB state (re-derived here, not just the
// staged existing_leg_id) so a leg written by a prior partial run is updated,
// never duplicated. Re-running after a failure resumes cleanly.
export async function applyBatch({ batchId, decisions, linkOverrides, onProgress }) {
  const now = () => new Date().toISOString()
  const { data: rows, error: rowsErr } = await supabase.from('load_import_rows').select('*').eq('batch_id', batchId)
  if (rowsErr) return { error: rowsErr }
  const plan = planFromRows(rows || [])

  // Loads/legs actually written = approved (not skipped) and not unchanged.
  const appliedPlan = plan.filter(p =>
    (decisions?.get(p.load_number) || 'approved') !== 'skipped' && p.classification !== 'unchanged')

  // Distinct to-create entities (by normalized name).
  const newCustomers = new Map(), newDispatchers = new Map()
  for (const p of plan) {
    const c = p.resolved.customer, d = p.resolved.dispatcher
    if (c?.match_status === 'to_create' && c.name) newCustomers.set(normName(c.name), c.name)
    if (d?.match_status === 'to_create' && d.name) newDispatchers.set(normName(d.name), d.name)
  }
  const custNames = [...newCustomers.values()]
  const dispNames = [...newDispatchers.values()]

  const legTotal = appliedPlan.reduce((n, p) => n + p.legs.length, 0)
  const linkCount = linkOverrides?.size || 0
  const total = custNames.length + dispNames.length + appliedPlan.length + legTotal + linkCount
  let done = 0
  const report = (phase) => onProgress?.({ phase, done, total })
  report('Starting')

  // ── Phase 1: customers ──
  for (const c of chunked(custNames)) {
    const { error } = await supabase.from('customers').insert(c.map(name => ({ name })))
    if (error && !/duplicate|unique/i.test(error.message || '')) return { error, done, total }
    done += c.length; report('Creating customers')
  }
  // ── Phase 2: dispatchers ──
  for (const c of chunked(dispNames)) {
    const { error } = await supabase.from('dispatchers').insert(c.map(name => ({ name })))
    if (error && !/duplicate|unique/i.test(error.message || '')) return { error, done, total }
    done += c.length; report('Creating dispatchers')
  }

  // Re-read entity maps (includes the just-created rows).
  const [{ data: custs }, { data: disps }] = await Promise.all([
    supabase.from('customers').select('id, name'),
    supabase.from('dispatchers').select('id, name'),
  ])
  const custByName = new Map((custs || []).map(c => [normName(c.name), c.id]))
  const dispByName = new Map((disps || []).map(d => [normName(d.name), d.id]))

  // ── Phase 3: loads ── partition into existing (update, no notes) vs new
  // (insert with notes); both via upsert on load_number for idempotency.
  const loadIdByNumber = new Map()
  const existingPayloads = [], newPayloads = []
  for (const p of appliedPlan) {
    const h = p.header
    const customer_id = p.resolved.customer?.id || (p.resolved.customer?.name ? custByName.get(normName(p.resolved.customer.name)) : null) || null
    const dispatcher_id = p.resolved.dispatcher?.id || (p.resolved.dispatcher?.name ? dispByName.get(normName(p.resolved.dispatcher.name)) : null) || null
    const carrier_id = p.resolved.carrier?.id || null   // carriers never auto-created
    const common = {
      load_number: p.load_number,
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
    if (p.existing_load_id) {
      loadIdByNumber.set(p.load_number, p.existing_load_id)
      existingPayloads.push(common)            // notes intentionally omitted → untouched
    } else {
      newPayloads.push({
        ...common,
        load_notes: h.load_notes ?? null, load_instructions: h.load_instructions ?? null,
        invoice_notes: h.invoice_notes ?? null, first_imported_at: now(),
      })
    }
  }
  for (const c of chunked(existingPayloads)) {
    const { error } = await supabase.from('loads').upsert(c, { onConflict: 'load_number' })
    if (error) return { error, done, total }
    done += c.length; report('Applying loads')
  }
  for (const c of chunked(newPayloads)) {
    const { data, error } = await supabase.from('loads').upsert(c, { onConflict: 'load_number' }).select('id, load_number')
    if (error || !data) return { error: error || new Error('Load upsert returned no rows'), done, total }
    for (const r of data) loadIdByNumber.set(r.load_number, r.id)
    done += c.length; report('Applying loads')
  }

  // ── Phase 4: legs ── re-derive current legs so a retry updates rather than
  // duplicates. driver/truck/trailer ids here are AUTO matches only; the
  // user-confirmed overrides are applied in Phase 5.
  const loadIds = [...new Set(loadIdByNumber.values())]
  const legIdByKey = new Map()  // `${load_id}|${normName(driver_raw)}` -> leg_id
  for (const c of chunked(loadIds, 200)) {
    const { data, error } = await supabase.from('load_legs').select('id, load_id, driver_raw').in('load_id', c)
    if (error) return { error, done, total }
    for (const lg of (data || [])) legIdByKey.set(`${lg.load_id}|${normName(lg.driver_raw)}`, lg.id)
  }
  const legInserts = [], legUpdates = []
  for (const p of appliedPlan) {
    const loadId = loadIdByNumber.get(p.load_number)
    if (!loadId) continue
    for (const leg of p.legs) {
      const lp = leg.parsed
      const fields = {
        driver_raw: lp.driver_raw, truck_raw: lp.truck_raw ?? null, trailer_raw: lp.trailer_raw ?? null,
        driver_id: leg.resolved?.driver?.id ?? null,
        truck_id: leg.resolved?.truck?.id ?? null,
        trailer_id: leg.resolved?.trailer?.id ?? null,
        empty_miles: lp.empty_miles ?? null, loaded_miles: lp.loaded_miles ?? null, total_miles: lp.total_miles ?? null,
        last_imported_at: now(),
      }
      const existId = legIdByKey.get(`${loadId}|${normName(lp.driver_raw)}`)
      if (existId) legUpdates.push({ id: existId, fields })
      else legInserts.push({ load_id: loadId, leg_seq: leg.leg_seq, ...fields })
    }
  }
  for (const c of chunked(legInserts)) {
    const { data, error } = await supabase.from('load_legs').insert(c).select('id, load_id, driver_raw')
    if (error) return { error, done, total }
    for (const lg of (data || [])) legIdByKey.set(`${lg.load_id}|${normName(lg.driver_raw)}`, lg.id)
    done += c.length; report('Linking legs')
  }
  // Updates carry distinct payloads → applied individually (low volume: a
  // fresh all-new import has zero of these).
  for (const u of legUpdates) {
    const { error } = await supabase.from('load_legs').update(u.fields).eq('id', u.id)
    if (error) return { error, done, total }
    done += 1; report('Linking legs')
  }

  // ── Phase 5: entity links ── set driver/truck/trailer_id on the legs whose
  // entity the user linked on the review screen. Grouped per link → one
  // update covering all its legs.
  for (const [key, overrideId] of (linkOverrides || new Map())) {
    const type = key.slice(0, key.indexOf(':'))
    const legIds = []
    for (const p of appliedPlan) {
      const loadId = loadIdByNumber.get(p.load_number)
      if (!loadId) continue
      for (const leg of p.legs) {
        const r = leg.resolved?.[type]
        if (!r || r.match_status !== 'unmatched' || linkKey(type, r.raw) !== key) continue
        const id = legIdByKey.get(`${loadId}|${normName(leg.parsed.driver_raw)}`)
        if (id) legIds.push(id)
      }
    }
    if (legIds.length) {
      const { error } = await supabase.from('load_legs').update({ [`${type}_id`]: overrideId }).in('id', legIds)
      if (error) return { error, done, total }
    }
    done += 1; report('Applying matches')
  }

  const { error: doneErr } = await supabase.from('load_import_batches')
    .update({ status: 'applied', applied_at: now() }).eq('id', batchId)
  if (doneErr) return { error: doneErr, done, total }

  done = total; report('Done')
  return { appliedLoads: appliedPlan.length, appliedLegs: legInserts.length + legUpdates.length }
}
