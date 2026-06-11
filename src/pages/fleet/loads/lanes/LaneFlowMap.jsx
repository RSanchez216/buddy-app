import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../../../contexts/ToastContext'
import { S } from '../../../../lib/styles'
import LaneMapCanvas from './LaneMapCanvas'
import { aggregateLanes, fetchLaneLegs, makeRpmScale, makeWidthScale, pickPayers, RPM_NULL_COLOR } from './laneData'
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

function Pills({ value, onChange, options, title }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0" title={title}>
      {options.map(([k, lbl]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${value === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
          {lbl}
        </button>
      ))}
    </div>
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

export default function LaneFlowMap() {
  const toast = useToast()
  const [preset, setPreset] = useState('week')
  const [range, setRange] = useState(thisWeek)
  const [basis, setBasis] = useState('delivery')
  const [view, setView] = useState('realized') // realized | booked
  const [weight, setWeight] = useState('revenue') // arc thickness: revenue | loads
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
    fetchLaneLegs({ from: range.from, to: range.to, basis })
      .then(legs => { if (!stale) setLegState({ key: dataKey, legs }) })
      .catch(err => {
        if (!stale) {
          toast.error("Couldn't load lane data", err)
          setLegState({ key: dataKey, legs: [] })
        }
      })
    return () => { stale = true }
  }, [dataKey, range.from, range.to, basis, toast])
  const loading = legState.key !== dataKey

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
    if (!legState.legs || !dispatcherFilter) return legState.legs
    return legState.legs.filter(l => l.dispatcher_id === dispatcherFilter)
  }, [legState.legs, dispatcherFilter])

  const agg = useMemo(
    () => (loading ? null : aggregateLanes(filteredLegs, view)),
    [loading, filteredLegs, view],
  )
  const rpmScale = useMemo(() => (agg ? makeRpmScale(agg.lanes) : null), [agg])
  const widthFor = useMemo(() => (agg ? makeWidthScale(agg.lanes, weight) : null), [agg, weight])

  const sortDef = LEADERBOARD_SORTS.find(s => s.key === sortKey) || LEADERBOARD_SORTS[0]
  const ranked = useMemo(() => (agg ? [...agg.lanes].sort(sortDef.fn) : []), [agg, sortDef])

  const payers = useMemo(() => (agg ? pickPayers(agg.lanes) : null), [agg])

  // Selection is keyed to (period, view): switching window or Realized/
  // Booked clears it by derivation rather than a reset effect.
  const selKey = `${dataKey}|${view}`
  const [selState, setSelState] = useState({ key: null, lane: null })
  const selectedKey = selState.key === selKey ? selState.lane : null
  const setSelected = useCallback((lane) => setSelState({ key: selKey, lane }), [selKey])
  const selectedLane = selectedKey && agg ? agg.lanes.find(l => l.key === selectedKey) : null

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

  const offMapLanes = agg ? agg.lanes.filter(l => !l.geocoded).length : 0
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

      {/* ── Controls ── */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center flex-wrap gap-2">
          <Pills value={view} onChange={setView} title="Realized = delivered revenue · Booked = projected revenue on upcoming loads"
            options={[['realized', 'Realized'], ['booked', 'Booked']]} />
          <Pills value={weight} onChange={setWeight} title="What arc thickness represents"
            options={[['revenue', 'Weight: revenue'], ['loads', 'Weight: loads']]} />
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
        </div>
        <div className="flex flex-col gap-1.5 lg:items-end">
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
          <p className="text-[11px] text-gray-400 dark:text-slate-500">{PRESET_LABEL[preset]} · {formatRange(range.from, range.to)} · by {basis} date</p>
        </div>
      </div>

      {/* ── KPI band ── */}
      {agg && agg.totals.legs > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi label="Lanes" value={fmtNum(agg.totals.lanes)} sub={offMapLanes ? `${offMapLanes} off-map` : 'all on map'} />
          <Kpi label="Loads" value={fmtNum(agg.totals.legs)} sub={view === 'booked' ? 'booked' : 'delivered'} />
          <Kpi label={view === 'booked' ? 'Booked revenue' : 'Revenue'} value={fmtMoney(agg.totals.revenue)} sub={`${fmtNum(agg.totals.miles)} mi`} />
          <Kpi label="$/mile" value={agg.totals.rpm == null ? '—' : `${fmtRpm(agg.totals.rpm)}/mi`} sub="all lanes" />
          <Kpi label="Map coverage" value={agg.coverage == null ? '—' : `${Math.round(agg.coverage * 100)}%`} sub="of loads geocoded" />
        </div>
      )}

      {/* ── Map + leaderboard ── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Map card */}
        <div className="rounded-3xl border border-gray-200 dark:border-white/10 bg-gradient-to-b from-white to-gray-50 dark:from-[#12132e] dark:to-[#0a0a18] overflow-hidden">
          <div className="flex items-center justify-between flex-wrap gap-2 px-5 pt-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">
              {view === 'booked' ? 'Booked flow' : 'Realized flow'} · {formatRange(range.from, range.to)}
            </p>
            {rpmScale && (
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
              No {view === 'booked' ? 'booked' : 'delivered'} loads in this window. Try another period or switch the {view === 'booked' ? 'Realized' : 'Booked'} view.
            </div>
          ) : (
            <div className="px-2 pb-1">
              <LaneMapCanvas
                lanes={agg.lanes}
                cities={agg.cities}
                colorFor={rpmScale.color}
                widthFor={widthFor}
                selectedKey={selectedKey}
                onSelect={setSelected}
              />
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-2 px-5 pb-3 pt-1">
            <p className="text-[11px] text-gray-400 dark:text-slate-500">
              {agg && agg.coverage != null && agg.coverage < 1
                ? `Geocode coverage: ${Math.round(agg.coverage * 100)}% of loads — the rest stay in the table below.`
                : 'Hover an arc for the lane, click to pin it.'}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 rounded-full bg-gray-400 dark:bg-slate-400" style={{ height: 2 }} /> thin = light volume
              <span className="inline-block w-4 rounded-full bg-gray-400 dark:bg-slate-400" style={{ height: 5 }} /> thick = heavy volume
            </p>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4 min-w-0">
          {/* Best / worst payers */}
          {payers && (
            <div className="grid grid-cols-2 gap-3">
              {[['Best payer', payers.best, 'text-emerald-600 dark:text-emerald-400'], ['Worst payer', payers.worst, 'text-rose-600 dark:text-rose-400']].map(([lbl, lane, cls]) => (
                <button key={lbl} onClick={() => setSelected(lane.key === selectedKey ? null : lane.key)}
                  title={payers.strict ? 'Among geocoded lanes with 2+ loads and a meaningful distance (50+ avg miles).' : 'Sparse window — shown among all priced lanes.'}
                  className={`${S.card} px-4 py-3 text-left hover:border-orange-300 dark:hover:border-orange-500/30 transition-colors ${selectedKey === lane.key ? 'ring-2 ring-orange-500/40' : ''}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{lbl}{payers.strict && <span className="normal-case tracking-normal"> · 2+ loads</span>}</p>
                  <p className={`text-lg font-bold font-mono leading-tight mt-0.5 ${cls}`}>{fmtRpm(lane.rpm)}/mi</p>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate" title={lane.key}>{lane.origin} → {lane.destination}</p>
                  <p className="text-[10px] text-gray-400 dark:text-slate-500">{lane.loads} load{lane.loads === 1 ? '' : 's'} · {fmtMoney(lane.revenue)}</p>
                </button>
              ))}
            </div>
          )}

          {/* Leaderboard */}
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
                    {ranked.map(lane => (
                      <tr key={lane.key} onClick={() => setSelected(lane.key === selectedKey ? null : lane.key)}
                        className={`${S.tableRow} cursor-pointer ${selectedKey === lane.key ? 'bg-orange-50 dark:bg-orange-500/10' : ''}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900 dark:text-slate-200 leading-tight">{lane.origin}</p>
                          <p className="text-gray-400 dark:text-slate-500 leading-tight">→ {lane.destination}{!lane.geocoded && <span className="ml-1 text-amber-600 dark:text-amber-400" title="This lane couldn't be geocoded, so it isn't drawn on the map.">⌀ off-map</span>}</p>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{lane.loads}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-900 dark:text-slate-200">{fmtMoney(lane.revenue)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold" style={{ color: rpmScale ? rpmScale.color(lane.rpm) : RPM_NULL_COLOR }}>{fmtRpm(lane.rpm)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{fmtNum(lane.avgMiles)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Loads on the selected lane */}
          {selectedLane && (
            <div className={`${S.card} overflow-hidden`}>
              <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Loads on this lane</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedLane.origin} <span className="text-orange-500">→</span> {selectedLane.destination}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 text-sm leading-none px-1" title="Clear selection">✕</button>
              </div>
              <ul className="divide-y divide-gray-50 dark:divide-white/[0.03] max-h-72 overflow-y-auto">
                {selectedLane.legs.map(leg => {
                  const legRpm = leg.leg_total_miles > 0 ? leg.leg_revenue / leg.leg_total_miles : null
                  return (
                    <li key={leg.leg_id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-slate-200 truncate">
                          #{leg.load_number || leg.load_id}
                          {leg.is_projected && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">Booked</span>}
                        </p>
                        <p className="text-gray-400 dark:text-slate-500 truncate">{leg[dateCol] || '—'} · {leg.customer_name || '—'}</p>
                        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Dispatcher: {leg.dispatcher_name || '—'}</p>
                        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Driver: {leg.driver_display || '—'}</p>
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
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── Honesty footer ── */}
      <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center max-w-3xl mx-auto">
        Revenue, miles, and $/mile are live BUDDY data ({view === 'booked' ? 'Booked shows projected revenue on upcoming loads' : 'Realized shows delivered revenue'}).
        City positions come from a bundled US Census gazetteer — loads whose city can't be placed stay in the table and are counted in the coverage figure.
        Fuel, insurance, and driver pay are not in BUDDY yet, so lane $/mile is a revenue signal, not net margin.
      </p>
    </div>
  )
}
