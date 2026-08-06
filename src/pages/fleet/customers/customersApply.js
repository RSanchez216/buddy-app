import { supabase } from '../../../lib/supabase'
import { normMc } from './customersPlan'

// DB layer for the customers import. The preview lives in client state — nothing
// is written until applyCustomerPlan runs. Reads the whole customers table paged
// past the 1000-row cap (there are 1,185), writes durable facts + a metrics
// snapshot on Apply, and records the run. is_active is NEVER written.

const READ_PAGE = 1000
const CHUNK = 200
const chunked = (arr, n = CHUNK) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Every customer (id, name, mc_number, tms_code) for matching — paged, never the
// first 1000 only, or the tail can't be matched and would be re-created.
const MATCH_COLS = 'id, name, mc_number, tms_code, phone, email, city, state, country, credit_limit, tms_status'
export async function fetchAllCustomers() {
  const all = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase.from('customers')
      .select(MATCH_COLS).order('id', { ascending: true })
      .range(from, from + READ_PAGE - 1)
    if (error) throw new Error(`Customer lookup failed: ${error.message}`)
    const page = data || []
    all.push(...page)
    if (page.length < READ_PAGE) break
  }
  return all
}

// Broker profile — one RPC, everything the profile page renders except the
// document list (which needs the rows, not a count).
export async function fetchBrokerProfile(customerId) {
  const { data, error } = await supabase.rpc('broker_profile', { p_customer_id: customerId })
  if (error) throw error
  return data || null
}
export async function fetchBrokerDocuments(customerId) {
  const { data, error } = await supabase.from('broker_documents')
    .select('id, doc_type, file_name, file_path, uploaded_at')
    .eq('customer_id', customerId).order('uploaded_at', { ascending: false })
  if (error) return []
  return data || []
}

export async function loadRecentCustomerImports(limit = 20) {
  const { data, error } = await supabase.from('customer_imports')
    .select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) return []
  return data || []
}

// The durable facts + metrics snapshot for a row. Durable facts are COALESCED
// against the existing record (file value wins when present, else keep what's
// there) so a blank cell never erases a value the customer already had — the 50
// existing MCs especially. Snapshot metrics always take the file's value (they're
// a point-in-time capture) and ride with tms_synced_at. On a re-run of the same
// file every value resolves the same, so only tms_synced_at changes.
function payloadFor(r, existing, syncedAt) {
  const keep = (fileVal, col) => (fileVal != null ? fileVal : (existing ? existing[col] : null) ?? null)
  return {
    mc_number: keep(normMc(r.mc_number), 'mc_number'),
    tms_code: keep(r.tms_code, 'tms_code'),
    phone: keep(r.phone, 'phone'),
    email: keep(r.email, 'email'),
    city: keep(r.city, 'city'),
    state: keep(r.state, 'state'),
    country: keep(r.country, 'country'),
    credit_limit: keep(r.credit_limit, 'credit_limit'),
    tms_status: keep(r.tms_status, 'tms_status'),
    tms_loads_ytd: r.tms_loads_ytd ?? null,
    tms_sales_ytd: r.tms_sales_ytd ?? null,
    tms_last_load_date: r.tms_last_load_date ?? null,
    tms_synced_at: syncedAt,
  }
}

// Apply: create the unmatched, update the matched, record the run. Conflicts are
// skipped (a person resolves them). is_active is never touched — a customer
// absent from this already-filtered export has NOT been deactivated.
export async function applyCustomerPlan({ plan, counts, filename, userId, syncedAt }) {
  const now = syncedAt || new Date().toISOString()

  // Creates — verbatim name (never the code-prefixed form) + facts.
  const toCreate = plan.filter(p => p.isNew).map(p => ({ name: p.row.name, ...payloadFor(p.row, null, now) }))
  const createdNames = []
  for (const c of chunked(toCreate)) {
    const { data, error } = await supabase.from('customers').insert(c).select('name')
    if (error && !/duplicate|unique/i.test(error.message || '')) return { error }
    for (const r of (data || [])) createdNames.push(r.name)
  }

  // Updates — matched, non-conflict. Upsert on id so it goes out batched, not one
  // round-trip per customer. The existing name is echoed back (unchanged) so the
  // upsert's INSERT arm has the NOT NULL name it needs; customers.name is never
  // rewritten from this file.
  const toUpdate = plan.filter(p => p.match && !p.conflict)
    .map(p => ({ id: p.matchId, name: p.matchName, ...payloadFor(p.row, p.match, now) }))
  for (const c of chunked(toUpdate)) {
    const { error } = await supabase.from('customers').upsert(c, { onConflict: 'id' })
    if (error) return { error }
  }

  // Record the run. Best-effort — the customers are already written, so a failure
  // to log the run must not fail the import.
  try {
    await supabase.from('customer_imports').insert({
      filename: filename ?? null,
      uploaded_by: userId ?? null,
      total_rows: plan.length,
      counts: counts || {},
      applied_at: now,
    })
  } catch (e) { console.error('customer_imports record failed', e) }

  return {
    created: toCreate.length,
    updated: toUpdate.length,
    conflicts: plan.filter(p => p.conflict).length,
    mcFilled: plan.filter(p => p.willFillMc).length,
    createdNames: createdNames.length ? createdNames.sort((a, b) => a.localeCompare(b)) : toCreate.map(c => c.name).sort((a, b) => a.localeCompare(b)),
  }
}
