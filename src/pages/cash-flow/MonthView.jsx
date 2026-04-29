import {
  startOfMonth, endOfMonth, startOfMonthGrid, endOfMonthGrid,
  addDays, isToday, toISO, fmtMoneyShort, isPaidStatus,
} from './calendarUtils'

const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function MonthView({ monthAnchor, eventsByDate, showPaid, onDayClick }) {
  const monthStart = startOfMonth(monthAnchor)
  const monthEnd = endOfMonth(monthAnchor)
  const gridStart = startOfMonthGrid(monthAnchor)
  const gridEnd = endOfMonthGrid(monthAnchor)

  const days = []
  let cursor = gridStart
  while (cursor <= gridEnd) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-2">
        {WEEK_LABELS.map(label => (
          <div key={label} className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 px-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2" style={{ gridAutoRows: 'minmax(110px, auto)' }}>
        {days.map(day => {
          const iso = toISO(day)
          const events = eventsByDate?.[iso] || []

          // Split paid vs pending so the day cell can show them separately
          let inPending = 0, outPending = 0, paidIn = 0, paidOut = 0
          for (const e of events) {
            const amt = Number(e.amount || 0)
            const settled = isPaidStatus(e.status)
            if (e.direction === 'inflow') {
              if (settled) paidIn += amt; else inPending += amt
            } else {
              if (settled) paidOut += amt; else outPending += amt
            }
          }
          const net = inPending - outPending
          const inMonth = day >= monthStart && day <= monthEnd
          const today = isToday(day)
          const settledTotal = paidIn + paidOut

          return (
            <button
              key={iso}
              onClick={() => onDayClick?.(day)}
              className={`flex flex-col items-start text-left rounded-xl border transition-all p-2 ${
                inMonth
                  ? 'bg-white dark:bg-[#0d0d1f] border-gray-200 dark:border-white/5 hover:border-orange-300 dark:hover:border-orange-500/30'
                  : 'bg-gray-50 dark:bg-white/[0.02] border-gray-100 dark:border-white/5 opacity-60'
              } ${today ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50/40 dark:bg-amber-500/5' : ''}`}
            >
              <span className={`text-sm font-semibold ${today ? 'text-amber-700 dark:text-amber-300' : inMonth ? 'text-gray-700 dark:text-slate-300' : 'text-gray-400 dark:text-slate-600'}`}>
                {day.getDate()}
              </span>
              {events.length > 0 && (
                <div className="mt-1 space-y-0.5 w-full">
                  <div className="text-[10px] text-gray-500 dark:text-slate-500">{events.length} event{events.length === 1 ? '' : 's'}</div>
                  {inPending > 0 && (
                    <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">+ {fmtMoneyShort(inPending)}</div>
                  )}
                  {outPending > 0 && (
                    <div className="text-[11px] font-semibold text-red-600 dark:text-red-400">− {fmtMoneyShort(outPending)}</div>
                  )}
                  {(inPending > 0 || outPending > 0) && (
                    <div className={`text-[10px] font-medium ${net >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                      Net {net >= 0 ? '+' : '−'} {fmtMoneyShort(Math.abs(net))}
                    </div>
                  )}
                  {showPaid && settledTotal > 0 && (
                    <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 opacity-80 flex items-center gap-1">
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {fmtMoneyShort(settledTotal)} settled
                    </div>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
