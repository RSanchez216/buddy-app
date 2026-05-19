import { useState } from 'react'
import { fmtMoneyExact, fmtMoneySigned, isPaidStatus } from './calendarUtils'

// One collapsible card per flow type per day.
// Replaces per-row chip rendering for inflows / transfers / expenses.
// Loans and adjustments stay individual.

const TYPE_STYLE = {
  inflow: {
    accent: '#16A34A',
    headerText: 'text-[#27500A] dark:text-emerald-300',
    totalText:  'text-emerald-700 dark:text-emerald-400',
    chevron:    'text-emerald-700/60 dark:text-emerald-400/70',
  },
  transfer: {
    accent: '#0E7490',
    headerText: 'text-[#0E7490] dark:text-cyan-300',
    totalText:  'text-cyan-700 dark:text-cyan-300',
    chevron:    'text-cyan-700/60 dark:text-cyan-300/70',
  },
  expense: {
    accent: '#B91C1C',
    headerText: 'text-[#791F1F] dark:text-red-300',
    totalText:  'text-red-700 dark:text-red-400',
    chevron:    'text-red-700/60 dark:text-red-400/70',
  },
}

export default function BatchCard({
  type,                  // 'inflow' | 'transfer' | 'expense'
  title,                 // 'Inflows' / 'Transfers' / 'Expenses'
  events,                // pre-sorted array of v_cash_flow_events rows
  total,                 // signed number for the header total
  totalDirection = type, // 'inflow' renders + prefix, 'expense' renders − prefix, transfer renders unsigned
  tagFor,                // (event) => string — small per-line category tag
  onChipClick,
  draggingId,
  setDraggingId,
  setDropTarget,
}) {
  const [expanded, setExpanded] = useState(false)
  if (!events || events.length === 0) return null
  const style = TYPE_STYLE[type] || TYPE_STYLE.expense

  // Mixed-status subtitle: only shown when both paid/received and pending rows exist
  const paidCount = events.filter(e => isPaidStatus(e.status)).length
  const planCount = events.length - paidCount
  const mixed = paidCount > 0 && planCount > 0
  const mixedLabel = mixed
    ? `(${paidCount} ${type === 'inflow' ? 'received' : 'paid'} · ${planCount} planned)`
    : null

  const headerAmount = totalDirection === 'transfer'
    ? fmtMoneyExact(Math.abs(Number(total || 0)))
    : fmtMoneySigned(Math.abs(Number(total || 0)), totalDirection === 'inflow' ? 'inflow' : 'outflow')

  return (
    <div
      className="rounded-lg bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 overflow-hidden"
      style={{ borderLeft: `3px solid ${style.accent}` }}
    >
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full px-2 py-1.5 flex items-baseline gap-1.5 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors text-left"
      >
        <span className={`text-[10px] leading-none mt-0.5 shrink-0 ${style.chevron}`} aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
        <span className={`text-[12px] font-semibold ${style.headerText}`}>{title}</span>
        <span className="text-[10px] text-gray-400 dark:text-slate-500 font-medium">
          · {events.length} {events.length === 1 ? 'line' : 'lines'}
        </span>
        {mixedLabel && (
          <span className="text-[10px] text-gray-400 dark:text-slate-500 italic ml-1 truncate">
            {mixedLabel}
          </span>
        )}
        <span className={`ml-auto text-[12px] font-mono font-semibold ${style.totalText} shrink-0`}>
          {headerAmount}
        </span>
      </button>

      {expanded && (
        <ul className="divide-y divide-gray-100 dark:divide-white/5">
          {events.map(ev => (
            <BatchLine
              key={ev.event_id}
              event={ev}
              tag={tagFor?.(ev)}
              onClick={onChipClick}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              setDropTarget={setDropTarget}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// One line item inside an expanded batch.
// Amount column is fixed-width tabular-nums so amounts line up.
function BatchLine({ event, tag, onClick, draggingId, setDraggingId, setDropTarget }) {
  const paid = isPaidStatus(event.status)
  const draggable = !!event.is_draggable && !paid
  const dragging = draggingId === event.event_id
  const isInflow = event.direction === 'inflow'
  // Transfers want unsigned amount on legs (the leg direction is conveyed
  // by the tag — Debit / Credit). Other inflows/outflows show +/− prefix.
  const isTransfer = event.reference_type === 'transfer_in'
    || event.reference_type === 'transfer_out'
    || event.reference_type === 'transfer'
  const amountText = isTransfer
    ? fmtMoneyExact(Math.abs(Number(event.amount || 0)))
    : fmtMoneySigned(event.amount, event.direction)
  const amountClass = isTransfer
    ? 'text-cyan-700 dark:text-cyan-300'
    : (isInflow ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')

  function handleDragStart(e) {
    if (!draggable) return
    e.dataTransfer.setData('text/plain', event.event_id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId?.(event.event_id)
  }

  return (
    <li
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={() => { setDraggingId?.(null); setDropTarget?.(null) }}
      onClick={() => onClick?.(event)}
      className={`flex items-baseline gap-1.5 px-2 py-1 text-[11px] ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } hover:bg-gray-50 dark:hover:bg-white/[0.02] ${paid ? 'opacity-55' : ''} ${dragging ? 'opacity-30' : ''}`}
      title={event.label || ''}
    >
      <span className={`font-mono font-semibold tabular-nums shrink-0 ${amountClass}`} style={{ minWidth: 72 }}>
        {amountText}
      </span>
      <span className="flex-1 truncate text-gray-700 dark:text-slate-300">
        {event.label || event.entity_name || ''}
      </span>
      {tag && (
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400">
          {tag}
        </span>
      )}
      {paid && (
        <svg className="w-3 h-3 shrink-0 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </li>
  )
}
