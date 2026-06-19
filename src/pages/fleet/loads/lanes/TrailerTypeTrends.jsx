import { useState, useEffect, useMemo, useCallback } from 'react'
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

// Format period label from period_start date
const formatPeriodLabel = (date, granularity) => {
  if (!date) return '—'
  const d = new Date(date)
  if (granularity === 'week') {
    const wk = Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)
    return `Wk${wk}`
  } else if (granularity === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  } else { // quarter
    const q = Math.floor(d.getMonth() / 3) + 1
    return `Q${q} '${String(d.getFullYear()).slice(2)}`
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

  // Default compare periods
  useEffect(() => {
    if (cmpA === null && periods.length > 0) {
      const lastIdx = periods.length - 1
      setCmpA(lastIdx)
      setCmpB(Math.max(0, lastIdx - 6))
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
              <th className={`${S.th} text-left`}>Trailer type</th>
              {periodCols.map((pc, i) => (
                <th key={i} className={S.th}>
                  {formatPeriodLabel(pc.date, granularity)}
                </th>
              ))}
              <th className={S.th}>Δ vs prior</th>
              <th className={S.th}>6-period avg</th>
            </tr>
          </thead>
          <tbody>
            {trilerTypes.map(type => {
              const vals = periodCols.map(pc => {
                const row = dataMap.get(`${pc.date}|${type}`)
                return row ? row[metricKey] : null
              })
              const last = vals[vals.length - 1]
              const prev = vals[vals.length - 2]
              const delta = prev != null && last != null ? last - prev : null
              const deltaPct = prev != null && last != null && prev !== 0 ? ((last - prev) / prev * 100) : null
              const avg6 = periods.slice(-6).reduce((sum, p) => {
                const row = dataMap.get(`${p}|${type}`)
                return sum + (row ? (row[metricKey] || 0) : 0)
              }, 0) / 6

              return (
                <tr key={type} className={S.tableRow}>
                  <td className={`${S.td} text-left flex items-center gap-2`}>
                    <span className="w-2.5 h-2.5 rounded" style={{ background: getTrailerColor(type) }} />
                    <span className="font-medium text-gray-900 dark:text-slate-200">{type}</span>
                  </td>
                  {vals.map((val, i) => (
                    <td key={i} className={S.td}>
                      <span className="font-mono text-gray-900 dark:text-slate-200">
                        {val != null ? fmt(val) : '—'}
                      </span>
                    </td>
                  ))}
                  <td className={S.td}>
                    {deltaPct != null ? (
                      <span className={`font-mono text-sm ${deltaPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className={S.td}>
                    <span className="font-mono text-gray-900 dark:text-slate-200">{fmt(avg6)}</span>
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
              <th className={`${S.th} text-left`}>Trailer type</th>
              <th className={S.th}>{labelA}</th>
              <th className={S.th}>{labelB}</th>
              <th className={S.th}>Δ</th>
              <th className={S.th}>Δ %</th>
            </tr>
          </thead>
          <tbody>
            {trilerTypes.map(type => {
              const rowA = dataMap.get(`${periodA}|${type}`)
              const rowB = dataMap.get(`${periodB}|${type}`)
              const valA = rowA ? rowA[metricKey] : null
              const valB = rowB ? rowB[metricKey] : null
              const delta = valA != null && valB != null ? valA - valB : null
              const deltaPct = valA != null && valB != null && valB !== 0 ? ((valA - valB) / valB * 100) : null

              return (
                <tr key={type} className={S.tableRow}>
                  <td className={`${S.td} text-left flex items-center gap-2`}>
                    <span className="w-2.5 h-2.5 rounded" style={{ background: getTrailerColor(type) }} />
                    <span className="font-medium text-gray-900 dark:text-slate-200">{type}</span>
                  </td>
                  <td className={S.td}>
                    <span className="font-mono text-gray-900 dark:text-slate-200">
                      {valA != null ? fmt(valA) : 'No data'}
                    </span>
                  </td>
                  <td className={S.td}>
                    <span className="font-mono text-gray-500 dark:text-slate-400">
                      {valB != null ? fmt(valB) : 'No data'}
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
                    ) : '—'}
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
            <select value={cmpA ?? ''} onChange={e => setCmpA(+e.target.value)}
              className={`${S.select} text-xs`}>
              {periods.map((p, i) => (
                <option key={i} value={i}>{formatPeriodLabel(p, granularity)}</option>
              ))}
            </select>
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400">vs</span>
            <select value={cmpB ?? ''} onChange={e => setCmpB(+e.target.value)}
              className={`${S.select} text-xs`}>
              {periods.map((p, i) => (
                <option key={i} value={i}>{formatPeriodLabel(p, granularity)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Insights */}
      {renderInsights()}

      {/* Table */}
      {loading ? (
        <div className="p-4 text-center text-gray-500 dark:text-slate-400 text-sm">Loading…</div>
      ) : rawData.length === 0 ? (
        <div className="p-6 text-center text-gray-500 dark:text-slate-400">
          <p className="text-sm mb-1">No data available yet</p>
          <p className="text-xs">Trends fill in as weekly imports land — earlier periods may be empty for now</p>
        </div>
      ) : (
        mode === 'trend' ? renderTrendTable() : renderCompareTable()
      )}
    </div>
  )
}
