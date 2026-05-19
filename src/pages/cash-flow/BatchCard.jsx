import { fmtMoneyExact, fmtMoneySigned, isPaidStatus } from './calendarUtils'

// One card per flow type per day. The header is a vertical stack:
//   Row 1: title  (12px medium, type-colored)
//   Row 2: total  (16px medium, type-colored)
//   Row 3: "N lines" subtitle (10px secondary; appended mixed-status note
//          when both paid/received and pending rows exist).
//
// Inline-expand was removed in this iteration. The follow-up BatchDetailModal
// owns batch editing; for now clicking the card is inert. Other unused
// props (tagFor, onChipClick, drag handles) are left on the signature so
// WeekView's call site doesn't need to change in the same PR; they're
// pruned when the modal lands.

const TYPE_STYLE = {
  inflow: {
    accent: '#16A34A',
    titleText: 'text-[#27500A] dark:text-emerald-300',
    totalText: 'text-emerald-700 dark:text-emerald-400',
  },
  transfer: {
    accent: '#0E7490',
    titleText: 'text-[#0E7490] dark:text-cyan-300',
    totalText: 'text-cyan-700 dark:text-cyan-300',
  },
  expense: {
    accent: '#B91C1C',
    titleText: 'text-[#791F1F] dark:text-red-300',
    totalText: 'text-red-700 dark:text-red-400',
  },
}

export default function BatchCard({
  type,                  // 'inflow' | 'transfer' | 'expense'
  title,                 // 'Inflows' / 'Transfers' / 'Expenses'
  events,                // pre-sorted array of v_cash_flow_events rows
  total,                 // signed number for the header total
  totalDirection = type, // 'inflow' renders + prefix, 'expense' renders − prefix, transfer renders unsigned
  onOpen,                // optional () => void — opens BatchDetailModal for editing
  // eslint-disable-next-line no-unused-vars
  tagFor, onChipClick, draggingId, setDraggingId, setDropTarget,
}) {
  if (!events || events.length === 0) return null
  const style = TYPE_STYLE[type] || TYPE_STYLE.expense

  const paidCount = events.filter(e => isPaidStatus(e.status)).length
  const planCount = events.length - paidCount
  const mixed = paidCount > 0 && planCount > 0
  const mixedLabel = mixed
    ? `(${paidCount} ${type === 'inflow' ? 'received' : 'paid'} · ${planCount} planned)`
    : null

  const headerAmount = totalDirection === 'transfer'
    ? fmtMoneyExact(Math.abs(Number(total || 0)))
    : fmtMoneySigned(Math.abs(Number(total || 0)), totalDirection === 'inflow' ? 'inflow' : 'outflow')

  const Tag = onOpen ? 'button' : 'div'
  const interactiveProps = onOpen
    ? { type: 'button', onClick: onOpen, className: 'w-full text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer' }
    : { className: '' }

  return (
    <Tag
      {...interactiveProps}
      className={`block rounded-lg bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 px-3 py-2.5 ${interactiveProps.className || ''}`}
      style={{ borderLeft: `3px solid ${style.accent}`, minHeight: 70 }}
    >
      <div className={`text-[12px] font-medium leading-tight ${style.titleText}`}>{title}</div>
      <div className={`mt-1 text-[16px] font-mono font-medium leading-tight whitespace-nowrap ${style.totalText}`}>
        {headerAmount}
      </div>
      <div className="mt-1 text-[10px] text-gray-500 dark:text-slate-500 leading-tight">
        {events.length} {events.length === 1 ? 'line' : 'lines'}
        {mixedLabel && <span className="italic ml-1">{mixedLabel}</span>}
      </div>
    </Tag>
  )
}
