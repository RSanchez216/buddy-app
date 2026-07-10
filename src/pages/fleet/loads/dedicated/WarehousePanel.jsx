import { Link } from 'react-router-dom'
import { LANE_STATUS, TRAILER_TYPE_COLORS, daysBucket } from '../../../../data/dedicatedLanesMock'
import { fmtMoney } from '../spotlight/spotlightShared'
import { StatusPill } from './dedicatedUi'
import { fmtDay, DAYS_TEXT } from './dedicatedFormat'

// The "warehouse" — a lane's yard rendered as parking bays, not a card grid.
// Each staged trailer occupies a painted bay; aging units (≥10d) glow red so
// the money-losers jump out; a couple of empty bays hint at spare capacity.

// Display capacity: staged trailers + breathing room, rounded to fill the
// 2-column bay grid so the lot always reads as a full pad.
function bayCount(trailers) {
  return Math.max(6, Math.ceil((trailers + 1) / 2) * 2)
}

function TrailerBay({ trailer, index }) {
  const aging = (trailer.flags || []).includes('AGING')
  const bucket = daysBucket(trailer.daysParked)
  return (
    <div
      className={`dl-bay relative rounded-xl border bg-white dark:bg-white/[0.04] p-3.5 pb-7 transition-all duration-200
        hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-black/40 hover:border-gray-300 dark:hover:border-white/20
        ${aging
          ? 'border-red-300 dark:border-red-500/40 dl-bay-aging'
          : 'border-gray-200 dark:border-white/10'}`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      {/* painted bay number */}
      <span className="absolute bottom-2 right-3 text-[9px] font-bold tracking-[0.2em] text-gray-300 dark:text-slate-600 select-none">
        BAY {String(index + 1).padStart(2, '0')}
      </span>
      {aging && (
        <span className="absolute top-2.5 right-2.5 text-[9px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30">
          AGING
        </span>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-extrabold text-gray-900 dark:text-white tabular-nums">{trailer.unit}</span>
        <span className="text-[9px] font-extrabold tracking-wide text-white rounded-md px-1.5 py-0.5"
          style={{ background: TRAILER_TYPE_COLORS[trailer.type] || TRAILER_TYPE_COLORS.Unassigned }}>
          {trailer.type}
        </span>
      </div>
      <div className={`mt-2.5 text-[26px] leading-none font-extrabold tabular-nums ${DAYS_TEXT[bucket]}`}>
        {trailer.daysParked}<span className="text-[13px] font-bold"> d</span>
      </div>
      <div className="text-[10px] text-gray-400 dark:text-slate-500 mb-2.5">parked</div>
      <dl className="space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-400 dark:text-slate-500">Last used</dt>
          <dd className="font-semibold text-gray-700 dark:text-slate-300">{fmtDay(trailer.lastUsed)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-400 dark:text-slate-500">Last driver</dt>
          <dd className="font-semibold text-gray-700 dark:text-slate-300">{trailer.lastDriver || '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-400 dark:text-slate-500">Last service</dt>
          <dd className={trailer.lastService ? 'font-semibold text-gray-700 dark:text-slate-300' : 'italic text-gray-300 dark:text-slate-600'}>
            {trailer.lastService ? fmtDay(trailer.lastService) : 'coming soon'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function EmptyBay({ index }) {
  return (
    <div className="dl-bay relative rounded-xl border border-dashed border-gray-200 dark:border-white/10 min-h-[120px] flex items-center justify-center dl-bay-stripes"
      style={{ animationDelay: `${index * 55}ms` }}>
      <span className="text-[9px] font-bold tracking-[0.25em] text-gray-300 dark:text-slate-700 select-none">EMPTY</span>
      <span className="absolute bottom-2 right-3 text-[9px] font-bold tracking-[0.2em] text-gray-200 dark:text-slate-700 select-none">
        BAY {String(index + 1).padStart(2, '0')}
      </span>
    </div>
  )
}

// Home Yard drill-in: not a lane — the true-idle bucket, explained.
function HomeYardCard({ homeYard, onBack }) {
  return (
    <div key="home" className="dl-panel-in">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rotate-45 rounded-[3px] bg-gray-500 shrink-0" />
            <h3 className="text-[16px] font-extrabold text-gray-900 dark:text-white">Home Yard</h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
            {homeYard.city}, {homeYard.state} · not a dedicated lane
          </p>
        </div>
        <button onClick={onBack} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0">
          ← Back to map
        </button>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tabular-nums text-gray-900 dark:text-white">{homeYard.count}</span>
          <span className="text-sm text-gray-500 dark:text-slate-400">trailers sitting with no lane purpose</span>
        </div>
        <p className="text-[13px] leading-relaxed text-gray-600 dark:text-slate-400">
          This is the <b className="text-gray-900 dark:text-slate-200">true-idle</b> bucket. Trailers staged
          in a dedicated lane are positioned to earn; these are parked at the yard costing equipment
          dollars with nothing scheduled. Idle Review should treat the two very differently.
        </p>
        <Link to="/fleet/profitability/idle"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-500 transition-colors">
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
        <p className="text-sm text-gray-400 dark:text-slate-500 max-w-[220px]">
          Select a facility on the map to open its yard.
        </p>
      </div>
    )
  }

  const m = lane.metrics
  const bays = bayCount(lane.trailers.length)

  return (
    <div key={lane.id} className="dl-panel-in">
      {/* Yard header */}
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-extrabold text-gray-900 dark:text-white truncate">{lane.name}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
              <span>{lane.facility.city}, {lane.facility.state}</span>
              <span className="text-gray-300 dark:text-slate-700">·</span>
              <span>{lane.customer || 'no customer linked'}</span>
              <StatusPill status={lane.status} />
            </p>
          </div>
          <button onClick={onBack} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0">
            ← Back to map
          </button>
        </div>
        <dl className="flex gap-6 mt-3.5 flex-wrap">
          {[
            ['trailers', String(m.trailers), null],
            ['avg idle', `${m.avgIdleDays.toFixed(1)}d`, null],
            ['idle cost · MTD', fmtMoney(m.idleCostMTD), null],
            ['net · MTD', `${m.netMTD >= 0 ? '+' : '−'}${fmtMoney(Math.abs(m.netMTD))}`,
              m.netMTD >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'],
          ].map(([k, v, cls]) => (
            <div key={k}>
              <dd className={`text-[15px] font-extrabold tabular-nums ${cls || 'text-gray-900 dark:text-white'}`}>{v}</dd>
              <dt className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{k}</dt>
            </div>
          ))}
        </dl>
      </div>

      {/* The lot — asphalt pad with painted bays */}
      <div className="p-3.5 dl-asphalt">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {lane.trailers.map((t, i) => <TrailerBay key={t.unit} trailer={t} index={i} />)}
          {Array.from({ length: bays - lane.trailers.length }, (_, i) => (
            <EmptyBay key={`empty-${i}`} index={lane.trailers.length + i} />
          ))}
        </div>
      </div>
    </div>
  )
}
