import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import { useTheme } from '../../../../contexts/ThemeContext'
import { fmtMoney, fmtRpm, fmtNum, trailerTypeColor } from '../spotlight/spotlightShared'

// Trailer Type Trends — period-over-period metrics by equipment type for recruiting
// Data source: lane_trailer_type_trends RPC (returns rows with period_start, trailer_type, gross, rpm, legs, etc.)

// Trailer-type color comes from the shared single-source map (Conestoga = rose,
// distinct from the gray Unassigned).
const getTrailerColor = trailerTypeColor

// Callout eligibility: Unassigned is never crowned (it's power-only or an
// un-linked trailer, not a real type), and a bucket needs at least this many
// legs so a 1-load outlier can't headline. Amazon is a real freight category
// and competes normally. Tunable in one place.
const CALLOUT_MIN_LEGS = 5
// Unassigned coverage chip under each x-axis period: at/above this % → amber
// chip; >0 and below → muted text; exactly 0 → nothing.
const UNASSIGNED_CHIP_AMBER_PCT = 10
const UNASSIGNED_TOOLTIP = "Share of this period's loads with no trailer linked. Unassigned can mean power-only (no trailer needed) or a trailer we haven't linked yet — the equipment bars exclude these loads."
const UNASSIGNED_ROW_NOTE = "Unassigned can mean power-only (no trailer needed) or a trailer we haven't linked yet. Check here for missing trailer assignments."

// Format period label from period_start date (no UTC conversion)
const formatPeriodLabel = (dateStr, granularity) => {
  if (!dateStr) return '—'
  // Parse as YYYY-MM-DD without UTC conversion: build local date from parts
  const [y, m, d] = dateStr.split('-').map(Number)
  const local = new Date(y, m - 1, d) // month is 0-indexed

  if (granularity === 'week') {
    // ISO week number
    const jan4 = new Date(y, 0, 4)
    const weekOne = new Date(jan4.getFullYear(), jan4.getMonth(), jan4.getDate() - jan4.getDay() + 1)
    const daysDiff = Math.floor((local - weekOne) / 86400000)
    const week = Math.floor(daysDiff / 7) + 1
    return `Wk${week}`
  } else if (granularity === 'month') {
    const month = local.toLocaleDateString('en-US', { month: 'short' })
    const year = String(y).slice(2)
    return `${month} '${year}`
  } else { // quarter
    const quarter = Math.floor(local.getMonth() / 3) + 1
    const year = String(y).slice(2)
    return `Q${quarter} '${year}`
  }
}

// Shared value cell for the trend + compare tables. In Per-driver mode it
// prints the driver count as muted subtext (sample-size transparency) and
// mutes the value for thin samples (< 3 drivers) — but never hides it, so
// required buckets like Amazon (often 1 driver) always show.
function MetricValueCell({ value, drivers, showDrivers, fmt }) {
  const lowSample = showDrivers && drivers > 0 && drivers < 3
  return (
    <>
      <span className={`font-mono ${lowSample ? 'text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-slate-200'}`}>
        {value != null ? fmt(value) : <span className="text-gray-400 dark:text-slate-500">—</span>}
      </span>
      {showDrivers && value != null && (
        <span className="block text-[10px] text-gray-400 dark:text-slate-500 font-normal">
          {fmtNum(drivers)} {drivers === 1 ? 'driver' : 'drivers'}
        </span>
      )}
    </>
  )
}

export default function TrailerTypeTrends() {
  const panelRef = useRef(null)
  // Subscribe to the theme so a light↔dark toggle re-renders the chart — the
  // SVG tick/grid/chip fills are resolved from isDark in JS, not CSS, so they
  // only adapt when this component actually re-renders.
  const { theme } = useTheme()
  const [granularity, setGranularity] = useState('month')
  const [metric, setMetric] = useState('rpm')
  const [mode, setMode] = useState('trend')
  const [cmpA, setCmpA] = useState(null)
  const [cmpB, setCmpB] = useState(null)
  const [dataByGran, setDataByGran] = useState({})
  const [loading, setLoading] = useState(false)

  // Fetch data for a granularity if not cached
  useEffect(() => {
    if (dataByGran[granularity]) return

    setLoading(true)
    supabase.rpc('lane_trailer_type_trends', { p_granularity: granularity })
      .then(({ data, error }) => {
        if (error) throw error
        setDataByGran(prev => ({ ...prev, [granularity]: data || [] }))
      })
      .catch(err => {
        console.error('Failed to load trailer type trends:', err)
        setDataByGran(prev => ({ ...prev, [granularity]: [] }))
      })
      .finally(() => setLoading(false))
  }, [granularity, dataByGran])

  const rawData = dataByGran[granularity] || []

  // Build unique periods and trailer types
  const { periods, trilerTypes, dataMap } = useMemo(() => {
    const seenPeriods = new Set()
    const seenTypes = new Set()
    const map = new Map()

    rawData.forEach(row => {
      seenPeriods.add(row.period_start)
      seenTypes.add(row.trailer_type)
      const key = `${row.period_start}|${row.trailer_type}`
      map.set(key, row)
    })

    const sortedPeriods = [...seenPeriods].sort()
    const sortedTypes = [...seenTypes].sort((a, b) => {
      // Real trailer types alphabetical; the two "no real trailer" buckets pinned
      // to the tail — Amazon (own-trailer) then Unassigned last.
      const tail = { Amazon: 1, Unassigned: 2 }
      const at = tail[a] || 0, bt = tail[b] || 0
      if (at || bt) return at - bt
      return a.localeCompare(b)
    })

    return { periods: sortedPeriods, trilerTypes: sortedTypes, dataMap: map }
  }, [rawData])

  // Default compare periods (ensure A and B are distinct)
  useEffect(() => {
    if (cmpA === null && periods.length > 0) {
      const lastIdx = periods.length - 1
      const secondLastIdx = Math.max(0, lastIdx - 6)
      // Only set defaults if they're different
      if (lastIdx !== secondLastIdx) {
        setCmpA(lastIdx)
        setCmpB(secondLastIdx)
      } else if (periods.length > 1) {
        // Fall back to comparing last two periods
        setCmpA(lastIdx)
        setCmpB(lastIdx - 1)
      }
    }
  }, [periods, cmpA])

  const metricKey = metric === 'rpm' ? 'rpm' : 'gross'
  const fmt = metric === 'rpm' ? fmtRpm : fmtMoney
  const isPerDriver = metric === 'per_driver'

  // Metric value for a row. Per-driver = gross ÷ distinct drivers (computed
  // here, not a DB column); null when the period has no drivers so callers
  // render an em dash. rpm/gross read straight off the row.
  const getVal = (row) => {
    if (!row) return null
    if (isPerDriver) {
      const d = Number(row.drivers || 0)
      return d > 0 ? Number(row.gross || 0) / d : null
    }
    return row[metricKey]
  }

  // Trend mode: show last 3 periods + avg + delta
  const renderTrendTable = () => {
    const shown = 3
    const showPeriods = periods.slice(-shown)
    const periodCols = showPeriods.map((p, i) => ({ date: p, idx: periods.length - shown + i }))

    // The delta compares the last two shown periods; derive the header's month
    // labels from those exact periods so it rolls forward automatically.
    // Short label = the period label minus the year suffix (e.g. "Jun '26" → "Jun").
    const latestPeriod = showPeriods[showPeriods.length - 1]
    const prevPeriod = showPeriods[showPeriods.length - 2]
    const shortLabel = (p) => (p ? formatPeriodLabel(p, granularity).replace(/\s*'\d{2}$/, '') : '')
    const changeHeader = (prevPeriod && latestPeriod)
      ? `Change (${shortLabel(prevPeriod)} → ${shortLabel(latestPeriod)})`
      : 'Change'

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={S.tableHead}>
            <tr>
              <th className={`${S.th} text-left text-gray-900 dark:text-slate-200`}>Trailer type</th>
              {periodCols.map((pc, i) => (
                <th key={i} className={`${S.th} text-gray-900 dark:text-slate-200`}>
                  {formatPeriodLabel(pc.date, granularity)}
                </th>
              ))}
              <th className={`${S.th} text-gray-900 dark:text-slate-200`}>
                <span className="inline-flex items-center gap-1">
                  {changeHeader}
                  <span
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-slate-600 text-[9px] font-normal normal-case text-gray-500 dark:text-slate-400 cursor-help align-middle"
                    title="Percent change in revenue per mile from the previous month to the latest."
                  >i</span>
                </span>
              </th>
              <th className={`${S.th} text-gray-900 dark:text-slate-200`}>6-period avg</th>
            </tr>
          </thead>
          <tbody>
            {trilerTypes.map(type => {
              const vals = periodCols.map(pc => {
                const row = dataMap.get(`${pc.date}|${type}`)
                return row
              })
              const last = vals[vals.length - 1]
              const prev = vals[vals.length - 2]
              const lastVal = getVal(last)
              const prevVal = getVal(prev)

              // Delta suppression: only show if both periods have legs >= 10
              const lastLegs = last ? last.legs : 0
              const prevLegs = prev ? prev.legs : 0
              const delta = prevVal != null && lastVal != null ? lastVal - prevVal : null
              const deltaPct = (prevVal != null && lastVal != null && prevVal !== 0 && lastLegs >= 10 && prevLegs >= 10)
                ? ((lastVal - prevVal) / prevVal * 100) : null
              // Headline per-mile dollar change (unsigned — arrow + color show
              // direction). $/mi → 2 decimals; gross → separators.
              const absDelta = delta != null
                ? (metric === 'rpm' ? `$${Math.abs(delta).toFixed(2)}` : fmtMoney(Math.abs(delta)))
                : null

              // 6-period average: only over populated periods (legs > 0)
              const last6Rows = periods.slice(-6).map(p => dataMap.get(`${p}|${type}`)).filter(r => r && r.legs > 0)
              let avg6 = null
              if (last6Rows.length > 0) {
                if (metric === 'rpm') {
                  // Loaded-mile weighted RPM: sum(linehaul) / sum(loaded_miles)
                  const totalLinehaul = last6Rows.reduce((sum, r) => sum + (r.linehaul || 0), 0)
                  const totalLoadedMiles = last6Rows.reduce((sum, r) => sum + (r.loaded_miles || 0), 0)
                  avg6 = totalLoadedMiles > 0 ? totalLinehaul / totalLoadedMiles : null
                } else if (isPerDriver) {
                  // Mean of the per-period per-driver averages across the window.
                  const perDriverVals = last6Rows
                    .map(r => { const d = Number(r.drivers || 0); return d > 0 ? Number(r.gross || 0) / d : null })
                    .filter(v => v != null)
                  avg6 = perDriverVals.length > 0
                    ? perDriverVals.reduce((s, v) => s + v, 0) / perDriverVals.length
                    : null
                } else {
                  // Gross: simple average over populated periods
                  const sum = last6Rows.reduce((total, r) => total + (r.gross || 0), 0)
                  avg6 = sum / last6Rows.length
                }
              }

              return (
                <tr key={type} className={S.tableRow}>
                  <td className={`${S.td} text-left flex items-center gap-2`}>
                    <span className="w-2.5 h-2.5 rounded" style={{ background: getTrailerColor(type) }} />
                    <span className="font-medium text-gray-900 dark:text-slate-200">{type}</span>
                    {type === 'Unassigned' && (
                      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-slate-600 text-[9px] font-normal text-gray-500 dark:text-slate-400 cursor-help" title={UNASSIGNED_ROW_NOTE}>i</span>
                    )}
                  </td>
                  {vals.map((row, i) => (
                    <td key={i} className={S.td}>
                      <MetricValueCell
                        value={getVal(row)}
                        drivers={row ? Number(row.drivers || 0) : 0}
                        showDrivers={isPerDriver}
                        fmt={fmt}
                      />
                    </td>
                  ))}
                  <td className={S.td}>
                    {deltaPct != null ? (
                      <span className="font-mono text-sm tabular-nums">
                        <span className={deltaPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                          {deltaPct >= 0 ? '↗' : '↘'} {absDelta}
                        </span>
                        <span className="text-gray-500 dark:text-slate-400"> {Math.abs(deltaPct).toFixed(1)}%</span>
                      </span>
                    ) : (prevLegs < 10 || lastLegs < 10) && (prevVal != null || lastVal != null) ? (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 cursor-help" title="Too few loads that month to compare reliably.">low sample</span>
                    ) : (
                      <span className="text-gray-900 dark:text-slate-200">—</span>
                    )}
                  </td>
                  <td className={S.td}>
                    <span className="font-mono text-gray-900 dark:text-slate-200">{avg6 != null ? fmt(avg6) : '—'}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Compare mode: show A vs B periods
  const renderCompareTable = () => {
    if (cmpA === null || cmpB === null) return <div className="p-4 text-gray-500 dark:text-slate-400">Loading periods…</div>

    const periodA = periods[cmpA]
    const periodB = periods[cmpB]
    const labelA = formatPeriodLabel(periodA, granularity)
    const labelB = formatPeriodLabel(periodB, granularity)

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={S.tableHead}>
            <tr>
              <th className={`${S.th} text-left text-gray-900 dark:text-slate-200`}>Trailer type</th>
              <th className={`${S.th} text-gray-900 dark:text-slate-200`}>{labelA}</th>
              <th className={`${S.th} text-gray-900 dark:text-slate-200`}>{labelB}</th>
              <th className={`${S.th} text-gray-900 dark:text-slate-200`}>Δ</th>
              <th className={`${S.th} text-gray-900 dark:text-slate-200`}>Δ %</th>
            </tr>
          </thead>
          <tbody>
            {trilerTypes.map(type => {
              const rowA = dataMap.get(`${periodA}|${type}`)
              const rowB = dataMap.get(`${periodB}|${type}`)
              const valA = getVal(rowA)
              const valB = getVal(rowB)
              const legsA = rowA ? rowA.legs : 0
              const legsB = rowB ? rowB.legs : 0

              const delta = valA != null && valB != null ? valA - valB : null
              const deltaPct = (valA != null && valB != null && valB !== 0 && legsA >= 10 && legsB >= 10)
                ? ((valA - valB) / valB * 100) : null

              return (
                <tr key={type} className={S.tableRow}>
                  <td className={`${S.td} text-left flex items-center gap-2`}>
                    <span className="w-2.5 h-2.5 rounded" style={{ background: getTrailerColor(type) }} />
                    <span className="font-medium text-gray-900 dark:text-slate-200">{type}</span>
                    {type === 'Unassigned' && (
                      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-slate-600 text-[9px] font-normal text-gray-500 dark:text-slate-400 cursor-help" title={UNASSIGNED_ROW_NOTE}>i</span>
                    )}
                  </td>
                  <td className={S.td}>
                    <MetricValueCell value={valA} drivers={rowA ? Number(rowA.drivers || 0) : 0} showDrivers={isPerDriver} fmt={fmt} />
                  </td>
                  <td className={S.td}>
                    <MetricValueCell value={valB} drivers={rowB ? Number(rowB.drivers || 0) : 0} showDrivers={isPerDriver} fmt={fmt} />
                  </td>
                  <td className={S.td}>
                    {delta != null ? (
                      <span className="font-mono text-gray-900 dark:text-slate-200">
                        {delta >= 0 ? '+' : ''}{fmt(delta)}
                      </span>
                    ) : <span className="text-gray-900 dark:text-slate-200">—</span>}
                  </td>
                  <td className={S.td}>
                    {deltaPct != null ? (
                      <span className={`font-mono text-sm ${deltaPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                      </span>
                    ) : (legsA < 10 || legsB < 10) && (valA != null || valB != null) ? (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 cursor-help" title="Too few loads that month to compare reliably.">low sample</span>
                    ) : (
                      <span className="text-gray-900 dark:text-slate-200">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Insights
  const renderInsights = () => {
    if (mode === 'trend' && periods.length > 0) {
      const lastPeriod = periods[periods.length - 1]
      const rows = trilerTypes.map(type => {
        const row = dataMap.get(`${lastPeriod}|${type}`)
        return { type, val: getVal(row), legs: row ? row.legs : 0 }
      })
      // Callout eligibility: never crown Unassigned, and require CALLOUT_MIN_LEGS
      // so a 1-load outlier can't headline (Amazon competes normally). The chart
      // and table still show every bucket — this guards only the two chips.
      const eligible = rows.filter(r => r.val != null && r.type !== 'Unassigned' && r.legs >= CALLOUT_MIN_LEGS)
      if (eligible.length === 0) return null

      const highest = eligible.reduce((a, b) => (b.val ?? 0) > (a.val ?? 0) ? b : a)
      const lowest = eligible.reduce((a, b) => (b.val ?? 0) < (a.val ?? 0) ? b : a)

      return (
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
            <span className="text-2xl">↑</span>
            <div className="text-xs">
              <p className="text-orange-700 dark:text-orange-400 font-medium">{metric === 'rpm' ? 'Highest $/mi' : isPerDriver ? 'Highest avg/driver' : 'Highest Gross'}</p>
              <p className="text-orange-900 dark:text-orange-300 font-bold">{highest.type} · {fmt(highest.val)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-slate-500/10 border border-gray-200 dark:border-slate-500/20">
            <span className="text-2xl">↓</span>
            <div className="text-xs">
              <p className="text-gray-700 dark:text-slate-400 font-medium">Lowest</p>
              <p className="text-gray-900 dark:text-slate-300 font-bold">{lowest.type} · {fmt(lowest.val)}</p>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  // Render accumulating note
  const renderAccumulatingNote = () => {
    return (
      <p className="text-xs text-gray-500 dark:text-slate-400 text-center">
        Trends fill in as weekly imports land — earlier periods may be empty for now
      </p>
    )
  }

  // Get theme for dark mode support — reactive via useTheme() so it recomputes
  // (and repaints the SVG chart) whenever the theme toggles.
  const isDark = theme === 'dark'
  const gridColor = isDark ? '#334155' : '#e5e7eb'
  const tickColor = isDark ? '#94a3b8' : '#6b7280'
  const tooltipBgColor = isDark ? '#1e293b' : '#ffffff'
  const tooltipBorderColor = isDark ? '#64748b' : '#d1d5db'

  // Custom tooltip for both Trend and Compare
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null
    return (
      <div className={`p-2 rounded border ${isDark ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-white border-gray-200 text-gray-900'} text-xs`}>
        <p className="font-semibold">{label}</p>
        {payload.map((entry, idx) => (
          <p key={idx} style={{ color: entry.color }}>
            {entry.name}: {metric === 'rpm' ? `$${Number(entry.value).toFixed(2)}/mi` : fmtMoney(entry.value)}
          </p>
        ))}
      </div>
    )
  }

  // Render Trend chart with recharts
  const renderTrendChart = () => {
    if (periods.length === 0) return null

    const shown = 6
    const showPeriods = periods.slice(-shown)

    // Build data: array of { period: "Jun '26", "Dry Van": 3.27, "Reefer": 2.18, ... }
    const chartData = showPeriods.map(period => {
      const row = { period: formatPeriodLabel(period, granularity) }
      trilerTypes.forEach(type => {
        const dataRow = dataMap.get(`${period}|${type}`)
        row[type] = dataRow && dataRow.legs > 0 ? getVal(dataRow) : null
      })
      return row
    })

    // Unassigned coverage per period (label → %), from the already-loaded RPC
    // rows: Unassigned legs ÷ all legs in that period. No new query.
    const pctByLabel = new Map()
    showPeriods.forEach(period => {
      let total = 0, unassigned = 0
      trilerTypes.forEach(type => {
        const r = dataMap.get(`${period}|${type}`)
        if (!r) return
        total += r.legs || 0
        if (type === 'Unassigned') unassigned += r.legs || 0
      })
      pctByLabel.set(formatPeriodLabel(period, granularity), total > 0 ? (100 * unassigned / total) : 0)
    })

    // Chip colors (dark-aware) — the panel's existing amber token for ≥ amber
    // threshold, the same muted grey as the "low sample" chip below it.
    const amberBg = isDark ? 'rgba(245,158,11,0.12)' : '#fffbeb'
    const amberBorder = isDark ? 'rgba(245,158,11,0.30)' : '#fde68a'
    const amberText = isDark ? '#fbbf24' : '#b45309'
    const mutedChipText = isDark ? '#94a3b8' : '#6b7280'

    // Custom x-axis tick: the period label with the unassigned-coverage chip
    // directly beneath it, centered.
    const periodTick = ({ x, y, payload }) => {
      const label = payload.value
      const pct = Math.round(pctByLabel.get(label) ?? 0)
      const isAmber = pct >= UNASSIGNED_CHIP_AMBER_PCT
      const isMuted = pct > 0 && pct < UNASSIGNED_CHIP_AMBER_PCT
      const chipText = `${pct}% unassigned`
      const chipW = chipText.length * 6 + 14
      return (
        <g transform={`translate(${x},${y})`}>
          <text x={0} y={0} dy={14} textAnchor="middle" fill={tickColor} fontSize={12}>{label}</text>
          {isAmber && (
            <g>
              <rect x={-chipW / 2} y={20} width={chipW} height={17} rx={8.5} fill={amberBg} stroke={amberBorder} strokeWidth={1}>
                <title>{UNASSIGNED_TOOLTIP}</title>
              </rect>
              <text x={0} y={20} dy={12} textAnchor="middle" fill={amberText} fontSize={11} fontWeight={600}>
                {chipText}
                <title>{UNASSIGNED_TOOLTIP}</title>
              </text>
            </g>
          )}
          {isMuted && (
            <text x={0} y={20} dy={12} textAnchor="middle" fill={mutedChipText} fontSize={11}>
              {chipText}
              <title>{UNASSIGNED_TOOLTIP}</title>
            </text>
          )}
        </g>
      )
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="period"
            tick={periodTick}
            interval={0}
            height={48}
            stroke={tickColor}
            axisLine={{ stroke: gridColor }}
          />
          <YAxis
            tick={{ fill: tickColor, fontSize: 12 }}
            stroke={tickColor}
            axisLine={{ stroke: gridColor }}
            tickFormatter={(val) => metric === 'rpm' ? `$${val.toFixed(2)}` : `$${(val / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '16px' }}
            iconType="square"
            textColor={tickColor}
            fontSize={12}
          />
          {trilerTypes.map(type => (
            <Bar
              key={type}
              dataKey={type}
              fill={getTrailerColor(type)}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // Render Compare chart with recharts
  const renderCompareChart = () => {
    if (cmpA === null || cmpB === null) return null

    const periodA = periods[cmpA]
    const periodB = periods[cmpB]
    const labelA = formatPeriodLabel(periodA, granularity)
    const labelB = formatPeriodLabel(periodB, granularity)

    // Build data: array of { type: "Dry Van", [labelA]: 3.27, [labelB]: 2.18 }
    const chartData = trilerTypes.map(type => {
      const rowA = dataMap.get(`${periodA}|${type}`)
      const rowB = dataMap.get(`${periodB}|${type}`)
      return {
        type,
        [labelA]: rowA && rowA.legs > 0 ? getVal(rowA) : null,
        [labelB]: rowB && rowB.legs > 0 ? getVal(rowB) : null,
      }
    })

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="type"
            tick={{ fill: tickColor, fontSize: 12 }}
            stroke={tickColor}
            axisLine={{ stroke: gridColor }}
          />
          <YAxis
            tick={{ fill: tickColor, fontSize: 12 }}
            stroke={tickColor}
            axisLine={{ stroke: gridColor }}
            tickFormatter={(val) => metric === 'rpm' ? `$${val.toFixed(2)}` : `$${(val / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '16px' }}
            iconType="square"
            textColor={tickColor}
            fontSize={12}
          />
          <Bar dataKey={labelA} fill="#f97316" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey={labelB} fill="#fed7aa" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // Check if Compare mode is valid (needs at least 2 distinct periods)
  const canCompare = periods.length >= 2 && cmpA !== null && cmpB !== null && cmpA !== cmpB

  // Export snapshot handler — verified working, exact function from live test
  const handleExport = async () => {
    const root = panelRef.current
    if (!root) return
    const metricLabel = metric === 'rpm' ? '$/mi' : metric === 'per_driver' ? 'Avg gross/driver' : 'Gross'
    const granularityLabel = granularity === 'week' ? 'Weekly' : granularity === 'month' ? 'Monthly' : 'Quarterly'
    const modeLabel = mode === 'trend' ? 'Trend' : 'Compare'
    try {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim()
      const toRGB = c => {
        if (!c) return [136, 136, 136]
        if (c[0] === '#') { const h = c.slice(1); const n = h.length === 3 ? h.split('').map(x => x + x).join('') : h
          return [0, 2, 4].map(i => parseInt(n.substr(i, 2), 16)) }
        const m = c.match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : [136, 136, 136]
      }
      const svgEl = Array.from(root.querySelectorAll('svg.recharts-surface'))
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
      const clone = svgEl.cloneNode(true)
      const src = svgEl.querySelectorAll('*'), dst = clone.querySelectorAll('*')
      for (let i = 0; i < src.length; i++) { const cs = getComputedStyle(src[i])
        ;['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'opacity']
          .forEach(p => { const v = cs.getPropertyValue(p); if (v) dst[i].style.setProperty(p, v) }) }
      const w = Math.round(svgEl.getBoundingClientRect().width)
      const h = Math.round(svgEl.getBoundingClientRect().height)
      clone.setAttribute('width', w); clone.setAttribute('height', h); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
      const png = await new Promise((res, rej) => { const im = new Image()
        im.onload = () => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d')
          x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.scale(2, 2); x.drawImage(im, 0, 0, w, h); res(c.toDataURL('image/png')) }
        im.onerror = () => rej(new Error('svg load fail')); im.src = svgUrl })
      const legend = Array.from(root.querySelectorAll('.recharts-legend-item')).map(li => {
        const sw = li.querySelector('svg path, svg rect, svg line, .recharts-legend-icon')
        return { label: norm(li.textContent), rgb: toRGB(sw ? (getComputedStyle(sw).fill || sw.getAttribute('fill')) : null) }
      })
      const san = s => norm(s).replace(/Δ/g, 'Change').replace(/↗/g, '+').replace(/↘/g, '-').replace(/→/g, '->').replace(/[^\x00-\x7F]/g, m => m === '—' ? '-' : m)
      const table = root.querySelector('table')
      const headers = Array.from(table.querySelectorAll('thead th')).map(t => san(t.textContent))
      const rows = Array.from(table.querySelectorAll('tbody tr'))
        .map(tr => Array.from(tr.querySelectorAll('td')).map(td => san(td.textContent)))
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth()
      pdf.setFontSize(15); pdf.setTextColor(20); pdf.text('Trailer Type Activity Trends', 24, 34)
      pdf.setFontSize(9); pdf.setTextColor(120)
      pdf.text(`${modeLabel} · ${granularityLabel} · ${metricLabel}   ·   generated ${new Date().toISOString().slice(0, 10)}`, 24, 50)
      const iw = pw - 48, ih = Math.min(h / w * iw, 300)
      pdf.addImage(png, 'PNG', 24, 60, iw, ih)
      let lx = 24, ly = 60 + ih + 16; pdf.setFontSize(9)
      legend.forEach(l => { pdf.setFillColor(l.rgb[0], l.rgb[1], l.rgb[2]); pdf.rect(lx, ly - 7, 9, 9, 'F')
        pdf.setTextColor(40); pdf.text(l.label, lx + 13, ly); lx += pdf.getTextWidth(l.label) + 34 })
      autoTable(pdf, { head: [headers], body: rows, startY: ly + 12, styles: { fontSize: 8 }, headStyles: { fillColor: [234, 88, 12] } })
      pdf.setFontSize(7); pdf.setTextColor(150)
      pdf.text('Loaded-mile linehaul RPM · revenue signal, not net margin · ~56% of billed freight is owner-operator pass-through.',
        24, pdf.internal.pageSize.getHeight() - 16)
      pdf.save(`trailer-type-activity-trends_${metric}_${granularity}_${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  return (
    <div ref={panelRef} className={`${S.card} p-6 space-y-4`}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Trailer Type Trends</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{isPerDriver ? 'Average gross per driver, by equipment type' : 'Period-over-period gross and RPM by equipment type'}</p>
        </div>
        <button
          data-export-button
          onClick={handleExport}
          className="px-3 py-2 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors whitespace-nowrap"
          title="Export current view as PDF"
        >
          ↓ Export snapshot
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
          {['trend', 'compare'].map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 font-medium transition-all ${
                mode === m
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}>
              {m === 'trend' ? 'Trend' : 'Compare'}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
          {['week', 'month', 'quarter'].map(g => (
            <button key={g} onClick={() => setGranularity(g)}
              className={`px-3 py-1.5 font-medium transition-all ${
                granularity === g
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}>
              {g === 'week' ? 'Weekly' : g === 'month' ? 'Monthly' : 'Quarterly'}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
          {['rpm', 'gross', 'per_driver'].map(m => (
            <button key={m} onClick={() => setMetric(m)}
              title={m === 'per_driver' ? 'Average load revenue per driver' : undefined}
              className={`px-3 py-1.5 font-medium transition-all ${
                metric === m
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}>
              {m === 'rpm' ? '$/mi' : m === 'gross' ? 'Gross' : 'Per driver'}
            </button>
          ))}
        </div>

        {mode === 'compare' && (
          <div className="flex items-center gap-2">
            {periods.length < 2 ? (
              <div className="text-xs text-amber-600 dark:text-amber-400">Need at least two periods to compare — trends fill in as imports land</div>
            ) : (
              <>
                <select value={cmpA ?? ''} onChange={e => setCmpA(+e.target.value)}
                  className={`${S.select} text-xs bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-200 border-gray-200 dark:border-slate-700`}>
                  {periods.map((p, i) => (
                    <option key={i} value={i}>{formatPeriodLabel(p, granularity)}</option>
                  ))}
                </select>
                <span className="text-xs font-medium text-gray-500 dark:text-slate-400">vs</span>
                <select value={cmpB ?? ''} onChange={e => setCmpB(+e.target.value)}
                  className={`${S.select} text-xs bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-200 border-gray-200 dark:border-slate-700`}>
                  {periods.map((p, i) => (
                    <option key={i} value={i}>{formatPeriodLabel(p, granularity)}</option>
                  ))}
                </select>
                {cmpA === cmpB && cmpA !== null && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 ml-2">Select different periods</div>
                )}
              </>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-300 dark:border-slate-600 text-xs text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-slate-700/30" title="Loaded-mile linehaul RPM: revenue per mile weighted by loaded miles">
          📊 Loaded-mile linehaul RPM
        </div>
      </div>

      {/* Insights */}
      {renderInsights()}

      {/* Table + Chart */}
      {loading ? (
        <div className="p-4 text-center text-gray-500 dark:text-slate-400 text-sm">Loading…</div>
      ) : rawData.length === 0 ? (
        <div className="p-6 text-center text-gray-500 dark:text-slate-400">
          <p className="text-sm mb-1">No data available yet</p>
          {renderAccumulatingNote()}
        </div>
      ) : (
        <>
          {/* Chart */}
          {mode === 'trend' && (
            <div className="h-72 mb-6 bg-white dark:bg-slate-800 p-4 rounded-lg border border-gray-200 dark:border-slate-700">
              {renderTrendChart()}
            </div>
          )}
          {mode === 'compare' && canCompare && (
            <div className="h-72 mb-6 bg-white dark:bg-slate-800 p-4 rounded-lg border border-gray-200 dark:border-slate-700">
              {renderCompareChart()}
            </div>
          )}

          {/* Table */}
          {mode === 'trend' ? renderTrendTable() : renderCompareTable()}
          <div className="pt-2">
            {renderAccumulatingNote()}
          </div>
        </>
      )}
    </div>
  )
}
