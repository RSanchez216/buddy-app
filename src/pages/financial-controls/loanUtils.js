// Helpers shared across Financial Controls / Debt Schedule UI

export const ORANGE = '#F97316'

// Module-scoped style overrides — reuse the global S object but with orange accents
export const FC = {
  btnPrimary: 'flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20',
  btnSave: 'px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all',
  pill: 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
  focusRing: 'focus:ring-orange-500/40 focus:border-orange-500/40',
}

export const LOAN_STATUSES = ['active', 'paid_off', 'inactive', 'total_loss']
export const EQUIPMENT_STATUSES = ['active', 'sold', 'totaled', 'in_repair', 'transferred', 'inactive']
export const PAYMENT_STATUSES = ['pending', 'paid', 'skipped', 'partial']
export const EVENT_TYPES = ['paydown', 'restructure', 'rate_change', 'balance_correction', 'transfer', 'note']
export const DOCUMENT_TYPES = ['contract', 'statement', 'paydown', 'amendment', 'title', 'insurance', 'other']

export const STATUS_LABELS = {
  active: 'Active',
  paid_off: 'Paid Off',
  inactive: 'Inactive',
  total_loss: 'Total Loss',
  sold: 'Sold',
  totaled: 'Totaled',
  in_repair: 'In Repair',
  transferred: 'Transferred',
  pending: 'Pending',
  paid: 'Paid',
  skipped: 'Skipped',
  partial: 'Partial',
  paydown: 'Paydown',
  restructure: 'Restructure',
  rate_change: 'Rate Change',
  balance_correction: 'Balance Correction',
  transfer: 'Transfer',
  note: 'Note',
}

export function loanStatusPill(status) {
  switch (status) {
    case 'active':     return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'paid_off':   return 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20'
    case 'inactive':   return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
    case 'total_loss': return 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'
    default:           return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
  }
}

export function equipmentStatusPill(status) {
  switch (status) {
    case 'active':       return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'sold':         return 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20'
    case 'totaled':      return 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'
    case 'in_repair':    return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20'
    case 'transferred':  return 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20'
    default:             return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
  }
}

export function paymentStatusPill(status) {
  switch (status) {
    case 'paid':    return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'skipped': return 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'
    case 'partial': return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20'
    case 'pending': return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
    default:        return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
  }
}

export function daysBehindCellClass(days) {
  if (!days || days <= 0)   return 'text-emerald-600 dark:text-emerald-400'
  if (days <= 15)           return 'text-amber-600 dark:text-amber-400'
  if (days <= 30)           return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}

export function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtMoneyCompact(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`
  if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(1)}k`
  return `$${num.toFixed(0)}`
}

export function fmtDate(d) {
  if (!d) return '—'
  // Treat date-only strings as local to avoid timezone shifts
  const s = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d
  const date = new Date(s)
  if (isNaN(date)) return '—'
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Last day of given calendar month (year, monthIndex 0-11)
function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function pad(n) { return String(n).padStart(2, '0') }

// Build YYYY-MM-DD due date from year/month and a due_day, clamped to month end
export function buildDueDate(year, monthIndex, dueDay) {
  const last = lastDayOfMonth(year, monthIndex)
  const day = Math.min(Math.max(1, dueDay || 1), last)
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`
}

// Generate a payment schedule from first_payment_date to maturity_date.
// One row per month. due_date = month + due_day (clamped to last day of month).
// scheduled_amount = monthly_payment, status = 'pending'.
export function generatePaymentSchedule({ loan_id, first_payment_date, maturity_date, due_day, monthly_payment }) {
  if (!first_payment_date || !maturity_date) return []
  const start = new Date(`${first_payment_date}T00:00:00`)
  const end = new Date(`${maturity_date}T00:00:00`)
  if (isNaN(start) || isNaN(end) || start > end) return []

  const day = Number(due_day) || start.getDate()
  const rows = []
  let y = start.getFullYear()
  let m = start.getMonth()

  while (true) {
    const dueDate = buildDueDate(y, m, day)
    const dueMonthFirst = `${y}-${pad(m + 1)}-01`
    rows.push({
      loan_id,
      due_month: dueMonthFirst,
      due_date: dueDate,
      scheduled_amount: Number(monthly_payment) || 0,
      status: 'pending',
    })
    if (y === end.getFullYear() && m === end.getMonth()) break
    if (rows.length > 600) break // safety: 50 yrs max
    m += 1
    if (m === 12) { m = 0; y += 1 }
  }
  return rows
}

// Compute days behind from a YYYY-MM-DD next due date (UI fallback)
export function computeDaysBehind(nextDueDate) {
  if (!nextDueDate) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(`${nextDueDate}T00:00:00`)
  if (isNaN(due)) return 0
  const ms = today - due
  return Math.max(0, Math.floor(ms / 86400000))
}
