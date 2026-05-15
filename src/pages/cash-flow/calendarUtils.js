// Cash Flow / Payment Calendar helpers

export const CF = {
  btnPrimary: 'flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20',
  btnOutline: 'flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-xl transition-all',
  btnSave:    'px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all',
  link:       'text-sm text-orange-600 dark:text-orange-400 hover:text-orange-500 hover:underline',
}

export const FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annually']
export const EXPENSE_CATEGORIES = ['payroll', 'insurance', 'rent', 'utilities', 'fuel', 'taxes', 'maintenance', 'other']

// True when the event's status indicates it has already settled (paid/received).
// Treats statuses case-insensitively (invoices store Pascal-case 'Paid'; others lowercase).
export function isPaidStatus(status) {
  if (!status) return false
  const s = String(status).toLowerCase()
  return s === 'paid' || s === 'received'
}

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

// "$42k", "$1.2M" — compact for chips. Kept for any non-calendar consumer;
// new calendar code should use fmtMoneyExact() which shows exact amounts.
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

// Exact-amount formatter for the Payment Calendar. Cents only when non-zero,
// thousands separated. Sign goes BEFORE the dollar so negatives read as
// "-$14,484.55" rather than "$-14,484.55".
export function fmtMoneyExact(n) {
  if (n == null || n === '') return '$0'
  const num = Number(n)
  if (isNaN(num)) return '$0'
  const negative = num < 0
  const abs = Math.abs(num)
  const fixed = abs.toFixed(2)
  const [intPart, decPart] = fixed.split('.')
  const formatted = Number(intPart).toLocaleString('en-US')
  const body = decPart === '00' ? `$${formatted}` : `$${formatted}.${decPart}`
  return negative ? `-${body}` : body
}

// Sign prefix for directional totals (kept for chip rendering where we
// explicitly want the +/− sign instead of a leading minus).
export function fmtMoneySigned(n, direction) {
  const sign = direction === 'inflow' ? '+ ' : '− '
  return `${sign}${fmtMoneyExact(Math.abs(Number(n || 0)))}`
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
// reference_type: 'inflow' | 'loan' | 'invoice' | 'custom' | 'recurring' | 'adjustment' | 'transfer_in' | 'transfer_out'
export function chipPalette(event) {
  // Inter-account transfers are cyan/teal — distinct from real money flow
  // (orange income / red expense / green inflow). Both legs share the
  // palette; the chip icon/label disambiguates direction. The consolidated
  // 'transfer' tag (one row per transfer.id, used in the flat day listing)
  // shares the palette too.
  if (event.reference_type === 'transfer'
   || event.reference_type === 'transfer_in'
   || event.reference_type === 'transfer_out') {
    return {
      kind: 'transfer',
      bg: 'bg-[#E0F7FA] dark:bg-[#0e2a30]',
      text: 'text-[#0E7490] dark:text-cyan-300',
      border: 'border-transparent',
      legend: 'Inter-account transfer',
    }
  }
  // Reconciliation adjustments are yellow regardless of sign — they're a
  // distinct "needs attention" category, not a normal inflow/outflow.
  if (event.reference_type === 'adjustment') {
    return {
      kind: 'adjustment',
      bg: 'bg-[#FEF3C7] dark:bg-[#3a2a05]',
      text: 'text-[#854D0E] dark:text-amber-300',
      border: 'border-transparent',
      legend: 'Reconciliation adjustment',
    }
  }
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

// ── Transfer consolidation ─────────────────────────────────────────────────
// v_cash_flow_events emits two rows per transfer (one out, one in). The flat
// day-column listing should display a single row per transfer.id. The grouped
// (BY BANK) listing still wants both legs visible — each bank's section
// naturally shows only its own leg, so no dedup is needed there.
//
// For the consolidated row we synthesize a "↔ Transfer: from → to" label
// and tag reference_type='transfer' so downstream consumers (EventChip,
// chip-click router) can recognize the merged form.

function _counterpartName(leg) {
  // Parse the counterpart account name out of the view's label string.
  // outgoing: "→ Transfer to NAME"  or  "→ Transfer to NAME · settles Mon DD"
  // incoming: "← Transfer from NAME" or "← Transfer from NAME · debited Mon DD"
  const m = leg?.label?.match(/^(?:→ Transfer to|← Transfer from)\s+(.+?)(?:\s+·\s+.+)?$/)
  return m ? m[1] : '—'
}

function _fmtShortDate(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function consolidateTransfers(events) {
  const out = []
  const seen = new Set()
  for (const ev of (events || [])) {
    if (ev.reference_type === 'transfer_out' || ev.reference_type === 'transfer_in') {
      if (seen.has(ev.reference_id)) continue
      seen.add(ev.reference_id)
      const isOut = ev.reference_type === 'transfer_out'
      const fromName = isOut ? ev.funding_account_name : _counterpartName(ev)
      const toName   = isOut ? _counterpartName(ev) : ev.funding_account_name
      const counterpartDate = ev.original_due_date  // view stores counterpart date here
      const inTransit = ev.status === 'in_transit'
      const suffix = inTransit
        ? (isOut
            ? ` · credits ${_fmtShortDate(counterpartDate)}`
            : ` · debited ${_fmtShortDate(counterpartDate)}`)
        : ''
      out.push({
        ...ev,
        // Tagged so EventChip can render an unsigned amount and the click
        // router can recognize the consolidated form.
        reference_type: 'transfer',
        label: `↔ Transfer: ${fromName} → ${toName}${suffix}`,
      })
    } else {
      out.push(ev)
    }
  }
  return out
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
