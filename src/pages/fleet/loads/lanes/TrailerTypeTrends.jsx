import { useState, useEffect, useMemo, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import { fmtMoney, fmtRpm, fmtNum } from '../spotlight/spotlightShared'

// Trailer Type Trends — period-over-period metrics by equipment type for recruiting
// Data source: lane_trailer_type_trends RPC (returns rows with period_start, trailer_type, gross, rpm, legs, etc.)

const TRAILER_COLORS = {
  'Dry Van': '#06b6d4',      // cyan
  'Step Deck': '#f59e0b',    // amber
  'Flatbed': '#ef4444',      // red
  'Reefer': '#10b981',       // emerald
  'Power Only': '#8b5cf6',   // violet
  'Unassigned': '#6b7280',   // gray
}

// Get or generate color for a trailer type
const getTrailerColor = (type) => TRAILER_COLORS[type] || '#6b7280'

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

export default function TrailerTypeTrends() {
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
      // Unassigned last, rest alphabetical
      if (a === 'Unassigned') return 1
      if (b === 'Unassigned') return -1
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

  // Trend mode: show last 3 periods + avg + delta
  const renderTrendTable = () => {
    const shown = 3
    const showPeriods = periods.slice(-shown)
    const periodCols = showPeriods.map((p, i) => ({ date: p, idx: periods.length - shown + i }))

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
              <th className={`${S.th} text-gray-900 dark:text-slate-200`}>Δ vs prior</th>
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
              const lastVal = last ? last[metricKey] : null
              const prevVal = prev ? prev[metricKey] : null

              // Delta suppression: only show if both periods have legs >= 10
              const lastLegs = last ? last.legs : 0
              const prevLegs = prev ? prev.legs : 0
              const delta = prevVal != null && lastVal != null ? lastVal - prevVal : null
              const deltaPct = (prevVal != null && lastVal != null && prevVal !== 0 && lastLegs >= 10 && prevLegs >= 10)
                ? ((lastVal - prevVal) / prevVal * 100) : null

              // 6-period average: only over populated periods (legs > 0)
              const last6Rows = periods.slice(-6).map(p => dataMap.get(`${p}|${type}`)).filter(r => r && r.legs > 0)
              let avg6 = null
              if (last6Rows.length > 0) {
                if (metricKey === 'rpm') {
                  // Loaded-mile weighted RPM: sum(linehaul) / sum(loaded_miles)
                  const totalLinehaul = last6Rows.reduce((sum, r) => sum + (r.linehaul || 0), 0)
                  const totalLoadedMiles = last6Rows.reduce((sum, r) => sum + (r.loaded_miles || 0), 0)
                  avg6 = totalLoadedMiles > 0 ? totalLinehaul / totalLoadedMiles : null
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
                  </td>
                  {vals.map((row, i) => (
                    <td key={i} className={S.td}>
                      <span className="font-mono text-gray-900 dark:text-slate-200">
                        {row && row[metricKey] != null ? fmt(row[metricKey]) : '—'}
                      </span>
                    </td>
                  ))}
                  <td className={S.td}>
                    {deltaPct != null ? (
                      <span className={`font-mono text-sm ${deltaPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                      </span>
                    ) : (prevLegs < 10 || lastLegs < 10) && (prevVal != null || lastVal != null) ? (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400">low sample</span>
                    ) : (
                      '—'
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
              const valA = rowA ? rowA[metricKey] : null
              const valB = rowB ? rowB[metricKey] : null
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
                  </td>
                  <td className={S.td}>
                    <span className="font-mono text-gray-900 dark:text-slate-200">
                      {valA != null ? fmt(valA) : <span className="text-gray-400 dark:text-slate-500">—</span>}
                    </span>
                  </td>
                  <td className={S.td}>
                    <span className="font-mono text-gray-900 dark:text-slate-200">
                      {valB != null ? fmt(valB) : <span className="text-gray-400 dark:text-slate-500">—</span>}
                    </span>
                  </td>
                  <td className={S.td}>
                    {delta != null ? (
                      <span className="font-mono text-gray-900 dark:text-slate-200">
                        {delta >= 0 ? '+' : ''}{fmt(delta)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={S.td}>
                    {deltaPct != null ? (
                      <span className={`font-mono text-sm ${deltaPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                      </span>
                    ) : (legsA < 10 || legsB < 10) && (valA != null || valB != null) ? (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400">low sample</span>
                    ) : (
                      '—'
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
        return { type, val: row ? row[metricKey] : null }
      })
      const valid = rows.filter(r => r.val != null)
      if (valid.length === 0) return null

      const highest = valid.reduce((a, b) => (b.val ?? 0) > (a.val ?? 0) ? b : a)
      const lowest = valid.reduce((a, b) => (b.val ?? 0) < (a.val ?? 0) ? b : a)

      return (
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20">
            <span className="text-2xl">↑</span>
            <div className="text-xs">
              <p className="text-orange-700 dark:text-orange-400 font-medium">{metric === 'rpm' ? 'Highest $/mi' : 'Highest Gross'}</p>
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

  // Get theme for dark mode support
  const isDark = typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
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
        row[type] = dataRow && dataRow.legs > 0 ? dataRow[metricKey] : null
      })
      return row
    })

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="period"
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
        [labelA]: rowA && rowA.legs > 0 ? rowA[metricKey] : null,
        [labelB]: rowB && rowB.legs > 0 ? rowB[metricKey] : null,
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

  return (
    <div className={`${S.card} p-6 space-y-4`}>
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Trailer Type Trends</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Period-over-period gross and RPM by equipment type</p>
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
          {['rpm', 'gross'].map(m => (
            <button key={m} onClick={() => setMetric(m)}
              className={`px-3 py-1.5 font-medium transition-all ${
                metric === m
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}>
              {m === 'rpm' ? '$/mi' : 'Gross'}
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
