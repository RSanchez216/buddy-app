// Excel parsing for the Trucks / Trailers TMS exports.
// Pure functions; no DB calls here — the modal hydrates a drivers list
// once and passes it down for resolveDriverId().

import * as XLSX from 'xlsx'

const VALID_TRAILER_TYPES = new Set(['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Conestoga', 'Other'])

const TRAILER_TYPE_MAP = {
  'dry van':    'Dry Van',
  'dryvan':     'Dry Van',
  'reefer':     'Reefer',
  'reefers':    'Reefer',
  'flatbed':    'Flatbed',
  'flat bed':   'Flatbed',
  'step deck':  'Step Deck',
  'step-deck':  'Step Deck',
  'stepdeck':   'Step Deck',
  'conestoga':  'Conestoga',
}

export function normalizeTrailerType(raw) {
  if (!raw) return null
  const k = String(raw).trim().toLowerCase()
  if (!k) return null
  return TRAILER_TYPE_MAP[k] || (VALID_TRAILER_TYPES.has(raw) ? raw : 'Other')
}

// Trucks plate format: "P1148666 - (IL)"
// Trailers plate format is messy:
//   "904508 IL"      → plate=904508, state=IL
//   "1019706ST"      → plate=1019706ST, state=null (no recognizable 2-letter trailing state)
//   "890422 st IL"   → plate=890422 st, state=IL  (last whitespace-separated 2-letter token = state)
//   raw garbage      → plate=raw, state=null
export function parseLicense(raw, isTrailer) {
  if (!raw) return { plate: null, state: null }
  const s = String(raw).trim()
  if (!s) return { plate: null, state: null }

  // Truck format
  if (!isTrailer) {
    const m = s.match(/^(.+?)\s*-\s*\(([A-Z]{2})\)\s*$/i)
    if (m) return { plate: m[1].trim(), state: m[2].toUpperCase() }
    // Fallback: store whole string, no state
    return { plate: s, state: null }
  }

  // Trailer format — try "<plate> <2-letter state>" as the final tokens
  const tailMatch = s.match(/^(.+?)\s+([A-Z]{2})\s*$/i)
  if (tailMatch) return { plate: tailMatch[1].trim(), state: tailMatch[2].toUpperCase() }
  return { plate: s, state: null }
}

// Excel date arrives as "03-04-2026" (MM-DD-YYYY). Return ISO date string or null.
export function parseExcelDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null

  // MM-DD-YYYY or M-D-YYYY
  let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    const iso = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
    const d = new Date(`${iso}T00:00:00`)
    if (Number.isNaN(d.getTime())) return null
    // Sanity: month 1-12, day 1-31
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null
    return iso
  }

  // ISO date already (defensive)
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return s

  // MM/DD/YYYY fallback
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    const iso = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
    const d = new Date(`${iso}T00:00:00`)
    if (Number.isNaN(d.getTime())) return null
    return iso
  }

  return null
}

export function parseYear(raw) {
  if (raw == null || raw === '') return null
  const n = parseInt(String(raw).trim(), 10)
  if (Number.isNaN(n)) return null
  if (n < 1990 || n > 2030) return null
  return n
}

// Driver field patterns:
//   Trucks:   "#1976 - Selegen Sedesa"   or   "-"   or   ""
//   Trailers: "Spencer Jonassaint"       or   ""
// Always preserves the raw string in driver_assignment_raw (caller's job).
// Returns { driverId, matchedBy } — matchedBy ∈ {'internal_id','full_name','none'}
export function resolveDriverId(rawDriverString, allDrivers) {
  if (!rawDriverString) return { driverId: null, matchedBy: 'none' }
  const s = String(rawDriverString).trim()
  if (!s || s === '-') return { driverId: null, matchedBy: 'none' }

  // Internal-id match: leading optional # + digits
  const hashMatch = s.match(/^#?(\d+)/)
  if (hashMatch) {
    const internalId = hashMatch[1]
    const found = allDrivers.find(d => String(d.internal_id ?? '').trim() === internalId)
    if (found) return { driverId: found.id, matchedBy: 'internal_id' }
  }

  // Strip "#1976 - " prefix and "(BAIKOZU)" suffix, then full-name compare
  const nameOnly = s
    .replace(/^#?\d+\s*-?\s*/, '')
    .replace(/\s*\([^)]*\)\s*/g, '')
    .trim()
    .toLowerCase()
  if (!nameOnly) return { driverId: null, matchedBy: 'none' }
  const found = allDrivers.find(d => (d.full_name || '').trim().toLowerCase() === nameOnly)
  if (found) return { driverId: found.id, matchedBy: 'full_name' }

  return { driverId: null, matchedBy: 'none' }
}

// Find a header column case-insensitively, tolerating whitespace differences.
function findCol(row, candidates) {
  const keys = Object.keys(row)
  for (const cand of candidates) {
    const k = keys.find(x => x.trim().toLowerCase() === cand.trim().toLowerCase())
    if (k) return k
  }
  return null
}

function cleanStr(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function cleanVin(v) {
  if (v == null) return null
  const s = String(v).trim().toUpperCase()
  return s === '' ? null : s
}

// Top-level: ArrayBuffer → { kind, rows: Array<RawRow>, errors }
// kind ∈ {'truck','trailer'} (caller passes hint based on which page launched the modal)
export function parseFleetWorkbook(arrayBuffer, kind, allDrivers) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

  const rows = []
  const errors = []

  if (raw.length === 0) {
    return { kind, rows, errors: ['Workbook contains no rows in the first sheet.'] }
  }

  const sample = raw[0]
  const isTrailer = kind === 'trailer'

  // Resolve column keys once
  const cols = {
    unit:    findCol(sample, isTrailer ? ['Unit ID', 'Unit ID#', 'Unit'] : ['Unit ID#', 'Unit ID', 'Unit']),
    status:  findCol(sample, ['Status']),
    owner:   findCol(sample, ['Equipment Owner']),
    driver:  findCol(sample, ['Driver']),
    year:    findCol(sample, ['Year']),
    make:    findCol(sample, ['Make']),
    model:   findCol(sample, ['Model']),
    vin:     findCol(sample, ['Vin', 'VIN']),
    license: findCol(sample, isTrailer ? ['License Plate', 'License plate'] : ['License plate (State)', 'License Plate (State)']),
    transponder: findCol(sample, ['Transponder']),
    lessee:  findCol(sample, ['Lessee']),
    trailerType: findCol(sample, ['Trailer Type']),
    inspExp: findCol(sample, ['Annual Inspection Expiration Date', 'Annual Inspection Expiration']),
  }

  if (!cols.unit || !cols.vin) {
    errors.push(`Missing required columns. Expected "${isTrailer ? 'Unit ID' : 'Unit ID#'}" and "Vin"; found: ${Object.keys(sample).join(', ')}`)
    return { kind, rows, errors }
  }

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    const rowNum = i + 2 // 1-indexed + header

    const vin = cleanVin(r[cols.vin])
    const unit_number = cleanStr(r[cols.unit])
    if (!vin && !unit_number) continue // truly empty row — skip silently

    if (!vin) {
      errors.push(`Row ${rowNum}: missing VIN (skipped).`)
      continue
    }
    if (!unit_number) {
      errors.push(`Row ${rowNum}: missing Unit # (skipped).`)
      continue
    }

    const rawDriver = cleanStr(cols.driver ? r[cols.driver] : null)
    const driverResolved = resolveDriverId(rawDriver, allDrivers)
    const license = parseLicense(cols.license ? r[cols.license] : null, isTrailer)

    const out = {
      _rowNum: rowNum,
      unit_number,
      vin,
      status: cleanStr(cols.status ? r[cols.status] : null),
      equipment_owner_raw: cleanStr(cols.owner ? r[cols.owner] : null),
      driver_assignment_raw: rawDriver,
      driver_id: driverResolved.driverId,
      driver_match_kind: driverResolved.matchedBy,
      year: parseYear(cols.year ? r[cols.year] : null),
      make: cleanStr(cols.make ? r[cols.make] : null),
      model: cleanStr(cols.model ? r[cols.model] : null),
      license_plate: license.plate,
      license_state: license.state,
      transponder: cleanStr(cols.transponder ? r[cols.transponder] : null),
      lessee: cleanStr(cols.lessee ? r[cols.lessee] : null),
    }
    if (isTrailer) {
      out.trailer_type = normalizeTrailerType(cols.trailerType ? r[cols.trailerType] : null)
      out.annual_inspection_expiration_date = parseExcelDate(cols.inspExp ? r[cols.inspExp] : null)
      if (cols.inspExp && r[cols.inspExp] && !out.annual_inspection_expiration_date) {
        errors.push(`Row ${rowNum}: unparseable inspection date "${r[cols.inspExp]}" — left blank.`)
      }
    }
    rows.push(out)
  }

  return { kind, rows, errors }
}
