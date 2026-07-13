import { Link } from 'react-router-dom'
import { TRAILER_TYPE_COLORS, daysBucket } from './dedicatedData'
import { fmtMoney } from '../spotlight/spotlightShared'
import { StatusPill } from './dedicatedUi'
import { fmtDay, DAYS_TEXT } from './dedicatedFormat'

// The lane's yard — trailer cards grouped by facility (Origin bays / Destination
// bays) using each trailer's position. On-road trailers (working, no cost) and
// any off-lane/unknown are listed separately. Aging (≥10d) and missing-rate
// trailers are flagged, not hidden.

function TrailerBay({ t, index }) {
  const bucket = daysBucket(t.idle_days)
  return (
    <div
      className={`dl-bay relative rounded-xl border bg-white dark:bg-white/[0.04] p-3.5 pb-4 transition-all duration-200
        hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-black/40 hover:border-gray-300 dark:hover:border-white/20
        ${t.aging ? 'border-red-300 dark:border-red-500/40 dl-bay-aging' : 'border-gray-200 dark:border-white/10'}`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div className="absolute top-2.5 right-2.5 flex gap-1">
        {t.missing_rate && (
          <span className="text-[8.5px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30" title="Lease has no fixed daily rate — idle cost not computed">
            NO FIXED RATE
          </span>
        )}
        {t.aging && (
          <span className="text-[9px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30">
            AGING
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-extrabold text-gray-900 dark:text-white tabular-nums">{t.unit}</span>
        <span className="text-[9px] font-extrabold tracking-wide text-white rounded-md px-1.5 py-0.5"
          style={{ background: TRAILER_TYPE_COLORS[t.type] || TRAILER_TYPE_COLORS.Unassigned }}>{t.type || 'Unassigned'}</span>
      </div>
      <div className={`mt-2.5 text-[26px] leading-none font-extrabold tabular-nums ${DAYS_TEXT[bucket]}`}>
        {t.idle_days}<span className="text-[13px] font-bold"> d</span>
      </div>
      <div className="text-[10px] text-gray-500 dark:text-slate-400 mb-2.5">
        parked · {t.missing_rate ? 'no rate' : `${fmtMoney(t.idle_cost)} idle cost`}
      </div>
      <dl className="space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-500">Last used</dt>
          <dd className="font-semibold text-gray-700 dark:text-slate-300">{fmtDay(t.last_used)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-500">Last driver</dt>
          <dd className="font-semibold text-gray-700 dark:text-slate-300">{t.last_driver || '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

function BayGroup({ title, facility, trailers, startIndex }) {
  if (!trailers.length) return null
  return (
    <div>
      <div className="flex items-baseline justify-between px-1 mb-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400">{title}</span>
        <span className="text-[11px] text-gray-400 dark:text-slate-500">
          {facility?.address ? `${facility.address} · ` : ''}{facility ? `${facility.city}, ${facility.state}` : ''} · {trailers.length}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {trailers.map((t, i) => <TrailerBay key={t.trailer_id || t.unit} t={t} index={startIndex + i} />)}
      </div>
    </div>
  )
}

function SimpleList({ title, trailers, tone }) {
  if (!trailers.length) return null
  return (
    <div>
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400 px-1 mb-2">{title} · {trailers.length}</div>
      <div className="flex flex-wrap gap-1.5">
        {trailers.map(t => (
          <span key={t.trailer_id || t.unit} className={`inline-flex items-center gap-1.5 text-[11px] font-bold rounded-lg px-2 py-1 border ${tone}`}>
            <span className="tabular-nums">{t.unit}</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: TRAILER_TYPE_COLORS[t.type] || TRAILER_TYPE_COLORS.Unassigned }} />
            {t.last_driver && <span className="font-medium opacity-70">{t.last_driver}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

function HomeYardCard({ homeYard, onBack }) {
  return (
    <div key="home" className="dl-panel-in">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rotate-45 rounded-[3px] bg-gray-500 shrink-0" />
            <h3 className="text-[16px] font-extrabold text-gray-900 dark:text-white">Home Yard</h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">{homeYard.city}, {homeYard.state} · not a dedicated lane</p>
        </div>
        <button onClick={onBack} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0">← Back to map</button>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tabular-nums text-gray-900 dark:text-white">{homeYard.count}</span>
          <span className="text-sm text-gray-500 dark:text-slate-400">trailers sitting with no lane purpose</span>
        </div>
        <p className="text-[13px] leading-relaxed text-gray-600 dark:text-slate-400">
          This is the <b className="text-gray-900 dark:text-slate-200">true-idle</b> bucket. Trailers staged in a dedicated lane are
          positioned to earn; these are parked with nothing scheduled. Idle Review should treat the two very differently.
        </p>
        <Link to="/fleet/profitability/idle" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-500 transition-colors">
          Open Idle Review
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
        </Link>
      </div>
    </div>
  )
}

export default function WarehousePanel({ lane, homeYard, onBack }) {
  if (lane === 'home') return <HomeYardCard homeYard={homeYard} onBack={onBack} />

  if (!lane) {
    return (
      <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-3 p-8 text-center">
        <svg className="w-10 h-10 text-gray-200 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.25}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm text-gray-400 dark:text-slate-500 max-w-[220px]">Select a lane on the map to open its yards.</p>
      </div>
    )
  }

  const trailers = lane.trailers || []
  const originT = trailers.filter(t => t.position === 'origin')
  const destT = trailers.filter(t => t.position === 'destination')
  const onRoad = trailers.filter(t => t.position === 'on_road')
  const offLane = trailers.filter(t => t.position === 'off_lane' || t.position === 'unknown')
  const net = Number(lane.net_mtd) || 0

  return (
    <div key={lane.lane_id} className="dl-panel-in">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-extrabold text-gray-900 dark:text-white truncate">{lane.name}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
              <span>{lane.origin.city}, {lane.origin.state} → {lane.destination.city}, {lane.destination.state}</span>
              <span className="text-gray-300 dark:text-slate-700">·</span>
              <span>{lane.customer || 'no customer linked'}</span>
              <StatusPill status={lane.status} days={lane.days_in_status} />
            </p>
          </div>
          <button onClick={onBack} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0">← Back to map</button>
        </div>
        <dl className="flex gap-6 mt-3.5 flex-wrap">
          {[
            ['trailers', String(lane.trailers_staged ?? trailers.length), null],
            ['avg idle', `${(Number(lane.avg_idle_days) || 0).toFixed(1)}d`, null],
            ['idle cost · MTD', fmtMoney(lane.idle_cost_mtd), null],
            ['net · MTD', `${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))}`, net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'],
          ].map(([k, v, cls]) => (
            <div key={k}>
              <dd className={`text-[15px] font-extrabold tabular-nums ${cls || 'text-gray-900 dark:text-white'}`}>{v}</dd>
              <dt className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{k}</dt>
            </div>
          ))}
        </dl>
        {lane.missing_rate_count > 0 && (
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">⚠ {lane.missing_rate_count} parked trailer{lane.missing_rate_count === 1 ? '' : 's'} with no fixed daily rate — idle cost understated.</p>
        )}
      </div>

      <div className="p-3.5 dl-asphalt space-y-4">
        {originT.length === 0 && destT.length === 0 && onRoad.length === 0 && offLane.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400 dark:text-slate-500">No trailers on this lane.</p>
        ) : (
          <>
            <BayGroup title="Origin bays" facility={lane.origin} trailers={originT} startIndex={0} />
            <BayGroup title="Destination bays" facility={lane.destination} trailers={destT} startIndex={originT.length} />
            <SimpleList title="On the road (working · no cost)" trailers={onRoad} tone="border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" />
            <SimpleList title="Off-lane" trailers={offLane} tone="border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] text-gray-500 dark:text-slate-400" />
          </>
        )}
      </div>
    </div>
  )
}
