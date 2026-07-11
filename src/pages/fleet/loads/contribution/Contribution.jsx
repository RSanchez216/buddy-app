import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../../../contexts/ToastContext'
import { S } from '../../../../lib/styles'
import { supabase } from '../../../../lib/supabase'
import ErrorBoundary from '../../../../components/ErrorBoundary'
import { fetchContribution, prorateUnitCost, fetchTeamByDriver } from './contributionData'
import { fmtMoney, fmtNum, formatRange, shiftYmd, spanDays, thisMonth, thisWeek } from '../spotlight/spotlightShared'

// A driver/unit has a usable comp rate iff its comp_type is one of these; else
// pay is unknown (est_unit_driver_pay = 0) and the row is flagged "needs rate".
const KNOWN_COMP = new Set(['rate_pct', 'rate_per_mile', 'service_charge_pct', 'flat_rate'])

// Profit Contribution — the fleet ranked by what each unit actually leaves
// behind after its equipment carrying cost and truck-purchase deduction.
// This is a PARTIAL margin (driver pay, fuel, insurance aren't in BUDDY yet)
// and every surface of the page says so. Additive route — the existing
// Profitability page, calendar, and Spotlight are untouched.

const PRESET_LABEL = { week: 'This week', month: 'This month', custom: 'Custom' }

const fmtSignedMoney = (n) => (n < 0 ? `−${fmtMoney(-n)}` : fmtMoney(n || 0)) // `|| 0` keeps −0 from rendering as "-$0"
const fmtCpm = (n) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`)
const fmtPct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`)

// Sortable metric columns. `get` returns the numeric sort value; null/— is
// treated as the lowest value (see sort comparator). `tip` is the header
// tooltip — wording verified against contributionData.js / the rollup RPC.
const COLUMNS = [
  { key: 'revenue',      label: 'Revenue',      get: r => r.revenue,
    tip: 'Realized linehaul revenue from delivered loads in this period. Canceled excluded; booked/upcoming not counted.' },
  { key: 'equipCost',    label: 'Equipment',    get: r => r.equipCost,
    tip: 'Equipment carrying cost (lease/loan): monthly cost prorated to the period — monthly × period days ÷ 30.44. $0 for driver-owned; units with unknown cost are excluded and flagged ⚠.' },
  { key: 'purchase',     label: 'Purchase',     get: r => r.purchase,
    tip: 'Driver-purchase payments due in this period (truck being bought by the driver). Subtracted from contribution.' },
  { key: 'contribution', label: 'Contribution', get: r => r.contribution,
    tip: 'Revenue − equipment carrying cost − purchase. Partial margin — driver pay & fuel are NOT included. Not net profit.' },
  { key: 'cpm',          label: 'Contrib / mi', get: r => r.cpm,
    tip: 'Contribution ÷ total miles this period.' },
  { key: 'util',         label: 'Util',         get: r => r.util,
    tip: 'Active days ÷ elapsed days in the period (future days aren’t counted as idle), capped at 100%.' },
]

// Driver-pay mode columns. tip wording verified against
// driver_pay_estimate_rollup / v_load_leg_pay_estimate.
const DRIVER_PAY_COLUMNS = [
  { key: 'loads',                     label: 'Loads',            num: d => Number(d.loads),
    tip: 'Load legs attributed to this driver in this period (by the selected pickup/delivery basis).' },
  { key: 'linehaul_revenue',          label: 'Linehaul revenue', num: d => Number(d.linehaul_revenue),
    tip: 'Driver’s linehaul (leg) revenue for loads dated in this period. Includes all in-window legs (not delivered-only), so it can differ from the Equipment view’s Revenue.' },
  { key: 'est_driver_pay',            label: 'Est. driver pay',  num: d => Number(d.est_driver_pay),
    tip: 'Estimated driver pay from the comp rate (per-mile × miles, % of revenue, or service-charge remainder) — an estimate, not actual settlement.' },
  { key: 'est_company_contribution',  label: 'Est. company earn', num: d => Number(d.est_company_contribution),
    tip: 'Linehaul revenue − estimated driver pay. Excludes equipment cost and fuel.' },
]

// Company Net mode columns (by driver). num() reads the computed row.
const COMPANY_NET_COLUMNS = [
  { key: 'revenue',    label: 'Revenue',     num: r => r.revenue,
    tip: 'Realized linehaul revenue from this driver’s loads in the period (all their loads — can exceed the by-truck Equipment Contrib figure if they ran more than one truck).' },
  { key: 'equipment',  label: 'Equipment',   num: r => r.equipment,
    tip: 'Truck + trailer carrying cost, monthly prorated to the period (monthly × period days ÷ 30.44) — same basis as Equipment Contrib. $0 for driver-owned units.' },
  { key: 'driverPay',  label: 'Driver pay',  num: r => r.driverPay,
    tip: 'Estimated driver pay from the comp rate (per-mile × miles, % of revenue, service-charge remainder, or weekly salary prorated to the period) — same estimate as Est. Driver Pay. Not actual settlement.' },
  { key: 'companyNet', label: 'Company Net', num: r => r.companyNet,
    tip: 'Revenue − equipment − driver pay = what the company keeps. Fuel, insurance & repairs not included yet — not final net profit.' },
]

// ── Mini waterfall: revenue → −equipment → −purchase → contribution ──────
// Top-of-page warning: who's idle right now and the truck+trailer carrying
// run-rate they're burning with no revenue. Dismissible for the session;
// recurs on the next visit (fresh mount). Trucks+trailers cost only — adding
// drivers' cost would double-count the same equipment.
function IdleWarningBubble() {
  const [data, setData] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let stale = false
    supabase.rpc('idle_subjects', { p_threshold: 3 })
      .then(({ data: rows, error }) => {
        if (stale || error) return
        const t = { trucks: 0, trailers: 0, drivers: 0, equipCost: 0 }
        for (const r of rows || []) {
          if (r.resolved) continue // active-only — resolved cases now persist in idle_subjects
          if (r.subject_type === 'truck') { t.trucks++; t.equipCost += Number(r.monthly_cost) || 0 }
          else if (r.subject_type === 'trailer') { t.trailers++; t.equipCost += Number(r.monthly_cost) || 0 }
          else if (r.subject_type === 'driver') t.drivers++
        }
        setData(t)
      })
      .catch(() => {})
    return () => { stale = true }
  }, [])

  if (dismissed || !data || (data.trucks + data.trailers + data.drivers) === 0) return null

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
      <span>
        ⚠ Idle right now: <span className="font-semibold">{data.trucks}</span> trucks · <span className="font-semibold">{data.trailers}</span> trailers · <span className="font-semibold">{data.drivers}</span> drivers — <span className="font-semibold">{fmtMoney(data.equipCost)}/mo</span> carrying cost, no revenue.
      </span>
      <span className="flex items-center gap-3 shrink-0">
        <Link to="/fleet/profitability/idle" className="font-semibold underline hover:no-underline whitespace-nowrap">Go to idle review →</Link>
        <button onClick={() => setDismissed(true)} className="text-amber-600 dark:text-amber-400 hover:opacity-70" aria-label="Dismiss">✕</button>
      </span>
    </div>
  )
}

// Plain positioned divs on a shared scale; the dashed line is $0.
function Waterfall({ row }) {
  const lo = Math.min(0, row.contribution)
  const hi = Math.max(row.revenue, 1)
  const x = (v) => ((v - lo) / (hi - lo)) * 100
  const steps = [
    { label: 'Realized revenue', from: 0, to: row.revenue, value: row.revenue, color: 'bg-cyan-500/80' },
    { label: 'Equipment carrying cost', from: row.revenue, to: row.revenue - row.equipCost, value: -row.equipCost, color: 'bg-amber-500/80' },
    { label: 'Truck-purchase deduction', from: row.revenue - row.equipCost, to: row.contribution, value: -row.purchase, color: 'bg-fuchsia-500/80' },
    { label: 'Contribution', from: 0, to: row.contribution, value: row.contribution, color: row.contribution >= 0 ? 'bg-emerald-500' : 'bg-rose-500' },
  ]
  return (
    <div className="space-y-1.5 max-w-xl">
      {steps.map(s => (
        <div key={s.label} className="flex items-center gap-3 text-xs">
          <span className="w-44 shrink-0 text-gray-700 dark:text-slate-400">{s.label}</span>
          <div className="relative flex-1 h-4 rounded bg-gray-100 dark:bg-white/[0.04] overflow-hidden">
            <div className="absolute inset-y-0 border-l border-dashed border-gray-300 dark:border-slate-600" style={{ left: `${x(0)}%` }} />
            <div
              className={`absolute inset-y-0.5 rounded-sm ${s.color}`}
              style={{ left: `${Math.min(x(s.from), x(s.to))}%`, width: `${Math.max(Math.abs(x(s.to) - x(s.from)), 0.5)}%` }}
            />
          </div>
          <span className={`w-24 shrink-0 text-right font-mono ${s.value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-700 dark:text-slate-200'}`}>
            {fmtSignedMoney(s.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Expanded row: waterfall + the units behind the equipment number ──────
function RowDetail({ row, days, dimension }) {
  return (
    <div className="px-4 py-4 space-y-4">
      <Waterfall row={row} />
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-gray-700 dark:text-slate-400">
        {row.units.length > 0 && (
          <div>
            <div className="font-semibold text-gray-600 dark:text-slate-300 mb-1">Equipment ({days}-day share of monthly cost)</div>
            {row.units.map((u, i) => (
              <div key={i} className="flex items-center gap-2 font-mono">
                <span className="w-14 capitalize font-sans text-gray-600 dark:text-slate-500">{u.etype}</span>
                <span className="w-24">{u.unitNumber || '—'}</span>
                <span className="w-20 text-right">{u.monthly != null ? `${fmtMoney(u.monthly)}/mo` : u.source === 'driver_owned' ? '$0 (driver-owned)' : 'unknown'}</span>
                <span className="font-sans text-gray-600 dark:text-slate-500">{u.source !== 'driver_owned' ? u.source : ''}</span>
              </div>
            ))}
          </div>
        )}
        <div>
          <div className="font-semibold text-gray-600 dark:text-slate-300 mb-1">Activity</div>
          <div>{fmtNum(row.loads)} realized loads · {fmtNum(row.miles)} mi · {row.rpm != null ? `$${row.rpm.toFixed(2)}/mi gross` : 'no $/mi'}</div>
          {row.purchaseCount > 0 && <div>{row.purchaseCount} purchase payment{row.purchaseCount > 1 ? 's' : ''} due in window</div>}
          {row.unknownUnits > 0 && (
            <div className="text-amber-600 dark:text-amber-400">
              {row.unknownUnits} unit{row.unknownUnits > 1 ? 's' : ''} with unknown carrying cost — not in this number
            </div>
          )}
          {row.unmatched && <div className="text-amber-600 dark:text-amber-400">Unmatched TMS {dimension} name — no master record linked</div>}
        </div>
      </div>
    </div>
  )
}

export default function Contribution() {
  const toast = useToast()

  const [viewMode, setViewMode] = useState('equipment') // 'equipment' | 'driver-pay'
  const [dimension, setDimension] = useState('truck')
  const [preset, setPreset] = useState('month')
  const [range, setRange] = useState(thisMonth)
  const [basis, setBasis] = useState('delivery')
  const [sort, setSort] = useState({ key: 'contribution', dir: 'desc' })
  const [driverPaySort, setDriverPaySort] = useState({ key: 'estCompanyContribution', dir: 'desc' })
  const [query, setQuery] = useState('')
  const [negativeFilter, setNegativeFilter] = useState(false)
  const [ownershipFilter, setOwnershipFilter] = useState('all') // 'all' | 'company' | 'driver_owned'

  // Async results live with the key they were fetched for — a dimension /
  // period / basis change invalidates them by derivation, no reset effects.
  const dataKey = `${dimension}|${range.from}|${range.to}|${basis}`
  const driverPayKey = `driver-pay|${range.from}|${range.to}|${basis}`
  const [dataState, setDataState] = useState({ key: null, data: null })
  const [driverPayState, setDriverPayState] = useState({ key: null, data: null })
  const [expandState, setExpandState] = useState({ key: null, id: null })
  // Current-team overlay (driver_id → {team_id, team_name}) — the driver-pay
  // rollup keys on the primary and labels with that person's name; this lets
  // the Est. Driver Pay row read the TEAM name. Fetched once, period-agnostic.
  const [teamMap, setTeamMap] = useState(null)

  useEffect(() => {
    let stale = false
    fetchContribution({ dimension, from: range.from, to: range.to, basis })
      .then(d => { if (!stale) setDataState({ key: dataKey, data: d }) })
      .catch(err => {
        if (!stale) {
          toast.error("Couldn't load contribution data", err)
          setDataState({ key: dataKey, data: { rows: [], days: 0, effDays: 0, unattributed: { amount: 0, count: 0 }, unassigned: { revenue: 0, miles: 0 } } })
        }
      })
    return () => { stale = true }
  }, [dataKey, dimension, range.from, range.to, basis, toast])

  // Fetch driver pay estimates (parallel to equipment data, always driver-keyed).
  // The pay-rollup collapses a team to its primary row; overlay the team-aware
  // unit pay (driver_contribution_inputs.est_unit_*) onto it by that primary's
  // driver_id so a per-mile/flat team shows both drivers' pay. Solo/owner-op
  // rows get their own value back (a no-op). No double-count — the rollup has no
  // separate co-driver row.
  useEffect(() => {
    let stale = false
    Promise.all([
      supabase.rpc('driver_pay_estimate_rollup', { p_from: range.from, p_to: range.to, p_basis: basis }),
      supabase.rpc('driver_contribution_inputs', { p_from: range.from, p_to: range.to, p_basis: basis }),
    ]).then(([rollup, ci]) => {
      if (stale) return
      if (rollup.error) throw rollup.error
      const unit = new Map((ci.error ? [] : (ci.data || [])).map(r => [r.driver_id, r]))
      const rows = (rollup.data || []).map(d => {
        const u = unit.get(d.driver_id)
        return u
          ? { ...d, est_driver_pay: Number(u.est_unit_driver_pay) || 0, est_company_contribution: Number(u.est_unit_company_earn) || 0 }
          : d
      })
      setDriverPayState({ key: driverPayKey, data: rows })
    }).catch(err => {
      if (!stale) {
        console.error('Failed to load driver pay data:', err)
        setDriverPayState({ key: driverPayKey, data: [] })
      }
    })
    return () => { stale = true }
  }, [driverPayKey, range.from, range.to, basis])

  useEffect(() => {
    let stale = false
    fetchTeamByDriver()
      .then(m => { if (!stale) setTeamMap(m) })
      .catch(() => { if (!stale) setTeamMap(new Map()) })
    return () => { stale = true }
  }, [])

  const loading = dataState.key !== dataKey
  const data = loading ? null : dataState.data
  const expandedId = expandState.key === dataKey ? expandState.id : null

  const filtered = useMemo(() => {
    if (!data) return []
    let rows = data.rows

    // Apply ownership filter
    if (ownershipFilter !== 'all') {
      if (ownershipFilter === 'company') {
        rows = rows.filter(r => r.ownershipStage && r.ownershipStage !== 'driver_owned')
      } else if (ownershipFilter === 'driver_owned') {
        rows = rows.filter(r => r.ownershipStage === 'driver_owned')
      }
    }

    // Apply negative filter
    if (negativeFilter) {
      rows = rows.filter(r => r.contribution < 0)
    }

    // Apply text filter
    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r => r.name?.toLowerCase().includes(q) || r.sub?.toLowerCase().includes(q))
    }

    return rows
  }, [data, query, negativeFilter, ownershipFilter])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    // Text column sorts alphabetically.
    if (sort.key === 'name') {
      return [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || '') * dir)
    }
    // Numeric columns sort by value; null/— is treated as the lowest value
    // (so it sinks under desc and leads under asc).
    const col = COLUMNS.find(c => c.key === sort.key) || COLUMNS[3]
    return [...filtered].sort((a, b) => {
      const av = col.get(a), bv = col.get(b)
      if (av == null && bv == null) return 0
      const na = av == null ? -Infinity : av
      const nb = bv == null ? -Infinity : bv
      return (na - nb) * dir
    })
  }, [filtered, sort])

  // Fleet totals across the FILTERED set, so the table footer always matches
  // the rows on screen.
  const totals = useMemo(() => {
    const t = { revenue: 0, equipCost: 0, purchase: 0, contribution: 0, miles: 0, negatives: 0, unknownUnits: 0 }
    for (const r of filtered) {
      t.revenue += r.revenue; t.equipCost += r.equipCost; t.purchase += r.purchase
      t.contribution += r.contribution; t.miles += r.miles
      if (r.contribution < 0) t.negatives++
      t.unknownUnits += r.unknownUnits
    }
    t.cpm = t.miles > 0 ? t.contribution / t.miles : null
    return t
  }, [filtered])

  // Driver pay totals
  const driverPayRaw = driverPayState.key === driverPayKey ? driverPayState.data : null
  // Overlay the team name onto team rows (the rollup collapses a team to its
  // primary and labels it with the primary's personal name). Numbers unchanged.
  const driverPayData = useMemo(() => {
    if (!driverPayRaw) return null
    if (!teamMap || teamMap.size === 0) return driverPayRaw
    return driverPayRaw.map(d => {
      const t = teamMap.get(d.driver_id)
      return t ? { ...d, driver_name: t.team_name, team_id: t.team_id } : d
    })
  }, [driverPayRaw, teamMap])
  const driverPayTotals = useMemo(() => {
    if (!driverPayData) return null
    const t = { loads: 0, linehaul: 0, estDriverPay: 0, estCompanyContribution: 0 }
    for (const d of driverPayData) {
      t.loads += Number(d.loads) || 0
      t.linehaul += Number(d.linehaul_revenue) || 0
      t.estDriverPay += Number(d.est_driver_pay) || 0
      t.estCompanyContribution += Number(d.est_company_contribution) || 0
    }
    return t
  }, [driverPayData])

  // Driver-pay rows sorted by the active column. Text column (driver name)
  // sorts alphabetically; numeric columns by value with null/— treated as the
  // lowest. Pinned totals live in the table footer, outside this list.
  const driverPaySorted = useMemo(() => {
    if (!driverPayData) return []
    const dir = driverPaySort.dir === 'asc' ? 1 : -1
    if (driverPaySort.key === 'driver_name') {
      return [...driverPayData].sort((a, b) => (a.driver_name || '').localeCompare(b.driver_name || '') * dir)
    }
    const col = DRIVER_PAY_COLUMNS.find(c => c.key === driverPaySort.key) || DRIVER_PAY_COLUMNS[3]
    return [...driverPayData].sort((a, b) => {
      const av = col.num(a), bv = col.num(b)
      const na = Number.isFinite(av) ? av : -Infinity
      const nb = Number.isFinite(bv) ? bv : -Infinity
      if (na === nb) return 0
      return (na - nb) * dir
    })
  }, [driverPayData, driverPaySort])

  function toggleDriverPaySort(key) {
    setDriverPaySort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }

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
  function toggleSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }

  const nounSingular = dimension === 'truck' ? 'truck' : 'driver'

  return (
    <div className="space-y-4">
      <IdleWarningBubble />
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profit Contribution</h1>
        <p className="text-sm text-gray-700 dark:text-slate-500 mt-0.5">
          {viewMode === 'driver-pay'
            ? 'Estimated driver pay vs. what the company keeps on each driver’s linehaul revenue.'
            : `What each ${nounSingular} leaves behind after its equipment carrying cost — money-losers flagged.`}
          <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 align-middle whitespace-nowrap" title="Driver pay, fuel, and insurance aren't all in BUDDY yet, so this is a partial margin — not net profit.">
            {viewMode === 'driver-pay' ? 'Estimate — fuel & equipment not included. Not net profit.' : 'Partial — driver pay & fuel pending. Not net profit.'}
          </span>
        </p>
      </div>

      {/* ── Controls: view · dimension · filter · period · basis ── */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center flex-wrap gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs shrink-0">
            {[['equipment', 'Equipment Contrib'], ['driver-pay', 'Est. Driver Pay'], ['company-net', 'Company Net']].map(([k, lbl]) => (
              <button key={k} onClick={() => setViewMode(k)} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${viewMode === k ? 'bg-blue-500 text-white font-semibold' : 'text-gray-700 dark:text-slate-400'}`}>{lbl}</button>
            ))}
          </div>
          {viewMode === 'equipment' && (
            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs shrink-0">
              {[['truck', 'By truck'], ['driver', 'By driver']].map(([k, lbl]) => (
                <button key={k} onClick={() => setDimension(k)} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${dimension === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-700 dark:text-slate-400'}`}>{lbl}</button>
              ))}
            </div>
          )}
          {viewMode === 'equipment' && (
            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs shrink-0">
              {[['all', 'All'], ['company', 'Company'], ['driver_owned', 'Owner-op']].map(([k, lbl]) => (
                <button key={k} onClick={() => setOwnershipFilter(k)} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${ownershipFilter === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-700 dark:text-slate-400'}`}>{lbl}</button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Filter ${nounSingular}s…`}
            className={`${S.input} w-44 text-xs`}
          />
        </div>
        <div className="flex flex-col gap-1.5 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => shiftRange(-1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Previous period">◀</button>
            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs shrink-0">
              {[['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, lbl]) => (
                <button key={k} onClick={() => setPresetRange(k)} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${preset === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-700 dark:text-slate-400'}`}>{lbl}</button>
              ))}
            </div>
            <button onClick={() => shiftRange(1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Next period">▶</button>
            <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs shrink-0">
              <button onClick={() => setBasis('delivery')} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${basis === 'delivery' ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>By delivery</button>
              <button onClick={() => setBasis('pickup')} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${basis === 'pickup' ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>By pickup</button>
            </div>
            {preset === 'custom' && (
              <>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                <span className="text-gray-600 text-xs shrink-0">→</span>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
              </>
            )}
          </div>
          <p className="text-[11px] text-gray-600 dark:text-slate-500">{PRESET_LABEL[preset]} · {formatRange(range.from, range.to)} · by {basis} date</p>
        </div>
      </div>

      {/* ── Fleet totals strip (equipment + driver-pay modes) ── */}
      {viewMode !== 'company-net' && (<>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Realized revenue', value: fmtMoney(totals.revenue), tone: '' },
          { label: '− Equipment cost', value: fmtSignedMoney(-totals.equipCost), tone: 'text-amber-600 dark:text-amber-400' },
          { label: '− Purchase deductions', value: fmtSignedMoney(-totals.purchase), tone: 'text-fuchsia-600 dark:text-fuchsia-400' },
          { label: '= Fleet contribution', value: fmtSignedMoney(totals.contribution), tone: totals.contribution >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400', big: true },
          { label: `Negative ${nounSingular}s`, value: loading ? '—' : String(totals.negatives), tone: totals.negatives > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400', clickable: true },
        ].map(c => (
          <div key={c.label} className={`${S.card} px-4 py-3 ${c.big ? 'ring-1 ring-orange-500/30' : ''} ${c.clickable ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} ${c.clickable && negativeFilter ? 'ring-2 ring-rose-500/50' : ''}`} onClick={() => c.clickable && setNegativeFilter(!negativeFilter)}>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">{c.label}</div>
            <div className={`mt-0.5 font-mono font-bold ${c.big ? 'text-xl' : 'text-lg'} ${c.tone || 'text-gray-900 dark:text-white'} flex items-center justify-between`}>
              <span>{loading ? '…' : c.value}</span>
              {c.clickable && negativeFilter && <span className="text-xs text-gray-600 dark:text-slate-500 font-normal ml-2">✕</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-600 dark:text-slate-500 -mt-1 space-y-1">
        <div>
          Contribution = realized revenue − equipment carrying cost (monthly cost × {data ? data.days : '…'} days ÷ 30.44) − truck-purchase deduction.
          Coming next on the road to net margin: fuel · insurance. Driver pay is estimated on the Est. Driver Pay toggle.
        </div>
        <div className="text-amber-700 dark:text-amber-400">
          <strong>On this equipment view, owner-operator contribution is gross of the driver's share,</strong> so it reads high. Use the <strong>Est. Driver Pay toggle</strong> or <strong>Profitability → Est. vs Act.</strong> for the driver-pay-adjusted read.
        </div>
      </p>
      </>)}

      {/* ── Company Net (combined contribution) ── */}
      {viewMode === 'company-net' && (
        <ErrorBoundary label="the Company Net view">
          <CompanyNetView key={`${range.from}|${range.to}|${basis}`} from={range.from} to={range.to} basis={basis} query={query} />
        </ErrorBoundary>
      )}

      {/* ── Equipment Contribution Table ── */}
      {viewMode === 'equipment' && (
        <div className={`${S.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={`${S.th} w-10`} title="Rank in the current sort order">#</th>
                  <th
                    className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`}
                    onClick={() => toggleSort('name')}
                    title="Sort alphabetically"
                  >
                    {dimension === 'truck' ? 'Truck · driver' : 'Driver · trucks'}{sort.key === 'name' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className={`${S.th} text-right cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => toggleSort(c.key)} title={c.tip}>
                      {c.label}{sort.key === c.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-500 animate-pulse">Crunching the leaderboard…</td></tr>
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-500">No {nounSingular}s with activity or carrying cost in this window.</td></tr>
                ) : sorted.map((r, i) => {
                  const negative = r.contribution < 0
                  const expanded = expandedId === r.id
                  return (
                    <FragmentRow
                      key={r.id}
                      row={r} rank={i + 1} negative={negative} expanded={expanded}
                      onToggle={() => setExpandState({ key: dataKey, id: expanded ? null : r.id })}
                      days={data.days} dimension={dimension}
                    />
                  )
                })}
              </tbody>
              {!loading && sorted.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-white/15 bg-gray-50 dark:bg-white/[0.02] font-semibold">
                    <td className={S.td} />
                    <td className={`${S.td} text-gray-700 dark:text-slate-200`}><span className="uppercase tracking-wide">Total</span> · {sorted.length} {nounSingular}s</td>
                    <td className={`${S.td} text-right font-mono`}>{fmtMoney(totals.revenue)}</td>
                    <td className={`${S.td} text-right font-mono text-amber-600 dark:text-amber-400`}>{fmtSignedMoney(-totals.equipCost)}</td>
                    <td className={`${S.td} text-right font-mono text-fuchsia-600 dark:text-fuchsia-400`}>{fmtSignedMoney(-totals.purchase)}</td>
                    <td className={`${S.td} text-right font-mono ${totals.contribution >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtSignedMoney(totals.contribution)}</td>
                    <td className={`${S.td} text-right font-mono`}>{fmtCpm(totals.cpm)}</td>
                    <td className={S.td} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── Estimated Driver Contribution Table ── */}
      {viewMode === 'driver-pay' && (
        <div>
          {/* Fleet totals strip for driver pay */}
          {driverPayTotals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total loads', value: fmtNum(driverPayTotals.loads), tone: '' },
                { label: 'Linehaul revenue', value: fmtMoney(driverPayTotals.linehaul), tone: '' },
                { label: 'Est. driver pay', value: fmtMoney(driverPayTotals.estDriverPay), tone: 'text-blue-600 dark:text-blue-400' },
                { label: 'Est. company earn', value: fmtMoney(driverPayTotals.estCompanyContribution), tone: 'text-emerald-600 dark:text-emerald-400', big: true },
              ].map(c => (
                <div key={c.label} className={`${S.card} px-4 py-3 ${c.big ? 'ring-1 ring-blue-500/30' : ''}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">{c.label}</div>
                  <div className={`mt-0.5 font-mono font-bold ${c.big ? 'text-xl' : 'text-lg'} ${c.tone || 'text-gray-900 dark:text-white'}`}>
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={`${S.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={S.tableHead}>
                  <tr>
                    <th className={`${S.th} w-10`} title="Rank in the current sort order">#</th>
                    <th
                      className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`}
                      onClick={() => toggleDriverPaySort('driver_name')}
                      title="Sort alphabetically"
                    >
                      Driver · type{driverPaySort.key === 'driver_name' ? (driverPaySort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                    {DRIVER_PAY_COLUMNS.map(c => (
                      <th key={c.key} className={`${S.th} text-right cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => toggleDriverPaySort(c.key)} title={c.tip}>
                        {c.label}{driverPaySort.key === c.key ? (driverPaySort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!driverPayData ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-500 animate-pulse">Loading driver pay estimates…</td></tr>
                  ) : driverPayData.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-500">No drivers with loads in this window.</td></tr>
                  ) : driverPaySorted.map((d, i) => (
                    <tr key={d.driver_id} className="border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                      <td className={`${S.td} font-mono text-gray-400 dark:text-slate-500 text-xs`}>{i + 1}</td>
                      <td className={`${S.td} font-medium`}>
                        <div className="text-gray-900 dark:text-slate-200 inline-flex items-center gap-1.5">
                          {d.team_id && <TeamIcon />}
                          {d.driver_name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {d.driver_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">{d.driver_type}</span>}
                          {d.has_contract && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">Contract rules TBD</span>}
                          {d.has_missing_comp && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">⚠ Needs rate</span>}
                        </div>
                      </td>
                      <td className={`${S.td} text-right font-mono`}>{fmtNum(d.loads)}</td>
                      <td className={`${S.td} text-right font-mono`}>{fmtMoney(d.linehaul_revenue)}</td>
                      <td className={`${S.td} text-right font-mono text-blue-600 dark:text-blue-400`}>{d.has_missing_comp ? '—' : fmtMoney(d.est_driver_pay)}</td>
                      <td className={`${S.td} text-right font-mono ${d.has_contract ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{d.has_contract ? 'TBD' : fmtMoney(d.est_company_contribution)}</td>
                    </tr>
                  ))}
                </tbody>
                {driverPayData && driverPaySorted.length > 0 && driverPayTotals && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 dark:border-white/15 bg-gray-50 dark:bg-white/[0.02] font-semibold">
                      <td className={S.td} />
                      <td className={`${S.td} text-gray-700 dark:text-slate-200`}><span className="uppercase tracking-wide">Total</span> · {driverPaySorted.length} drivers</td>
                      <td className={`${S.td} text-right font-mono`}>{fmtNum(driverPayTotals.loads)}</td>
                      <td className={`${S.td} text-right font-mono`}>{fmtMoney(driverPayTotals.linehaul)}</td>
                      <td className={`${S.td} text-right font-mono text-blue-600 dark:text-blue-400`}>{fmtMoney(driverPayTotals.estDriverPay)}</td>
                      <td className={`${S.td} text-right font-mono text-emerald-600 dark:text-emerald-400`}>{fmtMoney(driverPayTotals.estCompanyContribution)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-3 -mb-1 px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10">
            <strong>Estimated driver contribution</strong> = service charge (owner-op) or revenue − estimated driver pay (company driver). Driver pay is estimated from compensation rate. Fuel, tolls, and equipment costs are not included yet — this is partial contribution, not net profit.
          </p>
        </div>
      )}

      {/* ── Honesty footer ── */}
      <div className="text-[11px] text-gray-600 dark:text-slate-500 space-y-1 max-w-4xl">
        {data && data.unassigned.revenue > 0 && (
          <p>
            {fmtMoney(data.unassigned.revenue)} of realized revenue ({fmtNum(data.unassigned.miles)} mi) in this window
            has no {nounSingular} assigned in the TMS and is not in the table or totals above.
          </p>
        )}
        {data && data.unattributed.count > 0 && (
          <p>
            {data.unattributed.count} purchase payment{data.unattributed.count > 1 ? 's' : ''} ({fmtMoney(data.unattributed.amount)}) due in this
            window couldn&apos;t be tied to a listed {nounSingular} and are excluded from the totals above.
          </p>
        )}
        {!loading && totals.unknownUnits > 0 && (
          <p>{totals.unknownUnits} unit{totals.unknownUnits > 1 ? 's' : ''} have an unknown carrying cost (no loan or lease link) — their cost counts as $0 here and is flagged ⚠ on the row.</p>
        )}
        {dimension === 'truck' && <p>The truck view subtracts each truck&apos;s own carrying cost; trailer costs are attributed to drivers in the driver view.</p>}
        <p>
          Revenue, miles, equipment carrying cost, and purchase deductions are live BUDDY data. Driver pay is estimated on the Est. Driver Pay toggle and reconciled to actuals on Profitability → Est. vs Act. Fuel and insurance aren't connected yet, so true net margin is still pending.
        </p>
      </div>
    </div>
  )
}

// One leaderboard entry: the ranked row plus, when expanded, the waterfall
// detail row underneath it.
function FragmentRow({ row, rank, negative, expanded, onToggle, days, dimension }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`${S.tableRow} cursor-pointer ${negative ? 'bg-rose-50/60 dark:bg-rose-500/[0.06] hover:bg-rose-50 dark:hover:bg-rose-500/[0.1]' : ''}`}
      >
        <td className={`${S.td} font-mono text-xs text-gray-600 dark:text-slate-500`}>{rank}</td>
        <td className={S.td}>
          <div className="flex items-center gap-2">
            <span className={`font-medium inline-flex items-center gap-1.5 ${negative ? 'text-rose-700 dark:text-rose-300' : 'text-gray-900 dark:text-slate-100'}`}>
              {row.team_id && <TeamIcon />}
              {row.name || '—'}
            </span>
            {row.ownershipStage === 'driver_owned' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 font-semibold whitespace-nowrap" title="Owner-operator: contribution is gross of driver settlement">
                owner-op
              </span>
            )}
            {row.ownershipStage && row.ownershipStage !== 'driver_owned' && row.ownershipStage !== 'unknown' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400 font-semibold whitespace-nowrap">
                company
              </span>
            )}
            {negative && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 font-semibold whitespace-nowrap" title="Loses money before driver pay & fuel are even counted">
                losing money
              </span>
            )}
            {row.loads === 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-slate-500/10 text-gray-700 dark:text-slate-400 whitespace-nowrap">no loads</span>
            )}
            {row.status && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 whitespace-nowrap">{row.status}</span>
            )}
            {row.unknownUnits > 0 && <span title={`${row.unknownUnits} unit(s) with unknown carrying cost`} className="text-amber-500 text-xs">⚠</span>}
          </div>
          {row.sub && <div className="text-[11px] text-gray-600 dark:text-slate-500 mt-0.5">{row.sub}</div>}
        </td>
        <td className={`${S.td} text-right font-mono text-gray-700 dark:text-slate-200`}>{fmtMoney(row.revenue)}</td>
        <td className={`${S.td} text-right font-mono text-amber-600 dark:text-amber-400`}>{row.equipCost > 0 ? fmtSignedMoney(-row.equipCost) : '$0'}</td>
        <td className={`${S.td} text-right font-mono text-fuchsia-600 dark:text-fuchsia-400`}>{row.purchase > 0 ? fmtSignedMoney(-row.purchase) : '—'}</td>
        <td className={`${S.td} text-right font-mono font-semibold ${negative ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{fmtSignedMoney(row.contribution)}</td>
        <td className={`${S.td} text-right font-mono ${row.cpm != null && row.cpm < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-600 dark:text-slate-300'}`}>{fmtCpm(row.cpm)}</td>
        <td className={`${S.td} text-right font-mono text-gray-600 dark:text-slate-300`}>{fmtPct(row.util)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-200 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.015]">
          <td colSpan={8} className="p-0"><RowDetail row={row} days={days} dimension={dimension} /></td>
        </tr>
      )}
    </>
  )
}

// ── Company Net mode: Revenue − Equipment (truck+trailer) − Driver Pay ──────
// Self-contained: fetches driver_contribution_inputs, computes equipment
// (reusing the shared proration) + driver pay (shared comp branches), sorts,
// totals, and lazy-loads per-driver loads on accordion expand.
const NET_FLAG_TONE = {
  info:  'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400',
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
  red:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
}

function payBasisText(d) {
  // A team's pay is the fanned-out unit total; the primary's single-comp formula
  // would undercount, so show a unit caption instead of "rate × miles".
  if (d.team_id) return 'team pay · both drivers (unit total)'
  const v = Number(d.comp_value)
  if (d.comp_type === 'rate_per_mile') return `rate_per_mile $${v.toFixed(2)} × ${fmtNum(d.miles)} mi`
  if (d.comp_type === 'rate_pct') return `${v}% of revenue`
  if (d.comp_type === 'service_charge_pct') return `${v}% service charge → driver keeps ${100 - v}%`
  if (d.comp_type === 'flat_rate') {
    // Weekly salary; the pay figure is the prorated total. Show a derived $/mi
    // for comparison (≈), since the driver isn't actually paid per mile.
    const derived = d.miles > 0 && Number.isFinite(d.driverPay) ? ` · ≈ $${(d.driverPay / d.miles).toFixed(2)}/mi` : ''
    return `$${v.toLocaleString('en-US')} / wk · salary${derived}`
  }
  return 'comp rate missing'
}

function CompanyNetView({ from, to, basis, query }) {
  const [state, setState] = useState({ key: null, data: null })
  const [sort, setSort] = useState({ key: 'companyNet', dir: 'desc' })
  const [expandId, setExpandId] = useState(null)
  const [loadsByDriver, setLoadsByDriver] = useState({}) // driver_id → { loading, rows }

  // Period/basis changes remount this component (key in the parent), so state
  // starts fresh and this effect just fetches — no synchronous reset needed,
  // and the per-driver loads cache below can't go stale across periods.
  const key = `${from}|${to}|${basis}`
  useEffect(() => {
    let stale = false
    supabase.rpc('driver_contribution_inputs', { p_from: from, p_to: to, p_basis: basis })
      .then(({ data, error }) => { if (!stale) setState({ key, data: error ? [] : (data || []) }) })
      .catch(() => { if (!stale) setState({ key, data: [] }) })
    return () => { stale = true }
  }, [key, from, to, basis])

  const loading = state.key !== key
  const days = spanDays(from, to)

  const rows = useMemo(() => {
    if (!state.data) return []
    const q = query.trim().toLowerCase()
    return state.data.map(d => {
      const truckOwned = d.truck_stage === 'driver_owned'
      const trailerOwned = d.trailer_stage === 'driver_owned'
      const truckCost = truckOwned ? 0 : prorateUnitCost({ monthly: d.truck_monthly, weekly: d.truck_weekly, permile: d.truck_permile }, { days, miles: d.miles })
      const trailerCost = trailerOwned ? 0 : prorateUnitCost({ monthly: d.trailer_monthly, weekly: d.trailer_weekly, permile: d.trailer_permile }, { days, miles: d.miles })
      const equipment = truckCost + trailerCost
      const revenue = Number(d.revenue) || 0
      // Team-aware precomputed pay: per-mile/flat teams already fanned out to
      // both drivers, percentage/owner-op collapsed to one pool. Replaces the
      // old client-side revenue×comp% / miles×rate off the primary's single comp.
      const pay = Number(d.est_unit_driver_pay) || 0
      const missing = !KNOWN_COMP.has(d.comp_type)
      const companyNet = revenue - equipment - pay
      const netPct = revenue > 0 ? companyNet / revenue : null

      const truckCostMissing = d.has_truck && !truckOwned && d.truck_monthly == null && d.truck_weekly == null && d.truck_permile == null
      const trailerCostMissing = d.has_trailer && !trailerOwned && d.trailer_monthly == null && d.trailer_weekly == null && d.trailer_permile == null
      const flags = []
      if (truckOwned) flags.push({ label: 'driver-owned truck — $0', tone: 'info' })
      if (trailerOwned) flags.push({ label: 'driver-owned trailer — $0', tone: 'info' })
      if (truckCostMissing) flags.push({ label: 'truck cost missing', tone: 'red' })
      if (trailerCostMissing) flags.push({ label: 'trailer used, cost missing', tone: 'red' })
      if (!d.has_truck) flags.push({ label: 'no truck — equipment not counted', tone: 'red' })
      if (!d.has_trailer) flags.push({ label: 'no trailer assigned', tone: 'amber' })
      if (missing) flags.push({ label: 'driver pay missing', tone: 'red' })

      return { ...d, revenue, truckCost, trailerCost, equipment, driverPay: pay, payMissing: missing, companyNet, netPct, flags }
    }).filter(r => !q || (r.driver_name || '').toLowerCase().includes(q))
  }, [state.data, query, days])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.key === 'name') return [...rows].sort((a, b) => (a.driver_name || '').localeCompare(b.driver_name || '') * dir)
    const col = COMPANY_NET_COLUMNS.find(c => c.key === sort.key) || COMPANY_NET_COLUMNS[3]
    return [...rows].sort((a, b) => {
      const av = col.num(a), bv = col.num(b)
      const na = Number.isFinite(av) ? av : -Infinity
      const nb = Number.isFinite(bv) ? bv : -Infinity
      if (na === nb) return 0
      return (na - nb) * dir
    })
  }, [rows, sort])

  const totals = useMemo(() => {
    const t = { revenue: 0, equipment: 0, driverPay: 0, companyNet: 0 }
    for (const r of rows) { t.revenue += r.revenue; t.equipment += r.equipment; t.driverPay += r.driverPay; t.companyNet += r.companyNet }
    t.netPct = t.revenue > 0 ? t.companyNet / t.revenue : null
    return t
  }, [rows])

  function toggleSort(k) { setSort(s => (s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' })) }

  async function toggleExpand(driverId) {
    if (expandId === driverId) { setExpandId(null); return }
    setExpandId(driverId)
    if (!loadsByDriver[driverId]) {
      setLoadsByDriver(m => ({ ...m, [driverId]: { loading: true, rows: [] } }))
      try {
        const { data, error } = await supabase.rpc('driver_period_loads', { p_driver_id: driverId, p_from: from, p_to: to, p_basis: basis })
        setLoadsByDriver(m => ({ ...m, [driverId]: { loading: false, rows: error ? [] : (data || []) } }))
      } catch {
        setLoadsByDriver(m => ({ ...m, [driverId]: { loading: false, rows: [] } }))
      }
    }
  }

  const arrow = (k) => (sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '')

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenue', value: fmtMoney(totals.revenue), tone: '' },
          { label: '− Equipment', value: fmtSignedMoney(-totals.equipment), tone: 'text-amber-600 dark:text-amber-400' },
          { label: '− Driver pay', value: fmtSignedMoney(-totals.driverPay), tone: 'text-blue-600 dark:text-blue-400' },
          { label: '= Company Net', value: `${fmtSignedMoney(totals.companyNet)} · ${fmtPct(totals.netPct)}`, tone: totals.companyNet >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400', big: true },
        ].map(c => (
          <div key={c.label} className={`${S.card} px-4 py-3 ${c.big ? 'ring-1 ring-teal-500/30' : ''}`}>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">{c.label}</div>
            <div className={`mt-0.5 font-mono font-bold ${c.big ? 'text-xl' : 'text-lg'} ${c.tone || 'text-gray-900 dark:text-white'}`}>{loading ? '…' : c.value}</div>
          </div>
        ))}
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <th className={`${S.th} w-10`} title="Rank in the current sort order">#</th>
                <th className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => toggleSort('name')} title="Sort alphabetically">Driver{arrow('name')}</th>
                {COMPANY_NET_COLUMNS.map(c => (
                  <th key={c.key} className={`${S.th} text-right cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => toggleSort(c.key)} title={c.tip}>
                    {c.label}{arrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-500 animate-pulse">Crunching company net…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-slate-500">No revenue-bearing drivers in this window.</td></tr>
              ) : sorted.map((r, i) => {
                const expanded = expandId === r.driver_id
                const net = r.companyNet
                return (
                  <CompanyNetRow
                    key={r.driver_id}
                    row={r} rank={i + 1} expanded={expanded} net={net}
                    onToggle={() => toggleExpand(r.driver_id)}
                    loadsState={loadsByDriver[r.driver_id]}
                    days={days}
                  />
                )
              })}
            </tbody>
            {!loading && sorted.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 dark:border-white/15 bg-gray-50 dark:bg-white/[0.02] font-semibold">
                  <td className={S.td} />
                  <td className={`${S.td} text-gray-700 dark:text-slate-200`}><span className="uppercase tracking-wide">Total</span> · {sorted.length} drivers</td>
                  <td className={`${S.td} text-right font-mono`}>{fmtMoney(totals.revenue)}</td>
                  <td className={`${S.td} text-right font-mono text-amber-600 dark:text-amber-400`}>{fmtSignedMoney(-totals.equipment)}</td>
                  <td className={`${S.td} text-right font-mono text-blue-600 dark:text-blue-400`}>{fmtSignedMoney(-totals.driverPay)}</td>
                  <td className={`${S.td} text-right font-mono ${totals.companyNet >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtSignedMoney(totals.companyNet)} <span className="text-gray-500 dark:text-slate-400">· {fmtPct(totals.netPct)}</span></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-[11px] text-teal-700 dark:text-teal-400 px-4 py-2 rounded-lg bg-teal-50 dark:bg-teal-500/10">
        <strong>Company Net</strong> = revenue − equipment (truck + trailer, prorated) − estimated driver pay. Fuel, insurance & repairs aren&apos;t in BUDDY yet, so this is the closest read to net — not final net profit. Driver pay is estimated from the comp rate.
      </p>
    </div>
  )
}

// Team-unit glyph (users) — marks a collapsed team row (shared equipment counted
// once). Name already reads as the team.
function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-slate-500" aria-label="Team">
      <path d="M17 20h5v-2a3 3 0 0 0-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 0 1 5.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 0 1 9.288 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CompanyNetRow({ row, rank, expanded, net, onToggle, loadsState, days }) {
  return (
    <>
      <tr onClick={onToggle} className={`${S.tableRow} cursor-pointer`}>
        <td className={`${S.td} font-mono text-xs text-gray-600 dark:text-slate-500`}>{rank}</td>
        <td className={S.td}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 dark:text-slate-100 inline-flex items-center gap-1.5">
              {row.team_id && <TeamIcon />}
              {row.driver_name || '—'}
            </span>
            {row.driver_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400 whitespace-nowrap">{row.driver_type}</span>}
            {row.flags.map((f, i) => (
              <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${NET_FLAG_TONE[f.tone]}`}>{f.label}</span>
            ))}
          </div>
        </td>
        <td className={`${S.td} text-right font-mono text-gray-700 dark:text-slate-200`}>{fmtMoney(row.revenue)}</td>
        <td className={`${S.td} text-right font-mono text-amber-600 dark:text-amber-400`}>{row.equipment > 0 ? fmtSignedMoney(-row.equipment) : '$0'}</td>
        <td className={`${S.td} text-right font-mono text-blue-600 dark:text-blue-400`}>{row.payMissing ? '—' : fmtSignedMoney(-row.driverPay)}</td>
        <td className={`${S.td} text-right font-mono font-semibold ${net >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {fmtSignedMoney(net)} <span className="text-gray-500 dark:text-slate-400 font-normal">· {fmtPct(row.netPct)}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-200 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.015]">
          <td colSpan={6} className="p-0">
            <CompanyNetDetail row={row} loadsState={loadsState} days={days} />
          </td>
        </tr>
      )}
    </>
  )
}

function CompanyNetDetail({ row, loadsState, days }) {
  const all = loadsState?.rows || []
  const top = all.slice(0, 5)
  const moreCount = Math.max(0, all.length - top.length)
  const loadsSum = all.reduce((s, l) => s + (Number(l.revenue) || 0), 0)
  return (
    <div className="px-4 py-4 grid md:grid-cols-2 gap-x-8 gap-y-4 text-xs text-gray-700 dark:text-slate-400">
      {/* Loads driving revenue */}
      <div>
        <div className="font-semibold text-gray-600 dark:text-slate-300 mb-1">Loads driving revenue</div>
        {loadsState?.loading ? (
          <div className="animate-pulse text-gray-500 dark:text-slate-500">Loading loads…</div>
        ) : all.length === 0 ? (
          <div className="text-gray-500 dark:text-slate-500">No loads found.</div>
        ) : (
          <div className="space-y-0.5 font-mono">
            {top.map((l, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-28">{l.load_number}</span>
                <span className="w-20 text-gray-500 dark:text-slate-500">{l.load_date || '—'}</span>
                <span className="w-20 text-right">{fmtMoney(l.revenue)}</span>
                <span className="w-16 text-right text-gray-500 dark:text-slate-500">{fmtNum(l.miles)} mi</span>
              </div>
            ))}
            {moreCount > 0 && <div className="text-gray-500 dark:text-slate-500">…{moreCount} more load{moreCount > 1 ? 's' : ''}</div>}
            <div className="flex items-center gap-3 pt-1 mt-1 border-t border-gray-200 dark:border-white/10 font-semibold text-gray-700 dark:text-slate-200">
              <span className="w-28">Total</span>
              <span className="w-20" />
              <span className="w-20 text-right">{fmtMoney(loadsSum)}</span>
              <span className="w-16" />
            </div>
          </div>
        )}
      </div>

      {/* Cost breakdown */}
      <div className="space-y-2">
        <div>
          <div className="font-semibold text-gray-600 dark:text-slate-300 mb-1">Cost breakdown ({days}-day window)</div>
          <div className="space-y-0.5 font-mono">
            <div className="flex items-center gap-2">
              <span className="w-16 font-sans text-gray-600 dark:text-slate-500">Truck</span>
              <span className="w-24">{row.truck_unit || '—'}</span>
              <span className="font-sans text-gray-500 dark:text-slate-500">{row.truck_stage || '—'}</span>
              <span className="ml-auto text-right">{row.truck_stage === 'driver_owned' ? '$0 · driver-owned' : fmtSignedMoney(-row.truckCost)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 font-sans text-gray-600 dark:text-slate-500">Trailer</span>
              <span className="w-24">{row.trailer_unit || '—'}</span>
              <span className="font-sans text-gray-500 dark:text-slate-500">{row.trailer_stage || (row.has_trailer ? '—' : 'none')}</span>
              <span className="ml-auto text-right">{row.trailer_stage === 'driver_owned' ? '$0 · driver-owned' : fmtSignedMoney(-row.trailerCost)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 font-sans text-gray-600 dark:text-slate-500">Driver pay</span>
              <span className="font-sans text-gray-500 dark:text-slate-500">{payBasisText(row)}</span>
              <span className="ml-auto text-right">{row.payMissing ? '—' : fmtSignedMoney(-row.driverPay)}</span>
            </div>
          </div>
        </div>
        <Link to="/fleet/profitability/spotlight" className="inline-block text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline">
          View in Driver Spotlight →
        </Link>
      </div>
    </div>
  )
}
