import { memo, useMemo } from 'react'
import { DriverStatusPill, DriverTypePill, trailerTypePillClasses } from '../../fleetUtils'
import { fmtMoney, fmtMoney2, fmtNum, fmtRpm, monogram, nameHue, HEALTH_STYLES } from './spotlightShared'

// One driver's full dossier — the big card at the front of the deck.
// Everything on it is live BUDDY data except the "Unlocking next" section,
// which is deliberately number-free: fuel / insurance / driver pay aren't
// connected yet and we never invent margin.

// Initials avatar with a deterministic per-driver gradient. Drivers have no
// photo field yet; when a photo_url column lands it drops in here.
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
function TrendSparkline({ entry, trend }) {
  const series = useMemo(
    () => (trend || []).map(w => w.byKey.get(entry.id)?.gross ?? 0),
    [trend, entry.id]
  )
  if (!trend) return <div className="h-10 rounded-lg bg-gray-50 dark:bg-white/[0.03] animate-pulse" />
  const max = Math.max(...series, 1)
  const allZero = series.every(v => v === 0)
  return (
    <div>
      <div className="flex items-end gap-1 h-10">
        {series.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${i === series.length - 1 ? 'bg-orange-500/90' : 'bg-gray-300 dark:bg-slate-600/60'}`}
            style={{ height: `${Math.max((v / max) * 100, v > 0 ? 6 : 2)}%` }}
            title={`${trend[i].from} → ${trend[i].to}: ${fmtMoney(v)}`}
          />
        ))}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
        {allZero ? 'No realized revenue in the last 8 weeks' : 'Weekly gross — last 8 weeks (current window highlighted)'}
      </p>
    </div>
  )
}

function LaneRow({ lane, tag }) {
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
  { label: 'Driver pay', desc: 'settlement deductions' },
]

function DriverSpotlightCard({ entry, lanes, trend, rangeDays, effDays, periodLabel, basis = 'delivery', focused, rank, total, sortLabel }) {
  const m = entry.metrics
  const hs = HEALTH_STYLES[entry.health.level]
  // Idle days only count days that have actually happened — a mid-week
  // "This week" doesn't penalize the future.
  const utilDays = effDays ?? rangeDays
  const idleDays = Math.max(utilDays - m.activeDays, 0)
  const windowInProgress = utilDays < rangeDays

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
      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/[0.06]">
        <div className="flex items-start gap-4">
          <Avatar name={entry.name} photoUrl={entry.photoUrl} level={entry.health.level} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate">{entry.name}</h2>
              {entry.internalId && <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">#{entry.internalId}</span>}
              {!entry.driverId && (
                <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" title="Raw name from TMS — not yet linked to a driver record. Resolve it in Loads Import review.">
                  unmatched
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {entry.status && <DriverStatusPill status={entry.status} />}
              {entry.driverType && <DriverTypePill type={entry.driverType} short />}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1.5 truncate">
              {truckLabel
                ? <span><span className="text-gray-400 dark:text-slate-500 mr-1">Truck</span><span className="font-mono">{truckLabel}</span></span>
                : <span className="text-gray-400 dark:text-slate-500">no truck on file</span>}
              <span className="mx-1.5 text-gray-300 dark:text-slate-600">·</span>
              {trailerLabel
                ? <span><span className="text-gray-400 dark:text-slate-500 mr-1">Trailer</span><span className="font-mono">{trailerLabel}</span></span>
                : <span className="text-gray-400 dark:text-slate-500">no trailer</span>}
              {entry.trailerType && (
                <span className={`ml-1.5 inline-block px-1.5 py-px rounded-full text-[9px] font-semibold align-middle ${trailerTypePillClasses(entry.trailerType)}`}>{entry.trailerType}</span>
              )}
              {entry.carrier && <span className="ml-1.5 text-gray-400 dark:text-slate-500">· {entry.carrier}</span>}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${hs.pill}`}
              title="Revenue & utilization signal — full margin pending the cost layer (fuel, insurance, driver pay)."
            >
              <span className={`w-1.5 h-1.5 rounded-full ${hs.dot}`} /> {entry.health.label}
            </span>
            <p className="text-[9px] text-gray-400 dark:text-slate-500 mt-1 max-w-[130px] leading-tight">revenue & utilization signal — full margin pending cost layer</p>
            <p className="text-[10px] font-mono text-gray-400 dark:text-slate-500 mt-1">{rank} / {total} · {sortLabel}</p>
          </div>
        </div>
      </div>

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
                <LaneRow key={l.leg_id} lane={l} tag={l.leg_id === bestLaneId ? 'best' : l.leg_id === worstLaneId ? 'worst' : null} />
              ))
            )}
          </div>
        </div>

        {/* Trend + contribution + roadmap */}
        <div className="flex flex-col min-h-0 gap-3 overflow-y-auto pr-1">
          <TrendSparkline entry={entry} trend={trend} />

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
              Once these connect, this card shows true <span className="font-semibold text-gray-500 dark:text-slate-400">net margin</span> — no estimates shown until the data is real.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(DriverSpotlightCard)
