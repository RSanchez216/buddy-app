import * as XLSX from 'xlsx'

// Parser for the TMS "Customers" export. Pure — no DB. Mirrors the loads
// importer's parse (SheetJS + header-name column mapping), then splits the TMS
// short-code prefix out of the name.

const cleanStr = (v) => {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
const toNum = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, '')) // tolerate "$1,500.00", "1 234"
  return Number.isFinite(n) ? n : null
}
const toInt = (v) => {
  const n = toNum(v)
  return n == null ? null : Math.trunc(n)
}

// lower, trim, collapse internal whitespace — the name match key, kept aligned
// with the loads importer's normName so both resolve a customer the same way.
export const normName = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

// Find a header column case-insensitively, tolerating whitespace.
function findCol(row, candidates) {
  const keys = Object.keys(row)
  for (const cand of candidates) {
    const k = keys.find(x => x.trim().toLowerCase() === cand.trim().toLowerCase())
    if (k) return k
  }
  return null
}

// Split "ET  Evans Transportation Services, Inc." → { tms_code:'ET', name:'Evans…' }.
// A short code (≤3 chars) followed by a run of TWO OR MORE spaces, then the real
// name. "C.H. Robinson Worldwide Inc" (single spaces) → { tms_code:null, name:as-is }.
// The bare name is what goes into customers.name so it keeps matching the loads
// importer; the prefixed form is never stored there.
export function splitTmsName(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { tms_code: null, name: '' }
  const m = s.match(/^(\S{1,3})\s{2,}(.+)$/)
  if (m) return { tms_code: m[1].trim(), name: m[2].trim() }
  return { tms_code: null, name: s }
}

// Best-effort date → 'YYYY-MM-DD'. Excel dates arrive as strings (raw:false).
// Covers the export's MM-DD-YYYY Setup Date as well as MM/DD/YYYY and ISO. A
// blank or unparseable cell returns null — never an epoch date, which would read
// as a real 1970 setup.
function toYmd(v) {
  const s = cleanStr(v)
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  return null
}

// Yes/No → boolean. Anything unrecognised (including blank) stays null rather
// than defaulting to false: "we don't know" and "not on hold" are different, and
// only the latter should ever clear an existing hold.
function toBool(v) {
  const s = cleanStr(v)
  if (!s) return null
  const t = s.toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(t)) return true
  if (['no', 'n', 'false', '0'].includes(t)) return false
  return null
}

// Zip stays TEXT and is never run through toNum — 07094 must not become 7094.
// Also strips a trailing '.0' from a cell Excel decided was numeric.
function toZip(v) {
  const s = cleanStr(v)
  if (!s) return null
  return s.replace(/\.0+$/, '')
}

// ArrayBuffer → { rows, errors, cols }. Account Manager / Capacity Manager / CI
// Contact are intentionally not mapped — they're empty across the export.
export function parseCustomersWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

  const errors = []
  if (raw.length === 0) return { rows: [], errors: ['Workbook contains no rows in the first sheet.'], cols: {} }

  const sample = raw[0]
  const cols = {
    name:        findCol(sample, ['Name']),
    status:      findCol(sample, ['Status']),
    mc:          findCol(sample, ['MC', 'MC Number', 'MC #']),
    phone:       findCol(sample, ['Phone']),
    country:     findCol(sample, ['Country']),
    state:       findCol(sample, ['State']),
    city:        findCol(sample, ['City']),
    email:       findCol(sample, ['Email']),
    creditLimit: findCol(sample, ['Credit Limit']),
    salesYtd:    findCol(sample, ['Sales this year', 'Sales YTD']),
    loadsYtd:    findCol(sample, ['Loads this year', 'Loads YTD']),
    lastLoad:    findCol(sample, ['Last Active Load', 'Last Load']),
    // The 27-column export. Every one is optional: findCol returns null on the
    // older 15-column file and each field then parses to null, so the old export
    // still imports without error.
    creditHold:  findCol(sample, ['Credit hold', 'Credit Hold']),
    address:     findCol(sample, ['Address']),
    street1:     findCol(sample, ['Street 1', 'Street1']),
    street2:     findCol(sample, ['Street 2', 'Street2']),
    zip:         findCol(sample, ['Zip Code', 'Zip', 'Postal Code']),
    setupDate:   findCol(sample, ['Setup Date']),
    billingPref: findCol(sample, ['Billing Preference']),
    paymentTerms: findCol(sample, ['Payment Terms']),
    apPhone:     findCol(sample, ['AP phone', 'AP Phone']),
    // The INVOICE address. Never the POD/BOL desk — that comes from the rate
    // confirmation and lives in observed pod_emails. Four of eleven top brokers
    // route them to different departments.
    apEmails:    findCol(sample, ['AP Emails', 'AP Email']),
    openBalance: findCol(sample, ['Open balance', 'Open Balance']),
  }
  if (!cols.name) return { rows: [], errors: ['No "Name" column found in the first sheet.'], cols }

  const get = (r, col) => (col ? cleanStr(r[col]) : null)
  const rows = []
  raw.forEach((r, i) => {
    const rawName = get(r, cols.name)
    if (!rawName) return // skip blank rows
    const { tms_code, name } = splitTmsName(rawName)
    rows.push({
      row_index: i,
      raw_name: rawName,
      name,
      tms_code,
      mc_number: get(r, cols.mc),
      phone: get(r, cols.phone),
      email: get(r, cols.email),
      city: get(r, cols.city),
      state: get(r, cols.state),
      country: get(r, cols.country),
      credit_limit: cols.creditLimit ? toNum(r[cols.creditLimit]) : null,
      tms_status: get(r, cols.status),
      tms_loads_ytd: cols.loadsYtd ? toInt(r[cols.loadsYtd]) : null,
      tms_sales_ytd: cols.salesYtd ? toNum(r[cols.salesYtd]) : null,
      tms_last_load_date: cols.lastLoad ? toYmd(r[cols.lastLoad]) : null,
      // ── 27-column export ──
      credit_hold: cols.creditHold ? toBool(r[cols.creditHold]) : null,
      address: get(r, cols.address),
      street1: get(r, cols.street1),
      street2: get(r, cols.street2),
      zip_code: cols.zip ? toZip(r[cols.zip]) : null,
      setup_date: cols.setupDate ? toYmd(r[cols.setupDate]) : null,
      billing_preference: get(r, cols.billingPref),
      payment_terms: get(r, cols.paymentTerms),
      ap_phone: get(r, cols.apPhone),
      ap_emails: get(r, cols.apEmails),
      tms_open_balance: cols.openBalance ? toNum(r[cols.openBalance]) : null,
    })
  })
  return { rows, errors, cols }
}
