import * as XLSX from 'xlsx'

/**
 * Parse a fuel price daily report Excel file.
 * Returns { headerData, offers, errors } or { errors } on failure.
 */
export function parseFuelPriceWorkbook(buffer) {
  const errors = []
  try {
    const workbook = XLSX.read(buffer)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) {
      errors.push('No sheet found in workbook')
      return { errors }
    }

    // Read all rows
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (rows.length < 6) {
      errors.push('File has fewer than 6 rows')
      return { errors }
    }

    // Find header row (row index 5, the 6th row, should have "Site")
    let headerRowIdx = -1
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row && row.length > 0) {
        const firstCell = String(row[0] || '').trim().toLowerCase()
        if (firstCell === 'site') {
          headerRowIdx = i
          break
        }
      }
    }

    if (headerRowIdx === -1) {
      errors.push('Could not find "Site" header row')
      return { errors }
    }

    // Extract header data from rows before headerRowIdx (rows 1-5, 0-indexed as 0-4)
    const headerBand = rows.slice(0, headerRowIdx)
    const headerData = extractHeaderData(headerBand, errors)

    // Parse data rows (starting from headerRowIdx + 1)
    const headerRow = rows[headerRowIdx]
    const colMap = buildColumnMap(headerRow)
    const offers = []

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || !row.length) continue

      const offer = parseOfferRow(row, colMap, errors)
      if (offer) {
        offers.push(offer)
      }
    }

    // Filter to DSL only and validate site_int
    const dslOffers = offers.filter(o => {
      if (!o.prod || o.prod.trim().toUpperCase() !== 'DSL') return false
      // Skip rows with no numeric site
      if (o.site_int == null || !Number.isInteger(o.site_int) || o.site_int < 0) {
        return false
      }
      return true
    })

    return { headerData, offers: dslOffers, errors }
  } catch (e) {
    errors.push(e.message)
    return { errors }
  }
}

function extractHeaderData(headerBand, errors) {
  const data = {
    account: null,
    effective_date: null,
    price_source: null,
    provider: null,
    retail_as_of: null,
  }

  for (const row of headerBand) {
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] || '').trim()
      const nextCell = i + 1 < row.length ? String(row[i + 1] || '').trim() : ''

      if (cell.toLowerCase().includes('account')) {
        const acctMatch = nextCell.match(/\d+/)
        if (acctMatch) data.account = acctMatch[0]
      } else if (cell.toLowerCase().includes('effective date')) {
        const dateMatch = nextCell.match(/(\d+)\/(\d+)\/(\d+)/)
        if (dateMatch) {
          const [, m, d, y] = dateMatch
          const fullYear = parseInt(y) < 100 ? 2000 + parseInt(y) : parseInt(y)
          data.effective_date = new Date(fullYear, parseInt(m) - 1, parseInt(d))
        }
      } else if (cell.toLowerCase().includes('price source')) {
        data.price_source = nextCell
      } else if (cell.toLowerCase().includes('direct bill')) {
        data.provider = cell + (nextCell ? ` ${nextCell}` : '')
      } else if (cell.toLowerCase().includes('retail price @')) {
        // Extract timestamp if present
        if (nextCell) {
          try {
            data.retail_as_of = new Date(nextCell).toISOString()
          } catch {}
        }
      }
    }
  }

  return data
}

function buildColumnMap(headerRow) {
  const map = {}

  // Map of display names to normalized keys
  const columnMaps = [
    ['Site', 'site'],
    ['City', 'city'],
    ['ST', 'st'],
    ['Prod', 'prod'],
    ['Rack ID', 'rack_id'],
    ['Rack City', 'rack_city'],
    ['Rack ST', 'rack_st'],
    ['Cost', 'cost'],
    ['Federal Tax/Fees', 'federal_tax_fees'],
    ['State Tax/ Fees', 'state_tax_fees'],
    ['Sales Tax/ Fees', 'sales_tax_fees'],
    ['Lust/Insp Super Fund/Fees', 'lust_insp_fees'],
    ['Freight', 'freight'],
    ['Pump Fee', 'pump_fee'],
    ['Other', 'other'],
    ['Total Cost', 'total_cost'],
    ['Retail Price', 'retail_price'],
    ['Disc Retail', 'disc_retail'],
    ['Your Price', 'your_price'],
    ['Savings Total', 'savings_total'],
  ]

  for (const [displayName, key] of columnMaps) {
    for (let i = 0; i < headerRow.length; i++) {
      const cell = String(headerRow[i] || '').trim()
      if (cell === displayName) {
        map[key] = i
        break
      }
    }
  }

  return map
}

function parseOfferRow(row, colMap, errors) {
  const getVal = (key) => {
    const idx = colMap[key]
    return idx !== undefined ? row[idx] : null
  }

  const siteRaw = getVal('site')
  let siteInt = null
  if (siteRaw != null) {
    const siteStr = String(siteRaw).trim()
    const parsed = parseInt(siteStr, 10)
    if (!isNaN(parsed) && parsed >= 0) {
      siteInt = parsed
    } else {
      return null // Skip rows without valid numeric site
    }
  } else {
    return null
  }

  const parseNum = (key) => {
    const val = getVal(key)
    if (val == null || val === '') return null
    const n = Number(val)
    return isNaN(n) ? null : n
  }

  return {
    site_int: siteInt,
    city: String(getVal('city') || '').trim() || null,
    st: String(getVal('st') || '').trim() || null,
    prod: String(getVal('prod') || '').trim() || 'DSL',
    rack_id: String(getVal('rack_id') || '').trim() || null,
    rack_city: String(getVal('rack_city') || '').trim() || null,
    rack_st: String(getVal('rack_st') || '').trim() || null,
    cost: parseNum('cost'),
    federal_tax_fees: parseNum('federal_tax_fees'),
    state_tax_fees: parseNum('state_tax_fees'),
    sales_tax_fees: parseNum('sales_tax_fees'),
    lust_insp_fees: parseNum('lust_insp_fees'),
    freight: parseNum('freight'),
    pump_fee: parseNum('pump_fee'),
    other: parseNum('other'),
    total_cost: parseNum('total_cost'),
    retail_price: parseNum('retail_price'),
    disc_retail: parseNum('disc_retail'),
    your_price: parseNum('your_price'),
    savings_total: parseNum('savings_total'),
  }
}
