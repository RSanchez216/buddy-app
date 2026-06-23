import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import { fmtMoney } from '../spotlight/spotlightShared'

// Idle review — trucks, trailers, and drivers earning $0 while still costing
// money (3+ days since last load activity). Tag a reason, watch the duration,
// resolve when sold / terminated / back to work. Read/writes go through the
// idle_subjects / set_idle_reason / resolve_idle RPCs (already deployed).

const UNIT_REASONS = ['Parked', 'Dedicated lane site', 'Under repairs', 'Under claim', 'For sale', 'Other']
const DRIVER_REASONS = ['Vacation', 'Home-time', 'Under repairs', 'Health', 'Family', 'Other']

// Benign reasons read as expected idle (low severity); the rest are
// "attention" (amber). Anything uncategorized, or idle 14+ days, escalates red.
const BENIGN = new Set(['Vacation', 'Parked', 'Dedicated lane site', 'For sale'])

function severity(row) {
  const chronic = (row.days_idle ?? 0) >= 14
  // A driver holding no company-owned equipment ($0 run-rate) is low severity
  // — listed for the revenue gap, but no company cost. Chronic idle still
  // nudges it to red so a long-idle driver gets a look.
  if (row.subject_type === 'driver' && Number(row.monthly_cost) === 0 && !chronic) return 'low'
  if (chronic) return 'red'
  if (!row.reason) return 'red'
  if (BENIGN.has(row.reason)) return 'low'
  return 'amber'
}
const SEV_RANK = { red: 0, amber: 1, low: 2 }
const SEV_DOT = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  low: 'bg-teal-500',
}

const CAP = 10

// Column defs drive the sortable headers + comparator. `get` returns the sort
// value; `type` picks the comparator (text / numeric / severity). Hoisted to
// module scope so the reference is stable across renders (memoization-safe).
const UNIT_COLUMNS = [
  { key: 'label', label: 'Unit', type: 'text', get: r => r.label || '' },
  { key: 'days', label: 'Idle', type: 'num', align: 'right', get: r => r.days_idle },
  { key: 'extra', label: 'Assigned driver', type: 'text', get: r => r.extra || '' },
  { key: 'cost', label: '$/mo', type: 'num', align: 'right', get: r => Number(r.monthly_cost) },
  { key: 'reason', label: 'Reason', type: 'severity', get: r => SEV_RANK[severity(r)] },
]
const DRIVER_COLUMNS = [
  { key: 'label', label: 'Driver', type: 'text', get: r => r.label || '' },
  { key: 'days', label: 'Idle', type: 'num', align: 'right', get: r => r.days_idle },
  { key: 'cost', label: 'Holding (cost)', type: 'num', align: 'right', get: r => Number(r.monthly_cost) },
  { key: 'reason', label: 'Reason', type: 'severity', get: r => SEV_RANK[severity(r)] },
]

function fmtDays(d) {
  if (d == null) return '—'
  return `${d}d`
}

export default function IdleReview() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  async function load() {
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('idle_subjects', { p_threshold: 3 })
      if (err) throw err
      setRows(data || [])
    } catch (e) {
      console.error('Failed to load idle subjects:', e)
      setError(e.message || String(e))
      setRows([])
    }
  }

  useEffect(() => { load() }, [])

  const groups = useMemo(() => {
    const g = { truck: [], trailer: [], driver: [] }
    for (const r of rows || []) (g[r.subject_type] || (g[r.subject_type] = [])).push(r)
    return g
  }, [rows])

  const sumCost = (list) => list.reduce((s, r) => s + (Number(r.monthly_cost) || 0), 0)

  async function setReason(row, reason, note) {
    try {
      const { error: err } = await supabase.rpc('set_idle_reason', {
        p_subject_type: row.subject_type, p_subject_id: row.subject_id, p_reason: reason, p_note: note || null,
      })
      if (err) throw err
      await load()
    } catch (e) {
      console.error('set_idle_reason failed:', e)
    }
  }
  async function resolve(row) {
    try {
      const { error: err } = await supabase.rpc('resolve_idle', { p_subject_type: row.subject_type, p_subject_id: row.subject_id })
      if (err) throw err
      await load()
    } catch (e) {
      console.error('resolve_idle failed:', e)
    }
  }

  const loading = rows === null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Idle review</h1>
        <p className="text-sm text-gray-700 dark:text-slate-500 mt-0.5">
          Trucks, trailers, and drivers earning $0 while still on the books — tag a reason and watch the clock.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label="Idle trucks"
          count={groups.truck.length}
          sub={`${fmtMoney(sumCost(groups.truck))}/mo carrying`}
          loading={loading}
          tip="A subject is idle when it's been 3+ days since its last load activity (latest pickup or delivery, booked loads included). The $/mo is the monthly carrying run-rate of currently-idle equipment — not accrued loss. Equipment idle is judged by its assigned driver's activity (truck-on-load data is incomplete), so routing through the driver is the reliable signal."
        />
        <SummaryCard label="Idle trailers" count={groups.trailer.length} sub={`${fmtMoney(sumCost(groups.trailer))}/mo carrying`} loading={loading} />
        <SummaryCard label="Idle drivers" count={groups.driver.length} sub="not moving freight" loading={loading} />
      </div>

      {error && <div className={S.errorBox}>Couldn't load idle data: {error}</div>}

      {loading ? (
        <div className={`${S.card} p-12 text-center text-sm text-gray-500 dark:text-slate-500 animate-pulse`}>Finding idle subjects…</div>
      ) : (
        <>
          <IdleSection title="Trucks" kind="unit" rows={groups.truck} reasons={UNIT_REASONS} onSetReason={setReason} onResolve={resolve} />
          <IdleSection title="Trailers" kind="unit" rows={groups.trailer} reasons={UNIT_REASONS} onSetReason={setReason} onResolve={resolve} />
          <IdleSection title="Drivers" kind="driver" rows={groups.driver} reasons={DRIVER_REASONS} onSetReason={setReason} onResolve={resolve} />
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, count, sub, loading, tip }) {
  return (
    <div className={`${S.card} px-4 py-3`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">
        {label}
        {tip && (
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-slate-600 text-[9px] text-gray-500 dark:text-slate-400 cursor-help"
            title={tip}
          >?</span>
        )}
      </div>
      <div className="mt-0.5 text-2xl font-mono font-bold text-gray-900 dark:text-white">{loading ? '…' : count}</div>
      <div className="text-[11px] text-gray-500 dark:text-slate-500">{sub}</div>
    </div>
  )
}

function IdleSection({ title, kind, rows, reasons, onSetReason, onResolve }) {
  const columns = kind === 'unit' ? UNIT_COLUMNS : DRIVER_COLUMNS

  const [sort, setSort] = useState({ key: 'days', dir: 'desc' })
  const [expanded, setExpanded] = useState(false)

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sort.key) || columns[1]
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (col.type === 'text') return col.get(a).localeCompare(col.get(b)) * mul
      // severity + num both numeric; null/NaN treated as lowest.
      const av = col.get(a), bv = col.get(b)
      const na = av == null || !Number.isFinite(av) ? -Infinity : av
      const nb = bv == null || !Number.isFinite(bv) ? -Infinity : bv
      if (na === nb) return 0
      return (na - nb) * mul
    })
  }, [rows, sort, columns])

  const visible = expanded ? sorted : sorted.slice(0, CAP)

  function toggleSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '')

  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title} <span className="font-normal text-gray-500 dark:text-slate-500">({rows.length})</span></h2>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">None idle — everything in this group is moving.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  {columns.map(c => (
                    <th
                      key={c.key}
                      className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300 ${c.align === 'right' ? 'text-right' : ''}`}
                      onClick={() => toggleSort(c.key)}
                      title={c.key === 'reason' ? 'Sort by severity (red → amber → low)' : 'Sort'}
                    >
                      {c.label}{arrow(c.key)}
                    </th>
                  ))}
                  <th className={`${S.th} text-right`} />
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <IdleRow key={`${r.subject_type}:${r.subject_id}`} row={r} kind={kind} reasons={reasons} onSetReason={onSetReason} onResolve={onResolve} />
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > CAP && (
            <div className="px-4 py-2.5 border-t border-gray-100 dark:border-white/5">
              <button onClick={() => setExpanded(e => !e)} className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline">
                {expanded ? 'Show fewer' : `Show all (${sorted.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function IdleRow({ row, kind, reasons, onSetReason, onResolve }) {
  const [note, setNote] = useState(row.reason_note || '')
  const [confirming, setConfirming] = useState(false)
  const sev = severity(row)

  const daysCls = (row.days_idle ?? 0) >= 14 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-slate-300'

  const reasonCell = (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[sev]}`} title={sev === 'red' ? 'Needs attention' : sev === 'amber' ? 'Watch' : 'Expected idle'} />
      <select
        value={row.reason || ''}
        onChange={e => onSetReason(row, e.target.value, note)}
        className={`text-xs bg-white dark:bg-slate-800/80 border rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${row.reason ? 'border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200' : 'border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-400'}`}
      >
        <option value="">{row.reason ? '— Clear —' : 'set reason'}</option>
        {reasons.map(rs => <option key={rs} value={rs}>{rs}</option>)}
      </select>
      {row.reason && (
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={() => { if ((note || '') !== (row.reason_note || '')) onSetReason(row, row.reason, note) }}
          placeholder="note"
          className="text-xs w-28 bg-white dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 rounded-md px-1.5 py-0.5 text-gray-600 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
        />
      )}
    </div>
  )

  const actionsCell = (
    <td className={`${S.td} text-right whitespace-nowrap`}>
      {confirming ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-[11px] text-gray-500 dark:text-slate-400">Resolve?</span>
          <button onClick={() => { setConfirming(false); onResolve(row) }} className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">Yes</button>
          <button onClick={() => setConfirming(false)} className="text-[11px] text-gray-500 hover:underline">No</button>
        </span>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 hover:underline" title="Close this idle spell (sold, terminated, or back to work)">Resolve</button>
      )}
    </td>
  )

  if (kind === 'unit') {
    return (
      <tr className={S.tableRow}>
        <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{row.label || '—'}</td>
        <td className={`${S.td} text-right font-mono ${daysCls}`}>{fmtDays(row.days_idle)}</td>
        <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{row.extra || '—'}</td>
        <td className={`${S.td} text-right font-mono text-amber-600 dark:text-amber-400`}>{Number(row.monthly_cost) > 0 ? `${fmtMoney(row.monthly_cost)}` : '$0'}</td>
        <td className={S.td}>{reasonCell}</td>
        {actionsCell}
      </tr>
    )
  }
  // driver
  return (
    <tr className={S.tableRow}>
      <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
        {row.label || '—'}
        {row.detail && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">{row.detail}</span>}
      </td>
      <td className={`${S.td} text-right font-mono ${daysCls}`}>{fmtDays(row.days_idle)}</td>
      <td className={`${S.td} text-right`}>
        <span className={`font-mono ${Number(row.monthly_cost) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-slate-600'}`}>{Number(row.monthly_cost) > 0 ? `${fmtMoney(row.monthly_cost)}/mo` : '$0'}</span>
        {row.extra && <div className="text-[11px] text-gray-500 dark:text-slate-500">{row.extra}</div>}
      </td>
      <td className={S.td}>{reasonCell}</td>
      {actionsCell}
    </tr>
  )
}
