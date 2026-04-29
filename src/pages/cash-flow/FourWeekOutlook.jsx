import { addDays, fmtMoneyShort, isSameDay, startOfWeek } from './calendarUtils'

export default function FourWeekOutlook({ baseWeekStart, weeks, showPaid, onJumpToWeek }) {
  const today = startOfWeek(new Date())

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {weeks.map(w => {
        const isCurrent = isSameDay(w.weekStart, today)
        const start = w.weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const end = addDays(w.weekStart, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const net = (w.inflow || 0) - (w.outflow || 0)
        const positive = net >= 0
        return (
          <button
            key={w.weekStart.toISOString()}
            onClick={() => onJumpToWeek?.(w.weekStart)}
            className={`text-left rounded-2xl border p-4 transition-colors hover:border-orange-300 dark:hover:border-orange-500/30 ${
              isCurrent
                ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50/40 dark:bg-orange-500/5'
                : 'border-gray-200 dark:border-white/5 bg-white dark:bg-[#0d0d1f]'
            }`}
          >
            <p className="text-[11px] font-medium text-gray-500 dark:text-slate-500">
              {start} – {end}
              {isCurrent && <span className="ml-1 text-orange-600 dark:text-orange-400 font-semibold uppercase tracking-wide">· this week</span>}
            </p>
            <div className="mt-3 space-y-1">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-gray-500 dark:text-slate-400">▲ In</span>
                <span className="font-semibold font-mono text-emerald-600 dark:text-emerald-400">{fmtMoneyShort(w.inflow)}</span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-gray-500 dark:text-slate-400">▼ Out</span>
                <span className="font-semibold font-mono text-red-600 dark:text-red-400">{fmtMoneyShort(w.outflow)}</span>
              </div>
              {showPaid && (
                <div className="flex items-baseline justify-between text-xs pt-1 border-t border-gray-100 dark:border-white/5">
                  <span className="text-gray-400 dark:text-slate-500">✓ Paid</span>
                  <span className="font-medium font-mono text-emerald-600 dark:text-emerald-400 opacity-80">{fmtMoneyShort(w.paidOut)}</span>
                </div>
              )}
            </div>
            <div className={`mt-3 rounded-lg p-2 ${
              positive
                ? 'bg-emerald-50 dark:bg-emerald-500/10'
                : 'bg-red-50 dark:bg-red-500/10'
            }`}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Net</span>
                <span className={`text-sm font-bold font-mono ${positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {positive ? '+' : '−'} {fmtMoneyShort(Math.abs(net))}
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
