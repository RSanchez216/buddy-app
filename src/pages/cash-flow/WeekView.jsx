import { useState } from 'react'
import EventChip from './EventChip'
import { addDays, fmtMoneyShort, isToday, toISO } from './calendarUtils'
import { worstShortfallOnOrBefore } from './balanceCalc'

const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_BANKS_BEFORE_OVERFLOW = 5

export default function WeekView({
  weekStart,
  eventsByDate,
  dayBuckets,                 // { [iso]: { totals, banks } }
  groupByBank,                // bool
  projectionTimelines = {},   // { accountId: { account, byDate, firstShortfall } }
  onChipClick,
  onChipDrop,
}) {
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
        const today = isToday(day)
        const isDropTarget = dropTarget === iso
        const dayBucket = dayBuckets?.[iso]
        const shortfall = worstShortfallOnOrBefore(projectionTimelines, iso)

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
            style={{ minHeight: 240 }}
          >
            {/* Day header */}
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

            {/* Chips */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {events.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[10px] text-gray-300 dark:text-slate-700 italic">—</div>
              ) : groupByBank ? (
                <BankGroupedChips
                  bucket={dayBucket}
                  draggingId={draggingId}
                  setDraggingId={setDraggingId}
                  setDropTarget={setDropTarget}
                  onChipClick={onChipClick}
                />
              ) : (
                renderFlatChips(events, draggingId, setDraggingId, setDropTarget, onChipClick)
              )}
            </div>

            {/* Day footer — totals + by-bank + shortfall pill */}
            <DayFooter bucket={dayBucket} shortfall={shortfall} />
          </div>
        )
      })}
    </div>
  )
}

function renderFlatChips(events, draggingId, setDraggingId, setDropTarget, onChipClick) {
  const sorted = [...events].sort((a, b) => {
    if (a.direction === b.direction) return Number(b.amount) - Number(a.amount)
    return a.direction === 'inflow' ? -1 : 1
  })
  return sorted.map(ev => (
    <EventChip
      key={ev.event_id}
      event={ev}
      draggingId={draggingId}
      onClick={onChipClick}
      onDragStart={() => setDraggingId(ev.event_id)}
      onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
    />
  ))
}

// Group chips under bank section headers, sorted by |net| desc.
// Unassigned pinned to bottom.
function BankGroupedChips({ bucket, draggingId, setDraggingId, setDropTarget, onChipClick }) {
  if (!bucket) return null
  const banks = Object.entries(bucket.banks)
    .map(([key, b]) => ({ key, ...b, net: b.inflow - b.outflow }))
    .sort((a, b) => {
      if (!a.accountId && b.accountId) return 1
      if (a.accountId && !b.accountId) return -1
      return Math.abs(b.net) - Math.abs(a.net)
    })

  return banks.map(b => {
    const sortedEvents = [...b.events].sort((a, b) => {
      if (a.direction === b.direction) return Number(b.amount) - Number(a.amount)
      return a.direction === 'inflow' ? -1 : 1
    })
    return (
      <div key={b.key} className="space-y-1">
        <div className="flex items-baseline justify-between gap-2 px-1 pt-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 truncate">
            {b.name} <span className="font-normal text-gray-300 dark:text-slate-600">· {b.events.length}</span>
          </span>
          <span className={`text-[10px] font-mono font-semibold ${b.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {b.net >= 0 ? '+' : '−'}{fmtMoneyShort(Math.abs(b.net))}
          </span>
        </div>
        <div className="space-y-1 pl-1.5">
          {sortedEvents.map(ev => (
            <EventChip
              key={`${b.key}:${ev.event_id}`}
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
  })
}

function DayFooter({ bucket, shortfall }) {
  const [showAllBanks, setShowAllBanks] = useState(false)
  if (!bucket) return null

  const inflow = bucket.totals.inflow
  const outflow = bucket.totals.outflow
  const net = inflow - outflow
  const hasEvents = inflow > 0 || outflow > 0

  // By-bank list — sorted by |net| desc, with Unassigned pinned to bottom.
  // Hide Unassigned row entirely if it has zero net AND zero in/outflow
  // (per the spec example: "Unassigned −$0   (hide if zero)").
  const banks = Object.entries(bucket.banks)
    .map(([key, b]) => ({ key, ...b, net: b.inflow - b.outflow }))
    .filter(b => b.events.length > 0)
    .filter(b => b.accountId || (b.inflow !== 0 || b.outflow !== 0))
    .sort((a, b) => {
      if (!a.accountId && b.accountId) return 1
      if (a.accountId && !b.accountId) return -1
      return Math.abs(b.net) - Math.abs(a.net)
    })

  const visibleBanks = showAllBanks ? banks : banks.slice(0, MAX_BANKS_BEFORE_OVERFLOW)
  const hidden = banks.length - visibleBanks.length

  return (
    <div className="px-2 py-2 border-t border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.015] rounded-b-xl space-y-1.5">
      <FooterRow label="Inflow"  value={`+${fmtMoneyShort(inflow)}`}  positive />
      <FooterRow label="Outflow" value={`−${fmtMoneyShort(outflow)}`} negative />
      <div className="border-t border-gray-100 dark:border-white/5 pt-1">
        <FooterRow
          label="Net"
          value={`${net >= 0 ? '+' : '−'}${fmtMoneyShort(Math.abs(net))}`}
          positive={net >= 0}
          negative={net < 0}
          bold
        />
      </div>

      {hasEvents && banks.length > 0 && (
        <div className="pt-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1">By bank</p>
          <ul className="space-y-0.5">
            {visibleBanks.map(b => (
              <li key={b.key} className="flex items-baseline justify-between gap-1.5 text-[11px]">
                <span className="text-gray-500 dark:text-slate-400 truncate">{b.name}</span>
                <span className={`font-mono font-semibold ${b.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {b.net >= 0 ? '+' : '−'}{fmtMoneyShort(Math.abs(b.net))}
                </span>
              </li>
            ))}
            {hidden > 0 && (
              <li>
                <button
                  onClick={() => setShowAllBanks(true)}
                  className="text-[10px] text-orange-600 dark:text-orange-400 hover:underline"
                >
                  +{hidden} more
                </button>
              </li>
            )}
          </ul>
        </div>
      )}

      {shortfall && (
        <div className="mt-1.5 inline-flex w-full items-center gap-1 px-1.5 py-1 rounded bg-red-50 dark:bg-red-500/10 text-[10px] text-red-700 dark:text-red-400">
          <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
          <span className="truncate">
            <span className="font-semibold">⚠ Shortfall:</span> {shortfall.account.name} −{fmtMoneyShort(Math.abs(shortfall.balance))}
          </span>
        </div>
      )}
    </div>
  )
}

function FooterRow({ label, value, positive, negative, bold }) {
  const colorClass =
    positive ? 'text-emerald-600 dark:text-emerald-400'
    : negative ? 'text-red-600 dark:text-red-400'
    : 'text-gray-700 dark:text-slate-300'
  return (
    <div className="flex items-baseline justify-between gap-1.5 text-[11px]">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : 'font-semibold'} ${colorClass}`}>{value}</span>
    </div>
  )
}
