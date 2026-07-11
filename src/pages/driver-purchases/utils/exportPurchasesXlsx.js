// Excel export for the Driver Purchases list. Takes the currently-visible
// (tab + search filtered, sorted) rows and writes a flat sheet — dates as
// readable strings, money/counts as plain numbers so Excel keeps them
// sortable/summable. SheetJS is dynamically imported with the interop
// unwrap this codebase needs (mod.utils detection), matching
// exportDebtSchedule.js.

// Date-only (yyyy-mm-dd) OR timestamptz → "Jul 11, 2026"; '' when null.
// The T00:00:00 anchor keeps date-only strings from being UTC-shifted into
// the previous day; full timestamps parse as-is.
function fmtDateCell(iso) {
  if (!iso) return ''
  const s = String(iso)
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Numbers stay numeric (null → blank cell) so they don't become "$1,000"
// text that Excel can't sum.
function num(n) {
  if (n == null || n === '') return null
  const v = Number(n)
  return Number.isFinite(v) ? v : null
}

function localToday() {
  const now = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export async function exportPurchasesXlsx(rows = []) {
  const mod = await import('xlsx')
  const XLSX = mod && mod.utils ? mod : (mod.default ?? mod.namespace ?? mod)
  if (!XLSX || !XLSX.utils) throw new Error('xlsx library failed to load properly')

  const sheet = rows.map(r => ({
    'Driver name':        r.driver_name || '',
    'Internal ID':        r.driver_internal_id || '',
    'Unit / Truck':       r.truck_number || '',
    'VIN':                r.vin || '',
    'Status':             r.status_name || '',
    'Payment amount':     num(r.payment_amount),
    'Frequency':          r.payment_frequency || '',
    'Current balance':    num(r.current_balance),
    'Periods behind':     num(r.periods_behind) ?? 0,
    'Amount behind':      num(r.amount_behind) ?? 0,
    'Last charged':       fmtDateCell(r.last_charged_date),
    'Last update':        fmtDateCell(r.last_update_at),
    'Last update by':     r.last_update_by || '',
    'Linked lender':      r.underlying_lender_name || '',
    'Linked contract #':  r.underlying_loan_number || '',
    'Sale price':         num(r.sale_price),
    'Downpayment':        num(r.downpayment),
    'Purchase date':      fmtDateCell(r.purchase_date),
  }))

  const ws = XLSX.utils.json_to_sheet(sheet)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Driver Purchases')
  XLSX.writeFile(wb, `driver-purchases-${localToday()}.xlsx`)
}
