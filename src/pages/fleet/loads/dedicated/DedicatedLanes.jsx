import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { S } from '../../../../lib/styles'
import { withTimeout } from '../../../../lib/withTimeout'
import { ErrorRetry, CardGridSkeleton, Skeleton } from '../../../../components/Loading'
import { useAuth } from '../../../../contexts/AuthContext'
import { useToast } from '../../../../contexts/ToastContext'
import { fmtMoney } from '../spotlight/spotlightShared'
import { DedicatedKeyframes } from './dedicatedUi'
import { fetchDedicatedLanes, fetchLaneManagement, stagedByLane, addPlannedTrailer, deletePlannedTrailer, updateTelegramRecipients, HOME_YARD } from './dedicatedData'
import DedicatedMap from './DedicatedMap'
import WarehousePanel from './WarehousePanel'
import LanesTable from './LanesTable'
import NewLaneModal from './NewLaneModal'
import RecordEventModal from './RecordEventModal'

const EMPTY_MGMT = { events: [], planned: [], required: [], trailers: [], drivers: [], trucks: [], recipients: [] }

// Dedicated Lanes — staged-trailer facilities, idle exposure, lane P&L. Every
// number flows from get_dedicated_lanes() (see dedicatedData.js). A trailer on
// an active load is "on the road" (no cost); only a dropped/parked surplus
// trailer accrues idle cost = days × daily rate.

// KPI card. Renders the value straight from the payload — the number must equal
// overview.* (and match the subtitle, which already reads it directly). Numeric
// fields arrive as strings from JSON, so coerce before formatting.
function Kpi({ label, value, format, sub, accent }) {
  return (
    <div className={`${S.card} p-4 relative overflow-hidden`}>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${accent || 'bg-transparent'}`} />
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</div>
      <div className="text-[22px] font-extrabold tabular-nums mt-1.5 text-gray-900 dark:text-white leading-none">{format(Number(value) || 0)}</div>
      <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">{sub}</div>
    </div>
  )
}

// Idle Review split: staged-in-lane (working) vs true idle (Home Yard).
function IdleSplitBanner({ split }) {
  const working = split.staged_in_lanes || 0
  const trueIdle = split.true_idle_unassigned || 0
  const total = working + trueIdle
  const workingPct = total > 0 ? (working / total) * 100 : 0
  return (
    <div className={`${S.card} border-l-4 !border-l-orange-500 px-4 py-3.5`}>
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-[13px]">
        <span className="text-gray-700 dark:text-slate-300">
          <b className="font-extrabold text-gray-900 dark:text-white">Idle Review split:</b>{' '}
          <span className="tabular-nums font-bold">{total}</span> unattached trailers →
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/25 text-orange-700 dark:text-orange-400 px-2.5 py-1 text-xs font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          {working} staged in dedicated lanes <span className="font-semibold opacity-75">(working)</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] border border-gray-200 dark:border-white/10 text-gray-600 dark:text-slate-300 px-2.5 py-1 text-xs font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-slate-500" />
          {trueIdle} at Home Yard · {HOME_YARD.city}, {HOME_YARD.state} <span className="font-semibold opacity-75">(true idle)</span>
        </span>
        <Link to="/fleet/profitability/idle"
          className="ml-auto text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-500 transition-colors whitespace-nowrap">
          Open Idle Review →
        </Link>
      </div>
      <div className="mt-3 h-1.5 rounded-full overflow-hidden flex bg-gray-100 dark:bg-white/[0.06]" role="img"
        aria-label={`${working} working idle vs ${trueIdle} true idle`}>
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
  const { canEdit } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('map')
  const [selectedId, setSelectedId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editLane, setEditLane] = useState(null) // lane object when editing; null = create
  const [eventDefaults, setEventDefaults] = useState(null) // null = closed; object = Record-event open
  const [data, setData] = useState(null)
  const [mgmt, setMgmt] = useState(EMPTY_MGMT)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      // fetchDedicatedLanes/fetchLaneManagement wrap their own supabase calls, so
      // the abort signal isn't threaded — the shared withTimeout still rejects at
      // 20s on a hang regardless (it races a timer, not just an abort).
      const [d, m] = await withTimeout(() => Promise.all([fetchDedicatedLanes(), fetchLaneManagement()]))
      setData(d); setMgmt(m)
    } catch (e) {
      // Honesty rule: on failure show error + Retry, never a zeroed overview.
      console.error('[DedicatedLanes] load failed', e)
      setError(true)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Retry returns the page to loading, then re-runs the failed load in place.
  const retry = useCallback(() => { setData(null); setMgmt(EMPTY_MGMT); load() }, [load])

  const loading = data === null && !error
  const overview = data?.overview || {}
  const split = data?.idle_split || {}
  const homeYard = { ...HOME_YARD, count: split.true_idle_unassigned || 0 }
  const laneCount = overview.lane_count || 0

  // Merge the management surface (required target + staged count) onto each lane.
  const requiredMap = new Map((mgmt.required || []).map(r => [r.id, r.required_trailers]))
  const stagedMap = stagedByLane(mgmt.events)
  const trailerMap = new Map((mgmt.trailers || []).map(t => [t.id, t.unit_number]))
  const driverMap = new Map((mgmt.drivers || []).map(d => [d.id, d.full_name]))
  const truckMap = new Map((mgmt.trucks || []).map(t => [t.driver_id, t.unit_number]))
  const lanes = (data?.lanes || []).map(l => ({
    ...l,
    required_trailers: requiredMap.get(l.lane_id) ?? null,
    staged_count: (stagedMap.get(l.lane_id) || []).length,
  }))
  const selected = selectedId === 'home' ? 'home' : lanes.find(l => l.lane_id === selectedId) || null

  const onCreated = () => { setModalOpen(false); setEditLane(null); load() }
  const openCreate = () => { setEditLane(null); setModalOpen(true) }
  const openEdit = (l) => { setEditLane(l); setModalOpen(true) }
  const onEventSaved = () => { setEventDefaults(null); load() }
  const addPlanned = async (payload) => {
    try { await addPlannedTrailer({ laneId: selectedId, ...payload }); load() }
    catch (e) { console.error(e); toast.error("Couldn't add planned trailer", e.message) }
  }
  const removePlanned = async (id) => {
    try { await deletePlannedTrailer(id); load() }
    catch (e) { console.error(e); toast.error("Couldn't remove planned trailer", e.message) }
  }
  const saveRecipients = async (list) => {
    try { await updateTelegramRecipients(list); setMgmt(m => ({ ...m, recipients: list })); toast.success('Telegram recipients updated.') }
    catch (e) { console.error(e); toast.error("Couldn't update recipients", e.message) }
  }

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
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Staged-trailer facilities · idle exposure · lane profitability</p>
        </div>
        {canEdit && (
          <button onClick={openCreate}
            className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20 shrink-0">
            + New Dedicated Lane
          </button>
        )}
      </div>

      {error ? (
        <ErrorRetry message="Couldn't load dedicated lanes." onRetry={retry} />
      ) : loading ? (
        <div className="space-y-4">
          <CardGridSkeleton count={5} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" height="h-16" />
          <Skeleton className="w-full h-[380px]" />
        </div>
      ) : (
        <>
          {/* KPI band — bound to overview.* */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi label="Dedicated Lanes" value={laneCount} format={v => Math.round(v)}
              sub={`${laneCount - (overview.underwater_lanes || 0)} active · ${overview.underwater_lanes || 0} underwater`} accent="bg-orange-500/70" />
            <Kpi label="Trailers Staged" value={overview.trailers_staged || 0} format={v => Math.round(v)}
              sub={`parked across ${laneCount} lane${laneCount === 1 ? '' : 's'}`} accent="bg-orange-500/70" />
            <Kpi label="Avg Idle Days" value={overview.avg_idle_days || 0} format={v => v.toFixed(1)}
              sub="per staged trailer" accent="bg-amber-500/70" />
            <Kpi label="Idle Cost · MTD" value={overview.idle_cost_mtd || 0} format={v => fmtMoney(Math.round(v))}
              sub="days × equip cost/day" accent="bg-red-500/70" />
            <Kpi label="Net Margin · MTD" value={overview.net_mtd || 0}
              format={v => `${(overview.net_mtd || 0) >= 0 ? '+' : '−'}${fmtMoney(Math.abs(Math.round(v)))}`}
              sub="revenue − equip − idle" accent="bg-emerald-500/70" />
          </div>

          {overview.missing_rate_count > 0 && (
            <div className="text-[12px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 text-amber-700 dark:text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {overview.missing_rate_count} parked trailer{overview.missing_rate_count === 1 ? '' : 's'} have no fixed daily rate — idle cost is understated for those.
            </div>
          )}

          <IdleSplitBanner split={split} />

          {laneCount === 0 ? (
            <div className={`${S.card} p-10 text-center`}>
              <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">No dedicated lanes yet — create one to start tracking idle cost.</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5">
                {split.true_idle_unassigned || 0} unattached trailers are sitting true-idle at the Home Yard.{' '}
                <Link to="/fleet/profitability/idle" className="text-orange-600 dark:text-orange-400 font-medium hover:underline">Open Idle Review →</Link>
              </p>
              {canEdit && (
                <button onClick={openCreate} className="mt-4 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20">
                  + New Dedicated Lane
                </button>
              )}
            </div>
          ) : (
            <>
              {/* View switch */}
              <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 text-xs w-max">
                {TABS.map(([key, label, icon]) => (
                  <button key={key} onClick={() => setTab(key)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 font-semibold transition-colors ${
                      tab === key ? 'bg-orange-500 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}>
                    {icon}{label}
                  </button>
                ))}
              </div>

              {tab === 'map' ? (
                <div key="map" className="dl-view-in grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4 items-start">
                  <div className={`${S.card} overflow-hidden`}>
                    <div className="px-5 py-3.5 border-b border-gray-200 dark:border-white/5 flex items-center justify-between gap-3">
                      <span className="text-sm font-extrabold text-gray-900 dark:text-white">Facility map</span>
                      <span className="text-[11px] text-gray-400 dark:text-slate-500 font-medium">click a lane to isolate its route + yards</span>
                    </div>
                    <div className="p-2">
                      <DedicatedMap lanes={lanes} homeYard={homeYard} selectedId={selectedId} onSelect={setSelectedId} />
                    </div>
                    <div className="flex gap-x-4 gap-y-1.5 flex-wrap px-5 pb-4 pt-1 text-[11px] text-gray-400 dark:text-slate-500">
                      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Profitable</span>
                      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-amber-500" />Watch</span>
                      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-red-500" />Underwater</span>
                      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-gray-500" />Inactive</span>
                      <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rotate-45 rounded-[2px] bg-gray-500" />Home Yard (true idle)</span>
                      <span className="ml-auto">marker size = # trailers · red badge = aging units</span>
                    </div>
                  </div>
                  <div className={`${S.card} overflow-hidden min-h-[380px]`}>
                    <WarehousePanel lane={selected} homeYard={homeYard} onBack={() => setSelectedId(null)}
                      onEdit={canEdit ? openEdit : undefined} canEdit={canEdit}
                      events={mgmt.events.filter(e => e.dedicated_lane_id === selectedId)}
                      planned={mgmt.planned.filter(p => p.dedicated_lane_id === selectedId)}
                      staged={stagedMap.get(selectedId) || []}
                      trailerMap={trailerMap} driverMap={driverMap} truckMap={truckMap} recipients={mgmt.recipients}
                      onRecordEvent={canEdit ? setEventDefaults : undefined}
                      onAddPlanned={addPlanned} onDeletePlanned={removePlanned} onSaveRecipients={saveRecipients} />
                  </div>
                </div>
              ) : (
                <div key="table" className="dl-view-in">
                  <LanesTable lanes={lanes} />
                </div>
              )}
            </>
          )}
        </>
      )}

      <NewLaneModal open={modalOpen} onClose={() => { setModalOpen(false); setEditLane(null) }} onCreated={onCreated} lane={editLane} lanes={lanes} />
      <RecordEventModal open={!!eventDefaults} onClose={() => setEventDefaults(null)} onSaved={onEventSaved}
        lane={selectedId === 'home' ? null : selected} trailers={mgmt.trailers} drivers={mgmt.drivers} defaults={eventDefaults || {}} />
    </div>
  )
}
