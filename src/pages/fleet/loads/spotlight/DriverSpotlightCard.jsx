import { memo, useMemo } from 'react'
import { DriverStatusPill, DriverTypePill, trailerTypePillClasses } from '../../fleetUtils'
import { fmtMoney, fmtMoney2, fmtNum, fmtRpm, fmtDateShort, getCompFormulaLabels, monogram, nameHue, HEALTH_STYLES, parseYmd } from './spotlightShared'
import desert from '../../../../assets/spotlight-desert.svg'

// One driver's full dossier — the big card at the front of the deck.
// Everything on it is live BUDDY data except the "Unlocking next" section,
// which is deliberately number-free: fuel / insurance / driver pay aren't
// connected yet and we never invent margin.

// Dark identity hero with desert backdrop, driver watermark, and headshot
function Hero({ entry, photoUrl, hs }) {
  const truckLabel = entry.trucks.map(t => t.unit_number).filter(Boolean).join(', ')
  const trailerLabel = entry.trailers.map(t => t.unit_number).filter(Boolean).join(', ')
  const h = nameHue(entry.name)
  const initialsGradient = `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 42) % 360} 68% 34%))`

  return (
    <div className="relative h-56 overflow-hidden rounded-t-3xl">
      {/* Dark gradient base */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(100deg,#0b1220 0%,#131c2e 40%,#9a3412 80%,#ea580c 100%)' }}
      />

      {/* Desert overlay — SVG rendered as background image with screen blend */}
      <img
        src={desert}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          mixBlendMode: 'screen',
          opacity: 0.72,
          maskImage: 'linear-gradient(90deg, #000 0%, rgba(0,0,0,.85) 30%, transparent 62%)',
          WebkitMaskImage: 'linear-gradient(90deg, #000 0%, rgba(0,0,0,.85) 30%, transparent 62%)',
        }}
      />

      {/* Diagonal hairline stripes */}
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,.1) 2px, rgba(255,255,255,.1) 4px)' }} />

      {/* Content: DRIVER watermark on left */}
      <div className="absolute inset-0 flex items-end px-6 pb-6">
        <div style={{ color: 'rgba(255,255,255,.15)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-widest">Driver</p>
          <p className="text-6xl font-bold font-mono leading-none">{entry.internalId || '—'}</p>
        </div>
      </div>

      {/* Headshot bleeding into the right side */}
      <div className="absolute -right-8 bottom-0 h-48 w-48">
        {photoUrl ? (
          <div className="relative w-full h-full">
            <img src={photoUrl} alt={entry.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40" />
          </div>
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-6xl font-bold text-white"
            style={{ background: initialsGradient }}
          >
            {monogram(entry.name)}
          </div>
        )}
      </div>

      {/* Watch pill (top-right, fixed position) */}
      <div className="absolute top-4 right-6 z-10 shrink-0">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${hs.pill}`}
          title="Revenue & utilization signal — full margin pending the cost layer (fuel, insurance, driver pay)."
        >
          <span className={`w-1.5 h-1.5 rounded-full ${hs.dot}`} /> {entry.health.label}
        </span>
      </div>

      {/* Identity block (bottom-left, overlays hero) */}
      <div className="absolute bottom-0 left-0 right-0 px-6 pb-4 pt-8 bg-gradient-to-t from-black/60 to-transparent">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-3xl font-black text-white uppercase tracking-tight" style={{ fontFamily: 'Anton, sans-serif', lineHeight: 1 }}>
              {entry.name}
            </h2>
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-1.5 rounded border-2 border-orange-400 bg-orange-500/20 text-[11px] font-mono font-bold text-orange-200 uppercase tracking-widest">
                {truckLabel || 'no unit'}
              </span>
              {entry.status && <DriverStatusPill status={entry.status} />}
              {entry.driverType && <DriverTypePill type={entry.driverType} short />}
            </div>
            <p className="text-[9px] text-gray-300/80 mt-2 truncate">
              Driver #{entry.internalId} · Unit {truckLabel || '—'} · {trailerLabel || 'no trailer'} {entry.carrier ? `· ${entry.carrier}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Diagonal slash divider to light body */}
      <div
        className="absolute -bottom-px left-0 right-0 h-12 bg-white"
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 0)',
        }}
      />
    </div>
  )
}

// Initials avatar with a deterministic per-driver gradient.
function Avatar({ name, photoUrl, level }) {
  const ringClass = { strong: 'ring-emerald-500/40', watch: 'ring-amber-500/40', weak: 'ring-rose-500/50', idle: 'ring-slate-500/30' }[level] || 'ring-slate-500/30'
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className={`w-14 h-14 rounded-2xl object-cover ring-2 ${ringClass} shrink-0`} />
  }
  const h = nameHue(name)
  return (
    <div
      className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white ring-2 ${ringClass} shrink-0`}
      style={{ background: `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 42) % 360} 68% 34%))` }}
    >
      {monogram(name)}
    </div>
  )
}

function StatTile({ label, value, sub, tone = 'default' }) {
  const toneClass = {
    default: 'text-gray-900 dark:text-white',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    cyan: 'text-cyan-700 dark:text-cyan-400',
    amber: 'text-amber-700 dark:text-amber-400',
    rose: 'text-rose-700 dark:text-rose-400',
  }[tone]
  return (
    <div className="rounded-xl px-3 py-2.5 bg-gray-50/80 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.04]">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 truncate">{label}</p>
      <p className={`text-lg font-mono font-semibold leading-tight mt-0.5 ${toneClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

// "Flatbed avg $3.56 · this driver $3.20 ▼ 10%" with a bar visual: the
// driver's bar against a tick at the type average. Trailer types rate very
// differently, so a driver is judged against comparable equipment.
function BenchmarkStrip({ entry }) {
  const { rpm } = entry.metrics
  const avg = entry.benchmarkRpm
  const scopeLabel = entry.benchmarkScope === 'fleet' ? 'Fleet avg (all trailer types)' : `${entry.benchmarkScope} fleet avg`
  if (avg == null) {
    return <p className="text-[11px] text-gray-400 dark:text-slate-500">No fleet $/mile benchmark for this period yet.</p>
  }
  const ratio = rpm != null ? rpm / avg : null
  const max = Math.max(rpm || 0, avg) * 1.25
  const driverPct = rpm != null ? (rpm / max) * 100 : 0
  const avgPct = (avg / max) * 100
  const up = ratio != null && ratio >= 1
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-gray-500 dark:text-slate-400">
          <span className="font-semibold text-gray-700 dark:text-slate-300">Like-for-like:</span>{' '}
          {scopeLabel} <span className="font-mono font-semibold text-gray-900 dark:text-white">{fmtRpm(avg)}</span>
          <span className="mx-1.5 text-gray-300 dark:text-slate-600">·</span>
          this driver <span className="font-mono font-semibold text-gray-900 dark:text-white">{fmtRpm(rpm)}</span>
        </p>
        {ratio != null && (
          <span className={`text-[11px] font-semibold font-mono ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {up ? '▲' : '▼'} {Math.abs((ratio - 1) * 100).toFixed(0)}% {up ? 'above' : 'below'} avg
          </span>
        )}
      </div>
      <div className="relative h-2 mt-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-visible">
        {rpm != null && (
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${up ? 'bg-gradient-to-r from-emerald-500/70 to-emerald-400' : 'bg-gradient-to-r from-rose-500/70 to-rose-400'}`}
            style={{ width: `${driverPct}%`, transition: 'width 700ms cubic-bezier(0.22,1,0.36,1)' }}
          />
        )}
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-gray-400 dark:bg-slate-300 rounded" style={{ left: `${avgPct}%` }} title={`${scopeLabel}: ${fmtRpm(avg)}`} />
      </div>
    </div>
  )
}

// 8-week gross bars; the right-most bar is the most recent window.
function TrendSparkline({ entry, trend, activeWeekFrom, onWeekSelect }) {
  const series = useMemo(
    () => (trend || []).map(w => w.byKey.get(entry.id)?.gross ?? 0),
    [trend, entry.id]
  )
  if (!trend) return <div className="h-10 rounded-lg bg-gray-50 dark:bg-white/[0.03] animate-pulse" />
  const max = Math.max(...series, 1)
  const allZero = series.every(v => v === 0)
  const activeIndex = trend.findIndex(w => w.from === activeWeekFrom)

  const handleKeyDown = (e, i) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onWeekSelect?.(trend[i].from, trend[i].to)
    }
  }

  return (
    <div>
      <div className="flex items-end gap-1 h-10">
        {series.map((v, i) => (
          <button
            key={i}
            onClick={() => onWeekSelect?.(trend[i].from, trend[i].to)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`flex-1 rounded-t transition-all cursor-pointer hover:opacity-75 ${activeIndex === i ? 'bg-orange-500/90 ring-1 ring-orange-400' : 'bg-gray-300 dark:bg-slate-600/60 hover:bg-gray-400 dark:hover:bg-slate-600'}`}
            style={{ height: `${Math.max((v / max) * 100, v > 0 ? 6 : 2)}%` }}
            title={`${trend[i].from} – ${trend[i].to}: ${fmtMoney(v)}`}
            aria-label={`Week of ${trend[i].from}: ${fmtMoney(v)}`}
            role="button"
            tabIndex={0}
          />
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
        {allZero ? 'No realized revenue in the last 8 weeks' : 'Weekly gross — last 8 weeks (click a bar to select that week)'}
      </p>
    </div>
  )
}

function LaneRow({ lane, tag, baseYear }) {
  const rpm = lane.leg_total_miles > 0 ? Number(lane.leg_revenue) / Number(lane.leg_total_miles) : null
  const tagStyle = tag === 'best'
    ? 'border-emerald-300/60 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/[0.06]'
    : tag === 'worst'
      ? 'border-rose-300/60 dark:border-rose-500/30 bg-rose-50/60 dark:bg-rose-500/[0.06]'
      : 'border-gray-100 dark:border-white/[0.04] bg-gray-50/50 dark:bg-white/[0.02]'
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${tagStyle}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-800 dark:text-slate-200 truncate min-w-0">
          {lane.origin || '—'} <span className="text-gray-400 dark:text-slate-500">→</span> {lane.destination || '—'}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {tag === 'best' && <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">best $/mi</span>}
          {tag === 'worst' && <span className="text-[9px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">lowest $/mi</span>}
          {lane.is_projected && <span className="text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">booked</span>}
        </div>
      </div>
      <p className="text-[10px] font-mono text-gray-500 dark:text-slate-400 mt-0.5">
        {fmtMoney2(lane.leg_revenue)} · {fmtNum(lane.leg_total_miles)} mi · {rpm != null ? `${fmtRpm(rpm)}/mi` : '—'}
        {lane.customer_name && <span className="ml-1.5 text-gray-400 dark:text-slate-500 font-sans">· {lane.customer_name}</span>}
      </p>
      <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">
        PU {fmtDateShort(lane.pickup_date, baseYear)} · DEL {fmtDateShort(lane.delivery_date, baseYear)}
      </p>
    </div>
  )
}

function ContributionLine({ label, value, sign, strong, note }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="min-w-0">
        <span className={`text-xs ${strong ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-500 dark:text-slate-400'}`}>
          {sign && <span className="font-mono mr-1 text-gray-400 dark:text-slate-500">{sign}</span>}{label}
        </span>
        {note && <span className="block text-[10px] text-gray-400 dark:text-slate-500">{note}</span>}
      </div>
      <span className={`font-mono text-sm shrink-0 ${strong ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-slate-300'}`}>{value}</span>
    </div>
  )
}

const ROADMAP = [
  { label: 'Fuel', desc: 'per-load fuel spend' },
  { label: 'Insurance', desc: 'per-unit premiums' },
]

function DriverSpotlightCard({ entry, lanes, trend, rangeDays, effDays, periodLabel, basis = 'delivery', focused, rank, total, sortLabel, activeWeekFrom, onWeekSelect, photoUrl }) {
  const m = entry.metrics
  const hs = HEALTH_STYLES[entry.health.level]
  // Idle days only count days that have actually happened — a mid-week
  // "This week" doesn't penalize the future.
  const utilDays = effDays ?? rangeDays
  const idleDays = Math.max(utilDays - m.activeDays, 0)
  const windowInProgress = utilDays < rangeDays
  // Extract base year from the period start date for date formatting
  const baseYear = activeWeekFrom ? parseYmd(activeWeekFrom)?.getFullYear() : null

  // Best / worst realized lane by $/mi (needs at least 2 priced lanes to be
  // a meaningful contrast).
  const { bestLaneId, worstLaneId } = useMemo(() => {
    const priced = (lanes || []).filter(l => !l.is_projected && Number(l.leg_total_miles) > 0 && l.leg_revenue != null)
    if (priced.length < 2) return {}
    const byRpm = [...priced].sort((a, b) => (a.leg_revenue / a.leg_total_miles) - (b.leg_revenue / b.leg_total_miles))
    return { bestLaneId: byRpm[byRpm.length - 1].leg_id, worstLaneId: byRpm[0].leg_id }
  }, [lanes])

  const eq = entry.equipCost
  const contribution = m.gross - eq.periodCost - entry.purchase.periodExpected
  const truckLabel = entry.trucks.map(t => t.unit_number).filter(Boolean).join(', ')
  const trailerLabel = entry.trailers.map(t => t.unit_number).filter(Boolean).join(', ')

  return (
    <div
      className={`h-[640px] flex flex-col overflow-hidden rounded-3xl border bg-gradient-to-b from-white to-gray-50 dark:from-[#12132e] dark:to-[#0a0a18] border-gray-200 dark:border-white/10 shadow-xl dark:shadow-[0_40px_90px_-20px_rgba(0,0,0,0.85)] ${focused ? `ring-1 ${hs.ring}` : ''}`}
    >
      {/* ── Dark identity hero ── */}
      <Hero entry={entry} photoUrl={photoUrl} hs={hs} />

      {/* ── Rank/sort label under hero ── */}
      {(rank || total) && (
        <div className="px-6 py-2 text-right border-b border-gray-100 dark:border-white/[0.06]">
          <p className="text-[10px] font-mono text-gray-500 dark:text-slate-400">{rank} / {total} · {sortLabel}</p>
        </div>
      )}

      {/* ── Date range emphasis ── */}
      <div className="px-6 pt-4 pb-2">
        <div className="inline-flex flex-col gap-1 px-3 py-2 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800/40 dark:to-slate-900/20 border border-slate-200 dark:border-slate-700/40">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 font-mono">{periodLabel}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">by {basis} date</p>
        </div>
      </div>

      {/* ── Headline metrics (real — load_profit_rollup) ── */}
      <div className="px-6 pt-2">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <StatTile label="Gross revenue" tone="emerald" value={fmtMoney(m.gross)} sub={periodLabel} />
          <StatTile label="$/mile" tone={entry.health.rpmRatio != null && entry.health.rpmRatio < 0.9 ? 'rose' : 'amber'} value={fmtRpm(m.rpm)} sub={entry.benchmarkRpm != null ? `vs ${fmtRpm(entry.benchmarkRpm)} avg` : null} />
          <StatTile label="Loads" value={fmtNum(m.realizedLoads)} sub={m.bookedLoads > 0 ? `+ ${fmtNum(m.bookedLoads)} booked` : 'realized'} />
          <StatTile label="Miles" value={fmtNum(m.miles)} sub="realized" />
          <StatTile
            label="Active days"
            tone={utilDays > 0 && idleDays >= utilDays * 0.6 ? 'rose' : 'default'}
            value={utilDays > 0 ? `${fmtNum(m.activeDays)}/${utilDays}` : '—'}
            sub={utilDays > 0 ? `${fmtNum(idleDays)} idle${windowInProgress ? ' so far' : ''}` : 'window not started'}
          />
          <StatTile label="Booked pipeline" tone="cyan" value={m.booked > 0 ? fmtMoney(m.booked) : '—'} sub={m.bookedLoads > 0 ? `${fmtNum(m.bookedLoads)} load${m.bookedLoads === 1 ? '' : 's'} upcoming` : 'nothing booked'} />
        </div>

        {/* Estimated driver compensation block */}
        {entry.payEstimate && (() => {
          const { driverCaption, companyCaption } = getCompFormulaLabels(entry.payEstimate)
          return (
          <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-500/20 bg-blue-50/60 dark:bg-blue-500/[0.06] px-3 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">
                Estimated driver comp
              </p>
              <span className="text-[9px] px-1.5 py-px rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 font-medium">estimated</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {entry.payEstimate.hasContract ? (
                <div>
                  <p className="text-[10px] text-blue-600 dark:text-blue-400">Est. driver pay</p>
                  <p className="text-sm font-mono font-semibold text-blue-900 dark:text-blue-200">{entry.payEstimate.estDriverPay > 0 ? fmtMoney(entry.payEstimate.estDriverPay) : '—'}</p>
                </div>
              ) : (
                <div>
                  <p className="text-[10px] text-blue-600 dark:text-blue-400">Est. driver pay</p>
                  <p className="text-sm font-mono font-semibold text-blue-900 dark:text-blue-200">{fmtMoney(entry.payEstimate.estDriverPay)}</p>
                  {driverCaption && <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">{driverCaption}</p>}
                </div>
              )}
              <div>
                <p className="text-[10px] text-blue-600 dark:text-blue-400">Est. company earn</p>
                <p className="text-sm font-mono font-semibold text-blue-900 dark:text-blue-200">
                  {entry.payEstimate.hasContract ? 'TBD' : fmtMoney(entry.payEstimate.estCompanyContribution)}
                </p>
                {!entry.payEstimate.hasContract && companyCaption && <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">{companyCaption}</p>}
              </div>
            </div>
            {entry.payEstimate.hasMissingComp && (
              <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1.5 pt-1.5 border-t border-blue-200 dark:border-blue-500/20">
                ⚠ Missing rate — estimated numbers unavailable
              </p>
            )}
          </div>
        )})()}

        <div className="mt-3">
          <BenchmarkStrip entry={entry} />
        </div>
      </div>

      {/* ── Body: lanes | contribution + roadmap ── */}
      <div className="flex-1 min-h-0 px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Lanes (real — v_load_leg_profit) */}
        <div className="flex flex-col min-h-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">
            Lanes this period {lanes ? <span className="font-mono">({lanes.length})</span> : null}
          </p>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
            {!lanes ? (
              <>
                <div className="h-11 rounded-lg bg-gray-50 dark:bg-white/[0.03] animate-pulse" />
                <div className="h-11 rounded-lg bg-gray-50 dark:bg-white/[0.03] animate-pulse" />
                <div className="h-11 rounded-lg bg-gray-50 dark:bg-white/[0.03] animate-pulse" />
              </>
            ) : lanes.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 italic pt-2">No loads in this window.</p>
            ) : (
              lanes.map(l => (
                <LaneRow key={l.leg_id} lane={l} tag={l.leg_id === bestLaneId ? 'best' : l.leg_id === worstLaneId ? 'worst' : null} baseYear={baseYear} />
              ))
            )}
          </div>
        </div>

        {/* Trend + contribution + roadmap */}
        <div className="flex flex-col min-h-0 gap-3 overflow-y-auto pr-1">
          <TrendSparkline entry={entry} trend={trend} activeWeekFrom={activeWeekFrom} onWeekSelect={onWeekSelect} />

          {/* Contribution — real but PARTIAL: equipment & purchase only */}
          <div className="rounded-xl border border-gray-100 dark:border-white/[0.06] bg-gray-50/60 dark:bg-white/[0.02] px-3 py-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Contribution</p>
              <span className="text-[9px] px-1.5 py-px rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" title="Equipment carrying cost and truck-purchase deductions only. Fuel, insurance, and driver pay are not in BUDDY yet — this is NOT net profit.">
                partial — not net profit
              </span>
            </div>
            <ContributionLine label="Gross revenue" value={fmtMoney2(m.gross)} />
            <ContributionLine
              sign="−" label="Equipment carrying cost"
              value={eq.knownMonthly > 0 ? fmtMoney2(eq.periodCost) : eq.unknownUnits > 0 ? 'unknown' : fmtMoney2(0)}
              note={
                eq.unknownUnits > 0
                  ? `prorated for ${rangeDays} days · cost unknown for ${eq.unknownUnits} unit${eq.unknownUnits === 1 ? '' : 's'}`
                  : eq.units.length ? `prorated for ${rangeDays} days · ${eq.units.length} unit${eq.units.length === 1 ? '' : 's'}` : 'no equipment on file'
              }
            />
            <ContributionLine
              sign="−" label="Truck-purchase deduction"
              value={entry.purchase.periodExpected > 0 ? fmtMoney2(entry.purchase.periodExpected) : entry.purchase.hasPurchase ? fmtMoney2(0) : '—'}
              note={entry.purchase.periodExpected > 0 ? `${entry.purchase.payments} scheduled payment${entry.purchase.payments === 1 ? '' : 's'} in window` : entry.purchase.hasPurchase ? 'no payment due in window' : 'no purchase contract'}
            />
            <div className="border-t border-gray-200 dark:border-white/[0.08] mt-1 pt-1">
              <ContributionLine strong label="After equipment & purchase" value={fmtMoney2(contribution)} />
            </div>
          </div>

          {/* Roadmap — explicitly number-free until the cost layer lands */}
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/[0.08] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">Unlocking next → net margin</p>
            {ROADMAP.map(r => (
              <div key={r.label} className="flex items-center justify-between gap-2 py-0.5">
                <span className="text-xs text-gray-400 dark:text-slate-500">
                  − {r.label} <span className="text-[10px] text-gray-300 dark:text-slate-600">· {r.desc}</span>
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-px rounded-full bg-gray-100 dark:bg-slate-700/40 text-gray-400 dark:text-slate-500">coming</span>
              </div>
            ))}
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1.5 leading-snug">
              Driver pay is estimated above. Once fuel and insurance connect, this card shows true <span className="font-semibold text-gray-500 dark:text-slate-400">net margin</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(DriverSpotlightCard)
