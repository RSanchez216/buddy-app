// Cash Flow / Payment Calendar helpers

export const CF = {
  btnPrimary: 'flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20',
  btnOutline: 'flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-xl transition-all',
  btnSave:    'px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all',
  link:       'text-sm text-orange-600 dark:text-orange-400 hover:text-orange-500 hover:underline',
}

export const FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annually']
export const EXPENSE_CATEGORIES = ['payroll', 'insurance', 'rent', 'utilities', 'fuel', 'taxes', 'maintenance', 'other']

// ── Date helpers ───────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISO(s) {
  if (!s) return null
  return new Date(`${s}T00:00:00`)
}

// Monday of the week for a given date (treats Sunday as part of the previous week)
export function startOfWeek(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0 (Sun) … 6 (Sat)
  const offset = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + offset)
  return d
}

export function endOfWeek(date) {
  const start = startOfWeek(date)
  start.setDate(start.getDate() + 6)
  return start
}

export function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n)
  return d
}

export function startOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1); d.setHours(0, 0, 0, 0)
  return d
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

// First Monday of the visible month grid (may be in previous month)
export function startOfMonthGrid(date) {
  return startOfWeek(startOfMonth(date))
}

// Last Sunday of the visible month grid (may be in next month)
export function endOfMonthGrid(date) {
  const ws = startOfWeek(endOfMonth(date))
  ws.setDate(ws.getDate() + 6)
  return ws
}

export function isSameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isToday(date) {
  return isSameDay(date, new Date())
}

// ── Formatters ─────────────────────────────────────────────────────────────
const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

export function fmtMoney(n) {
  if (n == null || n === '') return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return moneyFmt.format(num)
}

// "$42k", "$1.2M" — compact for chips
export function fmtMoneyShort(n) {
  if (n == null || n === '') return '$0'
  const num = Number(n)
  if (isNaN(num)) return '$0'
  const abs = Math.abs(num)
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000)    return `$${Math.round(abs / 1000)}k`
  if (abs >= 1_000)     return `$${(abs / 1000).toFixed(1)}k`
  return `$${abs.toFixed(0)}`
}

export function fmtMoneySigned(n, direction) {
  const sign = direction === 'inflow' ? '+ ' : '− '
  return `${sign}${fmtMoneyShort(n)}`
}

export function fmtRange(weekStart) {
  const end = addDays(weekStart, 6)
  const sameMonth = weekStart.getMonth() === end.getMonth()
  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = sameMonth
    ? end.toLocaleDateString('en-US', { day: 'numeric' })
    : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Week of ${startStr} – ${endStr}, ${end.getFullYear()}`
}

export function fmtDayHeader(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// ── Chip styling ───────────────────────────────────────────────────────────
// Maps a v_cash_flow_events row → palette tokens for the chip
// direction: 'inflow' | 'outflow'
// reference_type: 'inflow' | 'loan' | 'invoice' | 'custom' | 'recurring'
export function chipPalette(event) {
  if (event.direction === 'inflow') {
    return {
      kind: 'inflow',
      bg: 'bg-[#EAF3DE] dark:bg-[#1d2e0e]',
      text: 'text-[#27500A] dark:text-emerald-300',
      border: 'border-transparent',
      legend: 'Inflow',
    }
  }
  switch (event.reference_type) {
    case 'loan':
      return {
        kind: 'loan',
        bg: 'bg-[#FAEEDA] dark:bg-[#3a2710]',
        text: 'text-[#633806] dark:text-orange-300',
        border: 'border-transparent',
        legend: 'Loan payment',
      }
    case 'invoice':
      return {
        kind: 'invoice',
        bg: 'bg-[#E6F1FB] dark:bg-[#0f2233]',
        text: 'text-[#0C447C] dark:text-sky-300',
        border: 'border-transparent',
        legend: 'AP bill',
      }
    case 'recurring':
    case 'custom':
    default:
      return {
        kind: 'custom',
        bg: 'bg-[#FCEBEB] dark:bg-[#371616]',
        text: 'text-[#791F1F] dark:text-red-300',
        border: 'border-transparent',
        legend: event.reference_type === 'recurring' ? 'Recurring expense' : 'Custom expense',
      }
  }
}

// Weekday label shortcuts for recurring patterns
export const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]
