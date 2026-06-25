// Excel export for the Debt Schedule table. Reuses the same SheetJS (xlsx)
// dynamic-import interop as the Lane Map → Top Performers export. Currency and
// dates are written as REAL Excel numbers/dates (penny-accurate, sortable), the
// header carries an AutoFilter, and a bold-labelled TOTALS row reconciles to
// the on-screen figures.
//
// Note on the community xlsx@0.18.5 build: it writes number formats (.z),
// column widths, and AutoFilter, but NOT frozen panes or cell styles (.s) —
// those need a styled/pro build, which we don't add per the "reuse the existing
// library" rule. .s is still set (harmless) to mirror the Top Performers code.

import { STATUS_LABELS } from './loanUtils'

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

// 'YYYY-MM-DD' → local Date (no UTC shift), or null.
const dateOnly = (s) => {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

// First candidate key that exists on the row (v_loans_summary select '*' keeps
// every column key even when null, so `in` reliably detects column presence).
const firstKey = (row, cands) => cands.find(k => row && k in row) || null

// Headers whose TOTALS we sum (additive only — never rates / counts / days).
const SUM_HEADERS = new Set(['Monthly Payment', 'Balance', 'Past Due Amount'])

export async function exportDebtScheduleXlsx({ rows, equipmentByLoan = {}, formatEqLabel = (x) => x, filterSummary = [], headerContext = '' }) {
  const mod = await import('xlsx')
  const XLSX = mod && mod.utils ? mod : (mod.default ?? mod)
  if (!XLSX || !XLSX.utils) throw new Error('xlsx library failed to load properly')

  const sample = rows[0] || {}
  const eqOf = (l) => equipmentByLoan[l.id] || []
  const eqTypeLabel = (l) => {
    const types = [...new Set(eqOf(l).map(e => e.equipment_type).filter(Boolean))]
    return types.length ? types.map(formatEqLabel).join(', ') : ''
  }

  // type: 'text' | 'money' | 'int' | 'date' | 'rate'. sum → included in TOTALS.
  const cols = [
    { h: 'Loan ID',         type: 'text',  get: l => l.loan_id_external || '' },
    { h: 'Sub ID',          type: 'text',  get: l => l.contract_number || '' },
    { h: 'Entity',          type: 'text',  get: l => l.entity_name || '' },
    { h: 'Lender',          type: 'text',  get: l => l.lender_name || '' },
    { h: 'Equipment Count', type: 'int',   get: l => eqOf(l).length },
    { h: 'Equipment Type',  type: 'text',  get: l => eqTypeLabel(l) },
    { h: 'Monthly Payment', type: 'money', get: l => num(l.monthly_payment) },
    { h: 'Balance',         type: 'money', get: l => num(l.current_balance) },
    { h: 'Next Due',        type: 'date',  get: l => dateOnly(l.next_due_date) },
    { h: 'Days Behind',     type: 'int',   get: l => num(l.days_behind) ?? 0 },
    { h: 'Skipped',         type: 'int',   get: l => num(l.unresolved_skipped_count) ?? 0 },
    { h: 'Status',          type: 'text',  get: l => STATUS_LABELS[l.status] || l.status || '' },
  ]

  // Finance-relevant extras — appended only when the column exists on the row.
  const optional = [
    { h: 'Original Principal', type: 'money', cands: ['original_principal', 'principal_amount', 'original_amount', 'amount_financed'] },
    { h: 'Interest Rate',      type: 'rate',  cands: ['interest_rate', 'rate', 'apr'] },
    { h: 'Term (months)',      type: 'int',   cands: ['term_months', 'term', 'num_payments'] },
    { h: 'Start Date',         type: 'date',  cands: ['start_date', 'origination_date', 'first_payment_date'] },
    { h: 'Payoff Date',        type: 'date',  cands: ['payoff_date', 'maturity_date', 'final_payment_date'] },
    { h: 'Past Due Amount',    type: 'money', cands: ['past_due_amount', 'total_past_due', 'past_due_total'] },
    { h: 'Pending Amount',     type: 'money', cands: ['pending_amount', 'past_due_pending_amount'] },
    { h: 'Skipped Amount',     type: 'money', cands: ['unresolved_skipped_amount', 'skipped_amount', 'past_due_skipped_amount'] },
  ]
  for (const o of optional) {
    const key = firstKey(sample, o.cands)
    if (!key) continue
    cols.push({
      h: o.h, type: o.type,
      get: l => o.type === 'date' ? dateOnly(l[key])
        : (o.type === 'money' || o.type === 'int' || o.type === 'rate') ? num(l[key])
        : (l[key] ?? ''),
    })
  }

  // ── Build the array-of-arrays (header + data + TOTALS) ──
  const headers = cols.map(c => c.h)
  const aoa = [headers]
  for (const l of rows) aoa.push(cols.map(c => { const v = c.get(l); return v == null ? null : v }))
  const totalsRow = cols.map(c => SUM_HEADERS.has(c.h) ? rows.reduce((s, l) => s + (Number(c.get(l)) || 0), 0) : null)
  totalsRow[0] = 'TOTALS'
  aoa.push(totalsRow)

  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
  const Z = { money: '$#,##0.00', int: '#,##0', date: 'mm/dd/yyyy', rate: '0.00' }

  // Number/date formats on every data cell + the TOTALS cells.
  for (let ci = 0; ci < cols.length; ci++) {
    const z = Z[cols[ci].type]
    if (!z) continue
    for (let ri = 1; ri < aoa.length; ri++) {
      const ref = XLSX.utils.encode_cell({ c: ci, r: ri })
      if (ws[ref] && ws[ref].v != null) ws[ref].z = z
    }
  }
  // Bold header (mirrors Top Performers; ignored by the community build).
  for (let ci = 0; ci < cols.length; ci++) {
    const ref = XLSX.utils.encode_cell({ c: ci, r: 0 })
    if (ws[ref]) ws[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE8E8E8' } } }
  }
  // Bold the TOTALS label cell.
  const totRef = XLSX.utils.encode_cell({ c: 0, r: aoa.length - 1 })
  if (ws[totRef]) ws[totRef].s = { font: { bold: true } }

  // Column widths sized to content.
  ws['!cols'] = cols.map((c, ci) => {
    let max = c.h.length
    for (let ri = 1; ri < aoa.length; ri++) {
      const v = aoa[ri][ci]
      if (v == null) continue
      const len = c.type === 'money' ? 12 : c.type === 'date' ? 10 : String(v).length
      if (len > max) max = len
    }
    return { wch: Math.min(40, Math.max(10, max + 2)) }
  })

  // AutoFilter across the header range (community build writes this).
  ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(cols.length - 1)}1` }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Debt Schedule')

  // ── Optional second sheet: export context ──
  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })
  const info = [
    ['Debt Schedule — export'],
    ['Generated', stamp + ' (America/Chicago)'],
    ['Rows exported', rows.length],
    ...(headerContext ? [['Header context', headerContext]] : []),
    [],
    ['Active filters'],
    ...(filterSummary.length ? filterSummary.map(f => ['', f]) : [['', 'None — all rows']]),
  ]
  const wsInfo = XLSX.utils.aoa_to_sheet(info)
  wsInfo['!cols'] = [{ wch: 16 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Export info')

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  XLSX.writeFile(wb, `debt_schedule_${today}.xlsx`)
}
