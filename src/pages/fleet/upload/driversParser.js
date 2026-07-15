// Excel parsing for the Drivers TMS export. Pure functions, no DB calls.

import * as XLSX from 'xlsx'

export function parseInternalId(raw) {
  if (!raw) return null
  const m = String(raw).match(/#(\d+)/)
  return m ? m[1] : null
}

// "12% SERVICE CHARGE" / "$0.65 RATE" / "30% RATE" / "$2000 FLAT RATE"
export function parseCompensation(raw) {
  if (!raw) return { type: null, value: null }
  const trimmed = String(raw).trim()
  if (!trimmed) return { type: null, value: null }

  // Flat rate — a fixed weekly salary, independent of gross or miles. Checked
  // first (whole-string match) so any phrasing ("$2,000 FLAT RATE",
  // "FLAT RATE - $2000/wk") is recognized before the per-mile/percent patterns.
  if (/flat\s*rate/i.test(trimmed)) {
    const amt = trimmed.match(/\$?\s*([\d,]+(?:\.\d+)?)/)
    if (amt) return { type: 'flat_rate', value: parseFloat(amt[1].replace(/,/g, '')) }
    // "flat rate" with no readable amount stays unparsed → a warning below.
    return { type: null, value: null }
  }

  const perMile = trimmed.match(/^\$([\d.]+)\s*RATE/i)
  if (perMile) return { type: 'rate_per_mile', value: parseFloat(perMile[1]) }

  const service = trimmed.match(/^([\d.]+)%\s*SERVICE\s*CHARGE/i)
  if (service) return { type: 'service_charge_pct', value: parseFloat(service[1]) }

  const ratePct = trimmed.match(/^([\d.]+)%\s*RATE/i)
  if (ratePct) return { type: 'rate_pct', value: parseFloat(ratePct[1]) }

  return { type: null, value: null }
}

// TMS "Status" → drivers.current_status (CHECK-constrained vocabulary). Case-
// and separator-insensitive so "Pre-Hire", "Prehire", "pre hire" all collapse
// to pre_hire. Blank/unrecognized falls back to 'active' with recognized=false
// so the caller can surface it (never silently swallow an unknown status).
// Only ever returns a value from the CHECK list, or the insert would be rejected.
const TMS_STATUS_MAP = {
  active: 'active',
  suspended: 'suspended',
  terminated: 'terminated',
  prehire: 'pre_hire',
  inactive: 'inactive',
}
export function mapTmsStatus(raw) {
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  const mapped = TMS_STATUS_MAP[key]
  return mapped ? { status: mapped, recognized: true } : { status: 'active', recognized: false }
}

// TMS calendar date "MM-DD-YYYY" → ISO "YYYY-MM-DD", built from the parts with
// NO Date object and NO timezone round-trip (that's the off-by-one trap that
// hit the assignment importer). Tolerates a trailing time token. Unrecognized
// format → null.
export function parseTmsDateToISO(raw) {
  if (!raw) return null
  const datePart = String(raw).trim().split(' ')[0]
  const m = datePart.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

export function normalizeDriverType(raw) {
  const lower = String(raw || '').toLowerCase().trim()
  if (!lower) return null
  if (lower.includes('owner operator') || lower === 'owner-op' || lower === 'owner op') return 'Owner Operator'
  if (lower.includes('leased') || (lower.includes('owner') && lower.includes('-'))) return 'Leased Owner-Op'
  if (lower.includes('contract')) return 'Contract Driver'
  if (lower.includes('company')) return 'Company Driver'
  return null
}

// "04-23-2026 15:45:54" → "2026-04-23"
export function parseOnboardedAt(raw) {
  if (!raw) return null
  const datePart = String(raw).split(' ')[0]
  let m = datePart.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    const iso = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
    const d = new Date(`${iso}T00:00:00`)
    return Number.isNaN(d.getTime()) ? null : iso
  }
  m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return datePart
  m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    const iso = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
    const d = new Date(`${iso}T00:00:00`)
    return Number.isNaN(d.getTime()) ? null : iso
  }
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

// Email-specific normalization. cleanStr handles the trim + empty→null,
// then we lowercase so a user typing "Bob@FOO.com" in TMS doesn't
// distinguish from "bob@foo.com" already in BUDDY. Brief calls this
// out explicitly so we can rely on case-insensitive matches later.
function cleanEmail(v) {
  const s = cleanStr(v)
  return s ? s.toLowerCase() : null
}

function parseYesNo(v) {
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === 'y'
}

// Normalized header signature for validating a multi-file batch: the first
// sheet's column names lowercased, trimmed, and sorted, joined with "|". Two
// exports with the same columns (any order/case) match; a differing column
// set does not. Returns null if no header row can be read.
export function driversHeaderSignature(arrayBuffer) {
  try {
    const wb = XLSX.read(arrayBuffer, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
    if (raw.length === 0) return null
    return Object.keys(raw[0]).map(k => k.trim().toLowerCase()).sort().join('|')
  } catch {
    return null
  }
}

// ArrayBuffer → { rows, errors }
export function parseDriversWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

  const rows = []
  const errors = []
  if (raw.length === 0) return { rows, errors: ['Workbook contains no rows in the first sheet.'] }

  const sample = raw[0]
  const cols = {
    driverId:    findCol(sample, ['Driver ID', 'Driver Id', 'Driver ID#']),
    status:      findCol(sample, ['Status']),
    jobRemoved:  findCol(sample, ['Job date removed', 'Job Date Removed', 'Date removed']),
    fullName:    findCol(sample, ['Full name', 'Full Name', 'Name']),
    truck:       findCol(sample, ['Truck']),
    carrier:     findCol(sample, ['Carrier']),
    trailer:     findCol(sample, ['Trailer']),
    driverType:  findCol(sample, ['Driver type', 'Driver Type']),
    phone:       findCol(sample, ['Phone number', 'Phone']),
    email:       findCol(sample, ['Email', 'Email Address', 'E-mail']),
    missingOp:   findCol(sample, ['Missing OP']),
    referred:    findCol(sample, ['Referred by', 'Referred By']),
    createdAt:   findCol(sample, ['Created at', 'Created At']),
    tempLicense: findCol(sample, ['Temporary License', 'Temporary license']),
    compensation: findCol(sample, ['Compensation']),
  }

  if (!cols.driverId || !cols.fullName) {
    errors.push(`Missing required columns. Expected "Driver ID" and "Full name"; found: ${Object.keys(sample).join(', ')}`)
    return { rows, errors }
  }

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]
    const rowNum = i + 2

    const rawId = cleanStr(r[cols.driverId])
    const fullName = cleanStr(r[cols.fullName])
    if (!rawId && !fullName) continue

    const internal_id = parseInternalId(rawId)
    if (!internal_id) {
      errors.push(`Row ${rowNum}: couldn't extract a numeric internal ID from "${rawId}" — skipped.`)
      continue
    }
    if (!fullName) {
      errors.push(`Row ${rowNum}: missing full name (skipped).`)
      continue
    }

    const compRaw = cleanStr(cols.compensation ? r[cols.compensation] : null)
    const comp = parseCompensation(compRaw)
    const driverTypeRaw = cleanStr(cols.driverType ? r[cols.driverType] : null)
    const driverType = normalizeDriverType(driverTypeRaw)

    // Status + Job date removed → mapped current_status + terminated_at. Used on
    // the NEW-driver INSERT path only (the commit's update path deliberately
    // preserves an existing driver's hand-set status). terminated_at is set only
    // for a terminated status — a terminated driver with a blank/off-format Job
    // date removed still lands terminated, just with terminated_at NULL.
    const statusRaw = cleanStr(cols.status ? r[cols.status] : null)
    const jobRemovedRaw = cleanStr(cols.jobRemoved ? r[cols.jobRemoved] : null)
    const { status: mappedStatus, recognized: statusRecognized } = mapTmsStatus(statusRaw)
    const terminatedAt = mappedStatus === 'terminated' ? parseTmsDateToISO(jobRemovedRaw) : null

    rows.push({
      _rowNum: rowNum,
      internal_id,
      full_name: fullName,
      driver_type: driverType,
      driver_type_raw: driverTypeRaw,
      carrier: cleanStr(cols.carrier ? r[cols.carrier] : null),
      phone: cleanStr(cols.phone ? r[cols.phone] : null),
      email: cleanEmail(cols.email ? r[cols.email] : null),
      truck_assignment_raw: cleanStr(cols.truck ? r[cols.truck] : null),
      trailer_assignment_raw: cleanStr(cols.trailer ? r[cols.trailer] : null),
      missing_op: cleanStr(cols.missingOp ? r[cols.missingOp] : null),
      referred_by: cleanStr(cols.referred ? r[cols.referred] : null),
      onboarded_at: parseOnboardedAt(cols.createdAt ? r[cols.createdAt] : null),
      temporary_license: parseYesNo(cols.tempLicense ? r[cols.tempLicense] : null),
      compensation_raw: compRaw,
      compensation_type: comp.type,
      compensation_value: comp.value,
      // Raw Status kept for preview reason text. mapped_status/terminated_at are
      // consumed by the NEW-driver insert path; status_recognized flags a
      // blank/unknown Status that fell back to 'active' so it can be warned on.
      source_status_raw: statusRaw,
      job_date_removed_raw: jobRemovedRaw,
      mapped_status: mappedStatus,
      terminated_at: terminatedAt,
      status_recognized: statusRecognized,
    })

    // A terminated driver whose Job date removed is present but not MM-DD-YYYY
    // parses to null — surface it so the missing terminated_at is visible.
    if (mappedStatus === 'terminated' && jobRemovedRaw && !terminatedAt) {
      errors.push(`Row ${rowNum}: couldn't parse Job date removed "${jobRemovedRaw}" — terminated_at left blank.`)
    }

    if (compRaw && !comp.type) {
      const msg = /flat\s*rate/i.test(compRaw)
        ? 'flat rate amount not found'
        : 'compensation format not recognized'
      errors.push(`Row ${rowNum}: ${msg} — "${compRaw}" (left unparsed)`)
    }
    if (driverTypeRaw && !driverType) {
      errors.push(`Row ${rowNum}: driver type not recognized — "${driverTypeRaw}"`)
    }
  }

  return { rows, errors }
}
