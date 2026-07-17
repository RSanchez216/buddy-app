import { supabase } from '../../../lib/supabase'

// Office Expenses — data + period helpers. Local-currency first; USD is derived
// from the transfer rate and frozen server-side (GENERATED). All period math
// goes through office_period_stats so balances (which do NOT sum across
// periods) are always correct — never roll periods up client-side.

// ── date helpers (local, no UTC shift) ───────────────────────────────────────
const pad = n => String(n).padStart(2, '0')
export const toISO = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
export function todayISO() {
  const n = new Date()
  return toISO(n.getFullYear(), n.getMonth() + 1, n.getDate())
}
// Parse 'YYYY-MM-DD' into {y,m,d} without a Date object.
export function parts(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return { y, m, d }
}

// A "period" is an anchor date + grain. Returns { from, to, label, key }.
export function periodRange(grain, anchorISO) {
  const { y, m } = parts(anchorISO)
  if (grain === 'year') {
    return { from: toISO(y, 1, 1), to: toISO(y, 12, 31), label: String(y), key: `${y}` }
  }
  if (grain === 'quarter') {
    const q = Math.floor((m - 1) / 3)          // 0..3
    const fm = q * 3 + 1
    const tm = fm + 2
    const to = lastOfMonth(y, tm)
    return { from: toISO(y, fm, 1), to, label: `${y}-Q${q + 1}`, key: `${y}Q${q + 1}` }
  }
  // month
  const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  return { from: toISO(y, m, 1), to: lastOfMonth(y, m), label, key: `${y}-${pad(m)}` }
}
function lastOfMonth(y, m) {
  const d = new Date(y, m, 0).getDate()          // day 0 of next month = last day of m
  return toISO(y, m, d)
}
// Step the anchor by ±1 period at the given grain. Returns a new anchor ISO.
export function stepPeriod(grain, anchorISO, dir) {
  const { y, m, d } = parts(anchorISO)
  if (grain === 'year') return toISO(y + dir, m, d)
  if (grain === 'quarter') { const dt = new Date(y, m - 1 + dir * 3, 1); return toISO(dt.getFullYear(), dt.getMonth() + 1, 1) }
  const dt = new Date(y, m - 1 + dir, 1); return toISO(dt.getFullYear(), dt.getMonth() + 1, 1)
}
// Is the given anchor's period the current (latest) one? Disables the ▶ step.
export function isCurrentPeriod(grain, anchorISO) {
  const now = periodRange(grain, todayISO())
  const cur = periodRange(grain, anchorISO)
  return cur.key === now.key || cur.from > now.from
}
export function prevPeriodLabel(grain, anchorISO) {
  return periodRange(grain, stepPeriod(grain, anchorISO, -1)).label
}

// ── queries ──────────────────────────────────────────────────────────────────
export async function listOffices() {
  const { data, error } = await supabase.from('offices')
    .select('id, name, country_code, currency_code, is_active')
    .eq('is_active', true).order('name')
  if (error) throw error
  return data || []
}

// One period's stats (the RPC computes balance correctly at every grain).
export async function periodStats(officeId, grain, from, to) {
  const { data, error } = await supabase.rpc('office_period_stats',
    { p_office_id: officeId, p_grain: grain, p_from: from, p_to: to })
  if (error) throw error
  return data || []
}

// The rate that applies to a given date (most recent transfer at/before it).
export async function rateFor(officeId, onDate) {
  const { data, error } = await supabase.rpc('office_rate_for',
    { p_office_id: officeId, p_on_date: onDate })
  if (error) throw error
  return (data && data[0]) || null   // { fx_rate, transfer_id, rate_date, is_inherited }
}

export async function listExpenses(officeId, from, to) {
  const { data, error } = await supabase.from('office_expenses')
    .select('id, office_id, category, description, expense_date, amount_local, fx_rate, amount_usd, rate_transfer_id, rate_is_manual, notes')
    .eq('office_id', officeId).gte('expense_date', from).lte('expense_date', to)
    .order('expense_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function listTransfers(officeId) {
  const { data, error } = await supabase.from('office_transfers')
    .select('id, office_id, from_funding_account_id, amount_usd, amount_local, fx_rate, sent_date, received_date, method, notes')
    .eq('office_id', officeId).order('sent_date', { ascending: false })
  if (error) throw error
  return data || []
}

// ── CSV export ───────────────────────────────────────────────────────────────
export function expensesToCSV(rows, currency) {
  const head = ['date', 'category', 'description', 'amount_local', 'currency', 'fx_rate', 'amount_usd', 'notes']
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [head.join(',')]
  for (const r of rows) {
    lines.push([r.expense_date, r.category, r.description, r.amount_local, currency, r.fx_rate, r.amount_usd, r.notes].map(esc).join(','))
  }
  return lines.join('\n')
}
export function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// ── formatting ───────────────────────────────────────────────────────────────
export const usd0 = v => v == null ? '—' : `$${Math.round(Number(v)).toLocaleString('en-US')}`
export const usd2 = v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const local0 = (v, ccy) => v == null ? '—' : `${Math.round(Number(v)).toLocaleString('en-US')} ${ccy}`
export const rate2 = v => v == null ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
