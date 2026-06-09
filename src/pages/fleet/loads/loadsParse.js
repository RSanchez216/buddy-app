import * as XLSX from 'xlsx'

// Loads ingest — Phase 2 parse layer. Reads the TMS "All Loads" export
// (one row per load-leg), maps columns by header NAME (tolerating the
// older 21-col file that lacks Truck #/notes — missing → null), and
// coerces numbers/dates. Pure: no DB, no React. Entity resolution and
// diffing live in loadsPlan.js.

// ── normalizers (shared with loadsPlan.js) ──────────────────────────────
// normName: lower, trim, collapse internal whitespace. For people/company
// names (driver, customer, dispatcher, carrier).
export function normName(s) {
  if (s == null) return ''
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim()
}
// Drop a trailing "(nickname)" so "Jose Ramirez (Pepe)" matches "Jose Ramirez".
export function stripNickname(s) {
  if (s == null) return ''
  return String(s).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
}
// normUnit: strip a leading '#' and all non-alphanumerics, uppercase. For
// truck/trailer unit numbers ("#SN66 9631" → "SN669631").
export function normUnit(s) {
  if (s == null) return ''
  return String(s).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function cleanStr(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function toNum(v) {
  if (v == null || v === '') return null
  // Tolerate "$1,500.00", "1 234", stray spaces.
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
function toInt(v) {
  const n = toNum(v)
  return n == null ? null : Math.trunc(n)
}

// Find a header column case-insensitively, tolerating whitespace.
function findCol(row, candidates) {
  const keys = Object.keys(row)
  for (const cand of candidates) {
    const k = keys.find(x => x.trim().toLowerCase() === cand.trim().toLowerCase())
    if (k) return k
  }
  return null
}

// PU/DEL info looks like "City, ST, US (TZ) MM-DD-YYYY HH:MM HH:MM"
// (city/tz sometimes absent). Extract the first MM-DD-YYYY token → ISO
// 'YYYY-MM-DD'. No date found → null. The full raw string is stored
// separately, so this only feeds pickup_date/delivery_date.
export function parseInfoDate(info) {
  if (!info) return null
  const m = String(info).match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  const month = String(mm).padStart(2, '0')
  const day = String(dd).padStart(2, '0')
  // Guard against nonsense tokens.
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null
  return `${yyyy}-${month}-${day}`
}

// ArrayBuffer → { rows: Array<RawLegRow>, errors }. Each RawLegRow keeps
// the original cell map (raw) plus parsed scalar fields. Header vs leg
// split + grouping happens in loadsPlan.js.
export function parseLoadsWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

  const errors = []
  if (raw.length === 0) return { rows: [], errors: ['Workbook contains no rows in the first sheet.'] }

  const sample = raw[0]
  const cols = {
    loadNumber:   findCol(sample, ['#', 'Load #', 'Load Number']),
    dispatcher:   findCol(sample, ['Dispatcher']),
    customer:     findCol(sample, ['Customer']),
    customerLoad: findCol(sample, ['Customer Load #', 'Customer Load Number']),
    status:       findCol(sample, ['Status']),
    loadType:     findCol(sample, ['Load Type']),
    driver:       findCol(sample, ['Driver']),
    trailer:      findCol(sample, ['Trailer #', 'Trailer']),
    picks:        findCol(sample, ['# of Picks', 'Picks']),
    puInfo:       findCol(sample, ['PU Info', 'PU info']),
    drops:        findCol(sample, ['# of Drops', 'Drops']),
    delInfo:      findCol(sample, ['DEL Info', 'Del Info', 'DEL info']),
    linehaul:     findCol(sample, ['Linehaul']),
    emptyMiles:   findCol(sample, ['Empty Miles']),
    loadedMiles:  findCol(sample, ['Loaded Miles']),
    totalMiles:   findCol(sample, ['Total Miles']),
    weight:       findCol(sample, ['Weight']),
    commodity:    findCol(sample, ['Commodity']),
    truck:        findCol(sample, ['Truck #', 'Truck']),
    carrier:      findCol(sample, ['Carrier']),
    loadNotes:    findCol(sample, ['Load Notes']),
    loadInstr:    findCol(sample, ['Load Instructions']),
    invoiceNotes: findCol(sample, ['Invoice Notes']),
  }

  if (!cols.loadNumber || !cols.driver) {
    errors.push(`Missing required columns. Expected "#" (load number) and "Driver"; found: ${Object.keys(sample).join(', ')}`)
    return { rows: [], errors }
  }

  const rows = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    const loadNumber = cleanStr(r[cols.loadNumber])
    const driverRaw = cleanStr(r[cols.driver])
    // A leg must have a load number and a driver; skip blank spacer rows.
    if (!loadNumber || !driverRaw) continue

    const puInfo = cleanStr(r[cols.puInfo])
    const delInfo = cleanStr(r[cols.delInfo])
    rows.push({
      row_index: i,
      raw: r,
      // ── header-scope (taken once per load in loadsPlan) ──
      load_number: loadNumber,
      customer_load_number: cleanStr(r[cols.customerLoad]),
      customer_raw:   cleanStr(r[cols.customer]),
      dispatcher_raw: cleanStr(r[cols.dispatcher]),
      carrier_raw:    cleanStr(r[cols.carrier]),
      status:    cleanStr(r[cols.status]),
      load_type: cleanStr(r[cols.loadType]),
      num_picks: toInt(r[cols.picks]),
      num_drops: toInt(r[cols.drops]),
      pu_info:  puInfo,
      del_info: delInfo,
      pickup_date:   parseInfoDate(puInfo),
      delivery_date: parseInfoDate(delInfo),
      linehaul:  toNum(r[cols.linehaul]),
      weight:    toNum(r[cols.weight]),
      commodity: cleanStr(r[cols.commodity]),
      load_notes:        cleanStr(r[cols.loadNotes]),
      load_instructions: cleanStr(r[cols.loadInstr]),
      invoice_notes:     cleanStr(r[cols.invoiceNotes]),
      // ── leg-scope ──
      driver_raw:  driverRaw,
      truck_raw:   cleanStr(r[cols.truck]),
      trailer_raw: cleanStr(r[cols.trailer]),
      empty_miles:  toNum(r[cols.emptyMiles]),
      loaded_miles: toNum(r[cols.loadedMiles]),
      total_miles:  toNum(r[cols.totalMiles]),
    })
  }

  if (rows.length === 0) errors.push('No rows with both a load number and a driver were found.')
  return { rows, errors }
}
