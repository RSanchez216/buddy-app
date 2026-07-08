import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import { fmtMoney, fmtNum, fmtRpm } from '../spotlight/spotlightShared'

// Miles & Performance — loaded vs. empty miles, RPM, and deadhead by driver /
// dispatcher / region for a selected period, with a rolling deadhead trend,
// load-level drill-down, and Excel/PDF export. Source RPCs (already shipped):
//   report_miles_loads(start,end)  — one row per leg; TONU/combined excluded,
//                                     empty is override-aware (effective deadhead)
//   deadhead_trend(grain,end,n)    — rolling empty/loaded/deadhead by bucket

// ── date helpers (local Y-M-D, no UTC shift) ────────────────────────────────
const CT = 'America/Chicago'
const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: CT }).format(new Date())
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d) }
function ymd(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` }

// The [from,to] window for an anchor day under a grain (Monday-start weeks).
function periodOf(anchor, grain) {
  const d = parseYmd(anchor)
  if (grain === 'week') {
    const dow = (d.getDay() + 6) % 7
    const mon = new Date(d); mon.setDate(d.getDate() - dow)
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { from: ymd(mon), to: ymd(sun) }
  }
  if (grain === 'month') {
    return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
  }
  return { from: anchor, to: anchor } // day
}
function shiftPeriod(range, timeframe, dir) {
  const from = parseYmd(range.from)
  if (timeframe === 'day') { const n = new Date(from); n.setDate(from.getDate() + dir); return periodOf(ymd(n), 'day') }
  if (timeframe === 'week') { const n = new Date(from); n.setDate(from.getDate() + 7 * dir); return periodOf(ymd(n), 'week') }
  if (timeframe === 'month') { return periodOf(ymd(new Date(from.getFullYear(), from.getMonth() + dir, 1)), 'month') }
  // custom — shift by the span
  const spanMs = parseYmd(range.to) - from
  const days = Math.round(spanMs / 864e5) + 1
  const nf = new Date(from); nf.setDate(from.getDate() + dir * days)
  const nt = new Date(nf); nt.setDate(nf.getDate() + days - 1)
  return { from: ymd(nf), to: ymd(nt) }
}
function periodLabel(range, timeframe) {
  const f = parseYmd(range.from)
  if (timeframe === 'day') return f.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (timeframe === 'month') return f.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const t = parseYmd(range.to)
  return `${f.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
function bucketLabel(s, grain) {
  const d = parseYmd(s)
  if (grain === 'month') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
// grain + rolling lookback per timeframe.
const TREND = { day: ['day', 14], week: ['week', 10], month: ['month', 12], custom: ['week', 10] }

// ── deadhead color tiers ─────────────────────────────────────────────────────
function deadheadCls(pct) {
  if (pct == null) return 'text-gray-400 dark:text-slate-500'
  const p = pct * 100
  if (p < 15) return 'text-emerald-600 dark:text-emerald-400'
  if (p < 25) return 'text-yellow-600 dark:text-yellow-400'
  if (p < 40) return 'text-orange-600 dark:text-orange-400'
  return 'text-red-600 dark:text-red-400'
}
// Bar fill by the same tiers as the text colors.
function deadheadBarCls(pct) {
  const p = (pct || 0) * 100
  if (p < 15) return 'bg-emerald-500'
  if (p < 25) return 'bg-yellow-400'
  if (p < 40) return 'bg-orange-500'
  return 'bg-red-500'
}
const fmtPct = (p) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`)

// ── aggregation ──────────────────────────────────────────────────────────────
function aggregate(loads, keyField, nameField) {
  const map = new Map()
  for (const l of loads) {
    const key = l[keyField] ?? '—'
    let g = map.get(key)
    if (!g) { g = { key, name: (nameField ? l[nameField] : l[keyField]) || '—', loads: 0, loaded: 0, empty: 0, gross: 0, drivers: new Set() }; map.set(key, g) }
    g.loads++
    g.loaded += Number(l.loaded_mi) || 0
    g.empty += Number(l.empty_mi) || 0
    g.gross += Number(l.gross) || 0
    if (l.driver_id) g.drivers.add(l.driver_id)
  }
  return [...map.values()].map(g => {
    const total = g.loaded + g.empty
    return { ...g, drivers: g.drivers.size, deadheadPct: total > 0 ? g.empty / total : null, rpm: g.loaded > 0 ? g.gross / g.loaded : null }
  })
}
function fleetTotals(loads) {
  const t = loads.reduce((a, l) => {
    a.loads++; a.loaded += Number(l.loaded_mi) || 0; a.empty += Number(l.empty_mi) || 0; a.gross += Number(l.gross) || 0
    if (l.driver_id) a.drivers.add(l.driver_id)
    return a
  }, { loads: 0, loaded: 0, empty: 0, gross: 0, drivers: new Set() })
  const total = t.loaded + t.empty
  return { ...t, drivers: t.drivers.size, deadheadPct: total > 0 ? t.empty / total : null, rpm: t.loaded > 0 ? t.gross / t.loaded : null }
}
function sortRows(rows, sort) {
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.key === 'name') return String(a.name).localeCompare(String(b.name)) * mul
    const av = a[sort.key], bv = b[sort.key]
    const an = av == null || !Number.isFinite(av), bn = bv == null || !Number.isFinite(bv)
    if (an && bn) return 0
    if (an) return 1
    if (bn) return -1
    return (av - bv) * mul
  })
}

const TABS = [
  { key: 'driver', label: 'By Driver', keyField: 'driver_id', nameField: 'driver_name', head: 'Driver', showDrivers: false },
  { key: 'dispatcher', label: 'By Dispatcher', keyField: 'dispatcher_id', nameField: 'dispatcher_name', head: 'Dispatcher', showDrivers: true },
  { key: 'region', label: 'By Region', keyField: 'region', nameField: null, head: 'Region', showDrivers: true },
]

export default function MilesPerformance() {
  const [timeframe, setTimeframe] = useState('month')
  const [range, setRange] = useState(() => periodOf(todayYmd(), 'month'))
  const [tab, setTab] = useState('driver')
  const [sort, setSort] = useState({ key: 'deadheadPct', dir: 'desc' }) // deadhead % is the point of the report
  const [expanded, setExpanded] = useState(() => new Set())
  const [loads, setLoads] = useState(null)
  const [priorLoads, setPriorLoads] = useState(null)
  const [trend, setTrend] = useState(null)
  const chartRef = useRef(null)
  const [grain] = [TREND[timeframe][0]]

  function pickTimeframe(tf) {
    setTimeframe(tf)
    if (tf === 'custom') return
    setRange(periodOf(range.to || todayYmd(), tf))
  }
  const navPeriod = (dir) => setRange(r => shiftPeriod(r, timeframe, dir))

  useEffect(() => { setExpanded(new Set()) }, [tab, range.from, range.to])

  useEffect(() => {
    let stale = false
    setLoads(null); setPriorLoads(null); setTrend(null)
    const prior = shiftPeriod(range, timeframe, -1)
    const [g, periods] = TREND[timeframe]
    Promise.all([
      supabase.rpc('report_miles_loads', { p_start: range.from, p_end: range.to }),
      supabase.rpc('report_miles_loads', { p_start: prior.from, p_end: prior.to }),
      supabase.rpc('deadhead_trend', { p_grain: g, p_end: range.to, p_periods: periods }),
    ]).then(([a, b, c]) => {
      if (stale) return
      setLoads(a.error ? [] : (a.data || []))
      setPriorLoads(b.error ? [] : (b.data || []))
      setTrend(c.error ? [] : (c.data || []))
    }).catch(() => { if (!stale) { setLoads([]); setPriorLoads([]); setTrend([]) } })
    return () => { stale = true }
  }, [range.from, range.to, timeframe])

  const tabDef = TABS.find(t => t.key === tab)
  const rows = useMemo(() => (loads ? aggregate(loads, tabDef.keyField, tabDef.nameField) : []), [loads, tabDef])
  const sortedRows = useMemo(() => sortRows(rows, sort), [rows, sort])
  const totals = useMemo(() => (loads ? fleetTotals(loads) : null), [loads])
  const priorTotals = useMemo(() => (priorLoads ? fleetTotals(priorLoads) : null), [priorLoads])

  const trendData = useMemo(() => {
    if (!trend) return []
    const maxLoaded = Math.max(1, ...trend.map(t => Number(t.loaded_mi) || 0))
    return trend.map(t => {
      const loaded = Number(t.loaded_mi) || 0, empty = Number(t.empty_mi) || 0
      const pct = loaded + empty > 0 ? empty / (loaded + empty) : 0
      return {
        label: bucketLabel(t.period_start, grain),
        pct: +(pct * 100).toFixed(1), loaded, empty,
        lowVol: loaded < 0.2 * maxLoaded,
        highlight: t.period_start >= range.from && t.period_start <= range.to,
      }
    })
  }, [trend, range.from, range.to, grain])

  function toggleSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }
  function toggleRow(key) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  const loading = loads === null
  // vs-prior deadhead delta (percentage points; up = worse).
  const delta = totals?.deadheadPct != null && priorTotals?.deadheadPct != null ? (totals.deadheadPct - priorTotals.deadheadPct) : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Profitability
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Miles &amp; Performance</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Loaded vs. empty miles, RPM, and deadhead by driver, dispatcher, and region. Empty is effective (override-aware); TONU &amp; combined loads excluded.</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
          {['day', 'week', 'month', 'custom'].map(tf => (
            <button key={tf} onClick={() => pickTimeframe(tf)}
              className={`px-3 py-1.5 font-medium capitalize transition-colors ${timeframe === tf ? 'bg-orange-500 text-white' : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{tf}</button>
          ))}
        </div>
        {timeframe === 'custom' ? (
          <div className="flex items-center gap-1.5">
            <input type="date" className={`${S.input} w-[9rem]`} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
            <span className="text-gray-400 text-xs">→</span>
            <input type="date" className={`${S.input} w-[9rem]`} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={() => navPeriod(-1)} className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5" aria-label="Previous period">◀</button>
            <span className="text-sm font-semibold text-gray-900 dark:text-white min-w-[8rem] text-center">{periodLabel(range, timeframe)}</span>
            <button onClick={() => navPeriod(1)} className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5" aria-label="Next period">▶</button>
          </div>
        )}
        {/* deadhead + vs-prior delta */}
        {totals?.deadheadPct != null && (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <span className={`font-mono font-semibold ${deadheadCls(totals.deadheadPct)}`}>{fmtPct(totals.deadheadPct)}</span>
            <span className="text-[11px] text-gray-400 dark:text-slate-500">deadhead</span>
            {delta != null && Math.abs(delta) >= 0.0005 && (
              <span className={`text-[11px] font-mono ${delta > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
                title={`vs ${periodLabel(shiftPeriod(range, timeframe, -1), timeframe)}`}>
                {delta > 0 ? '▲' : '▼'}{Math.abs(delta * 100).toFixed(1)}
              </span>
            )}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={exportExcel} disabled={loading} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">↓ Excel</button>
          <button onClick={exportPdf} disabled={loading} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">↓ PDF</button>
        </div>
      </div>

      {/* Rolling deadhead trend */}
      <div className={`${S.card} p-4`} ref={chartRef}>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Deadhead trend <span className="font-normal text-gray-400 dark:text-slate-500">· rolling {grain}s · selected period highlighted</span></h2>
        </div>
        <div className="h-56">
          {trend && trendData.length > 0 ? <DeadheadChart data={trendData} /> : (
            <div className="h-full grid place-items-center text-sm text-gray-400 dark:text-slate-500">{trend ? 'No trend data.' : 'Loading…'}</div>
          )}
        </div>
        <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">Low-volume edge buckets are muted so a partial period doesn’t skew the axis.</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 font-medium transition-colors ${tab === t.key ? 'bg-orange-500 text-white' : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{t.label}</button>
        ))}
      </div>

      {/* Region deadhead bars — at-a-glance which regions run empty */}
      {tab === 'region' && !loading && rows.length > 0 && <RegionDeadheadBars rows={rows} />}

      {/* Summary table + accordion */}
      <div className={`${S.card} overflow-hidden`}>
        {loading ? (
          <div className="p-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
        ) : sortedRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400 dark:text-slate-500">No loads in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={S.tableHead}>
                <tr>
                  <Th label={tabDef.head} k="name" sort={sort} onSort={toggleSort} left />
                  <Th label="Loads" k="loads" sort={sort} onSort={toggleSort} />
                  <Th label="Loaded" k="loaded" sort={sort} onSort={toggleSort} />
                  <Th label="Empty" k="empty" sort={sort} onSort={toggleSort} />
                  <Th label="Deadhead" k="deadheadPct" sort={sort} onSort={toggleSort} />
                  <Th label="Gross" k="gross" sort={sort} onSort={toggleSort} />
                  <Th label="RPM" k="rpm" sort={sort} onSort={toggleSort} />
                  {tabDef.showDrivers && <Th label="Drivers" k="drivers" sort={sort} onSort={toggleSort} />}
                  <th className={`${S.th} w-6`} />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(r => {
                  const open = expanded.has(r.key)
                  const rowLoads = open ? loads.filter(l => (l[tabDef.keyField] ?? '—') === r.key).sort((a, b) => (Number(b.empty_mi) || 0) - (Number(a.empty_mi) || 0)) : []
                  return (
                    <Fragment key={r.key}>
                      <tr onClick={() => toggleRow(r.key)} className={`${S.tableRow} cursor-pointer`}>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-200">{r.name}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{r.loads}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{fmtNum(r.loaded)}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{fmtNum(r.empty)}</td>
                        <td className={`px-2 py-2 text-right font-mono font-semibold ${deadheadCls(r.deadheadPct)}`}>{fmtPct(r.deadheadPct)}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-900 dark:text-slate-200">{fmtMoney(r.gross)}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{r.rpm == null ? '—' : fmtRpm(r.rpm)}</td>
                        {tabDef.showDrivers && <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{r.drivers}</td>}
                        <td className="px-2 py-2 text-right text-gray-400">{open ? '▾' : '▸'}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={tabDef.showDrivers ? 9 : 8} className="px-3 pb-3 pt-0 bg-gray-50/60 dark:bg-white/[0.02]">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-gray-400 dark:text-slate-500">
                                  <th className="text-left font-medium py-1">Load</th>
                                  <th className="text-left font-medium py-1">Lane</th>
                                  <th className="text-right font-medium py-1">Loaded</th>
                                  <th className="text-right font-medium py-1">Empty</th>
                                  <th className="text-right font-medium py-1">Deadhead</th>
                                  <th className="text-right font-medium py-1">Gross</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rowLoads.map(l => {
                                  const lo = Number(l.loaded_mi) || 0, em = Number(l.empty_mi) || 0
                                  const dh = lo + em > 0 ? em / (lo + em) : null
                                  return (
                                    <tr key={l.leg_id} className="border-t border-gray-100 dark:border-white/5">
                                      <td className="py-1 font-mono text-gray-700 dark:text-slate-300">{l.load_number}</td>
                                      <td className="py-1 text-gray-500 dark:text-slate-400">{l.origin} → {l.destination}</td>
                                      <td className="py-1 text-right font-mono text-gray-600 dark:text-slate-400">{fmtNum(lo)}</td>
                                      <td className="py-1 text-right font-mono text-gray-600 dark:text-slate-400">{fmtNum(em)}</td>
                                      <td className={`py-1 text-right font-mono ${deadheadCls(dh)}`}>{fmtPct(dh)}</td>
                                      <td className="py-1 text-right font-mono text-gray-700 dark:text-slate-300">{fmtMoney(l.gross)}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 dark:border-white/10 font-semibold bg-gray-50/60 dark:bg-white/[0.03]">
                    <td className="px-3 py-2 text-gray-900 dark:text-white">Fleet total</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{totals.loads}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{fmtNum(totals.loaded)}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{fmtNum(totals.empty)}</td>
                    <td className={`px-2 py-2 text-right font-mono ${deadheadCls(totals.deadheadPct)}`}>{fmtPct(totals.deadheadPct)}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-900 dark:text-white">{fmtMoney(totals.gross)}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{totals.rpm == null ? '—' : fmtRpm(totals.rpm)}</td>
                    {tabDef.showDrivers && <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{totals.drivers}</td>}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-center text-gray-400 dark:text-slate-500">
        Deadhead tiers: <span className="text-emerald-600 dark:text-emerald-400">&lt;15%</span> · <span className="text-yellow-600 dark:text-yellow-400">15–25%</span> · <span className="text-orange-600 dark:text-orange-400">25–40%</span> · <span className="text-red-600 dark:text-red-400">40%+</span>
      </p>
    </div>
  )

  // ── exports (inside component to capture current cut/range/data) ────────────
  async function exportExcel() {
    if (!loads) return
    const mod = await import('xlsx')
    const XLSX = mod && mod.utils ? mod : (mod.default ?? mod)
    if (!XLSX?.utils) return
    const summary = sortedRows.map(r => ({
      [tabDef.head]: r.name, Loads: r.loads, Loaded_mi: Math.round(r.loaded), Empty_mi: Math.round(r.empty),
      Deadhead_pct: r.deadheadPct == null ? '' : +(r.deadheadPct * 100).toFixed(1), Gross: Math.round(r.gross),
      RPM: r.rpm == null ? '' : +r.rpm.toFixed(2), ...(tabDef.showDrivers ? { Drivers: r.drivers } : {}),
    }))
    if (totals) summary.push({ [tabDef.head]: 'Fleet total', Loads: totals.loads, Loaded_mi: Math.round(totals.loaded), Empty_mi: Math.round(totals.empty), Deadhead_pct: totals.deadheadPct == null ? '' : +(totals.deadheadPct * 100).toFixed(1), Gross: Math.round(totals.gross), RPM: totals.rpm == null ? '' : +totals.rpm.toFixed(2), ...(tabDef.showDrivers ? { Drivers: totals.drivers } : {}) })
    const loadRows = loads.map(l => {
      const lo = Number(l.loaded_mi) || 0, em = Number(l.empty_mi) || 0
      return {
        Load: l.load_number, Driver: l.driver_name, Dispatcher: l.dispatcher_name, Region: l.region,
        Origin: l.origin, Destination: l.destination, Loaded_mi: Math.round(lo), Empty_mi: Math.round(em),
        Deadhead_pct: lo + em > 0 ? +((em / (lo + em)) * 100).toFixed(1) : '', Gross: Math.round(Number(l.gross) || 0),
        RPM_loaded: l.rpm_loaded == null ? '' : +Number(l.rpm_loaded).toFixed(2), Delivery: l.delivery_date,
      }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(loadRows), 'Loads')
    XLSX.writeFile(wb, `MilesPerformance_${tab}_${range.from}_to_${range.to}.xlsx`)
  }

  async function exportPdf() {
    if (!loads) return
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    const pw = pdf.internal.pageSize.getWidth()
    pdf.setFontSize(15); pdf.setTextColor(20); pdf.text('Miles & Performance', 24, 34)
    pdf.setFontSize(9); pdf.setTextColor(120)
    pdf.text(`${tabDef.label} · ${periodLabel(range, timeframe)}  ·  generated ${todayYmd()}`, 24, 50)
    let y = 62
    // Trend chart snapshot (recharts SVG → PNG).
    try {
      const svgEl = chartRef.current?.querySelector('svg.recharts-surface')
      if (svgEl) {
        const clone = svgEl.cloneNode(true)
        const src = svgEl.querySelectorAll('*'), dst = clone.querySelectorAll('*')
        for (let i = 0; i < src.length; i++) {
          const cs = getComputedStyle(src[i])
          ;['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'opacity'].forEach(p => { const v = cs.getPropertyValue(p); if (v) dst[i].style.setProperty(p, v) })
        }
        const w = Math.round(svgEl.getBoundingClientRect().width), h = Math.round(svgEl.getBoundingClientRect().height)
        clone.setAttribute('width', w); clone.setAttribute('height', h); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
        const png = await new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.scale(2, 2); x.drawImage(im, 0, 0, w, h); res(c.toDataURL('image/png')) }; im.onerror = () => rej(new Error('svg')); im.src = url })
        const iw = pw - 48, ih = Math.min(h / w * iw, 220)
        pdf.addImage(png, 'PNG', 24, y, iw, ih); y += ih + 14
      }
    } catch (e) { console.error('trend snapshot failed', e) }
    const cols = [tabDef.head, 'Loads', 'Loaded', 'Empty', 'Deadhead', 'Gross', 'RPM', ...(tabDef.showDrivers ? ['Drivers'] : [])]
    const body = sortedRows.map(r => [r.name, r.loads, fmtNum(r.loaded), fmtNum(r.empty), fmtPct(r.deadheadPct), fmtMoney(r.gross), r.rpm == null ? '—' : fmtRpm(r.rpm), ...(tabDef.showDrivers ? [r.drivers] : [])])
    if (totals) body.push(['Fleet total', totals.loads, fmtNum(totals.loaded), fmtNum(totals.empty), fmtPct(totals.deadheadPct), fmtMoney(totals.gross), totals.rpm == null ? '—' : fmtRpm(totals.rpm), ...(tabDef.showDrivers ? [totals.drivers] : [])])
    autoTable(pdf, { head: [cols], body, startY: y, styles: { fontSize: 8 }, headStyles: { fillColor: [234, 88, 12] } })
    pdf.save(`MilesPerformance_${tab}_${range.from}_to_${range.to}.pdf`)
  }
}

// Sortable header cell.
function Th({ label, k, sort, onSort, left }) {
  const active = sort.key === k
  return (
    <th className={`${S.th} ${left ? '!px-3 text-left' : '!px-2 text-right'} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => onSort(k)}>
      <span className={`inline-flex items-center gap-0.5 ${left ? '' : 'justify-end'}`}>{label}{active && <span className="text-orange-500">{sort.dir === 'desc' ? '▾' : '▴'}</span>}</span>
    </th>
  )
}

// Colored deadhead bars, one per region, high→low. Bar width is proportional
// to the top region's % (so the worst reads full-width); tier-colored.
function RegionDeadheadBars({ rows }) {
  const sorted = [...rows].filter(r => r.deadheadPct != null).sort((a, b) => b.deadheadPct - a.deadheadPct)
  if (!sorted.length) return null
  const max = Math.max(...sorted.map(r => r.deadheadPct)) || 1
  return (
    <div className={`${S.card} p-4`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Deadhead by region</h2>
      <div className="space-y-2">
        {sorted.map(r => (
          <div key={r.key} className="flex items-center gap-3 text-xs">
            <span className="w-28 shrink-0 truncate font-medium text-gray-700 dark:text-slate-300">{r.name}</span>
            <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-white/5 overflow-hidden">
              <div className={`h-full rounded ${deadheadBarCls(r.deadheadPct)}`} style={{ width: `${Math.max(3, (r.deadheadPct / max) * 100)}%` }} />
            </div>
            <span className={`w-14 text-right font-mono font-semibold ${deadheadCls(r.deadheadPct)}`}>{fmtPct(r.deadheadPct)}</span>
            <span className="w-12 text-right font-mono text-gray-400 dark:text-slate-500">({r.loads})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeadheadChart({ data }) {
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const grid = isDark ? '#334155' : '#e5e7eb'
  const tick = isDark ? '#94a3b8' : '#6b7280'
  const mutedBar = isDark ? '#3f4a5c' : '#e5e7eb'
  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className={`p-2 rounded border text-xs ${isDark ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-white border-gray-200 text-gray-900'}`}>
        <p className="font-semibold">{d.label}{d.highlight ? ' · selected' : ''}{d.lowVol ? ' · low volume' : ''}</p>
        <p>Deadhead: {d.pct}%</p>
        <p className="text-gray-400 dark:text-slate-500">{fmtNum(d.loaded)} loaded · {fmtNum(d.empty)} empty mi</p>
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: tick, fontSize: 11 }} stroke={tick} axisLine={{ stroke: grid }} />
        <YAxis tick={{ fill: tick, fontSize: 11 }} stroke={tick} axisLine={{ stroke: grid }} tickFormatter={v => `${v}%`} width={38} />
        <Tooltip content={<Tip />} cursor={{ fill: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(0,0,0,0.04)' }} />
        <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.highlight ? '#f97316' : d.lowVol ? mutedBar : '#f59e0b'} fillOpacity={d.lowVol ? 0.5 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
