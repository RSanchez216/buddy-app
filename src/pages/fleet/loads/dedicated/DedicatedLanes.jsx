import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { S } from '../../../../lib/styles'
import { DEDICATED_LANES, IDLE_SPLIT, computeKpis } from '../../../../data/dedicatedLanesMock'
import { fmtMoney } from '../spotlight/spotlightShared'
import { DedicatedKeyframes } from './dedicatedUi'
import DedicatedMap from './DedicatedMap'
import WarehousePanel from './WarehousePanel'
import LanesTable from './LanesTable'
import NewLaneModal from './NewLaneModal'

// Dedicated Lanes — staged-trailer facilities, idle exposure, lane P&L.
// Rebeca's ask: some "available" trailers aren't rotting in the yard — they're
// staged in a dedicated lane, positioned to earn. This page profiles each
// lane, shows its yard trailer-by-trailer, and reclassifies the Idle Review
// picture into working idle vs true idle.
//
// All data flows through src/data/dedicatedLanesMock.js (the single Supabase
// swap point) — nothing here is hardcoded.

// Count-up for the KPI band: eases to the target on mount. Reduced-motion
// users get the final number immediately (lazy initial state, no animation).
function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? target : 0
  )
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf
    const t0 = performance.now()
    const tick = now => {
      const p = Math.min(1, (now - t0) / duration)
      setValue(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function Kpi({ label, value, format, sub, accent }) {
  const v = useCountUp(value)
  return (
    <div className={`${S.card} p-4 relative overflow-hidden`}>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${accent || 'bg-transparent'}`} />
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</div>
      <div className="text-[22px] font-extrabold tabular-nums mt-1.5 text-gray-900 dark:text-white leading-none">
        {format(v)}
      </div>
      <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">{sub}</div>
    </div>
  )
}

// The headline reclassification: N unattached → X working (staged in lanes)
// vs Y true idle (Home Yard), with the ratio drawn as a split bar.
function IdleSplitBanner({ split }) {
  const workingPct = (split.stagedInLanes / split.totalUnattached) * 100
  return (
    <div className={`${S.card} border-l-4 !border-l-orange-500 px-4 py-3.5`}>
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-[13px]">
        <span className="text-gray-700 dark:text-slate-300">
          <b className="font-extrabold text-gray-900 dark:text-white">Idle Review split:</b>{' '}
          <span className="tabular-nums font-bold">{split.totalUnattached}</span> unattached trailers →
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/25 text-orange-700 dark:text-orange-400 px-2.5 py-1 text-xs font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          {split.stagedInLanes} staged in dedicated lanes <span className="font-semibold opacity-75">(working)</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 text-gray-600 dark:text-slate-300 px-2.5 py-1 text-xs font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-slate-500" />
          {split.homeYard.count} at Home Yard · {split.homeYard.city}, {split.homeYard.state} <span className="font-semibold opacity-75">(true idle)</span>
        </span>
        <Link to="/fleet/profitability/idle"
          className="ml-auto text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-500 transition-colors whitespace-nowrap">
          Open Idle Review →
        </Link>
      </div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden flex bg-gray-100 dark:bg-white/[0.06]" role="img"
        aria-label={`${split.stagedInLanes} working idle vs ${split.homeYard.count} true idle`}>
        <span className="bg-orange-500 rounded-l-full" style={{ width: `${workingPct}%` }} />
        <span className="bg-gray-300 dark:bg-slate-600 flex-1 rounded-r-full" />
      </div>
    </div>
  )
}

const TABS = [
  ['map', 'Map view', <svg key="i" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>],
  ['table', 'Table view', <svg key="i" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM9 6v12" /></svg>],
]

export default function DedicatedLanes() {
  const [tab, setTab] = useState('map')
  const [selectedId, setSelectedId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  const lanes = DEDICATED_LANES
  const split = IDLE_SPLIT
  const kpis = computeKpis(lanes, split)
  const selected = selectedId === 'home' ? 'home' : lanes.find(l => l.id === selectedId) || null

  return (
    <div className="max-w-[1400px] mx-auto space-y-4">
      <DedicatedKeyframes />

      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dedicated Lanes</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Staged-trailer facilities · idle exposure · lane profitability
            <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 align-middle whitespace-nowrap"
              title="Rendering the agreed mock data — lane assignments and live metrics arrive with the Supabase wiring.">
              Preview — mock data, live wiring next pass
            </span>
          </p>
        </div>
        <button onClick={() => setModalOpen(true)}
          className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20 shrink-0">
          + New Dedicated Lane
        </button>
      </div>

      {/* KPI band */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Dedicated Lanes" value={kpis.laneCount} format={v => Math.round(v)}
          sub={`${kpis.active} active · ${kpis.underwater} underwater`} accent="bg-orange-500/70" />
        <Kpi label="Trailers Staged" value={kpis.staged} format={v => Math.round(v)}
          sub={`of ${kpis.totalUnattached} unattached`} accent="bg-orange-500/70" />
        <Kpi label="Avg Idle Days" value={kpis.avgIdleDays} format={v => v.toFixed(1)}
          sub="per staged trailer" accent="bg-amber-500/70" />
        <Kpi label="Idle Cost · MTD" value={kpis.idleCostMTD} format={v => fmtMoney(Math.round(v))}
          sub="days × equip cost/day" accent="bg-red-500/70" />
        <Kpi label="Net Margin · MTD" value={kpis.netMTD}
          format={v => `${kpis.netMTD >= 0 ? '+' : '−'}${fmtMoney(Math.abs(Math.round(v)))}`}
          sub="revenue − equip − idle" accent="bg-emerald-500/70" />
      </div>

      <IdleSplitBanner split={split} />

      {/* View switch */}
      <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 text-xs w-max">
        {TABS.map(([key, label, icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 font-semibold transition-colors ${
              tab === key
                ? 'bg-orange-500 text-white'
                : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}>
            {icon}{label}
          </button>
        ))}
      </div>

      {/* Views */}
      {tab === 'map' ? (
        <div key="map" className="dl-view-in grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4 items-start">
          <div className={`${S.card} overflow-hidden`}>
            <div className="px-5 py-3.5 border-b border-gray-200 dark:border-white/5 flex items-center justify-between gap-3">
              <span className="text-sm font-extrabold text-gray-900 dark:text-white">Facility map</span>
              <span className="text-[11px] text-gray-400 dark:text-slate-500 font-medium">click a marker to open the yard</span>
            </div>
            <div className="p-2">
              <DedicatedMap lanes={lanes} homeYard={split.homeYard} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            <div className="flex gap-x-4 gap-y-1.5 flex-wrap px-5 pb-4 pt-1 text-[11px] text-gray-400 dark:text-slate-500">
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Profitable</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-amber-500" />Watch</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-red-500" />Underwater</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rotate-45 rounded-[2px] bg-gray-500" />Home Yard (true idle)</span>
              <span className="ml-auto">marker size = # trailers · red badge = aging units</span>
            </div>
          </div>
          <div className={`${S.card} overflow-hidden min-h-[380px]`}>
            <WarehousePanel lane={selected} homeYard={split.homeYard} onBack={() => setSelectedId(null)} />
          </div>
        </div>
      ) : (
        <div key="table" className="dl-view-in">
          <LanesTable lanes={lanes} />
        </div>
      )}

      <NewLaneModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
