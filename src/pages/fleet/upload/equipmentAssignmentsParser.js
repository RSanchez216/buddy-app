// Parser for the TMS Equipment Assignments export (trucks + trailers).
// One row = one (equipment, driver, start_date) event. Blank End Date = open.
// The same parser handles both files since the column set is identical; the
// caller passes equipmentType ('truck' | 'trailer') so we can stamp it on each
// row for the unified equipment_assignments table.
//
// Pure functions, no DB. Matching against trucks / trailers / drivers happens
// in equipmentAssignmentsMatcher.js after the modal hydrates the lookup sets.

import * as XLSX from 'xlsx'

// Strip leading "#" / whitespace, uppercase, drop spaces. Used on both the
// upload's Equipment Name and the BUDDY trucks/trailers.unit_number for
// case- and prefix-insensitive matching. The TMS export omits the leading
// "#" but the in-app unit_number sometimes carries one historically.
export function normalizeUnitNumber(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  return s.replace(/^#+/, '').replace(/\s+/g, '').toUpperCase()
}

// Excel dates from this TMS export arrive as MM/DD/YYYY (some rows MM-DD-YYYY).
// Blank string → null (the upload uses blank End Date to mean "currently open").
export function parseAssignmentDate(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null

  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
  }
  // Defensive: ISO already
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return s
  return null
}

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

// Open-assignment sentinels seen in the TMS export. Blank is the canonical
// form but "N/A" is common, and a handful of one-offs ("-", "—", "none",
// "null", "open") show up across operators / source systems. All are
// treated as "currently open" with no warning. Anything else that fails
// to parse as a date IS a warning — that's the signal we want left in
// the panel after this change.
const OPEN_END_SENTINELS = new Set(['', 'n/a', 'na', '-', '—', 'none', 'null', 'open'])

function isOpenEndDateSentinel(raw) {
  if (raw == null) return true
  return OPEN_END_SENTINELS.has(String(raw).trim().toLowerCase())
}

function parseTmsId(v) {
  const s = cleanStr(v)
  if (!s) return null
  // TMS Equipment IDs are integers; defensive parse so the upsert's bigint
  // column doesn't choke on a stray non-numeric value.
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

// ArrayBuffer → { rows, errors }. equipmentType is stamped on each row so
// the caller can pass the result straight into the matcher / commit.
export function parseEquipmentAssignmentsWorkbook(arrayBuffer, equipmentType) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

  const rows = []
  const errors = []
  if (raw.length === 0) return { rows, errors: ['Workbook contains no rows in the first sheet.'] }

  const sample = raw[0]
  const cols = {
    equipmentId:   findCol(sample, ['Equipment ID', 'Equipment Id', 'EquipmentID']),
    equipmentName: findCol(sample, ['Equipment Name', 'Equipment', 'Unit', 'Unit #']),
    driverName:    findCol(sample, ['Driver Full Name', 'Driver Name', 'Driver']),
    driverId:      findCol(sample, ['Driver ID', 'Driver Id', 'DriverID']),
    startDate:     findCol(sample, ['Start Date', 'Start', 'Assignment Start']),
    endDate:       findCol(sample, ['End Date', 'End', 'Assignment End']),
    createdBy:     findCol(sample, ['Created By', 'CreatedBy']),
  }

  if (!cols.equipmentId || !cols.equipmentName || !cols.startDate) {
    errors.push(
      'Missing required columns. Expected "Equipment ID", "Equipment Name", and "Start Date"; '
      + `found: ${Object.keys(sample).join(', ')}`
    )
    return { rows, errors }
  }

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    const rowNum = i + 2 // header is row 1, so first data row is 2

    const tmsEquipmentId = parseTmsId(r[cols.equipmentId])
    const equipmentNameRaw = cleanStr(r[cols.equipmentName])
    const startDate = parseAssignmentDate(r[cols.startDate])

    // Skip fully blank rows silently; flag partial rows.
    if (tmsEquipmentId == null && !equipmentNameRaw && !startDate) continue
    if (!equipmentNameRaw) { errors.push(`Row ${rowNum}: missing Equipment Name — skipped.`); continue }
    if (!startDate)        { errors.push(`Row ${rowNum}: invalid Start Date "${r[cols.startDate]}" — skipped.`); continue }

    const endRaw = cols.endDate ? r[cols.endDate] : null
    // Blank / N/A / dash / "open" etc. all mean "currently open" — no
    // warning. Only flag values that are non-sentinel AND fail date
    // parsing, since those are genuinely unparseable.
    let endDate = null
    if (!isOpenEndDateSentinel(endRaw)) {
      endDate = parseAssignmentDate(endRaw)
      if (!endDate) {
        errors.push(`Row ${rowNum}: unrecognized End Date "${endRaw}" — treating as currently open.`)
      }
    }

    const tmsDriverId = cleanStr(cols.driverId ? r[cols.driverId] : null)
    const driverNameRaw = cleanStr(cols.driverName ? r[cols.driverName] : null)

    rows.push({
      _rowNum: rowNum,
      equipment_type: equipmentType,
      tms_equipment_id: tmsEquipmentId,
      equipment_name_raw: equipmentNameRaw,
      tms_driver_id: tmsDriverId,
      driver_name_raw: driverNameRaw,
      start_date: startDate,
      end_date: endDate,
      created_by_raw: cleanStr(cols.createdBy ? r[cols.createdBy] : null),
    })
  }

  return { rows, errors }
}
