import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import ProfitabilityCalendar from './ProfitabilityCalendar'

// Loads ingest — Phase 3 profitability (revenue/productivity only; margin
// comes when the cost side is wired). Rolls revenue + miles + $/mile up by
// driver/truck/dispatcher/customer/carrier over a DELIVERY-date range, via
// load_profit_rollup(). Realized vs projected (Booked = upcoming income)
// shown side by side. A team-load split editor sets per-leg revenue_amount
// (must total the load's linehaul); the base view prefers it over the even
// split.

const DIMENSIONS = [
  { key: 'driver',     label: 'Drivers' },
  { key: 'truck',      label: 'Trucks' },
  { key: 'dispatcher', label: 'Dispatchers' },
  { key: 'customer',   label: 'Customers' },
  { key: 'carrier',    label: 'Carriers' },
]

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function thisWeek() {
  const now = new Date()
  const dow = (now.getDay() + 6) % 7 // Monday = 0
  const mon = new Date(now); mon.setDate(now.getDate() - dow)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return { from: ymd(mon), to: ymd(sun) }
}
function thisMonth() {
  const now = new Date()
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
}
function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}
function fmtMoneyWhole(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtNum(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
// Parse a 'YYYY-MM-DD' as a LOCAL date (avoid the UTC shift of new Date(str)).
function parseYmd(s) {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  return new Date(y, m - 1, d)
}
// Inclusive span label, e.g. "Jun 8 – Jun 14, 2026" (year collapsed when both
// endpoints share it). Matches the rollup's BETWEEN from AND to.
function formatRange(from, to) {
  const a = parseYmd(from), b = parseYmd(to)
  if (!a || !b) return ''
  const sameYear = a.getFullYear() === b.getFullYear()
  const aStr = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  const bStr = b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${aStr} – ${bStr}`
}
const PRESET_LABEL = { week: 'This week', month: 'This month', custom: 'Custom' }

// Shift a 'YYYY-MM-DD' by N days (local), and inclusive day-span between two.
function shiftYmd(s, days) { const d = parseYmd(s); d.setDate(d.getDate() + days); return ymd(d) }
function spanDays(from, to) {
  const a = parseYmd(from), b = parseYmd(to)
  if (!a || !b) return 0
  return Math.round((b - a) / 86400000) + 1
}

// Roll a set of rollup rows up to period totals. activeEntities = rows with any
// realized load (e.g. drivers who actually ran a load this week).
function aggregate(rows) {
  let loads = 0, realizedLoads = 0, bookedLoads = 0, miles = 0, realized = 0, projected = 0, activeEntities = 0
  for (const r of rows) {
    loads += Number(r.load_count || 0)
    realizedLoads += Number(r.realized_loads || 0)
    bookedLoads += Number(r.booked_loads || 0)
    miles += Number(r.total_miles || 0)
    realized += Number(r.realized_revenue || 0)
    projected += Number(r.projected_revenue || 0)
    if (Number(r.realized_loads || 0) > 0) activeEntities++
  }
  return { loads, realizedLoads, bookedLoads, miles, realized, projected, activeEntities, rpm: miles > 0 ? realized / miles : null }
}

// Week-over-week movement. isNew when there's nothing to compare against (prior
// = 0) but the current period has activity; flat when essentially unchanged.
function pctDelta(cur, prev) {
  cur = Number(cur) || 0; prev = Number(prev) || 0
  if (prev === 0) return cur > 0 ? { isNew: true } : { flat: true }
  const pct = (cur - prev) / prev * 100
  return { pct, dir: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat' }
}

export default function Profitability() {
  const toast = useToast()
  const [dimension, setDimension] = useState('driver')
  const [preset, setPreset] = useState('week')
  const [range, setRange] = useState(thisWeek)
  const [calendarView, setCalendarView] = useState(false)
  const [rows, setRows] = useState([])
  const [priorRows, setPriorRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [teamLoads, setTeamLoads] = useState([])
  const [editLoad, setEditLoad] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Team loads delivering in-range, with their legs, for the split editor.
    async function loadTeamLoads() {
      const { data: loads } = await supabase.from('loads')
        .select('id, load_number, customer_id, linehaul, delivery_date')
        .eq('is_team_load', true)
        .gte('delivery_date', range.from).lte('delivery_date', range.to)
        .not('status', 'ilike', 'canceled')
        .order('delivery_date')
      if (!loads?.length) return []
      const [{ data: legs }, { data: custs }] = await Promise.all([
        supabase.from('load_legs').select('id, load_id, leg_seq, driver_raw, driver_id, total_miles, revenue_amount').in('load_id', loads.map(l => l.id)),
        supabase.from('customers').select('id, name'),
      ])
      const driverIds = [...new Set((legs || []).map(l => l.driver_id).filter(Boolean))]
      let driversById = new Map()
      if (driverIds.length) {
        const { data: drv } = await supabase.from('drivers').select('id, full_name').in('id', driverIds)
        driversById = new Map((drv || []).map(d => [d.id, d.full_name]))
      }
      const custById = new Map((custs || []).map(c => [c.id, c.name]))
      const legsByLoad = new Map()
      for (const lg of (legs || [])) {
        if (!legsByLoad.has(lg.load_id)) legsByLoad.set(lg.load_id, [])
        legsByLoad.get(lg.load_id).push({ ...lg, driver_display: driversById.get(lg.driver_id) || lg.driver_raw })
      }
      return loads.map(l => ({
        ...l,
        customer_name: custById.get(l.customer_id) || '—',
        legs: (legsByLoad.get(l.id) || []).sort((a, b) => (a.leg_seq || 0) - (b.leg_seq || 0)),
      }))
    }

    // Prior comparable period (same dimension) for week-over-week deltas:
    // the equal-length span immediately before the selected one.
    const span = spanDays(range.from, range.to)
    const priorFrom = shiftYmd(range.from, -span)
    const priorTo = shiftYmd(range.to, -span)

    const [rollup, prior, team] = await Promise.all([
      supabase.rpc('load_profit_rollup', { p_dimension: dimension, p_from: range.from, p_to: range.to }),
      supabase.rpc('load_profit_rollup', { p_dimension: dimension, p_from: priorFrom, p_to: priorTo }),
      loadTeamLoads(),
    ])
    if (rollup.error) toast.error("Couldn't load profitability", rollup.error)
    setRows(rollup.data || [])
    setPriorRows(prior.data || [])
    setTeamLoads(team)
    setLoading(false)
  }, [dimension, range.from, range.to, toast])

  useEffect(() => { load() }, [load])

  function setDimensionAndReset(d) {
    setDimension(d)
    if (d !== 'driver') setCalendarView(false)
  }

  function setPresetRange(p) {
    setPreset(p)
    if (p === 'week') setRange(thisWeek())
    else if (p === 'month') setRange(thisMonth())
  }

  const sorted = useMemo(
    () => [...rows].sort((a, b) => Number(b.realized_revenue) - Number(a.realized_revenue)),
    [rows]
  )
  const totals = useMemo(() => aggregate(rows), [rows])
  const priorTotals = useMemo(() => aggregate(priorRows), [priorRows])

  const dimLabel = DIMENSIONS.find(d => d.key === dimension)?.label || ''
  // Comparison framing for the summary panel: a 7-day selection reads "vs last
  // week"; anything else compares to the equal-length prior period.
  const isWeek = spanDays(range.from, range.to) === 7
  const cmpLabel = isWeek ? 'vs last week' : 'vs prior period'
  // Days-active denominator = days in the selected window (7 for a week).
  const rangeDays = spanDays(range.from, range.to)
  // Utilization column is most meaningful where one entity = one running unit.
  const showDays = dimension === 'driver' || dimension === 'truck'
  // "% of loads" is scoped to the Customers tab for now (concentration view).
  const showPct = dimension === 'customer'
  const colCount = 6 + (showPct ? 1 : 0) + (showDays ? 1 : 0)
  const pctOfLoads = (n) => totals.loads > 0 ? `${(Number(n || 0) / totals.loads * 100).toFixed(1)}%` : '—'

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profitability</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
          Revenue, miles, and $/mile by delivery date. Canceled excluded; Booked shown as upcoming income.
          Cost &amp; margin come in a later phase.
        </p>
      </div>

      {/* Week summary — revenue-based "good week / bad week" read with
          week-over-week deltas. NOT a profit verdict; the net-margin layer
          lands with the cost phase and can drop straight into this panel. */}
      <div className={`${S.card} p-4`}>
        <div className="flex items-start justify-between flex-wrap gap-x-4 gap-y-1 mb-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {isWeek ? 'Week summary' : 'Period summary'}
            <span className="ml-2 text-[11px] font-normal text-gray-400 dark:text-slate-500">{cmpLabel}</span>
          </h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" title="This is a revenue/productivity read. Driver pay, fuel, and equipment cost aren't in BUDDY yet, so there's no true profit verdict here — that arrives with the cost/margin phase.">
            Revenue view — net margin pending cost layer
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="Realized gross" tone="emerald" value={fmtMoneyWhole(totals.realized)} delta={pctDelta(totals.realized, priorTotals.realized)} cmpLabel={cmpLabel} />
          <Stat label="Upcoming (Booked)" tone="cyan" value={fmtMoneyWhole(totals.projected)} sub={`${totals.bookedLoads.toLocaleString()} booked`} delta={pctDelta(totals.projected, priorTotals.projected)} cmpLabel={cmpLabel} />
          <Stat label="Realized loads" tone="slate" value={fmtNum(totals.realizedLoads)} delta={pctDelta(totals.realizedLoads, priorTotals.realizedLoads)} cmpLabel={cmpLabel} />
          <Stat label="Realized miles" tone="slate" value={fmtNum(totals.miles)} delta={pctDelta(totals.miles, priorTotals.miles)} cmpLabel={cmpLabel} />
          <Stat label="Realized $/mile" tone="amber" value={totals.rpm == null ? '—' : `$${totals.rpm.toFixed(2)}`} delta={pctDelta(totals.rpm, priorTotals.rpm)} cmpLabel={cmpLabel} />
          <Stat label={`Active ${dimLabel.toLowerCase()}`} tone="slate" value={fmtNum(totals.activeEntities)} sub={`of ${rows.length}`} delta={pctDelta(totals.activeEntities, priorTotals.activeEntities)} cmpLabel={cmpLabel} />
        </div>
      </div>

      {/* Controls: dimension tabs + date range. Stacks on narrow widths so
          the date control drops below the tabs instead of squeezing the
          preset buttons into clipped/wrapped labels (~1280px laptop). */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center flex-wrap gap-2">
          {DIMENSIONS.map(d => (
            <button
              key={d.key}
              onClick={() => setDimensionAndReset(d.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                dimension === d.key
                  ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {/* Week navigation arrows */}
            <button
              onClick={() => setRange(r => ({ from: shiftYmd(r.from, -7), to: shiftYmd(r.to, -7) }))}
              className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              title="Previous week"
            >
              ◀
            </button>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0">
              {[['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, lbl]) => (
                <button key={k} onClick={() => setPresetRange(k)} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${preset === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>{lbl}</button>
              ))}
            </div>
            <button
              onClick={() => setRange(r => ({ from: shiftYmd(r.from, 7), to: shiftYmd(r.to, 7) }))}
              className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              title="Next week"
            >
              ▶
            </button>
            {/* Table | Calendar toggle (Drivers dimension only) */}
            {dimension === 'driver' && (
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0">
                <button
                  onClick={() => setCalendarView(false)}
                  className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${!calendarView ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}
                >
                  Table
                </button>
                <button
                  onClick={() => setCalendarView(true)}
                  className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${calendarView ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}
                >
                  Calendar
                </button>
              </div>
            )}
            {preset === 'custom' && (
              <>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                <span className="text-gray-400 text-xs shrink-0">→</span>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
              </>
            )}
          </div>
          {/* Resolved span so "This week" isn't ambiguous. Updates live with
              preset/custom changes; inclusive of both endpoints. */}
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            {PRESET_LABEL[preset]} · <span className="font-medium text-gray-500 dark:text-slate-400">{formatRange(range.from, range.to)}</span> · by delivery date
          </p>
        </div>
      </div>

      {/* Table or Calendar view */}
      {calendarView && dimension === 'driver' ? (
        <ProfitabilityCalendar weekStart={range.from} weekEnd={range.to} />
      ) : (
        <>
      {/* Rollup table. Vertical scroll lives on this container so the header
          row can stick to its top on long lists (sticky needs a scrolling
          ancestor; the card itself stays put). */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#0d0d1f]">
              <tr>
                <th className={`${S.th} min-w-[180px]`}>{dimLabel.replace(/s$/, '')}</th>
                <th className={`${S.th} text-right`}>Loads</th>
                {showDays && <th className={`${S.th} text-right`} title={`Distinct days with a realized (delivered) load in range — utilization out of ${rangeDays}.`}>Days active</th>}
                {showPct && <th className={`${S.th} text-right`} title="Share of total loads in the selected date window.">% of loads</th>}
                <th className={`${S.th} text-right`}>Miles</th>
                <th className={`${S.th} text-right`}>Realized revenue</th>
                <th className={`${S.th} text-right`}>$/mile</th>
                <th className={`${S.th} text-right`} title="Booked loads delivering in-range — revenue not yet earned.">Upcoming (Booked)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={colCount} className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={colCount} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No loads delivered in this range. Import loads first, then check the date window.</td></tr>
              ) : sorted.map((r, i) => (
                <tr key={r.key_id || `raw-${i}`} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                    {r.key_name || <span className="italic text-gray-400 dark:text-slate-500">(unassigned)</span>}
                    {!r.key_id && r.key_name && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" title="Raw name from TMS — not yet linked to a fleet record. Resolve it in Loads Import review.">unmatched</span>
                    )}
                  </td>
                  <td className={`${S.td} text-right font-mono text-gray-600 dark:text-slate-400 align-top`}>
                    {fmtNum(r.load_count)}
                    {/* Show the realized vs booked split when any of the row's
                        loads are Booked — so a $0/0mi/— row reads as upcoming,
                        not missing data. Pure-realized rows stay clean. */}
                    {Number(r.booked_loads) > 0 && (
                      <span className="block text-[10px] font-normal text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                        {fmtNum(r.realized_loads)} realized · <span className="text-cyan-600 dark:text-cyan-400">{fmtNum(r.booked_loads)} booked</span>
                      </span>
                    )}
                  </td>
                  {showDays && (
                    <td className={`${S.td} text-right font-mono text-gray-600 dark:text-slate-400 align-top`}>
                      <span className={Number(r.active_days) > 0 ? 'text-gray-900 dark:text-slate-200' : 'text-gray-300 dark:text-slate-600'}>
                        {fmtNum(r.active_days)} <span className="text-gray-400 dark:text-slate-500">/ {rangeDays}</span>
                      </span>
                      {Number(r.active_days) > 0 && Number(r.realized_loads) > 0 && (
                        <span className="block text-[10px] font-normal text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                          {(Number(r.realized_loads) / Number(r.active_days)).toFixed(1)} loads/day
                        </span>
                      )}
                    </td>
                  )}
                  {showPct && <td className={`${S.td} text-right font-mono text-gray-500 dark:text-slate-400 align-top`}>{pctOfLoads(r.load_count)}</td>}
                  <td className={`${S.td} text-right font-mono text-gray-600 dark:text-slate-400 align-top`}>{fmtNum(r.total_miles)}</td>
                  <td className={`${S.td} text-right font-mono text-gray-900 dark:text-slate-200`}>{fmtMoney(r.realized_revenue)}</td>
                  <td className={`${S.td} text-right font-mono text-gray-600 dark:text-slate-400`}>{r.realized_rpm == null ? '—' : `$${Number(r.realized_rpm).toFixed(2)}`}</td>
                  <td className={`${S.td} text-right font-mono ${Number(r.projected_revenue) > 0 ? 'text-cyan-700 dark:text-cyan-400' : 'text-gray-300 dark:text-slate-600'}`}>{Number(r.projected_revenue) > 0 ? fmtMoney(r.projected_revenue) : '—'}</td>
                </tr>
              ))}
            </tbody>
            {!loading && sorted.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.02] font-medium">
                  <td className={`${S.td} text-xs text-gray-600 dark:text-slate-300 align-top`}>Totals · {sorted.length} {dimLabel.toLowerCase()}</td>
                  <td className={`${S.td} text-right font-mono align-top`}>
                    {fmtNum(totals.loads)}
                    {totals.bookedLoads > 0 && (
                      <span className="block text-[10px] font-normal text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                        {fmtNum(totals.realizedLoads)} realized · <span className="text-cyan-600 dark:text-cyan-400">{fmtNum(totals.bookedLoads)} booked</span>
                      </span>
                    )}
                  </td>
                  {showDays && <td className={`${S.td} text-right font-mono align-top text-gray-400 dark:text-slate-500`}>{totals.activeEntities} active</td>}
                  {showPct && <td className={`${S.td} text-right font-mono align-top text-gray-500 dark:text-slate-400`}>{totals.loads > 0 ? '100.0%' : '—'}</td>}
                  <td className={`${S.td} text-right font-mono align-top`}>{fmtNum(totals.miles)}</td>
                  <td className={`${S.td} text-right font-mono text-gray-900 dark:text-slate-200`}>{fmtMoney(totals.realized)}</td>
                  <td className={`${S.td} text-right font-mono`}>{totals.rpm == null ? '—' : `$${totals.rpm.toFixed(2)}`}</td>
                  <td className={`${S.td} text-right font-mono text-cyan-700 dark:text-cyan-400`}>{totals.projected > 0 ? fmtMoney(totals.projected) : '—'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Team-load revenue distribution */}
      {teamLoads.length > 0 && (
        <div className={`${S.card} p-4 space-y-3`}>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Team-load revenue distribution</h2>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
              Team loads delivering in range. Distribute each load's linehaul across its legs — until you do, it splits evenly.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={S.tableHead}><tr>
                <th className={S.th}>Load #</th><th className={S.th}>Customer</th>
                <th className={`${S.th} text-right`}>Linehaul</th><th className={`${S.th} text-right`}>Legs</th>
                <th className={S.th}>Allocation</th><th className={`${S.th} text-right`}></th>
              </tr></thead>
              <tbody>
                {teamLoads.map(l => {
                  const allocated = l.legs.some(lg => lg.revenue_amount != null)
                  return (
                    <tr key={l.id} className={S.tableRow}>
                      <td className={`${S.td} font-mono`}>{l.load_number}</td>
                      <td className={S.td}>{l.customer_name}</td>
                      <td className={`${S.td} text-right font-mono`}>{fmtMoney(l.linehaul)}</td>
                      <td className={`${S.td} text-right`}>{l.legs.length}</td>
                      <td className={S.td}>
                        {allocated
                          ? <span className="text-emerald-700 dark:text-emerald-400">manual</span>
                          : <span className="text-gray-400 dark:text-slate-500">even split</span>}
                      </td>
                      <td className={`${S.td} text-right`}>
                        <button onClick={() => setEditLoad(l)} className={S.btnBlue}>Distribute</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editLoad && (
        <TeamSplitModal load={editLoad} onClose={() => setEditLoad(null)} onSaved={() => { setEditLoad(null); load() }} />
      )}
        </>
      )}
    </div>
  )
}

function Stat({ label, tone, value, sub, delta, cmpLabel }) {
  const toneText = {
    emerald: 'text-emerald-700 dark:text-emerald-400', cyan: 'text-cyan-700 dark:text-cyan-400',
    amber: 'text-amber-700 dark:text-amber-400', slate: 'text-gray-900 dark:text-slate-200',
  }[tone] || 'text-gray-900 dark:text-slate-200'
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-mono font-medium ${toneText} leading-tight mt-0.5`}>{value}</p>
      <div className="flex items-center gap-1.5 leading-tight mt-0.5">
        <DeltaBadge delta={delta} cmpLabel={cmpLabel} />
        {sub && <span className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</span>}
      </div>
    </div>
  )
}

// Week-over-week badge: ▲/▼ + %, green up / red down (more revenue, miles,
// loads, RPM is always "better" here). "new" when there's no prior to compare.
function DeltaBadge({ delta, cmpLabel }) {
  if (!delta || delta.flat) return <span className="text-[11px] text-gray-400 dark:text-slate-600">— flat</span>
  if (delta.isNew) return <span className="text-[11px] text-emerald-600 dark:text-emerald-400" title={`No activity ${cmpLabel}`}>new</span>
  const up = delta.dir === 'up', down = delta.dir === 'down'
  const cls = up ? 'text-emerald-600 dark:text-emerald-400' : down ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-slate-600'
  return (
    <span className={`text-[11px] font-medium ${cls}`} title={cmpLabel}>
      {up ? '▲' : down ? '▼' : '■'} {Math.abs(delta.pct).toFixed(0)}%
    </span>
  )
}

// Per-leg revenue allocation. Pre-fills current revenue_amount or the even
// split; the running total must equal the load's linehaul (±$0.01) to save.
function TeamSplitModal({ load, onClose, onSaved }) {
  const toast = useToast()
  const linehaul = Number(load.linehaul) || 0
  const evenSplit = load.legs.length ? linehaul / load.legs.length : 0
  const [amounts, setAmounts] = useState(() =>
    load.legs.map(lg => (lg.revenue_amount != null ? String(lg.revenue_amount) : evenSplit.toFixed(2)))
  )
  const [saving, setSaving] = useState(false)

  const total = amounts.reduce((s, a) => s + (Number(a) || 0), 0)
  const balanced = Math.abs(total - linehaul) <= 0.01
  const diff = linehaul - total

  async function save() {
    if (!balanced || saving) return
    setSaving(true)
    const results = await Promise.all(load.legs.map((lg, i) =>
      supabase.from('load_legs').update({ revenue_amount: Number(amounts[i]) }).eq('id', lg.id)
    ))
    setSaving(false)
    const failed = results.find(r => r.error)
    if (failed) { toast.error("Couldn't save the split", failed.error); return }
    toast.success(`Revenue distributed across ${load.legs.length} legs — ${load.load_number}`)
    onSaved?.()
  }

  function reset() { setAmounts(load.legs.map(() => evenSplit.toFixed(2))) }

  return (
    <Modal open onClose={onClose} title={`Distribute revenue — ${load.load_number}`} size="lg">
      <div className={S.modalBody}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-slate-400">Load linehaul</span>
          <span className="font-mono font-semibold text-gray-900 dark:text-slate-200">{fmtMoney(linehaul)}</span>
        </div>
        <div className="space-y-2">
          {load.legs.map((lg, i) => (
            <div key={lg.id} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900 dark:text-slate-200 truncate">{lg.driver_display || '—'}</div>
                <div className="text-[11px] text-gray-400 dark:text-slate-500">leg {lg.leg_seq} · {fmtNum(lg.total_miles)} mi</div>
              </div>
              <div className="relative w-40">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number" step="0.01" min="0"
                  className={`${S.input} pl-6 text-right font-mono`}
                  value={amounts[i]}
                  onChange={e => setAmounts(prev => prev.map((a, j) => j === i ? e.target.value : a))}
                />
              </div>
            </div>
          ))}
        </div>
        <div className={`flex items-center justify-between text-sm rounded-xl px-3 py-2 ${balanced ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
          <span>Allocated total</span>
          <span className="font-mono font-semibold">
            {fmtMoney(total)}
            {!balanced && <span className="ml-2 text-xs">({diff > 0 ? `${fmtMoney(diff)} short` : `${fmtMoney(-diff)} over`})</span>}
          </span>
        </div>
        <div className={S.modalFooter}>
          <button onClick={reset} className={S.btnCancel} disabled={saving} type="button">Reset to even split</button>
          <button onClick={save} disabled={!balanced || saving} className={S.btnSave}>
            {saving ? 'Saving…' : 'Save distribution'}
          </button>
        </div>
        {!balanced && (
          <p className="text-[11px] text-gray-400 dark:text-slate-500 text-right">Per-leg amounts must total the load's linehaul to save.</p>
        )}
      </div>
    </Modal>
  )
}
