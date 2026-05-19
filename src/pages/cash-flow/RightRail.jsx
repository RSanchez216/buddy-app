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
  // Cover-with-transfer entry point. Called with
  //   { mode: 'cover', targetAccountId } or { mode: 'list', targetAccountId: null }
  // from the rail's cover block buttons. The parent owns modal state.
  onCoverShortfall,
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
            onCoverShortfall={onCoverShortfall}
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

function DayPanel({ weekStart, selectedDay, setSelectedDay, dayBucket, dayProjections, needsUpdateIdSet, onRecordBalance, onCoverShortfall }) {
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

  // Merge today's per-account net (from dayBucket) with projected end-of-day
  // (from dayProjections) into one row per account. Sort: positives first
  // (DESC by Proj EOD), negatives after (ASC — most negative last). Day
  // column footer already shows Inflow / Outflow / Net, so the rail drops
  // those redundant rows in favor of this combined per-account table.
  const rows = (dayProjections || []).map(({ account, balance }) => {
    const bank = dayBucket?.banks?.[account.id]
    const today = bank ? (Number(bank.inflow || 0) - Number(bank.outflow || 0)) : 0
    return { account, today, projEod: balance }
  })
  rows.sort((a, b) => {
    const aNeg = a.projEod != null && a.projEod < 0
    const bNeg = b.projEod != null && b.projEod < 0
    if (aNeg !== bNeg) return aNeg ? 1 : -1
    // Positives: DESC (biggest surplus first). Negatives: closer-to-zero
    // first, most-negative LAST — the crescendo reads downward to the
    // most painful shortfall. Nulls sink to the bottom of the positives.
    if (aNeg) return (b.projEod ?? 0) - (a.projEod ?? 0)
    return (b.projEod ?? -Infinity) - (a.projEod ?? -Infinity)
  })

  const negativeRows = rows.filter(r => r.projEod != null && r.projEod < 0)
  const totalShortfall = negativeRows.reduce((s, r) => s + Math.abs(r.projEod), 0)
  // After the sort, the most-negative row sits at the end of negativeRows.
  const biggestShortfall = negativeRows[negativeRows.length - 1]
  const surplusRows = rows.filter(r => r.projEod != null && r.projEod > 0)

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

      {/* Single combined per-account table — Today + Proj EOD.
          Inflow / Outflow / Net live in the day column footer (no need
          to duplicate here). BY BANK and PROJECTED END OF DAY are
          merged into this one block. */}
      {rows.length > 0 && (
        <div className="border-t border-gray-100 dark:border-white/5 pt-3">
          <div className="grid grid-cols-[1.8fr_0.7fr_0.95fr] gap-x-2 gap-y-0 items-baseline">
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Account</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 text-right">Today</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 text-right">Proj EOD</p>
            {rows.map(({ account, today, projEod }) => {
              const isNeg = projEod != null && projEod < 0
              const needsUpdate = needsUpdateIdSet?.has?.(account.id)
              const todayClass =
                today > 0 ? 'text-emerald-600 dark:text-emerald-400'
                : today < 0 ? 'text-red-600 dark:text-red-400'
                : 'text-gray-400 dark:text-slate-500'
              const eodClass =
                projEod == null ? 'text-gray-400 dark:text-slate-600 italic'
                : isNeg ? 'text-red-700 dark:text-red-400 font-bold'
                : 'text-gray-700 dark:text-slate-300'
              return (
                <div key={account.id} className={`contents`}>
                  {/* contents pseudo-row: 3 cells inherit grid placement.
                      The red tint on negative rows is painted by absolutely
                      positioning a background underlay through the row. We
                      simulate by tinting the three cells with the same bg. */}
                  <div className={`text-xs min-w-0 truncate py-1 -mx-2 px-2 rounded-l ${isNeg ? 'bg-red-50 dark:bg-red-500/10' : ''}`} title={account.name}>
                    <span className="text-gray-600 dark:text-slate-400">{account.name}</span>
                    {needsUpdate && onRecordBalance && (
                      <button
                        type="button"
                        onClick={() => onRecordBalance(account)}
                        className="ml-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        title={`Record today's actual balance for ${account.name}`}
                      >
                        Update
                      </button>
                    )}
                  </div>
                  <div className={`text-xs font-mono font-semibold py-1 px-1 text-right ${isNeg ? 'bg-red-50 dark:bg-red-500/10' : ''} ${todayClass}`}>
                    {today === 0 ? '—' : (today > 0 ? '+' : '−') + fmtMoneyExact(Math.abs(today))}
                  </div>
                  <div
                    className={`text-xs font-mono py-1 px-1 -mr-2 pr-2 text-right whitespace-nowrap rounded-r ${isNeg ? 'bg-red-50 dark:bg-red-500/10' : ''} ${eodClass}`}
                    title={projEod == null ? undefined : ((projEod < 0 ? '−' : '') + fmtMoney(Math.abs(projEod)))}
                  >
                    {projEod == null
                      ? 'not set'
                      : (projEod < 0 ? '−' : '') + fmtMoney(Math.abs(projEod))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Cover block — actionable shortfall summary.
          "Cover with transfer →" opens the cover modal targeted at the
          biggest shortfall; "View all" opens the same modal in list mode
          so the user can pick which negative account to cover first. */}
      {negativeRows.length > 0 && (
        <div
          className="rounded-xl p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs space-y-2"
          style={{ borderLeft: '3px solid #B91C1C' }}
        >
          <p className="font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
            </svg>
            <span className="truncate">
              {negativeRows.length} account{negativeRows.length === 1 ? '' : 's'} negative EOD ·{' '}
              <span className="font-mono">{fmtMoney(totalShortfall)}</span>
            </span>
          </p>
          {biggestShortfall && (
            <p className="text-red-700/85 dark:text-red-400/85 text-[11px]">
              <span className="font-semibold">{biggestShortfall.account.name}</span>{' '}
              needs the largest cover:{' '}
              <span className="font-mono">{fmtMoney(Math.abs(biggestShortfall.projEod))}</span>
            </p>
          )}
          {surplusRows.length === 0 && (
            <p className="text-[10px] italic text-red-700/70 dark:text-red-400/70">
              No accounts have surplus today. Any transfer will move the shortfall.
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onCoverShortfall?.({ mode: 'cover', targetAccountId: biggestShortfall?.account?.id })}
              className={
                surplusRows.length === 0
                  ? 'px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors'
                  : 'px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors'
              }
              title={surplusRows.length === 0 ? 'No accounts have surplus today' : `Cover ${biggestShortfall?.account?.name || ''}`}
            >
              Cover with transfer →
            </button>
            <button
              type="button"
              onClick={() => onCoverShortfall?.({ mode: 'list', targetAccountId: null })}
              className="text-[11px] font-medium text-red-700 dark:text-red-400 hover:underline"
            >
              View all
            </button>
          </div>
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
