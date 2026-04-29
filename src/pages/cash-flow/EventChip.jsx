import { chipPalette, fmtMoneySigned, isPaidStatus } from './calendarUtils'

// Darker accent stripe for the "settled" left-border on paid/received chips.
// Matches the chip's category but a shade darker, so it reads as "done"
// without competing with the dashed red border used for recurring instances.
function paidAccentColor(event) {
  if (event.direction === 'inflow') return '#16A34A'        // emerald-600
  switch (event.reference_type) {
    case 'loan':                          return '#B45309'  // amber-700
    case 'invoice':                       return '#1D4ED8'  // blue-700
    case 'recurring':
    case 'custom':
    default:                              return '#B91C1C'  // red-700
  }
}

export default function EventChip({ event, onClick, onDragStart, onDragEnd, draggingId }) {
  const palette = chipPalette(event)
  const paid = isPaidStatus(event.status)
  // Paid chips can't be dragged or rescheduled — they're history.
  const draggable = !!event.is_draggable && !paid
  const isRecurring = event.reference_type === 'recurring' || event.category === 'recurring'
  const isLoan = event.reference_type === 'loan'
  const isDragging = draggingId === event.event_id

  // Recurring uses dashed red; paid uses solid darker color. Paid wins if both apply.
  let leftStyle
  if (paid) {
    leftStyle = { borderLeft: `3px solid ${paidAccentColor(event)}`, paddingLeft: 6 }
  } else if (isRecurring) {
    leftStyle = { borderLeft: '2px dashed #E24B4A', paddingLeft: 7 }
  }

  function handleDragStart(e) {
    if (!draggable) return
    e.dataTransfer.setData('text/plain', event.event_id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart?.(event)
  }

  // Muted opacity for the whole chip when paid/received
  const opacityClass = isDragging ? 'opacity-30' : (paid ? 'opacity-55' : 'opacity-100')

  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onClick?.(event)}
      title={paid
        ? `✓ ${event.direction === 'inflow' ? 'Received' : 'Paid'}: ${event.label || ''}`
        : isRecurring ? `↻ Recurring: ${event.label || ''}` : event.label || ''}
      style={leftStyle}
      className={`group relative w-full text-left px-2 py-1 rounded-lg ${palette.bg} ${palette.text} ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${opacityClass} hover:ring-2 hover:ring-orange-400/40 transition-all`}
    >
      <div className="flex items-center gap-1">
        <span className="text-[12px] font-semibold leading-tight truncate">
          {fmtMoneySigned(event.amount, event.direction)}
        </span>
        {paid ? (
          <svg className="w-3 h-3 ml-auto shrink-0 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : isLoan ? (
          <svg className="w-3 h-3 ml-auto opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        ) : isRecurring ? (
          <svg className="w-3 h-3 ml-auto opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : null}
      </div>
      <div className="text-[11px] leading-tight truncate" style={{ opacity: 0.75 }}>
        {event.label || event.entity_name || ''}
      </div>
    </button>
  )
}
