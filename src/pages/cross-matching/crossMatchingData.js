import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

// Data layer for the EFS cross-matching hub. All matching lives in the DB (the
// recon_* tables + RPCs, deployed); this file reads the views/RPCs and parses the
// EFS export client-side. Nothing here hardcodes the matcher/category rules — the
// create-target mapping is read from recon_matchers.config.

// ── date helpers (Monday-start weeks, Chicago-agnostic date math) ─────────────
export function ymd(d) {
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export function addDays(s, n) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n)
  return ymd(dt)
}
export function mondayOf(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay() // 0=Sun
  return addDays(s, dow === 0 ? -6 : -(dow - 1))
}
export function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}
export function fmtRange(start, end) {
  const f = (v) => { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—' }
  return `${f(start)} – ${f(end)}`
}
export function money(n, dp = 2) {
  const v = Number(n)
  return Number.isFinite(v) ? `$${v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}` : '—'
}

// ── reads ─────────────────────────────────────────────────────────────────────
// Weekly table. Monday-start weeks between p_from and p_to inclusive.
export async function fetchEfsWeeks(from, to) {
  const { data, error } = await supabase.rpc('recon_efs_weeks', { p_from: from, p_to: to })
  if (error) throw error
  return data || []
}

// Matcher registry — drives the category → create-target mapping. Read here so
// the UI never hardcodes which category creates a lumper vs an accessorial.
export async function fetchMatchers() {
  const { data, error } = await supabase.from('recon_matchers').select('*')
  if (error) return []
  return data || []
}
// { category → { lumper?:bool, accessorial?:{type_code} } } collapsed from every
// matcher's config->create_targets, defensively (shapes vary).
export function createTargetsFrom(matchers) {
  const map = {}
  for (const m of matchers || []) {
    const cfg = m.config || m.config_json || {}
    const targets = cfg.create_targets || cfg.createTargets
    if (!targets) continue
    for (const [cat, spec] of Object.entries(targets)) {
      const cur = map[cat] || {}
      if (spec === 'lumper' || spec?.lumper || spec?.kind === 'lumper') cur.lumper = true
      if (Array.isArray(spec)) {
        for (const s of spec) {
          if (s === 'lumper') cur.lumper = true
          else if (s === 'accessorial' || s?.kind === 'accessorial') cur.accessorial = { type_code: s?.type_code || cat }
          else if (typeof s === 'string') cur.accessorial = { type_code: s }
        }
      }
      if (spec?.accessorial || spec?.type_code || spec?.kind === 'accessorial') {
        cur.accessorial = { type_code: spec.type_code || spec.accessorial?.type_code || cat }
      }
      map[cat] = cur
    }
  }
  return map
}

// Every check for a week, read from v_efs_check_state (the UI source of truth).
export async function fetchWeekChecks(weekStart) {
  const { data, error } = await supabase.from('v_efs_check_state').select('*').eq('week_start', weekStart)
  if (error) throw error
  return data || []
}

// Is this check load-related? Prefer the generated column; fall back to the
// presence of a lumper/accessorial state.
export function checkIsLoadRelated(c) {
  const v = c?.is_load_related
  if (v != null) return !!v
  return c?.lumper_state != null || c?.accessorial_state != null
}

// The unmatched load-related checks for a week — the same set the hub's "Not
// recorded anywhere" card counts, so the Lumpers banner can't drift from it.
export async function fetchWeekUnmatchedSummary(weekStart) {
  const checks = await fetchWeekChecks(weekStart)
  const unmatched = checks.filter(c => checkIsLoadRelated(c) && c.lumper_state === 'no' && c.accessorial_state === 'no')
  const total = unmatched.reduce((s, c) => s + (Number(c.total ?? c.check_amount) || 0), 0)
  const byCat = {}
  for (const c of unmatched) { const k = c.purpose_category || 'other'; byCat[k] = (byCat[k] || 0) + 1 }
  return { weekStart, weekEnd: addDays(weekStart, 6), count: unmatched.length, total, byCat }
}

// The candidate records a `maybe` check could link to — from recon_matches for
// this check that are still suggestions.
export async function fetchCandidates(checkId) {
  const { data, error } = await supabase.from('recon_matches')
    .select('*').eq('efs_check_id', checkId)
  if (error) return []
  return (data || []).filter(m => (m.status ?? 'suggested') === 'suggested' || m.status === 'candidate')
}

// ── writes / RPCs ─────────────────────────────────────────────────────────────
export const runEfsLoadRelated = (batchId) => supabase.rpc('recon_run_efs_load_related', { batch_id: batchId })
export const reconConfirm = (matchId) => supabase.rpc('recon_confirm', { match_id: matchId })
export const reconSetStatus = (matchId, status) => supabase.rpc('recon_set_status', { match_id: matchId, status })
export const createLumperFromCheck = (checkId) => supabase.rpc('recon_create_lumper_from_check', { check_id: checkId })
export const createAccessorialFromCheck = (checkId, typeCode) => supabase.rpc('recon_create_accessorial_from_check', { check_id: checkId, type_code: typeCode })

// ── purpose → category (case-insensitive, on the trimmed string) ──────────────
// Order matters: the first hit wins. Anything unmatched is 'unclassified' —
// surfaced for a human, never dropped.
export function categorizePurpose(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'unclassified'
  const has = (...subs) => subs.some(x => s.includes(x))
  if (has('lumper')) return 'lumper'
  if (has('escort')) return 'escort_fee'
  if (has('late')) return 'late_fee'
  if (has('detention')) return 'detention'
  if (has('layover')) return 'layover'
  if (has('cash advance')) return 'cash_advance'
  if (has('tire', 'reem')) return 'tires'
  if (has('fuel', 'gas')) return 'fuel'
  if (has('park')) return 'parking'
  if (has('tow', 'roadside')) return 'towing'
  if (has('repair', 'diagnostic', 'mudflap', 'tool')) return 'repair'
  if (has('wash', 'clean')) return 'wash'
  if (has('scale', 'scalw')) return 'scale'
  return 'unclassified'
}

// ── importer ──────────────────────────────────────────────────────────────────
const cleanStr = (v) => { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s }
const toNum = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null }
function findCol(headers, cands) {
  for (const c of cands) { const k = headers.find(x => x.trim().toLowerCase() === c.trim().toLowerCase()); if (k) return k }
  return null
}
function toYmd(v) {
  const s = cleanStr(v); if (!s) return null
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (m) { let yy = m[3]; if (yy.length === 2) yy = `20${yy}`; return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` }
  return null
}
// Full timestamp if the cell carries a time, else the date at midnight — a
// date-only string is a valid timestamptz literal, so this never fails the insert.
function toTs(v, ymd) {
  const s = cleanStr(v)
  const m = s && s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (ymd && m) return `${ymd}T${String(m[1]).padStart(2, '0')}:${m[2]}:${m[3] || '00'}`
  return ymd || null
}

// Header aliases — EFS renames its export columns from time to time, so accept
// alternatives (case-insensitive, trimmed) rather than failing.
const HEADER_ALIASES = {
  money: ['Money Code', 'Code', 'Check Number', 'Check #'],
  date: ['TX Date', 'Transaction Date', 'Date', 'Issue Date', 'Check Date'],
  driver: ['Check Driver Information', 'Driver', 'Driver Name', 'Driver Information'],
  issued_to: ['Check Issued To', 'Issued To'],
  location: ['Check Location', 'Location'],
  purpose: ['Check Purpose', 'Purpose', 'Reason'],
  amount: ['Check Amount', 'Amount'],
  fee: ['Fee', 'Check Fee'],
  total: ['Total', 'Total Amount'],
  transaction_id: ['Transaction ID', 'TX ID', 'Trans ID'],
}
// The importer can't group/idempotency without these.
export const REQUIRED_FIELDS = ['money', 'date', 'purpose', 'amount']

// Parse the EFS export (xlsx or csv). `mapping` overrides the auto-detected
// columns (from the manual column-mapping step). Keeps purpose_raw UNTRIMMED and
// the whole source row; never sets is_load_related (generated in the DB).
export function parseEfsWorkbook(arrayBuffer, mapping) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  if (!raw.length) return { rows: [], errors: ['File has no rows in the first sheet.'], headers: [], missing: [] }
  const headers = Object.keys(raw[0])
  const cols = {}
  for (const f of Object.keys(HEADER_ALIASES)) cols[f] = mapping?.[f] || findCol(headers, HEADER_ALIASES[f])
  const missing = REQUIRED_FIELDS.filter(f => !cols[f])
  if (missing.length) return { rows: [], errors: [], headers, missing, cols }

  const get = (r, f) => (cols[f] ? r[cols[f]] : null)
  const rows = []
  raw.forEach((r, i) => {
    const money_code = cleanStr(get(r, 'money'))
    const rawPurpose = get(r, 'purpose')
    const purpose_raw = rawPurpose == null || String(rawPurpose).trim() === '' ? null : String(rawPurpose) // untrimmed
    if (!money_code && !purpose_raw) return
    const tx_date = toYmd(get(r, 'date'))
    rows.push({
      row_index: i,
      money_code,
      tx_date,
      tx_at: toTs(get(r, 'date'), tx_date),
      driver_name: cleanStr(get(r, 'driver')),
      issued_to: cleanStr(get(r, 'issued_to')),
      check_location: cleanStr(get(r, 'location')),
      purpose_raw,
      purpose_category: categorizePurpose(purpose_raw),
      check_amount: toNum(get(r, 'amount')),
      fee: toNum(get(r, 'fee')),
      total_amount: toNum(get(r, 'total')),
      transaction_id: cleanStr(get(r, 'transaction_id')),
      raw: r,
    })
  })
  const span = rows.map(r => r.tx_date).filter(Boolean).sort()
  return { rows, errors: [], headers, missing: [], cols, span: span.length ? { min: span[0], max: span[span.length - 1] } : null }
}

// Guard 1 — year overlap with lumper_events. No overlap → refuse (the wrong-year
// export makes every check read as missing).
export async function checkYearOverlap(span) {
  if (!span) return { ok: true }
  const [{ data: lo }, { data: hi }] = await Promise.all([
    supabase.from('lumper_events').select('event_date').order('event_date', { ascending: true }).limit(1),
    supabase.from('lumper_events').select('event_date').order('event_date', { ascending: false }).limit(1),
  ])
  const min = lo?.[0]?.event_date, max = hi?.[0]?.event_date
  if (!min || !max) return { ok: true }
  const overlaps = span.min <= String(max).slice(0, 10) && span.max >= String(min).slice(0, 10)
  return { ok: overlaps, boardMin: String(min).slice(0, 10), boardMax: String(max).slice(0, 10) }
}

// Guard 2 — transposed Purpose/Driver. Purpose reads like a roster driver AND the
// driver cell categorises as a real purpose → likely swapped.
export function detectSwaps(rows, driverNames) {
  const norm = (x) => String(x ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const roster = new Set((driverNames || []).map(norm))
  return rows.filter(r =>
    r.purpose_raw && roster.has(norm(r.purpose_raw)) &&
    r.driver_name && categorizePurpose(r.driver_name) !== 'unclassified'
  ).map(r => r.row_index)
}
export function applySwaps(rows, indices) {
  const set = new Set(indices)
  return rows.map(r => set.has(r.row_index)
    ? { ...r, driver_name: r.purpose_raw, purpose_raw: r.driver_name, purpose_category: categorizePurpose(r.driver_name), fields_swapped: true }
    : r)
}

// Guard 3 — fee sanity: every fee should be $2 and total = amount + fee.
export function feeSanity(rows) {
  return rows.filter(r => r.check_amount != null && r.total_amount != null && r.fee != null &&
    Math.abs((r.check_amount + r.fee) - r.total_amount) > 0.005).map(r => r.row_index)
}

export async function fetchRosterDriverNames() {
  const { data } = await supabase.from('drivers').select('full_name')
  return (data || []).map(d => d.full_name).filter(Boolean)
}

// Apply the import: record the batch, upsert checks (idempotent on money_code),
// backfill the batch's imported/skipped counts, then recompute matches. Column
// names are the authoritative recon_batches / efs_checks schema; is_load_related
// is generated and never sent. imported_by defaults to auth.uid() server-side.
export async function applyEfsImport({ rows, filename, span }) {
  const payload = rows.filter(r => r.money_code).map(r => ({
    money_code: r.money_code,
    tx_at: r.tx_at,
    tx_date: r.tx_date,
    driver_name: r.driver_name,
    issued_to: r.issued_to,
    check_location: r.check_location,
    purpose_raw: r.purpose_raw,
    purpose_category: r.purpose_category,
    check_amount: r.check_amount,
    fee: r.fee,
    total_amount: r.total_amount,
    transaction_id: r.transaction_id ?? null,
    fields_swapped: !!r.fields_swapped,
    raw: r.raw,
  }))

  const { data: batch, error: bErr } = await supabase.from('recon_batches')
    .insert({
      source_key: 'efs_checks',
      filename: filename ?? null,
      period_start: span?.min ?? null,
      period_end: span?.max ?? null,
      row_count: rows.length,
    }).select('id').single()
  if (bErr) return { error: bErr }
  const batchId = batch.id

  // Upsert with batch_id; ignoreDuplicates → .select() returns only rows actually
  // inserted, so skipped = total − inserted.
  let inserted = 0
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200).map(p => ({ ...p, batch_id: batchId }))
    const { data, error } = await supabase.from('efs_checks')
      .upsert(chunk, { onConflict: 'money_code', ignoreDuplicates: true }).select('money_code')
    if (error) return { error, batchId }
    inserted += (data || []).length
  }
  const skipped = payload.length - inserted
  await supabase.from('recon_batches').update({ imported_count: inserted, skipped_count: skipped }).eq('id', batchId)

  const { data: runData, error: runErr } = await runEfsLoadRelated(batchId)
  if (runErr) return { error: runErr, batchId }
  return { batchId, imported: inserted, skipped, run: runData }
}
