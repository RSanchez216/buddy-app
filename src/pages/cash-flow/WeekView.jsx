import { useState } from 'react'
import EventChip from './EventChip'
import { addDays, isToday, toISO } from './calendarUtils'

const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function WeekView({ weekStart, eventsByDate, onChipClick, onChipDrop }) {
  const [draggingId, setDraggingId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function handleDragOver(e, dateISO) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTarget !== dateISO) setDropTarget(dateISO)
  }

  function handleDrop(e, dateISO) {
    e.preventDefault()
    const eventId = e.dataTransfer.getData('text/plain')
    setDraggingId(null); setDropTarget(null)
    if (eventId && eventsByDate) {
      // Find original event from any day's bucket
      let dragged = null
      for (const list of Object.values(eventsByDate)) {
        const found = list.find(ev => ev.event_id === eventId)
        if (found) { dragged = found; break }
      }
      if (dragged && toISO(new Date(`${dragged.event_date}T00:00:00`)) !== dateISO) {
        onChipDrop?.(dragged, dateISO)
      }
    }
  }

  function handleDragLeave(e, dateISO) {
    if (dropTarget === dateISO) setDropTarget(null)
  }

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day, i) => {
        const iso = toISO(day)
        const events = eventsByDate?.[iso] || []
        // inflows first, then outflows
        const sorted = [...events].sort((a, b) => {
          if (a.direction === b.direction) return Number(b.amount) - Number(a.amount)
          return a.direction === 'inflow' ? -1 : 1
        })
        const today = isToday(day)
        const isDropTarget = dropTarget === iso
        return (
          <div
            key={iso}
            onDragOver={e => handleDragOver(e, iso)}
            onDrop={e => handleDrop(e, iso)}
            onDragLeave={e => handleDragLeave(e, iso)}
            className={`flex flex-col rounded-xl border ${
              today
                ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50/40 dark:bg-amber-500/5'
                : 'border-gray-200 dark:border-white/5 bg-white dark:bg-[#0d0d1f]'
            } ${isDropTarget ? 'ring-2 ring-orange-400 ring-offset-1 dark:ring-offset-transparent' : ''}`}
            style={{ minHeight: 200 }}
          >
            <div className={`px-2 py-1.5 border-b ${today ? 'border-amber-200 dark:border-amber-500/20' : 'border-gray-100 dark:border-white/5'}`}>
              <div className="flex items-baseline justify-between">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${today ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-slate-500'}`}>
                  {WEEK_LABELS[i]}
                </span>
                <span className={`text-sm font-semibold ${today ? 'text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-slate-300'}`}>
                  {day.getDate()}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {sorted.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[10px] text-gray-300 dark:text-slate-700 italic">—</div>
              ) : sorted.map(ev => (
                <EventChip
                  key={ev.event_id}
                  event={ev}
                  draggingId={draggingId}
                  onClick={onChipClick}
                  onDragStart={() => setDraggingId(ev.event_id)}
                  onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
