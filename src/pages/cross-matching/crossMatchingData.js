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
function findCol(row, cands) {
  const keys = Object.keys(row)
  for (const c of cands) { const k = keys.find(x => x.trim().toLowerCase() === c.trim().toLowerCase()); if (k) return k }
  return null
}
function toYmd(v) {
  const s = cleanStr(v); if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (m) { let yy = m[3]; if (yy.length === 2) yy = `20${yy}`; return `${yy}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` }
  return null
}

// Parse the EFS export → normalized check rows. Keeps purpose_raw + the whole
// original row; never sets is_load_related (generated in the DB).
export function parseEfsWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
  if (!raw.length) return { rows: [], errors: ['Workbook has no rows in the first sheet.'] }
  const s = raw[0]
  const cols = {
    money: findCol(s, ['Money Code', 'Check Number', 'Check #', 'Money code', 'Card Number']),
    date: findCol(s, ['Date', 'Issue Date', 'Transaction Date', 'Check Date']),
    driver: findCol(s, ['Check Driver Information', 'Driver', 'Driver Information', 'Driver Name']),
    purpose: findCol(s, ['Check Purpose', 'Purpose', 'Reason']),
    amount: findCol(s, ['Check Amount', 'Amount']),
    fee: findCol(s, ['Fee', 'Check Fee']),
    total: findCol(s, ['Total', 'Total Amount']),
  }
  const rows = []
  raw.forEach((r, i) => {
    const money_code = cleanStr(cols.money && r[cols.money])
    const purpose_raw = cleanStr(cols.purpose && r[cols.purpose])
    if (!money_code && !purpose_raw) return
    rows.push({
      row_index: i,
      money_code,
      event_date: cols.date ? toYmd(r[cols.date]) : null,
      driver: cleanStr(cols.driver && r[cols.driver]),
      purpose_raw,
      purpose_category: categorizePurpose(purpose_raw),
      check_amount: cols.amount ? toNum(r[cols.amount]) : null,
      fee: cols.fee ? toNum(r[cols.fee]) : null,
      total: cols.total ? toNum(r[cols.total]) : null,
      raw: r,
    })
  })
  const span = rows.map(r => r.event_date).filter(Boolean).sort()
  return { rows, errors: [], span: span.length ? { min: span[0], max: span[span.length - 1] } : null }
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
    r.driver && categorizePurpose(r.driver) !== 'unclassified'
  ).map(r => r.row_index)
}
export function applySwaps(rows, indices) {
  const set = new Set(indices)
  return rows.map(r => set.has(r.row_index)
    ? { ...r, driver: r.purpose_raw, purpose_raw: r.driver, purpose_category: categorizePurpose(r.driver), fields_swapped: true }
    : r)
}

// Guard 3 — fee sanity: every fee should be $2 and total = amount + fee.
export function feeSanity(rows) {
  return rows.filter(r => r.check_amount != null && r.total != null && r.fee != null &&
    Math.abs((r.check_amount + r.fee) - r.total) > 0.005).map(r => r.row_index)
}

export async function fetchRosterDriverNames() {
  const { data } = await supabase.from('drivers').select('full_name')
  return (data || []).map(d => d.full_name).filter(Boolean)
}

// Apply the import: record the batch, upsert checks (idempotent on money_code),
// then recompute matches. Nothing sets is_load_related.
export async function applyEfsImport({ rows, filename, userId }) {
  const { data: batch, error: bErr } = await supabase.from('recon_batches')
    .insert({ source: 'efs_import', filename: filename ?? null, uploaded_by: userId ?? null, row_count: rows.length })
    .select('id').single()
  if (bErr) return { error: bErr }
  const batchId = batch.id
  const payload = rows.filter(r => r.money_code).map(r => ({
    batch_id: batchId,
    money_code: r.money_code,
    event_date: r.event_date,
    driver: r.driver,
    purpose_raw: r.purpose_raw,
    purpose_category: r.purpose_category,
    check_amount: r.check_amount,
    fee: r.fee,
    total: r.total,
    fields_swapped: !!r.fields_swapped,
    raw: r.raw,
  }))
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from('efs_checks')
      .upsert(payload.slice(i, i + 200), { onConflict: 'money_code', ignoreDuplicates: true })
    if (error) return { error, batchId }
  }
  const { error: runErr } = await runEfsLoadRelated(batchId)
  if (runErr) return { error: runErr, batchId }
  return { batchId, imported: payload.length }
}
