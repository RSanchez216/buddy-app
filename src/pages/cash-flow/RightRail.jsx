import { fmtMoney, fmtMoneyExact, addDays, toISO } from './calendarUtils'

export default function RightRail({
  mode = 'week',
  setMode,
  // Week-mode props
  weekStart, startingCash, inflowSum, outflowSum, paidOutSum, receivedInSum,
  showPaid, byBank = [], shortfall, accountsMissingBalance = 0,
  onEditCash,
  // Day-mode props
  selectedDay, setSelectedDay,
  dayBucket, dayShortfall, dayProjections = [],
  // Stale-balance prompt props — passed through to DayPanel.
  // needsUpdateIdSet is a Set<accountId> for O(1) row-level lookup;
  // onRecordBalance(account) opens the parent's modal.
  needsUpdateIdSet, onRecordBalance,
}) {
  return (
    <aside className="space-y-3 sticky top-2 self-start">
      <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-4 space-y-3">
        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-xl">
          <button
            onClick={() => setMode?.('week')}
            className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded-lg transition-all ${
              mode === 'week'
                ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm'
                : 'text-gray-500 dark:text-slate-400'
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setMode?.('day')}
            className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded-lg transition-all ${
              mode === 'day'
                ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm'
                : 'text-gray-500 dark:text-slate-400'
            }`}
          >
            Day
          </button>
        </div>

        {mode === 'week' ? (
          <WeekPanel
            weekStart={weekStart}
            startingCash={startingCash}
            inflowSum={inflowSum}
            outflowSum={outflowSum}
            paidOutSum={paidOutSum}
            receivedInSum={receivedInSum}
            showPaid={showPaid}
            byBank={byBank}
            shortfall={shortfall}
            accountsMissingBalance={accountsMissingBalance}
            onEditCash={onEditCash}
          />
        ) : (
          <DayPanel
            weekStart={weekStart}
            selectedDay={selectedDay}
            setSelectedDay={setSelectedDay}
            dayBucket={dayBucket}
            dayShortfall={dayShortfall}
            dayProjections={dayProjections}
            needsUpdateIdSet={needsUpdateIdSet}
            onRecordBalance={onRecordBalance}
          />
        )}
      </div>
    </aside>
  )
}

function WeekPanel({
  weekStart, startingCash, inflowSum, outflowSum, paidOutSum, receivedInSum,
  showPaid, byBank, shortfall, accountsMissingBalance, onEditCash,
}) {
  const net = (inflowSum || 0) - (outflowSum || 0)
  const projected = (Number(startingCash) || 0) + net
  const positive = net >= 0
  const projPositive = projected >= 0
  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">This Week</span>
        <span className="text-[10px] text-gray-400 dark:text-slate-600">{startStr}</span>
      </div>

      <Row
        label="Starting cash"
        value={startingCash != null ? fmtMoney(startingCash) : '—'}
        mono
        action={
          <button
            onClick={onEditCash}
            title="Edit starting cash"
            className="text-gray-400 dark:text-slate-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20h9" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        }
      />

      <Row label="▲ Inflow expected" value={fmtMoney(inflowSum)} mono color="text-emerald-600 dark:text-emerald-400" />
      <Row label="▼ Outflow scheduled" value={fmtMoney(outflowSum)} mono color="text-red-600 dark:text-red-400" />

      {showPaid && (
        <div className="border-t border-gray-100 dark:border-white/5 pt-3 space-y-2">
          <Row label="✓ Paid this week"     value={fmtMoney(paidOutSum)}    mono color="text-emerald-600 dark:text-emerald-400" />
          <Row label="✓ Received this week" value={fmtMoney(receivedInSum)} mono color="text-emerald-600 dark:text-emerald-400" />
        </div>
      )}

      <div className="border-t border-gray-100 dark:border-white/5 pt-3">
        <Row
          label="Net"
          value={(positive ? '+ ' : '− ') + fmtMoney(Math.abs(net)).replace('$', '$')}
          mono
          color={positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
          bold
        />
      </div>

      {byBank.length > 0 && (
        <div className="border-t border-gray-100 dark:border-white/5 pt-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">By bank</p>
          {byBank.map(b => (
            <div key={b.accountId || '__unassigned__'} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-gray-500 dark:text-slate-400 truncate">{b.name}</span>
              <span className={`font-mono font-semibold ${b.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {b.net >= 0 ? '+' : '−'}{fmtMoneyExact(Math.abs(b.net))}
              </span>
            </div>
          ))}
        </div>
      )}

      {shortfall && (
        <div className="rounded-xl p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs">
          <p className="font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
            Shortfall this week
          </p>
          <p className="text-red-700 dark:text-red-400 mt-1">
            <span className="font-semibold">{shortfall.account.name}</span>{' '}
            <span className="font-mono">−{fmtMoneyExact(Math.abs(shortfall.lowest))}</span>{' '}
            <span className="text-red-600/80 dark:text-red-400/80">by {shortDay(shortfall.firstNegDate)}</span>
          </p>
        </div>
      )}

      {accountsMissingBalance > 0 && (
        <div className="rounded-xl p-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-400">
          ℹ {accountsMissingBalance} account{accountsMissingBalance === 1 ? '' : 's'} missing balance — projection partial.
          Set balances in Settings → Funding & Sources.
        </div>
      )}

      <div className={`rounded-xl p-3 ${
        projPositive
          ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20'
          : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20'
      }`}>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Projected end of week</p>
        <p className={`text-lg font-bold font-mono ${projPositive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
          {fmtMoney(projected)}
        </p>
      </div>
    </>
  )
}

function DayPanel({ weekStart, selectedDay, setSelectedDay, dayBucket, dayShortfall, dayProjections, needsUpdateIdSet, onRecordBalance }) {
  if (!selectedDay) {
    return (
      <p className="text-xs text-gray-500 dark:text-slate-400 py-4 text-center">
        Click a day in the calendar to see its breakdown.
      </p>
    )
  }

  const wsISO = toISO(weekStart)
  const weISO = toISO(addDays(weekStart, 6))
  const todayISO = toISO(new Date())

  function shiftDay(delta) {
    const d = new Date(`${selectedDay}T00:00:00`)
    const next = toISO(addDays(d, delta))
    if (next < wsISO || next > weISO) return
    setSelectedDay?.(next)
  }
  function jumpToday() {
    if (todayISO >= wsISO && todayISO <= weISO) setSelectedDay?.(todayISO)
  }

  const canBack = selectedDay > wsISO
  const canFwd = selectedDay < weISO
  const dateObj = new Date(`${selectedDay}T00:00:00`)
  const headerLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()

  const inflow = dayBucket?.totals?.inflow || 0
  const outflow = dayBucket?.totals?.outflow || 0
  const net = inflow - outflow
  const positive = net >= 0

  const banks = dayBucket
    ? Object.entries(dayBucket.banks)
        .map(([key, b]) => ({ key, ...b, net: b.inflow - b.outflow }))
        .filter(b => b.events.length > 0)
        .filter(b => b.accountId || (b.inflow !== 0 || b.outflow !== 0))
        .sort((a, b) => {
          if (!a.accountId && b.accountId) return 1
          if (a.accountId && !b.accountId) return -1
          return Math.abs(b.net) - Math.abs(a.net)
        })
    : []

  return (
    <>
      {/* Header w/ nav. Click label jumps to today (when today is in week). */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => shiftDay(-1)}
          disabled={!canBack}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-gray-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous day"
        >‹</button>
        <button
          onClick={jumpToday}
          title="Jump to today"
          className="text-[10px] font-bold uppercase tracking-widest text-gray-700 dark:text-slate-300 hover:text-orange-600 dark:hover:text-orange-400 transition-colors text-center flex-1 truncate"
        >
          {headerLabel}
        </button>
        <button
          onClick={() => shiftDay(1)}
          disabled={!canFwd}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-gray-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next day"
        >›</button>
      </div>

      <Row label="▲ Inflow"  value={fmtMoney(inflow)}  mono color="text-emerald-600 dark:text-emerald-400" />
      <Row label="▼ Outflow" value={fmtMoney(outflow)} mono color="text-red-600 dark:text-red-400" />
      <div className="border-t border-gray-100 dark:border-white/5 pt-3">
        <Row
          label="Net"
          value={(positive ? '+ ' : '− ') + fmtMoney(Math.abs(net))}
          mono
          bold
          color={positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
        />
      </div>

      {/* By bank — full list, no truncation */}
      {banks.length > 0 && (
        <div className="border-t border-gray-100 dark:border-white/5 pt-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">By bank</p>
          {banks.map(b => (
            <div key={b.key} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-gray-500 dark:text-slate-400 truncate">{b.name}</span>
              <span className={`font-mono font-semibold ${b.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {b.net >= 0 ? '+' : '−'}{fmtMoneyExact(Math.abs(b.net))}
              </span>
            </div>
          ))}
        </div>
      )}

      {dayShortfall && (
        <div className="rounded-xl p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs">
          <p className="font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
            Shortfall on this day
          </p>
          <p className="text-red-700 dark:text-red-400 mt-1">
            <span className="font-semibold">{dayShortfall.account.name}</span>{' '}
            <span className="font-mono">−{fmtMoneyExact(Math.abs(dayShortfall.balance))}</span>
          </p>
        </div>
      )}

      {/* Projected end of day per bank */}
      {dayProjections.length > 0 && (
        <div className="border-t border-gray-100 dark:border-white/5 pt-3 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Projected end of day</p>
          {dayProjections.map(({ account, balance }) => {
            const hasBalance = balance != null
            const positive = hasBalance && balance >= 0
            // "Update" inline link surfaces when this account is in
            // the staleness-and-has-movement set from Slice 2c. Same
            // semantics as the banner above the calendar — opens the
            // Record Balance modal for this specific account. Subtle
            // blue so it doesn't compete with the balance number.
            const needsUpdate = needsUpdateIdSet?.has?.(account.id)
            return (
              <div key={account.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-gray-500 dark:text-slate-400 truncate">{account.name}</span>
                <div className="flex items-baseline gap-2 shrink-0">
                  {needsUpdate && onRecordBalance && (
                    <button
                      type="button"
                      onClick={() => onRecordBalance(account)}
                      className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      title={`Record today's actual balance for ${account.name}`}
                    >
                      Update
                    </button>
                  )}
                  {hasBalance ? (
                    <span className={`font-mono font-semibold ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {positive ? '' : '−'}{fmtMoney(Math.abs(balance))}
                    </span>
                  ) : (
                    <span className="text-[10px] italic text-gray-400 dark:text-slate-600">balance not set</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function Row({ label, value, mono, color, bold, action }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
        {action}
      </div>
      <span className={`${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : 'font-semibold'} text-sm ${color || 'text-gray-700 dark:text-slate-300'}`}>
        {value}
      </span>
    </div>
  )
}

function shortDay(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}
