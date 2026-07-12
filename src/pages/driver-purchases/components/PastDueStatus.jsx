import { fmtMoney } from '../utils/format'

// Presentation for v_driver_purchase_summary.past_due_status. The dollar
// past-due persists until those exact weeks are paid — it never silently
// clears — so this status only says whether the gap is an ACTIVE problem
// (falling behind) or a stable historical one (holding). 'current' → nothing.
export const PAST_DUE_META = {
  falling_behind: {
    label: 'falling behind',
    arrow: '↑',
    chip: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
    text: 'text-red-600 dark:text-red-400',
    tip: 'The most recent due week is unpaid — actively falling behind.',
  },
  holding: {
    label: 'holding',
    arrow: '',
    chip: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
    tip: 'Recent weeks are being paid, but an older unpaid gap remains. The dollar past-due stays until those exact weeks are paid.',
  },
}

// Frequency-aware "3 wks" / "1 mo" label — mirrors the list's Behind column.
export function behindLabel(periods, frequency) {
  const n = Number(periods) || 0
  if (n <= 0) return null
  const unit = frequency === 'monthly' ? 'mo' : frequency === 'biweekly' ? 'biwk' : 'wk'
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

// Compact chip for the list's Behind column. Renders nothing for 'current'.
export function PastDueChip({ status }) {
  const m = PAST_DUE_META[status]
  if (!m) return null
  return (
    <span
      title={m.tip}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${m.chip}`}
    >
      {m.label}{m.arrow && <span aria-hidden>{m.arrow}</span>}
    </span>
  )
}

// Contract-page one-liner. When behind: "$3,000 past due · 3 wks · falling
// behind" in the status color; when current: a subtle green "Current".
export function PastDueSummary({ summary, className = '' }) {
  const behind = Number(summary?.periods_behind || 0)
  if (behind <= 0) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Current
      </span>
    )
  }
  const m = PAST_DUE_META[summary.past_due_status] || PAST_DUE_META.falling_behind
  const amount = Number(summary.amount_behind || 0)
  const label = behindLabel(behind, summary.payment_frequency)
  return (
    <span
      title={m.tip}
      className={`inline-flex items-center gap-1.5 text-sm font-semibold ${m.text} ${className}`}
    >
      {fmtMoney(amount)} past due · {label} · {m.label}{m.arrow && <span aria-hidden>{m.arrow}</span>}
    </span>
  )
}
