import { useEffect, useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import { fmtMoney, fmtNum, fmtRpm } from '../spotlight/spotlightShared'
import { exportToExcel, exportToPDF } from './exportTopPerformers'

function Pills({ value, onChange, options, title }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0" title={title}>
      {options.map(([k, lbl, tooltip]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          title={tooltip}
          className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${
            value === k
              ? 'bg-orange-500 text-slate-900 font-semibold'
              : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
          }`}
        >
          {lbl}
        </button>
      ))}
    </div>
  )
}

function MedalBadge({ rank }) {
  const medals = {
    1: { color: '#F0A03A', textColor: '#412402', label: '🥇' },
    2: { color: '#B4B2A9', textColor: '#2C2C2A', label: '🥈' },
    3: { color: '#D85A30', textColor: '#4A1B0C', label: '🥉' },
  }

  if (rank <= 3) {
    const medal = medals[rank]
    return (
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
        style={{ background: medal.color, color: medal.textColor }}
      >
        {rank}
      </div>
    )
  }

  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300">
      {rank}
    </div>
  )
}

function DriverRow({ driver, rank }) {
  const isMedaled = rank <= 3
  return (
    <tr className={`${S.tableRow} ${isMedaled ? 'bg-orange-50 dark:bg-orange-500/10' : ''}`}>
      <td className="px-4 py-3 flex items-center gap-3">
        <MedalBadge rank={rank} />
        <span className={`text-sm truncate ${isMedaled ? 'font-semibold' : ''} text-gray-900 dark:text-slate-200`}>
          {driver.driver_name}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <span className="font-semibold text-gray-900 dark:text-slate-200">{fmtMoney(driver.gross)}</span>
      </td>
      <td className="px-3 py-3 text-right text-xs text-gray-600 dark:text-slate-400">
        {driver.legs} load{driver.legs === 1 ? '' : 's'}
      </td>
      <td className="px-3 py-3 text-right text-xs text-gray-600 dark:text-slate-400">
        {fmtNum(driver.miles)} mi
      </td>
      <td className="px-3 py-3 text-right text-xs font-mono text-gray-600 dark:text-slate-400">
        {fmtRpm(driver.rpm)}
      </td>
    </tr>
  )
}

function DispatcherRow({ dispatcher, rank }) {
  const isMedaled = rank <= 3
  return (
    <tr className={`${S.tableRow} ${isMedaled ? 'bg-orange-50 dark:bg-orange-500/10' : ''}`}>
      <td className="px-4 py-3 flex items-center gap-3">
        <MedalBadge rank={rank} />
        <span className={`text-sm truncate ${isMedaled ? 'font-semibold' : ''} text-gray-900 dark:text-slate-200`}>
          {dispatcher.dispatcher_name}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <span className="font-semibold text-gray-900 dark:text-slate-200">{fmtMoney(dispatcher.gross)}</span>
      </td>
      <td className="px-3 py-3 text-right text-xs text-gray-600 dark:text-slate-400">
        {dispatcher.legs} load{dispatcher.legs === 1 ? '' : 's'}
      </td>
      <td className="px-3 py-3 text-right text-xs font-mono text-gray-600 dark:text-slate-400">
        {fmtRpm(dispatcher.rpm)}
      </td>
      <td className="px-3 py-3 text-right text-xs text-gray-600 dark:text-slate-400">
        {dispatcher.drivers} driver{dispatcher.drivers === 1 ? '' : 's'}
      </td>
    </tr>
  )
}

function ExportDropdown({ data, isDriver, range, phases }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [position, setPosition] = useState({ top: 0, right: 0 })
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  const handleExport = async (format) => {
    if (!data || data.length === 0) return

    setIsExporting(true)
    try {
      const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })

      if (format === 'excel') {
        await exportToExcel(data, isDriver, range, phases, timestamp)
      } else if (format === 'pdf') {
        // For PDF, we'd pass the SVG map here; for now, PDF exports without the map
        await exportToPDF(data, isDriver, range, phases, timestamp, null)
      }
    } catch (err) {
      console.error(`Export failed: ${err.message}`)
      alert(`Failed to export: ${err.message}`)
    } finally {
      setIsExporting(false)
      setIsOpen(false)
    }
  }

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return

    const rect = buttonRef.current.getBoundingClientRect()
    setPosition({
      top: rect.bottom + window.scrollY,
      right: window.innerWidth - rect.right,
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  if (!data || data.length === 0) {
    return (
      <button className="px-3 py-1.5 text-xs text-gray-400 dark:text-slate-500 cursor-not-allowed">
        Export
      </button>
    )
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isExporting}
        className="px-3 py-1.5 text-xs text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 rounded border border-gray-200 dark:border-slate-700 disabled:opacity-50"
      >
        Export {isOpen ? '▲' : '▾'}
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded shadow-lg z-50"
            style={{
              top: `${position.top}px`,
              right: `${position.right}px`,
            }}
          >
            <button
              onClick={() => handleExport('excel')}
              disabled={isExporting}
              className="w-full px-4 py-2 text-left text-xs text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 whitespace-nowrap"
            >
              Excel (.xlsx)
            </button>
            <button
              onClick={() => handleExport('pdf')}
              disabled={isExporting}
              className="w-full px-4 py-2 text-left text-xs text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 border-t border-gray-100 dark:border-white/5 whitespace-nowrap"
            >
              PDF
            </button>
          </div>,
          document.body
        )}
    </>
  )
}

function LeaderboardSection({ title, data, isDriver, total, range, phases }) {
  const [expandedSort, setExpandedSort] = useState('gross') // gross | loads | rpm
  const [expanded, setExpanded] = useState(false)

  const sortedData = useMemo(() => {
    if (!data) return []
    const sorted = [...data]
    if (expandedSort === 'gross') {
      sorted.sort((a, b) => (b.gross ?? 0) - (a.gross ?? 0))
    } else if (expandedSort === 'loads') {
      sorted.sort((a, b) => (b.legs ?? 0) - (a.legs ?? 0))
    } else if (expandedSort === 'rpm') {
      sorted.sort((a, b) => (b.rpm ?? 0) - (a.rpm ?? 0))
    }
    return sorted
  }, [data, expandedSort])

  const displayData = expanded ? sortedData : sortedData.slice(0, 10)

  return (
    <div className={`${S.card} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/5 flex-wrap gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">
            {title}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
            Delivered + in transit · {total} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pills
            value={expandedSort}
            onChange={setExpandedSort}
            options={[
              ['gross', 'Gross $', 'Rank by total billed revenue'],
              ['loads', 'Loads', 'Rank by number of legs'],
              ['rpm', 'RPM', 'Rank by revenue per mile'],
            ]}
            title="Sort metric"
          />
          <ExportDropdown data={data} isDriver={isDriver} range={range} phases={phases} />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={`${S.tableHead} sticky top-0 bg-white dark:bg-[#0d0d1f] z-10`}>
            <tr>
              <th className={`${S.th} !px-4`}>Rank</th>
              <th className={`${S.th} !px-3 text-right`}>
                Gross {expandedSort === 'gross' ? '★' : ''}
              </th>
              {isDriver ? (
                <>
                  <th className={`${S.th} !px-3 text-right`}>
                    Loads {expandedSort === 'loads' ? '★' : ''}
                  </th>
                  <th className={`${S.th} !px-3 text-right`}>Miles</th>
                </>
              ) : (
                <>
                  <th className={`${S.th} !px-3 text-right`}>
                    Loads {expandedSort === 'loads' ? '★' : ''}
                  </th>
                </>
              )}
              <th className={`${S.th} !px-3 text-right`}>
                RPM {expandedSort === 'rpm' ? '★' : ''}
              </th>
              {!isDriver && (
                <th className={`${S.th} !px-3 text-right`}>Drivers</th>
              )}
            </tr>
          </thead>
          <tbody>
            {displayData.length === 0 ? (
              <tr>
                <td colSpan={isDriver ? 5 : 6} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-slate-500">
                  No {title.toLowerCase()} in this window
                </td>
              </tr>
            ) : (
              displayData.map((item, idx) =>
                isDriver ? (
                  <DriverRow key={item.driver_id} driver={item} rank={idx + 1} />
                ) : (
                  <DispatcherRow key={item.dispatcher_id} dispatcher={item} rank={idx + 1} />
                )
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Expander */}
      {total > 10 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-4 py-3 text-xs text-center font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 border-t border-gray-100 dark:border-white/5"
        >
          View full ranking ({total} total)
        </button>
      )}

      {expanded && total > 10 && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full px-4 py-3 text-xs text-center font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 border-t border-gray-100 dark:border-white/5"
        >
          Show top 10
        </button>
      )}
    </div>
  )
}

export default function TopPerformers({ range, phases }) {
  const [drivers, setDrivers] = useState(null)
  const [dispatchers, setDispatchers] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const dataKey = `${range.from}|${range.to}|${[...phases].sort().join(',')}`

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)

    async function fetchData() {
      try {
        const phasesArray = Array.from(phases)

        const [driverRes, dispatcherRes] = await Promise.all([
          supabase.rpc('lane_top_drivers', {
            page_start: range.from,
            page_end: range.to,
            phases: phasesArray,
          }),
          supabase.rpc('lane_top_dispatchers', {
            page_start: range.from,
            page_end: range.to,
            phases: phasesArray,
          }),
        ])

        if (driverRes.error) throw driverRes.error
        if (dispatcherRes.error) throw dispatcherRes.error

        if (!stale) {
          setDrivers(driverRes.data || [])
          setDispatchers(dispatcherRes.data || [])
        }
      } catch (err) {
        if (!stale) {
          console.error('Failed to fetch top performers:', err)
          setError(err.message || 'Failed to load data')
          setDrivers([])
          setDispatchers([])
        }
      } finally {
        if (!stale) setLoading(false)
      }
    }

    fetchData()
    return () => {
      stale = true
    }
  }, [dataKey, range, phases])

  if (error) {
    return (
      <div className={`${S.card} p-4 text-center text-sm text-red-600 dark:text-red-400`}>
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Performance
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Top performers</h2>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
          Leaders by gross revenue, loads moved, and rate-per-mile efficiency.
        </p>
      </div>

      {loading && (
        <div className={`${S.card} h-64 flex items-center justify-center`}>
          <div className="text-sm text-gray-400 dark:text-slate-500">Loading…</div>
        </div>
      )}

      {!loading && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Top Drivers */}
          <LeaderboardSection
            title="Top drivers"
            data={drivers}
            isDriver
            total={drivers?.length || 0}
            range={range}
            phases={phases}
          />

          {/* Top Dispatchers */}
          <LeaderboardSection
            title="Top dispatchers"
            data={dispatchers}
            isDriver={false}
            total={dispatchers?.length || 0}
            range={range}
            phases={phases}
          />
        </div>
      )}

      {/* Honesty note for drivers */}
      <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center max-w-2xl mx-auto">
        By gross booked (company + owner-operator). Net-to-MANAS ranking comes with settlement data.
      </p>
    </div>
  )
}
