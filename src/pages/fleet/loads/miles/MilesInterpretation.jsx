// Timeframe-aware plain-language read of the current Miles & Performance view,
// with one region / one dispatcher / one driver worth attention (each paired
// with a bright spot). Numbers + selections come from the RPC
// (report_miles_interpretation); wording is composed here so it stays tunable.
// Speaks only in deadhead %, RPM, and loaded-mile volume — never profit.

import { n0, loadsLabel, pctS, rpmS, rpmPhrase, monthNameOf } from './milesInterpText'

const RED = 'text-red-600 dark:text-red-400'
const GREEN = 'text-emerald-600 dark:text-emerald-400'
const MUTED = 'text-gray-500 dark:text-slate-400'

// up on deadhead = worse = red; down = better = green; steady = neutral.
function trendPhrase(trend, d) {
  if (trend === 'up') return <span className={`font-semibold ${RED}`}>up {Number(d).toFixed(1)}pt</span>
  if (trend === 'down') return <span className={`font-semibold ${GREEN}`}>down {Math.abs(Number(d)).toFixed(1)}pt</span>
  return <span className={`font-semibold ${MUTED}`}>about level</span>
}
function trendWord(trend) {
  if (trend === 'up') return <span className={`font-semibold ${RED}`}>trending the wrong way</span>
  if (trend === 'down') return <span className={`font-semibold ${GREEN}`}>improving</span>
  return <span className={`font-semibold ${MUTED}`}>holding steady</span>
}
// Bold count + correctly-pluralised "load(s)" — mirrors loadsLabel().
function Loads({ n }) {
  return <><strong className="font-semibold text-gray-900 dark:text-white">{n0(n)}</strong> load{Number(n) === 1 ? '' : 's'}</>
}

function Verdict({ interp }) {
  const { grain, overall, prev, dh_delta, dh_trend, rpm_trend } = interp
  const cls = 'text-sm text-gray-700 dark:text-slate-300 leading-relaxed'
  const hasPrev = prev && prev.dh != null

  if (grain === 'day') {
    return (
      <p className={cls}>
        Partial day so far — <Loads n={overall.loads} /> at {pctS(overall.dh)} deadhead
        {hasPrev && <>, vs yesterday&apos;s {pctS(prev.dh)} for reference</>}. A single day is a pulse, not a trend — the callouts below sit on small samples.
      </p>
    )
  }
  if (grain === 'week') {
    return (
      <p className={cls}>
        Week to date: <Loads n={overall.loads} />, {pctS(overall.dh)} deadhead
        {hasPrev && <> — {trendPhrase(dh_trend, dh_delta)} vs the same point last week ({pctS(prev.dh)}), and RPM {rpmPhrase(rpm_trend)} to {rpmS(overall.rpm)} from {rpmS(prev.rpm)}</>}.
      </p>
    )
  }
  if (grain === 'month') {
    return (
      <p className={cls}>
        {monthNameOf(interp.period_start)} MTD: <Loads n={overall.loads} />, {pctS(overall.dh)} deadhead
        {hasPrev && <> vs {pctS(prev.dh)} at this point last month ({trendWord(dh_trend)}), and RPM {rpmPhrase(rpm_trend)} to {rpmS(overall.rpm)} from {rpmS(prev.rpm)}</>}. Volume is healthy; empty miles are the leak.
      </p>
    )
  }
  // custom — no prior period
  return (
    <p className={cls}>
      Selected range: <Loads n={overall.loads} />, {pctS(overall.dh)} deadhead, {rpmS(overall.rpm)} RPM loaded. Custom ranges are summarized, not compared — pick a comparison range for a delta.
    </p>
  )
}

function Callout({ icon, title, flag, bright, reason, context, ring }) {
  return (
    <div className={`relative rounded-lg border border-l-2 border-gray-200 border-l-orange-500 dark:border-white/10 dark:border-l-orange-500 bg-white dark:bg-white/[0.03] p-3 ${ring ? 'ring-1 ring-orange-500/40' : ''}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
        {icon}{title}
      </div>
      {flag ? (
        <>
          <div className="mt-1 text-sm font-semibold text-orange-600 dark:text-orange-400 truncate" title={flag.name}>{flag.name}</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            <span className="font-semibold text-orange-600 dark:text-orange-400">{pctS(flag.dh)}</span> · {reason}
          </div>
        </>
      ) : (
        <div className="mt-1 text-sm text-gray-400 dark:text-slate-500">Not enough data to flag</div>
      )}
      {bright && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
          <CheckIcon /> <span className="truncate" title={bright.name}>{bright.name}</span> · {pctS(bright.dh)}
        </div>
      )}
      {context && <div className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">{context}</div>}
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

export default function MilesInterpretation({ interp, error, periodText, activeTab }) {
  if (error) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-white/10 px-4 py-3 text-xs text-gray-400 dark:text-slate-500">
        Interpretation unavailable right now — the rest of the report is unaffected.
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

  const partial = !!interp.partial
  const pill = partial ? (interp.grain === 'month' ? 'MTD' : 'to date') : null
  const zero = !interp.overall || Number(interp.overall.loads) === 0

  const region = interp.region || {}
  const dispatcher = interp.dispatcher || {}
  const driver = interp.driver || {}

  const regionReason = region.flag
    ? `${loadsLabel(region.flag.loads)}${region.top && region.flag.name === region.top.name ? ' — highest-impact target' : ''}`
    : null
  const regionContext = region.top ? `${region.top.name} carries the volume — ${loadsLabel(region.top.loads)} at ${pctS(region.top.dh)}` : null
  const dispReason = dispatcher.flag ? `${loadsLabel(dispatcher.flag.loads)} running hot` : null
  const driverReason = driver.flag
    ? `${loadsLabel(driver.flag.loads)}${Number(driver.flag.loads) >= 15 ? ' — volume + empty = real money' : ' — watch'}`
    : null

  return (
    <FrameCard>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400">Interpretation</h2>
        {periodText && <span className="text-xs text-gray-500 dark:text-slate-400">· {periodText}</span>}
        {pill && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300">{pill}</span>}
      </div>

      {zero ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">No delivered loads in this range yet.</p>
      ) : (
        <>
          <Verdict interp={interp} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Callout icon={<PinIcon />} title="Region" flag={region.flag} bright={region.bright} reason={regionReason} context={regionContext} ring={activeTab === 'region'} />
            <Callout icon={<HeadsetIcon />} title="Dispatcher" flag={dispatcher.flag} bright={dispatcher.bright} reason={dispReason} ring={activeTab === 'dispatcher'} />
            <Callout icon={<WheelIcon />} title="Driver" flag={driver.flag} bright={driver.bright} reason={driverReason} ring={activeTab === 'driver'} />
          </div>
        </>
      )}

      <p className="text-[11px] text-gray-400 dark:text-slate-500 border-t border-gray-100 dark:border-white/5 pt-2">
        Reads deadhead %, RPM, and loaded-mile volume — never profit (gross here is freight volume, ~56% pass-through).
      </p>
    </FrameCard>
  )
}

// ── tiny inline icons ────────────────────────────────────────────────────────
function CheckIcon() {
  return <svg className="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10l4 4 8-9" /></svg>
}
function PinIcon() {
  return <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
}
function HeadsetIcon() {
  return <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13a8 8 0 0 1 16 0" /><rect x="3" y="13" width="4" height="6" rx="1" /><rect x="17" y="13" width="4" height="6" rx="1" /><path d="M20 19a3 3 0 0 1-3 3h-2" /></svg>
}
function WheelIcon() {
  return <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /><path d="M12 14.5V21M9.8 11 4 8M14.2 11 20 8" /></svg>
}
