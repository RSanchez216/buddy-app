// Page-level interpretation card for the Dispatcher Scorecard — blends all four
// lenses (performance, momentum, efficiency, Amazon) and adapts to the timeframe
// toggle (month → MTD, quarter → QTD, half → HTD, year → YTD). Numbers come from
// dispatcher_scorecard_interpretation; wording is composed here. Ranks on
// productivity + momentum + turnover, never raw revenue.
import { money, int } from './dispatcherData'

const RED = 'text-red-600 dark:text-red-400'
const GREEN = 'text-emerald-600 dark:text-emerald-400'
const GRAIN_WORD = { week: 'week', month: 'month', quarter: 'quarter', half: 'half', year: 'year', custom: 'period' }
const pct1 = (x) => `${Math.abs(Number(x)).toFixed(1)}%`
const timesX = (x) => `${Number(x).toFixed(1)}×`

// Left-accent + title colour per callout kind.
const ACCENT = {
  green: { border: 'border-l-emerald-500', title: GREEN },
  red: { border: 'border-l-red-500', title: RED },
  blue: { border: 'border-l-blue-500', title: 'text-blue-600 dark:text-blue-400' },
  amber: { border: 'border-l-amber-500', title: 'text-amber-600 dark:text-amber-400' },
}

function Delta({ x }) {
  const down = Number(x) < 0
  return <span className={`font-semibold ${down ? RED : GREEN}`}>{down ? 'down' : 'up'} {pct1(x)}</span>
}

function Verdict({ d }) {
  const grainWord = GRAIN_WORD[d.grain] || 'period'
  const o = d.overall || {}
  const eff = d.efficiency || {}
  const az = d.amazon || {}
  return (
    <p className="text-sm leading-relaxed text-gray-700 dark:text-slate-300">
      <strong className="font-semibold text-gray-900 dark:text-white">{d.period_label}{d.kind ? ` ${d.kind}` : ''}</strong>: {money(o.gross)} across {int(o.desks)} desks and {int(o.loads)} loads.{' '}
      {eff.spread_x != null && (
        <>Output per driver swings {timesX(eff.spread_x)} — {money(eff.top_pdm)} a driver-month at the top, {money(eff.bottom_pdm)} at the bottom.{' '}</>
      )}
      {d.gross_delta_pct != null && (
        <>Revenue is <Delta x={d.gross_delta_pct} /> vs the same point last {grainWord}.{' '}</>
      )}
      {Number(o.turnover) > 0 && (
        <>{int(o.turnover)} drivers changed desks.{' '}</>
      )}
      {Number(az.gross) > 0 && (
        az.delta_pct != null
          ? <>Amazon desks did {money(az.gross)}, <Delta x={az.delta_pct} />.</>
          : <>Amazon desks did {money(az.gross)} across {int(az.drivers)} drivers.</>
      )}
    </p>
  )
}

function Callout({ accent, label, title, lines, sub }) {
  const a = ACCENT[accent] || ACCENT.green
  return (
    <div className={`rounded-lg border border-l-2 border-gray-200 dark:border-white/10 ${a.border} bg-white dark:bg-white/[0.03] p-3`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold ${a.title}`} title={title}>{title}</div>
      {(lines || []).filter(Boolean).map((ln, i) => <div key={i} className="text-[11px] text-gray-500 dark:text-slate-400">{ln}</div>)}
      {sub && <div className="mt-0.5 text-[11px] text-gray-400 dark:text-slate-500">{sub}</div>}
    </div>
  )
}

function FrameCard({ children }) {
  return (
    <div className="rounded-xl bg-orange-50/40 dark:bg-orange-500/[0.05] p-2.5" style={{ borderWidth: '2px', borderStyle: 'solid', borderColor: '#F97316' }}>
      <div className="rounded-lg bg-white dark:bg-[#0d0d1f] shadow-sm p-4 space-y-3">{children}</div>
    </div>
  )
}

export default function ScorecardInterpretation({ interp, error }) {
  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-white/10 px-4 py-3 text-xs text-gray-400 dark:text-slate-500">
        Interpretation unavailable right now — the rest of the scorecard is unaffected.
      </div>
    )
  }
  if (!interp) {
    return (
      <FrameCard>
        <div className="h-4 w-40 rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
        <div className="h-3 w-full rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />)}
        </div>
      </FrameCard>
    )
  }

  const d = interp
  // Build up to three callouts, adapting to available data.
  const callouts = []
  if (d.top_desk) {
    callouts.push({
      accent: 'green', label: 'Top desk', title: d.top_desk.name,
      lines: [`${money(d.top_desk.per_driver_month)} / driver-mo`, money(d.top_desk.gross)], sub: 'Most productive',
    })
  }
  if (d.decliner) {
    callouts.push({
      accent: 'red', label: 'Needs attention', title: d.decliner.name,
      lines: [`down ${pct1(d.decliner.delta_pct)}`, `${money(d.decliner.prev_gross)} → ${money(d.decliner.gross)}`], sub: 'Steepest drop, same-point',
    })
  } else if (d.amazon && Number(d.amazon.drivers) >= 3) {
    callouts.push({
      accent: 'blue', label: 'Amazon', title: money(d.amazon.gross),
      lines: [`${int(d.amazon.drivers)} drivers`, d.amazon.delta_pct != null ? `${d.amazon.delta_pct < 0 ? 'down' : 'up'} ${pct1(d.amazon.delta_pct)}` : null], sub: 'Amazon freight',
    })
  } else if (d.gainer) {
    callouts.push({ accent: 'green', label: 'Biggest gainer', title: d.gainer.name, lines: [`up ${pct1(d.gainer.delta_pct)}`] })
  }
  if (d.retention) {
    // "— and a top desk" when the churning desk is also a big producer.
    const bigProducer = d.top_desk && d.retention.gross != null && Number(d.retention.gross) >= 0.6 * Number(d.top_desk.gross)
    callouts.push({
      accent: 'amber', label: 'Retention watch', title: d.retention.name,
      lines: [`${int(d.retention.turnover)} drivers left`], sub: `Highest turnover${bigProducer ? ' — and a top desk' : ''}`,
    })
  }

  return (
    <FrameCard>
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400">Interpretation</h2>
        {d.period_label && <span className="text-xs text-gray-500 dark:text-slate-400">· {d.period_label}</span>}
        {d.partial && d.kind && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300">{d.kind}</span>
        )}
      </div>

      <Verdict d={d} />

      {callouts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {callouts.map((c, i) => <Callout key={i} {...c} />)}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-gray-400 dark:text-slate-500 border-t border-gray-100 dark:border-white/5 pt-2">
        Ranks on productivity (gross per driver-month), momentum, and turnover — not raw revenue, so lean desks aren't buried by big ones.
        Comparisons are same-point{d.kind ? ` (${d.kind} vs the same point last period)` : ''}.
      </p>
    </FrameCard>
  )
}
