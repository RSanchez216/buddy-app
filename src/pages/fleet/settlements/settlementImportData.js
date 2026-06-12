import { supabase } from '../../../lib/supabase'

// Normalize a driver name for matching: lowercase, trim, collapse spaces, remove parenthetical notes
function normalizeDriverName(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .trim()
    .replace(/\(.*?\)/g, '') // remove parenthetical notes
    .replace(/\s+/g, ' ')    // collapse multiple spaces
    .trim()
}

// Parse an xlsx file (via SheetJS) into settlement rows.
// Expected columns: Driver's number | Driver name | Truck | Pay To | Status | Driver type |
// $ Per Mile | Miles | % Loaded | % Empty | Linehaul Revenue | Driver Pay | Fuel Total |
// Adjustment | Settlement | Settlement Date | Carrier
export function parseSettlementWorkbook(workbook) {
  const ws = workbook.Sheets[workbook.SheetNames[0]]
  if (!ws) throw new Error('No sheet found in workbook')

  const rows = []
  let row = 1

  // Skip to header row (look for "Driver's number" or similar)
  while (row <= 100) {
    const cell = ws[`A${row}`]
    if (cell?.v && String(cell.v).includes('number')) break
    row++
  }

  if (row > 100) throw new Error('Could not find header row')

  const headerRow = row
  const colMap = {
    'Driver\'s number': 'driverNumber',
    'Driver name': 'driverName',
    'Truck': 'truck',
    'Pay To': 'payTo',
    'Status': 'status',
    'Driver type': 'driverType',
    '$ Per Mile': 'ratePerMile',
    'Miles': 'miles',
    '% Loaded': 'pctLoaded',
    '% Empty': 'pctEmpty',
    'Linehaul Revenue': 'linehaulRevenue',
    'Driver Pay': 'driverPay',
    'Fuel Total': 'fuelTotal',
    'Adjustment': 'adjustment',
    'Settlement': 'settlement',
    'Settlement Date': 'settlementDate',
    'Carrier': 'carrier',
  }

  // Map column letters to field names
  const colIndex = {}
  for (let col = 1; col <= 26; col++) {
    const letter = String.fromCharCode(64 + col)
    const cell = ws[`${letter}${headerRow}`]
    if (!cell) continue
    const header = String(cell.v || '').trim()
    for (const [hdr, field] of Object.entries(colMap)) {
      if (header.includes(hdr)) {
        colIndex[field] = letter
        break
      }
    }
  }

  // Parse data rows
  for (let r = headerRow + 1; r <= 1000; r++) {
    const driverNumberCell = ws[`${colIndex.driverNumber}${r}`]
    const driverNameCell = ws[`${colIndex.driverName}${r}`]

    // Stop at first blank row
    if (!driverNumberCell && !driverNameCell) break

    // Skip blank or footer rows (no driver number/name)
    const driverNumber = String(driverNumberCell?.v || '').trim()
    const driverName = String(driverNameCell?.v || '').trim()
    if (!driverNumber && !driverName) continue

    const getCellValue = (field) => {
      const col = colIndex[field]
      if (!col) return null
      const cell = ws[`${col}${r}`]
      return cell?.v || null
    }

    // Parse numeric values
    const parseNum = (v) => {
      if (v == null) return null
      const str = String(v).trim().replace(/[$,%]/g, '').replace(/,/g, '')
      const num = parseFloat(str)
      return isNaN(num) ? null : num
    }

    rows.push({
      driverNumberRaw: driverNumber,
      driverNameRaw: driverName,
      truck: String(getCellValue('truck') || '').trim() || null,
      payTo: String(getCellValue('payTo') || '').trim() || null,
      statusRaw: String(getCellValue('status') || '').trim() || null,
      driverTypeRaw: String(getCellValue('driverType') || '').trim() || null,
      ratePerMile: parseNum(getCellValue('ratePerMile')),
      miles: parseNum(getCellValue('miles')),
      pctLoaded: parseNum(getCellValue('pctLoaded')),
      pctEmpty: parseNum(getCellValue('pctEmpty')),
      linehaulRevenue: parseNum(getCellValue('linehaulRevenue')),
      driverPay: parseNum(getCellValue('driverPay')),
      fuelTotal: parseNum(getCellValue('fuelTotal')),
      adjustment: parseNum(getCellValue('adjustment')),
      settlement: parseNum(getCellValue('settlement')),
      settlementDate: getCellValue('settlementDate') ? new Date(getCellValue('settlementDate')).toISOString().split('T')[0] : null,
      carrier: String(getCellValue('carrier') || '').trim() || null,
      driverId: null,
      matchStatus: 'unmatched', // 'matched' | 'matched-by-name' | 'unmatched'
    })
  }

  return rows
}

// Match drivers by internal_id, then by normalized name
export async function matchDrivers(rows) {
  const { data: drivers } = await supabase.from('drivers').select('id, internal_id, full_name')
  const driversById = new Map()
  const driversByNormalizedName = new Map()

  for (const d of (drivers || [])) {
    if (d.internal_id) driversById.set(String(d.internal_id).trim(), d.id)
    const normalized = normalizeDriverName(d.full_name)
    if (normalized && !driversByNormalizedName.has(normalized)) {
      driversByNormalizedName.set(normalized, d.id)
    }
  }

  // Match each row
  for (const row of rows) {
    // First try internal_id match
    if (row.driverNumberRaw && driversById.has(row.driverNumberRaw)) {
      row.driverId = driversById.get(row.driverNumberRaw)
      row.matchStatus = 'matched'
      continue
    }

    // Then try normalized name match
    const normalized = normalizeDriverName(row.driverNameRaw)
    if (normalized && driversByNormalizedName.has(normalized)) {
      row.driverId = driversByNormalizedName.get(normalized)
      row.matchStatus = 'matched-by-name'
      continue
    }
  }

  return rows
}

// Upsert settlement rows into driver_settlement_weekly with onConflict
export async function commitSettlements(rows, payPeriodStart, payPeriodEnd, paySchedule, userId, sourceFile) {
  const toInsert = rows.map(row => ({
    driver_id: row.driverId,
    driver_number_raw: row.driverNumberRaw,
    driver_name_raw: row.driverNameRaw,
    truck_raw: row.truck,
    pay_to: row.payTo,
    status_raw: row.statusRaw,
    driver_type_raw: row.driverTypeRaw,
    rate_per_mile: row.ratePerMile,
    miles: row.miles,
    pct_loaded: row.pctLoaded,
    pct_empty: row.pctEmpty,
    linehaul_revenue: row.linehaulRevenue,
    driver_pay: row.driverPay,
    fuel_total: row.fuelTotal,
    adjustment: row.adjustment,
    settlement: row.settlement,
    settlement_date: row.settlementDate,
    carrier: row.carrier,
    pay_period_start: payPeriodStart,
    pay_period_end: payPeriodEnd,
    pay_schedule: paySchedule,
    source_file: sourceFile,
    imported_by: userId,
  }))

  // Upsert with onConflict on unique key: (pay_period_start, pay_period_end, driver_number_raw, driver_name_raw)
  const { error } = await supabase.from('driver_settlement_weekly')
    .upsert(toInsert, {
      onConflict: 'pay_period_start,pay_period_end,driver_number_raw,driver_name_raw',
    })

  if (error) throw error
  return toInsert.length
}

// Load recent settlement imports for history
export async function loadRecentSettlements(limit = 10) {
  const { data, error } = await supabase.from('driver_settlement_weekly')
    .select('pay_period_start, pay_period_end, source_file, imported_at, imported_by, pay_schedule')
    .order('imported_at', { ascending: false })
    .limit(limit * 2) // Fetch more to deduplicate by period

  if (error) throw error

  // Group by pay period and get unique file imports
  const seen = new Set()
  const recent = []

  for (const row of (data || [])) {
    const key = `${row.pay_period_start}|${row.pay_period_end}`
    if (seen.has(key)) continue
    seen.add(key)
    recent.push(row)
    if (recent.length >= limit) break
  }

  return recent
}

// Get count of rows in a pay period
export async function getSettlementCount(payPeriodStart, payPeriodEnd) {
  const { count, error } = await supabase.from('driver_settlement_weekly')
    .select('*', { count: 'exact', head: true })
    .eq('pay_period_start', payPeriodStart)
    .eq('pay_period_end', payPeriodEnd)

  if (error) throw error
  return count || 0
}
