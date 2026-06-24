import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../../../contexts/ToastContext'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import LaneHeatCanvas from './LaneHeatCanvas'
import LaneMapCanvas from './LaneMapCanvas'
import GeoHeatMap from './GeoHeatMap'
import TopPerformers from './TopPerformers'
import TrailerTypeTrends from './TrailerTypeTrends'
import { aggregateLanes, EXCLUDED_STATUSES, fetchLaneLegs, fetchTrailerTypes, makeRpmScale, makeTypeColorMap, makeWidthScale, pickAllLoadMetrics, resolveLegTypes, RPM_NULL_COLOR, UNKNOWN_TYPE } from './laneData'
import { binHeatCells } from './mapShared'
import { fmtMoney, fmtNum, fmtRpm, formatRange, shiftYmd, spanDays, thisMonth, thisWeek } from '../spotlight/spotlightShared'

// Lane Flow Map — where the money moves, geographically. Every leg in the
// window draws as an origin → destination arc: thickness = volume on that
// lane, color = $/mile (rose → amber → emerald). Additive showcase route;
// the existing Profitability page, calendar, and Spotlight are untouched.

const PRESET_LABEL = { week: 'This week', month: 'This month', custom: 'Custom' }
const LEADERBOARD_SORTS = [
  { key: 'revenue', label: 'Revenue', fn: (a, b) => b.revenue - a.revenue },
  { key: 'rpm', label: '$/mile', fn: (a, b) => (b.rpm ?? -1) - (a.rpm ?? -1) },
  { key: 'loads', label: 'Loads', fn: (a, b) => b.loads - a.loads || b.revenue - a.revenue },
]

// options: [key, label, disabled?] — disabled keeps the pill visible so the
// toolbar has the same shape in every view; it just can't be picked here.
function Pills({ value, onChange, options, title }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0" title={title}>
      {options.map(([k, lbl, disabled]) => (
        <button key={k} disabled={disabled} onClick={() => onChange(k)}
          className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${disabled ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed' : value === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
          {lbl}
        </button>
      ))}
    </div>
  )
}

function TypeBadge({ type, color }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-gray-200 dark:border-white/10 text-[10px] font-medium text-gray-600 dark:text-slate-300 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {type}
    </span>
  )
}

// One load-leg line item — shared by the "Loads on this lane" card (arc
// click) and the "Loads in this area" card (heat-spot click).
function LegRow({ leg, dateCol, rpmScale, showLane, showPhase }) {
  const legRpm = leg.leg_total_miles > 0 ? leg.leg_revenue / leg.leg_total_miles : null
  const phaseLabels = { booked: 'Booked', in_transit: 'In transit', delivered: 'Delivered' }
  return (
    <li className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
      <div className="min-w-0">
        <p className="font-medium text-gray-900 dark:text-slate-200 truncate">
          #{leg.load_number || leg.load_id}
          {showPhase && leg.load_phase && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
            leg.load_phase === 'booked' ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400' :
            leg.load_phase === 'in_transit' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' :
            'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}>{phaseLabels[leg.load_phase]}</span>}
        </p>
        {showLane && <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">{leg.origin} → {leg.destination}</p>}
        <p className="text-gray-400 dark:text-slate-500 truncate">{leg[dateCol] || '—'} · {leg.customer_name || '—'}</p>
        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Dispatcher: {leg.dispatcher_name || '—'}</p>
        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Driver: {leg.driver_display || '—'}</p>
        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Trailer: {leg.trailer_display || '—'}{leg.trailer_type ? ` · ${leg.trailer_type}` : ''}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono text-gray-900 dark:text-slate-200">{fmtMoney(leg.leg_revenue)}</p>
        <p className="font-mono text-[11px]" style={{ color: rpmScale ? rpmScale.color(legRpm) : undefined }}>
          {legRpm != null ? `${fmtRpm(legRpm)}/mi` : '—'}
        </p>
        <p className="font-mono text-gray-400 dark:text-slate-500">{fmtNum(leg.leg_total_miles)} mi</p>
      </div>
    </li>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div className={`${S.card} px-4 py-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white font-mono leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 dark:text-slate-500">{sub}</p>}
    </div>
  )
}

// ── Worst-load card advisory notes ──────────────────────────────────────────
// Strictly additive — never hide or change the displayed value/lane.

// Realistic revenue floor: a sub-$500 same-city load is almost certainly a TONU.
const TONU_FLOOR = 500
const sameCity = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

// "Worst load · by revenue" → amber Possible-TONU note. Shown only when the
// displayed load is both below the floor AND same-city pickup & drop (the TONU
// signature); a legit sub-$500 different-city run is correctly excluded.
function WorstRevenueNote({ load }) {
  if (!load || !(Number(load.revenue) < TONU_FLOOR && sameCity(load.origin, load.destination))) return null
  return (
    <div className="mt-2">
      <span
        title="Below the $500 realistic floor · same-city pickup & drop"
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-300"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
        </svg>
        Possible TONU
      </span>
    </div>
  )
}

// "Worst load · by $/mi" → blue combined-load note. One RPC scoped to the
// single worst load_number, memoized on it (re-fires only when it changes).
// Fail-safe: any error / empty / 'none' renders nothing.
function WorstRpmCombineNote({ loadNumber }) {
  const [info, setInfo] = useState(null)
  // Rendered with key={loadNumber} so the component remounts when the worst
  // load changes — state resets without a synchronous in-effect reset.
  useEffect(() => {
    if (!loadNumber) return
    let stale = false
    supabase.rpc('worst_load_combine_flag', { p_load_number: loadNumber })
      .then(({ data, error }) => {
        if (stale) return
        const row = !error && Array.isArray(data) && data.length ? data[0] : null
        setInfo(row && (row.combine_state === 'candidate' || row.combine_state === 'tagged') ? row : null)
      })
      .catch(() => { if (!stale) setInfo(null) })
    return () => { stale = true }
  }, [loadNumber])

  if (!info) return null
  const tagged = info.combine_state === 'tagged'
  const partners = String(info.partner_load || '').split(', ').filter(Boolean).map(n => `#${n}`).join(', ')
  const rpm = info.combined_rpm == null ? null : `$${Number(info.combined_rpm).toFixed(2)}/mi`
  const tooltip = `${tagged ? 'Grouped' : 'Candidate'} w/ ${partners || '—'}${rpm ? ` · combined ≈ ${rpm}` : ''}`
  return (
    <div className="mt-2">
      <span
        title={tooltip}
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-900/60 dark:text-blue-300"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v6a5 5 0 0 0 5 5h5m0 0-3-3m3 3-3 3" />
        </svg>
        {tagged ? 'Combined load' : 'Possible combine'}
      </span>
    </div>
  )
}

export default function LaneFlowMap() {
  const toast = useToast()
  const [preset, setPreset] = useState('week')
  const [range, setRange] = useState(thisWeek)
  const [basis, setBasis] = useState('delivery')
  const [selectedPhases, setSelectedPhases] = useState(new Set(['in_transit', 'delivered'])) // booked | in_transit | delivered
  const [weight, setWeight] = useState('revenue') // intensity: revenue | loads | rpm (rpm is heat-only)
  const [colorBy, setColorBy] = useState('rpm') // arc color: rpm | type
  const [mapMode, setMapMode] = useState('heat') // lanes (arcs) | heat (density)
  function switchMapMode(m) {
    setMapMode(m)
    // $/mile is an average — meaningful as heat intensity, not as arc
    // thickness, so leaving Heat falls back to revenue weighting.
    if (m === 'lanes' && weight === 'rpm') setWeight('revenue')
  }
  const [sortKey, setSortKey] = useState('revenue')
  const [dispatcherSearchOpen, setDispatcherSearchOpen] = useState(false)
  const [dispatcherSearchQuery, setDispatcherSearchQuery] = useState('')
  const dispatcherInputRef = useRef(null)

  // Fetched legs are stored with the period key they belong to, so a
  // period/basis change invalidates them by derivation (Spotlight pattern).
  const dataKey = `${range.from}|${range.to}|${basis}`
  const [legState, setLegState] = useState({ key: null, legs: null })

  // Dispatcher filter is keyed to the data window like the selection below —
  // changing period/basis resets it by derivation, no reset effect needed.
  const [dispFilterState, setDispFilterState] = useState({ key: null, id: null })
  const dispatcherFilter = dispFilterState.key === dataKey ? dispFilterState.id : null
  const setDispatcherFilter = useCallback((id) => setDispFilterState({ key: dataKey, id }), [dataKey])

  const clearDispatcherFilter = useCallback((reopen) => {
    setDispatcherFilter(null)
    setDispatcherSearchQuery('')
    setDispatcherSearchOpen(!!reopen)
    if (reopen) dispatcherInputRef.current?.focus()
  }, [setDispatcherFilter])
  useEffect(() => {
    let stale = false
    Promise.all([
      fetchLaneLegs({ from: range.from, to: range.to, basis }),
      // Trailer type is resolved by a live join at render time — legs gain
      // trailers days later via the weekly assignment upload, so the type is
      // never snapshotted. A failed trailers fetch degrades to all-Unknown.
      fetchTrailerTypes().catch(() => new Map()),
    ])
      .then(([legs, typeById]) => { if (!stale) setLegState({ key: dataKey, legs, typeById }) })
      .catch(err => {
        if (!stale) {
          toast.error("Couldn't load lane data", err)
          setLegState({ key: dataKey, legs: [], typeById: new Map() })
        }
      })
    return () => { stale = true }
  }, [dataKey, range.from, range.to, basis, toast])
  const loading = legState.key !== dataKey

  const typedLegs = useMemo(
    () => (legState.legs ? resolveLegTypes(legState.legs, legState.typeById) : null),
    [legState],
  )

  // Type list is derived from the data so new trailer types appear on their
  // own; Unknown sorts last when present.
  const typeOptions = useMemo(() => {
    if (!typedLegs) return []
    const set = new Set(typedLegs.map(l => l.trailer_type))
    const known = [...set].filter(t => t !== UNKNOWN_TYPE).sort((a, b) => a.localeCompare(b))
    return set.has(UNKNOWN_TYPE) ? [...known, UNKNOWN_TYPE] : known
  }, [typedLegs])

  const typeColorMap = useMemo(() => makeTypeColorMap(typeOptions), [typeOptions])
  const typeColorFor = useCallback((t) => typeColorMap.get(t) || RPM_NULL_COLOR, [typeColorMap])

  // Trailer-type filter, window-keyed like the dispatcher filter.
  // null = all types, otherwise the array of types kept.
  const [typeFilterState, setTypeFilterState] = useState({ key: null, sel: null })
  const typeFilter = typeFilterState.key === dataKey ? typeFilterState.sel : null
  function toggleType(t) {
    // Functional update so rapid clicks can't act on a stale selection.
    setTypeFilterState(s => {
      const cur = s.key === dataKey ? s.sel : null
      let next
      if (!cur) next = [t] // from "all", the first click isolates that type
      else if (cur.includes(t)) next = cur.filter(x => x !== t)
      else next = [...cur, t]
      if (!next.length || next.length >= typeOptions.length) next = null
      return { key: dataKey, sel: next }
    })
  }

  const dispatchers = useMemo(() => {
    if (!legState.legs) return []
    const seen = new Map()
    for (const l of legState.legs) {
      if (l.dispatcher_id && !seen.has(l.dispatcher_id))
        seen.set(l.dispatcher_id, l.dispatcher_name || String(l.dispatcher_id))
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [legState.legs])

  const filteredDispatchers = useMemo(() => {
    const q = dispatcherSearchQuery.trim().toLowerCase()
    return dispatchers.filter(d => d.name.toLowerCase().includes(q))
  }, [dispatchers, dispatcherSearchQuery])

  const filteredLegs = useMemo(() => {
    if (!typedLegs) return typedLegs
    let legs = typedLegs
    if (dispatcherFilter) legs = legs.filter(l => l.dispatcher_id === dispatcherFilter)
    if (typeFilter) legs = legs.filter(l => typeFilter.includes(l.trailer_type))
    return legs
  }, [typedLegs, dispatcherFilter, typeFilter])

  // Lanes split per trailer type so every $/mi row is type-pure — a mixed
  // corridor becomes one row per type, never a blended rate.
  const agg = useMemo(
    () => (loading ? null : aggregateLanes(filteredLegs, [...selectedPhases], { byType: true })),
    [loading, filteredLegs, selectedPhases],
  )
  const rpmScale = useMemo(() => (agg ? makeRpmScale(agg.lanes) : null), [agg])
  const widthFor = useMemo(() => (agg ? makeWidthScale(agg.lanes, weight === 'rpm' ? 'revenue' : weight) : null), [agg, weight])

  const sortDef = LEADERBOARD_SORTS.find(s => s.key === sortKey) || LEADERBOARD_SORTS[0]
  const ranked = useMemo(() => (agg ? [...agg.lanes].sort(sortDef.fn) : []), [agg, sortDef])

  // Best/worst loads by both metrics simultaneously, independent of leaderboard toggle
  const allLoadMetrics = useMemo(() => (agg ? pickAllLoadMetrics(agg.loads, EXCLUDED_STATUSES) : null), [agg])

  function togglePhase(phase) {
    setSelectedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phase)) {
        // Don't allow deselecting if it's the only one selected
        if (next.size > 1) next.delete(phase)
      } else {
        next.add(phase)
      }
      return next
    })
  }

  // Selection is keyed to (period, phases): switching window or phases clears
  // it by derivation rather than a reset effect.
  const phasesKey = [...selectedPhases].sort().join('|')
  const selKey = `${dataKey}|${phasesKey}`
  const [selState, setSelState] = useState({ key: null, lane: null })
  const selectedKey = selState.key === selKey ? selState.lane : null
  const setSelected = useCallback((lane) => setSelState({ key: selKey, lane }), [selKey])
  const selectedLane = selectedKey && agg ? agg.lanes.find(l => l.key === selectedKey) : null

  // Heat-spot selection mirrors the lane selection: clicking a hot cell pins
  // it and the side panel lists the loads touching that area.
  const heatCells = useMemo(() => (agg ? binHeatCells(agg.lanes) : []), [agg])
  const [heatCellState, setHeatCellState] = useState({ key: null, cell: null })
  const selectedCellKey = heatCellState.key === selKey ? heatCellState.cell : null
  const setSelectedCell = useCallback((k) => setHeatCellState({ key: selKey, cell: k }), [selKey])
  const selectedCell = selectedCellKey ? heatCells.find(c => c.key === selectedCellKey) : null

  // An active selection's detail card takes the leaderboard's slot in the
  // side panel (small screens shouldn't scroll to find it); "← Leaderboard"
  // brings the list back. Heat-spot selection wins while in the Heat view.
  const activeDetail = mapMode === 'heat' && selectedCell ? 'cell' : selectedLane ? 'lane' : null

  function setPresetRange(p) {
    setPreset(p)
    if (p === 'week') setRange(thisWeek())
    else if (p === 'month') setRange(thisMonth())
  }
  function shiftRange(dir) {
    setRange(r => {
      const span = spanDays(r.from, r.to)
      return { from: shiftYmd(r.from, dir * span), to: shiftYmd(r.to, dir * span) }
    })
  }

  // Lane KPIs count distinct corridors, not the type-split rows.
  const distinctLanes = agg ? new Set(agg.lanes.map(l => `${l.origin} → ${l.destination}`)).size : 0
  const offMapLanes = agg ? new Set(agg.lanes.filter(l => !l.geocoded).map(l => `${l.origin} → ${l.destination}`)).size : 0
  const typesPresent = useMemo(
    () => (agg ? typeOptions.filter(t => agg.lanes.some(l => l.trailerType === t)) : []),
    [agg, typeOptions],
  )
  const laneColorFor = colorBy === 'type' ? (lane) => typeColorFor(lane.trailerType) : null
  // Isolating a single trailer type tints the heat ramp toward that type's
  // color so a screenshot identifies itself.
  const heatTint = typeFilter && typeFilter.length === 1 ? typeColorFor(typeFilter[0]) : null
  const dateCol = basis === 'pickup' ? 'pickup_date' : 'delivery_date'

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lane Flow Map</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Every load drawn origin → destination — thick arcs carry the volume, green arcs pay the best per mile.
            <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 align-middle whitespace-nowrap" title="Fuel, insurance, and driver pay aren't in BUDDY yet — lane $/mile is a revenue signal, not a margin verdict.">
              Revenue view — net margin pending cost layer
            </span>
          </p>
        </div>
      </div>

      {/* ── KPI band ── */}
      {agg && agg.totals.legs > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi label="Lanes" value={fmtNum(distinctLanes)} sub={offMapLanes ? `${offMapLanes} off-map` : 'all on map'} />
          <Kpi label="Loads" value={fmtNum(agg.totals.loads)} sub={[...selectedPhases].sort().join(' + ')} />
          <Kpi label="Revenue" value={fmtMoney(agg.totals.revenue)} sub={`${fmtNum(agg.totals.miles)} mi`} />
          <Kpi label="$/mile" value={agg.totals.rpm == null ? '—' : `${fmtRpm(agg.totals.rpm)}/mi`} sub="all lanes" />
          <Kpi label="Map coverage" value={agg.coverage == null ? '—' : `${Math.round(agg.coverage * 100)}%`} sub="of loads geocoded" />
        </div>
      )}

      {/* ── Controls — one toolbar that sits right against the map, so changing
          a filter and seeing the result never needs a scroll. Every control is
          present in both views (disabled when not applicable) so the bar keeps
          the exact same shape switching Lanes ↔ Heat. ── */}
      <div className="flex items-center flex-wrap gap-2">
          <Pills value={mapMode} onChange={switchMapMode} title="Lanes = origin→destination arcs · Heat = where freight concentrates"
            options={[['lanes', 'Lanes'], ['heat', 'Heat']]} />
          <div className="flex items-center gap-1 flex-wrap">
            {['booked', 'in_transit', 'delivered'].map(phase => {
              const labels = { booked: 'Booked', in_transit: 'In transit', delivered: 'Delivered' }
              const isSelected = selectedPhases.has(phase)
              return (
                <button key={phase} onClick={() => togglePhase(phase)}
                  title={phase === 'in_transit' ? 'Picked up, not yet delivered' : phase === 'booked' ? 'Pickup date in the future' : 'Delivery date has passed'}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400'
                      : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}>
                  {labels[phase]}
                </button>
              )
            })}
          </div>
          <Pills value={weight} onChange={setWeight}
            title={mapMode === 'heat' ? 'Heat intensity: revenue sum, load count, or revenue-weighted average $/mile' : 'What arc thickness represents — $/mile weighting applies to the Heat view'}
            options={[['revenue', 'Weight: revenue'], ['loads', 'Weight: loads'], ['rpm', 'Weight: $/mile', mapMode !== 'heat']]} />
          <Pills value={colorBy} onChange={setColorBy}
            title={mapMode === 'heat' ? 'Arc color applies to the Lanes view' : 'Arc color: $/mile gradient, or one categorical color per trailer type'}
            options={[['rpm', 'Color: $/mi', mapMode === 'heat'], ['type', 'Color: type', mapMode === 'heat']]} />
          {typeOptions.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              {typeOptions.map(t => {
                const active = !typeFilter || typeFilter.includes(t)
                return (
                  <button key={t} onClick={() => toggleType(t)}
                    title={typeFilter ? 'Click to add or remove this trailer type' : 'Click to isolate this trailer type'}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] transition-colors ${active ? 'border-gray-300 dark:border-white/20 text-gray-700 dark:text-slate-200 bg-white dark:bg-white/5' : 'border-gray-200 dark:border-white/10 text-gray-400 dark:text-slate-600 opacity-60'}`}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: typeColorFor(t), opacity: active ? 1 : 0.4 }} />
                    {t}
                  </button>
                )
              })}
              {typeFilter && (
                <button onClick={() => setTypeFilterState({ key: dataKey, sel: null })}
                  className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline px-1" title="Show all trailer types">
                  All types
                </button>
              )}
            </div>
          )}
          {dispatchers.length > 1 && (
            <div className="relative">
              <input
                ref={dispatcherInputRef}
                type="text"
                value={dispatcherFilter ? (dispatchers.find(d => d.id === dispatcherFilter)?.name || '') : dispatcherSearchQuery}
                onChange={e => {
                  // Editing while a dispatcher is selected turns the text into a
                  // fresh search — emptying the box can never leave a stale filter.
                  if (dispatcherFilter) setDispatcherFilter(null)
                  setDispatcherSearchQuery(e.target.value)
                  setDispatcherSearchOpen(true)
                }}
                onFocus={() => setDispatcherSearchOpen(true)}
                onBlur={() => setTimeout(() => setDispatcherSearchOpen(false), 150)}
                onKeyDown={e => { if (e.key === 'Escape') clearDispatcherFilter(false) }}
                placeholder="Filter dispatchers…"
                className={`${S.input} w-32 text-xs ${dispatcherFilter ? 'pr-7 ring-2 ring-orange-400/50' : ''}`}
                title="Search and filter by dispatcher — ✕ or Escape resets to all"
              />
              {dispatcherFilter && (
                <button
                  onMouseDown={e => { e.preventDefault(); clearDispatcherFilter(true) }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-[10px] leading-none text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-white/10"
                  title="Clear dispatcher filter (back to all dispatchers)"
                  aria-label="Clear dispatcher filter"
                >✕</button>
              )}
              {dispatcherSearchOpen && (
                <div className="absolute z-50 mt-1 w-48 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg overflow-hidden">
                  <button
                    onMouseDown={e => { e.preventDefault(); setDispatcherFilter(null); setDispatcherSearchQuery(''); setDispatcherSearchOpen(false) }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-slate-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 border-b border-gray-100 dark:border-white/[0.06]"
                  >
                    All dispatchers
                  </button>
                  {filteredDispatchers.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</p>
                  ) : (
                    filteredDispatchers.map(d => (
                      <button
                        key={d.id}
                        onMouseDown={e => { e.preventDefault(); setDispatcherFilter(d.id); setDispatcherSearchQuery(''); setDispatcherSearchOpen(false) }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-orange-50 dark:hover:bg-orange-500/10 ${dispatcherFilter === d.id ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}
                      >
                        {d.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => shiftRange(-1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Previous period">◀</button>
            <Pills value={preset} onChange={setPresetRange} options={[['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']]} />
            <button onClick={() => shiftRange(1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Next period">▶</button>
            <Pills value={basis} onChange={setBasis} options={[['delivery', 'By delivery'], ['pickup', 'By pickup']]} />
            {preset === 'custom' && (
              <div className="flex items-center gap-1.5 shrink-0">
                <input type="date" className={`${S.input} w-[9rem]`} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                <span className="text-gray-400 text-xs">→</span>
                <input type="date" className={`${S.input} w-[9rem]`} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
              </div>
            )}
        </div>
        <p className="basis-full text-[11px] text-gray-400 dark:text-slate-500 -mt-1">{[...selectedPhases].sort((a, b) => {
            const order = { booked: 0, in_transit: 1, delivered: 2 }
            return (order[a] ?? 3) - (order[b] ?? 3)
          }).map(p => p === 'in_transit' ? 'In transit' : p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')} · {formatRange(range.from, range.to)} · by {basis} date</p>
      </div>

      {/* ── Map + leaderboard ── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Map card */}
        <div className="rounded-3xl border border-gray-200 dark:border-white/10 bg-gradient-to-b from-white to-gray-50 dark:from-[#12132e] dark:to-[#0a0a18] overflow-hidden">
          <div className="flex items-start justify-between flex-wrap gap-4 px-5 pt-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Map
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Origin → destination</h2>
              <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
                {[...selectedPhases].sort((a, b) => {
                  const order = { booked: 0, in_transit: 1, delivered: 2 }
                  return (order[a] ?? 3) - (order[b] ?? 3)
                }).map(p => p === 'in_transit' ? 'In transit' : p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')} {mapMode === 'heat' ? 'heat' : 'flow'} · {formatRange(range.from, range.to)}
              </p>
            </div>
            {mapMode === 'heat' ? null : colorBy === 'type' && typesPresent.length > 0 ? (
              <div className="flex items-center gap-2.5 flex-wrap text-[10px] text-gray-400 dark:text-slate-500">
                {typesPresent.map(t => (
                  <span key={t} className="inline-flex items-center gap-1">
                    <span className="rounded-full" style={{ background: typeColorFor(t), height: 3, width: 12 }} />
                    {t}
                  </span>
                ))}
              </div>
            ) : rpmScale && (
              <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-slate-500">
                <span className="font-mono">{fmtRpm(rpmScale.domain[0])}/mi</span>
                <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${rpmScale.colorAt(0)}, ${rpmScale.colorAt(0.5)}, ${rpmScale.colorAt(1)})` }} />
                <span className="font-mono">{fmtRpm(rpmScale.domain[1])}/mi</span>
              </div>
            )}
          </div>
          {loading ? (
            <div className="aspect-[975/610] m-5 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          ) : agg.totals.legs === 0 ? (
            <div className="aspect-[975/610] flex items-center justify-center text-sm text-gray-400 dark:text-slate-500 px-8 text-center">
              No {[...selectedPhases].sort().join(' + ')} loads in this window. Try another period or select different phases.
            </div>
          ) : (
            <div className="px-2 pb-1">
              {/* Both layers stay mounted and cross-fade on toggle; the
                  transition collapses under prefers-reduced-motion. */}
              <div className="relative">
                <div className={`transition-opacity duration-300 motion-reduce:transition-none ${mapMode === 'heat' ? 'opacity-0 pointer-events-none absolute inset-0' : 'opacity-100'}`} aria-hidden={mapMode === 'heat'}>
                  <LaneMapCanvas
                    lanes={agg.lanes}
                    cities={agg.cities}
                    colorFor={rpmScale.color}
                    widthFor={widthFor}
                    selectedKey={selectedKey}
                    onSelect={setSelected}
                    laneColorFor={laneColorFor || undefined}
                    typeColorFor={typeColorFor}
                    selectedPhases={selectedPhases}
                  />
                </div>
                <div className={`transition-opacity duration-300 motion-reduce:transition-none ${mapMode === 'lanes' ? 'opacity-0 pointer-events-none absolute inset-0' : 'opacity-100'}`} aria-hidden={mapMode === 'lanes'}>
                  <LaneHeatCanvas cells={heatCells} metric={weight} tintColor={heatTint}
                    selectedKey={selectedCellKey} onSelect={setSelectedCell} />
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-2 px-5 pb-3 pt-1">
            <p className="text-[11px] text-gray-400 dark:text-slate-500">
              {agg && agg.coverage != null && agg.coverage < 1
                ? `Geocode coverage: ${Math.round(agg.coverage * 100)}% of loads — the rest stay in the table below.`
                : mapMode === 'heat' ? 'Hover a hot area for what drives it.' : 'Hover an arc for the lane, click to pin it.'}
            </p>
            {mapMode === 'heat' ? (
              <p className="text-[11px] text-gray-400 dark:text-slate-500">
                Each load glows at its origin and destination — brighter = more {weight === 'rpm' ? 'revenue per mile' : weight === 'loads' ? 'loads' : 'revenue'}.
              </p>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
                <span className="inline-block w-4 h-0.5 rounded-full bg-gray-400 dark:bg-slate-400" style={{ height: 2 }} /> thin = light volume
                <span className="inline-block w-4 rounded-full bg-gray-400 dark:bg-slate-400" style={{ height: 5 }} /> thick = heavy volume
              </p>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4 min-w-0">
          {/* Best / worst loads by both revenue and $/mi */}
          {allLoadMetrics && (
            <div className="space-y-3">
              {/* By Revenue row */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Best load · by revenue', allLoadMetrics.bestByRevenue, 'text-emerald-600 dark:text-emerald-400', true],
                  ['Worst load · by revenue', allLoadMetrics.worstByRevenue, 'text-rose-600 dark:text-rose-400', true],
                ].map(([lbl, load, cls]) => (
                  <div key={lbl} className={`${S.card} px-4 py-3 text-left`}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{lbl}</p>
                    <p className={`text-lg font-bold font-mono leading-tight mt-0.5 ${cls}`}>{fmtMoney(load.revenue)}</p>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate" title={`${load.origin} → ${load.destination}`}>{load.origin} → {load.destination}</p>
                    {load.trailer_type && <p className="mt-0.5"><TypeBadge type={load.trailer_type} color={typeColorFor(load.trailer_type)} /></p>}
                    <p className="text-[10px] text-gray-400 dark:text-slate-500">#{load.load_number}</p>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500">{fmtRpm(load.rpm)}/mi · {fmtNum(load.miles)} mi</p>
                    {lbl.startsWith('Worst') && <WorstRevenueNote load={load} />}
                  </div>
                ))}
              </div>
              {/* By $/mi row */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Best load · by $/mi', allLoadMetrics.bestByRpm, 'text-emerald-600 dark:text-emerald-400', false],
                  ['Worst load · by $/mi', allLoadMetrics.worstByRpm, 'text-rose-600 dark:text-rose-400', false],
                ].map(([lbl, load, cls]) => (
                  <div key={lbl} className={`${S.card} px-4 py-3 text-left`}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{lbl}</p>
                    {load ? (
                      <>
                        <p className={`text-lg font-bold font-mono leading-tight mt-0.5 ${cls}`}>{fmtRpm(load.rpm)}/mi</p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate" title={`${load.origin} → ${load.destination}`}>{load.origin} → {load.destination}</p>
                        {load.trailer_type && <p className="mt-0.5"><TypeBadge type={load.trailer_type} color={typeColorFor(load.trailer_type)} /></p>}
                        <p className="text-[10px] text-gray-400 dark:text-slate-500">#{load.load_number}</p>
                        <p className="text-[10px] text-gray-400 dark:text-slate-500">{fmtMoney(load.revenue)} · {fmtNum(load.miles)} mi</p>
                        {lbl.startsWith('Worst') && <WorstRpmCombineNote key={load.load_number} loadNumber={load.load_number} />}
                      </>
                    ) : (
                      <p className="text-[11px] text-gray-400 dark:text-slate-500">—</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leaderboard — hidden while a selection's detail card uses its slot */}
          {!activeDetail && (
          <div className={`${S.card} overflow-hidden`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/5">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Lane leaderboard</p>
              <Pills value={sortKey} onChange={setSortKey} options={LEADERBOARD_SORTS.map(s => [s.key, s.label])} title="Revenue — total $ on the lane · $/mile — revenue ÷ miles · Loads — how many loads ran this origin→destination. Tied lanes sorted by revenue." />
            </div>
            <div className="max-h-[460px] overflow-y-auto">
              {ranked.length === 0 ? (
                <p className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">No lanes in this window.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className={`${S.tableHead} sticky top-0 bg-white dark:bg-[#0d0d1f] z-10`}>
                    <tr>
                      <th className={`${S.th} !px-3`}>Lane</th>
                      <th className={`${S.th} !px-2 text-right`}>Loads</th>
                      <th className={`${S.th} !px-2 text-right`}>Revenue</th>
                      <th className={`${S.th} !px-2 text-right`}>$/mi</th>
                      <th className={`${S.th} !px-3 text-right`}>Avg mi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map(lane => {
                      // Show phase breakdown in leaderboard when multiple phases shown
                      const phaseLabels = { booked: 'Booked', in_transit: 'In transit', delivered: 'Delivered' }
                      const phaseBreakdown = selectedPhases.size > 1 && lane.legs ? (() => {
                        const phases = new Map()
                        for (const phase of ['booked', 'in_transit', 'delivered']) {
                          phases.set(phase, lane.legs.filter(l => l.load_phase === phase).length)
                        }
                        return phases
                      })() : null
                      return (
                      <tr key={lane.key} onClick={() => setSelected(lane.key === selectedKey ? null : lane.key)}
                        className={`${S.tableRow} cursor-pointer ${selectedKey === lane.key ? 'bg-orange-50 dark:bg-orange-500/10' : ''}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900 dark:text-slate-200 leading-tight">{lane.origin}</p>
                          <p className="text-gray-400 dark:text-slate-500 leading-tight">→ {lane.destination}{!lane.geocoded && <span className="ml-1 text-amber-600 dark:text-amber-400" title="This lane couldn't be geocoded, so it isn't drawn on the map.">⌀ off-map</span>}</p>
                          {lane.trailerType && <p className="mt-1 leading-none"><TypeBadge type={lane.trailerType} color={typeColorFor(lane.trailerType)} /></p>}
                          {phaseBreakdown && (
                            <p className="mt-1 text-[10px] text-gray-500 dark:text-slate-400 flex flex-wrap gap-1">
                              {[...phaseBreakdown].map(([phase, count]) => count > 0 && (
                                <span key={phase} className={`inline-block px-1.5 py-0.5 rounded-full ${
                                  phase === 'booked' ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400' :
                                  phase === 'in_transit' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' :
                                  'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                }`}>{phaseLabels[phase]} {count}</span>
                              ))}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{lane.loads}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-900 dark:text-slate-200">{fmtMoney(lane.revenue)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold" style={{ color: rpmScale ? rpmScale.color(lane.rpm) : RPM_NULL_COLOR }}>{fmtRpm(lane.rpm)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{fmtNum(lane.avgMiles)}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          )}

          {/* Loads on the selected lane */}
          {activeDetail === 'lane' && selectedLane && (
            <div className={`${S.card} overflow-hidden`}>
              <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Loads on this lane</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedLane.origin} <span className="text-orange-500">→</span> {selectedLane.destination}</p>
                  {selectedLane.trailerType && <p className="mt-1"><TypeBadge type={selectedLane.trailerType} color={typeColorFor(selectedLane.trailerType)} /></p>}
                </div>
                <button onClick={() => setSelected(null)}
                  className="shrink-0 text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline"
                  title="Clear selection and show the lane leaderboard">← Leaderboard</button>
              </div>
              <ul className="divide-y divide-gray-50 dark:divide-white/[0.03] max-h-72 overflow-y-auto">
                {selectedLane.legs.map(leg => <LegRow key={leg.leg_id} leg={leg} dateCol={dateCol} rpmScale={rpmScale} showPhase={selectedPhases.size > 1} />)}
              </ul>
            </div>
          )}

          {/* Loads touching the pinned heat spot (heat view's lane click) */}
          {activeDetail === 'cell' && selectedCell && (
            <div className={`${S.card} overflow-hidden`}>
              <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Loads in this area</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedCell.topCity || 'Selected area'}</p>
                  <p className="text-[11px] text-gray-400 dark:text-slate-500">{selectedCell.legs.length} load{selectedCell.legs.length === 1 ? '' : 's'} · {fmtMoney(selectedCell.revenue)} touching</p>
                </div>
                <button onClick={() => setSelectedCell(null)}
                  className="shrink-0 text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline"
                  title="Clear selection and show the lane leaderboard">← Leaderboard</button>
              </div>
              <ul className="divide-y divide-gray-50 dark:divide-white/[0.03] max-h-72 overflow-y-auto">
                {selectedCell.legs.map(leg => <LegRow key={leg.leg_id} leg={leg} dateCol={dateCol} rpmScale={rpmScale} showLane showPhase={selectedPhases.size > 1} />)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── Geo heat map section ── */}
      <GeoHeatMap
        range={range}
        phases={selectedPhases}
        pageTitle="Lanes by region & state"
      />

      {/* ── Top performers section ── */}
      <TopPerformers
        range={range}
        phases={selectedPhases}
      />

      {/* ── Trailer type trends section ── */}
      <TrailerTypeTrends />

      {/* ── Honesty footer ── */}
      <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center max-w-3xl mx-auto">
        Revenue, miles, and $/mile are live BUDDY data. City positions come from a bundled US Census gazetteer — loads whose city can't be placed stay in the table and are counted in the coverage figure.
        Fuel, insurance, and driver pay are not in BUDDY yet, so lane $/mile is a revenue signal, not net margin.
      </p>
    </div>
  )
}
