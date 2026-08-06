import { supabase } from '../../../lib/supabase'
import { normMc } from './customersPlan'

// DB layer for the customers import. The preview lives in client state — nothing
// is written until applyCustomerPlan runs. Reads the whole customers table paged
// past the 1000-row cap (there are 1,185), writes durable facts + a metrics
// snapshot on Apply, and records the run. is_active is NEVER written.

const READ_PAGE = 1000

// Every customer (id, name, mc_number, tms_code) for matching — paged, never the
// first 1000 only, or the tail can't be matched and would be re-created.
const MATCH_COLS = 'id, name, mc_number, tms_code, phone, email, city, state, country, credit_limit, tms_status, '
  + 'credit_hold, address, street1, street2, zip_code, setup_date, billing_preference, payment_terms, ap_phone, ap_emails'
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

// Full credit history for a broker, lifted events included, newest first — a
// broker stopped twice in six months is worth seeing, which is exactly what
// broker_credit_status can't tell you (it returns the open event only).
// Matching is on MC, never name: the credit list and the customer record often
// spell the company differently (Yellow Diamond Logistics vs Yellow Diamond
// Consultants LLC).
export async function fetchBrokerCreditHistory(mcNumber) {
  if (!mcNumber) return []
  const { data, error } = await supabase.from('broker_credit_events')
    .select('id, event_type, active_from, resolved_on, new_limit_usd, prior_limit_usd, exceeded_by_usd, reason, source, source_posted_at')
    .eq('mc_number', mcNumber)
    .order('active_from', { ascending: false })
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

    // ── 27-column export ──
    // Durable facts, so they coalesce like the rest: a blank cell (or an older
    // 15-column file, where these parse to null) keeps whatever is on record
    // rather than wiping it.
    credit_hold: keep(r.credit_hold, 'credit_hold'),
    address: keep(r.address, 'address'),
    street1: keep(r.street1, 'street1'),
    street2: keep(r.street2, 'street2'),
    zip_code: keep(r.zip_code, 'zip_code'),
    setup_date: keep(r.setup_date, 'setup_date'),
    billing_preference: keep(r.billing_preference, 'billing_preference'),
    payment_terms: keep(r.payment_terms, 'payment_terms'),
    ap_phone: keep(r.ap_phone, 'ap_phone'),
    // The invoice address. Stored on the customer and shown under Billing only —
    // it is never written to load_broker_rules and never becomes a pod_email.
    ap_emails: keep(r.ap_emails, 'ap_emails'),
    // A snapshot, not a durable fact: it rides with tms_synced_at and always
    // takes the file's value, exactly like the other tms_* metrics.
    tms_open_balance: r.tms_open_balance ?? null,
  }
}

// Record the run whatever happened. Written on both paths — a failed apply that
// leaves no trace is how the last one became invisible.
//
// NOTE the column names: this table is file_name / rows_in_file / applied_by /
// summary. The previous version wrote filename / total_rows / uploaded_by /
// counts, none of which exist, so every insert failed silently inside its
// try/catch and customer_imports stayed empty even on the runs that worked.
async function recordRun({ filename, userId, plan, counts, at, status, summary }) {
  try {
    const { error } = await supabase.from('customer_imports').insert({
      file_name: filename ?? null,
      rows_in_file: plan.length,
      matched: counts?.matched ?? null,
      created: counts?.created ?? null,
      updated: counts?.matched ?? null,
      unmatched: counts?.created ?? null,
      mc_filled: counts?.mc_filled ?? null,
      applied_at: at,
      applied_by: userId ?? null,
      status,
      summary: summary || counts || {},
    })
    if (error) console.error('customer_imports record failed', error)
  } catch (e) { console.error('customer_imports record failed', e) }
}

// Apply: create the unmatched and update the matched in ONE statement, then
// record the run. Conflicts are skipped (a person resolves them). is_active is
// never touched — a customer absent from this already-filtered export has NOT
// been deactivated.
//
// ATOMICITY. Every supabase-js call is its own transaction, so the old
// create-loop → update-loop → audit sequence could (and did) fail a quarter of
// the way through and leave the database half-written with no record of it.
// There is no server-side apply function to call and this fix ships no SQL, so
// atomicity comes from making the customer write a SINGLE statement: ids are
// generated on the client for the creates, and one upsert on `id` inserts the
// new rows and updates the existing ones together. One statement is one
// transaction — it either all lands or none of it does.
//
// That means NO chunking: splitting the payload would restore exactly the
// half-written failure this is meant to remove. ~1,200 rows go in one request.
export async function applyCustomerPlan({ plan, counts, filename, userId, syncedAt }) {
  const now = syncedAt || new Date().toISOString()

  // Creates carry a client-generated id so they can ride in the same upsert as
  // the updates. Name is verbatim from the file (never the code-prefixed form),
  // except where resolving a conflict had to disambiguate it past the unique
  // name index — createName then carries the chosen one.
  const creates = plan.filter(p => p.isNew && !p.conflict)
    .map(p => ({ id: crypto.randomUUID(), name: p.createName || p.row.name, ...payloadFor(p.row, null, now) }))

  // Updates echo the EXISTING name back so the upsert's insert arm has the NOT
  // NULL column it needs; customers.name is never rewritten from this file.
  const updates = plan.filter(p => p.match && !p.conflict)
    .map(p => ({ id: p.matchId, name: p.matchName, ...payloadFor(p.row, p.match, now) }))

  const rows = [...creates, ...updates]
  if (rows.length === 0) {
    await recordRun({ filename, userId, plan, counts, at: now, status: 'applied', summary: { ...counts, note: 'nothing to write' } })
    return { created: 0, updated: 0, conflicts: plan.filter(p => p.conflict).length, mcFilled: 0, createdNames: [] }
  }

  // A duplicate id here would raise the same "cannot affect row a second time"
  // as before. buildCustomerPlan already routes those to Conflicts; this is the
  // backstop that keeps a plan built some other way from half-writing.
  const seen = new Set()
  for (const r of rows) {
    if (seen.has(r.id)) {
      const err = new Error('Two file rows resolve to the same customer. Resolve the conflicts before applying.')
      await recordRun({ filename, userId, plan, counts, at: now, status: 'failed', summary: { ...counts, error: err.message } })
      return { error: err }
    }
    seen.add(r.id)
  }

  const { error } = await supabase.from('customers').upsert(rows, { onConflict: 'id' })
  if (error) {
    await recordRun({ filename, userId, plan, counts, at: now, status: 'failed', summary: { ...counts, error: error.message } })
    return { error }
  }

  await recordRun({ filename, userId, plan, counts, at: now, status: 'applied', summary: counts })

  return {
    created: creates.length,
    updated: updates.length,
    conflicts: plan.filter(p => p.conflict).length,
    mcFilled: plan.filter(p => p.willFillMc).length,
    createdNames: creates.map(c => c.name).sort((a, b) => a.localeCompare(b)),
  }
}
