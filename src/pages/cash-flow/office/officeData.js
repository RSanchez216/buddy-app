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
// Today in America/Chicago as 'YYYY-MM-DD' — for the mark-paid default date.
export function todayChicago() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}
// First-of-month key for a date (the office_rate_estimates.period_month grain).
export function firstOfMonth(iso) {
  return `${String(iso).slice(0, 7)}-01`
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
    .select('id, office_id, category, description, expense_date, amount_local, fx_rate, amount_usd, rate_transfer_id, rate_is_manual, notes, entry_currency, entered_amount, is_paid, paid_date, payment_method, paid_by, paid_at, payment_note')
    .eq('office_id', officeId).gte('expense_date', from).lte('expense_date', to)
    .order('expense_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Lightweight user list for resolving paid_by → name (small team).
export async function listUsersLite() {
  const { data, error } = await supabase.from('users').select('id, full_name')
  if (error) throw error
  return data || []
}

// ── Estimate rates + payment (admin/manager RPCs) ────────────────────────────
// Estimate rate: a temporary, editable KGS/UZS-per-USD used until a real
// transfer exists. Stored per office+month in office_rate_estimates; it drives
// estimated USD + currency conversion but is NEVER stamped onto expenses.
export async function listRateEstimates(officeId) {
  const { data, error } = await supabase.from('office_rate_estimates')
    .select('period_month, fx_rate').eq('office_id', officeId)
  if (error) throw error
  return data || []
}
export async function getRateEstimate(officeId, periodMonth) {
  const { data, error } = await supabase.from('office_rate_estimates')
    .select('fx_rate').eq('office_id', officeId).eq('period_month', periodMonth).maybeSingle()
  if (error) throw error
  return data?.fx_rate != null ? Number(data.fx_rate) : null
}
export async function setRateEstimate(officeId, periodMonth, fxRate) {
  const { error } = await supabase.rpc('set_office_rate_estimate',
    { p_office_id: officeId, p_period_month: periodMonth, p_fx_rate: fxRate })
  if (error) throw error
}
export async function markExpensePaid(id, paidDate, method, note) {
  const { error } = await supabase.rpc('mark_expense_paid',
    { p_expense_id: id, p_paid_date: paidDate, p_method: method, p_note: note?.trim() || null })
  if (error) throw error
}
export async function unmarkExpensePaid(id) {
  const { error } = await supabase.rpc('unmark_expense_paid', { p_expense_id: id })
  if (error) throw error
}

// Free-text values stored verbatim in office_expenses.payment_method.
export const PAYMENT_METHODS = ['Manual / cash', 'Wire', 'Check', 'Payroll deduction', 'Other']

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
