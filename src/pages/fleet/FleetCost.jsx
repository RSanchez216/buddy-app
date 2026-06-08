import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import { StagePill } from './fleetUtils'
import Select from '../../components/Select'

// Per-unit carrying-cost view. Reads from the public.fleet_equipment_cost
// SQL view (single source of truth for the cost split: loan / owned
// outright / owned no loan / lease / driver_owned / unknown). Vendor +
// loan info is hydrated client-side so the view stays trim.
//
// Header cards show fleet-wide totals + the "needs cost" worklist count
// (lease without lease_cost + owned_no_loan). The same set sits behind
// the Needs cost filter pill — Rebeca's permanent in-app worklist.

const COST_SOURCE_META = {
  loan:           { label: 'Loan',           dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  owned_outright: { label: 'Owned outright', dot: 'bg-slate-400',   text: 'text-slate-600 dark:text-slate-300'    },
  owned_no_loan:  { label: 'Owned, no loan', dot: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-400'    },
  lease:          { label: 'Lease',          dot: 'bg-cyan-500',    text: 'text-cyan-700 dark:text-cyan-400'      },
  driver_owned:   { label: 'Driver owned',   dot: 'bg-violet-400',  text: 'text-violet-700 dark:text-violet-400'  },
  unknown:        { label: 'Unknown',        dot: 'bg-red-500',     text: 'text-red-700 dark:text-red-400'        },
}

const FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'needs_cost',  label: '⚠️ Needs cost', tooltip: "Cost-bearing units without a fixed cost entered yet — leased units missing a manual cost, or company-owned units with no linked loan." },
  { key: 'idle',        label: '⚠️ Idle (active · no driver)', tooltip: "Cost-bearing units that are active but have no current driver. Mark genuine yard/spare units Inactive to remove them from the idle total." },
  { key: 'loan',        label: 'Loan',           tooltip: "Financed: has an active loan in the Debt Schedule. Monthly cost auto-derives from the loan payment." },
  { key: 'lease',       label: 'Lease',          tooltip: "Rented from a lessor vendor. Cost entered manually (monthly or weekly)." },
  { key: 'owned_outright', label: 'Owned outright', tooltip: "Company-owned with the loan fully paid off — no payment remaining, so $0 carrying cost." },
  { key: 'owned_no_loan',  label: 'Owned, no loan', tooltip: "Company-owned but no matching loan found in the Debt Schedule. Cost unknown: either truly owned outright ($0) or the loan needs to be added/linked." },
  { key: 'driver_owned',   label: 'Driver owned',   tooltip: "Owned by the driver — no cost to MANAS." },
  { key: 'unknown',        label: 'Unknown',        tooltip: "Not yet classified." },
]

function fmtMoney(n) {
  if (n == null || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function needsCost(row) {
  return row.cost_source === 'owned_no_loan'
    || (row.cost_source === 'lease' && (row.monthly_cost == null))
}

// Cost-bearing = the categories that SHOULD have a cost (loan, lease,
// owned_outright, owned_no_loan). Driver-owned and unknown carry no
// company cost and don't belong in the "Units Costed" denominator —
// including them was making coverage look worse than it is.
const COST_BEARING_SOURCES = new Set(['loan', 'lease', 'owned_outright', 'owned_no_loan'])

// Cost-bearing, active, no current driver. The brief's "money sitting"
// definition — leased units missing a cost still count (they're real
// idle inventory; their monthly_cost may just not be entered yet),
// owned-no-loan likewise count toward the unit total. The dollar total
// only sums monthly_cost where it's known.
function isIdle(row) {
  return ['company_owned', 'company_leased'].includes(row.ownership_stage)
    && (row.operational_status || 'active') === 'active'
    && !row.has_current_driver
}

export default function FleetCost() {
  const { user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [vendorsById, setVendorsById] = useState(new Map())
  const [loansById, setLoansById] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  // Bulk action selection. Only used when the user is in the
  // 'owned_no_loan' filter — the brief's bulk Mark-outright is scoped
  // there. The Set is keyed `${etype}:${id}` to match the rendered row.
  const [selected, setSelected] = useState(() => new Set())
  const [marking, setMarking] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // all | truck | trailer

  useEffect(() => { load() }, [])
  // Reset selection whenever the filter or rowset shifts so a stale
  // checkbox-set from one filter can't leak into a bulk action on
  // another.
  useEffect(() => { setSelected(new Set()) }, [filter, rows])

  async function load() {
    setLoading(true)
    const [costRes, vendorsRes, loansRes] = await Promise.all([
      supabase.from('fleet_equipment_cost').select('*').order('etype').order('unit_number'),
      supabase.from('vendors').select('id, name'),
      supabase.from('loans').select('id, loan_id_external, contract_number, status'),
    ])
    setRows(costRes.data || [])
    setVendorsById(new Map((vendorsRes.data || []).map(v => [v.id, v])))
    setLoansById(new Map((loansRes.data || []).map(l => [l.id, l])))
    setLoading(false)
  }

  const sourceCounts = useMemo(() => {
    const c = { all: rows.length, needs_cost: 0, idle: 0 }
    for (const k of Object.keys(COST_SOURCE_META)) c[k] = 0
    for (const r of rows) {
      c[r.cost_source] = (c[r.cost_source] || 0) + 1
      if (needsCost(r)) c.needs_cost++
      if (isIdle(r))    c.idle++
    }
    return c
  }, [rows])

  const totals = useMemo(() => {
    let monthly = 0, weekly = 0, costedCount = 0, costBearingCount = 0
    for (const r of rows) {
      if (COST_BEARING_SOURCES.has(r.cost_source)) costBearingCount++
      if (r.monthly_cost != null) {
        monthly += Number(r.monthly_cost)
        weekly  += Number(r.weekly_cost || 0)
        costedCount++
      }
    }
    return { monthly, weekly, costedCount, costBearingCount, total: rows.length }
  }, [rows])

  // Idle-cost lens. Splits owned vs leased so it's clear what's
  // financed (cost MANAS is paying out anyway) vs rented (cost that
  // could be ended by returning the unit). monthly_cost may be NULL
  // for leased units missing a manual cost entry — counted in unit
  // total, omitted from dollar total.
  const idleTotals = useMemo(() => {
    const owned  = { units: 0, monthly: 0, weekly: 0, costed: 0, uncosted: 0 }
    const leased = { units: 0, monthly: 0, weekly: 0, costed: 0, uncosted: 0 }
    for (const r of rows) {
      if (!isIdle(r)) continue
      const bucket = r.ownership_stage === 'company_leased' ? leased : owned
      bucket.units++
      if (r.monthly_cost != null) {
        bucket.monthly += Number(r.monthly_cost)
        bucket.weekly  += Number(r.weekly_cost || 0)
        bucket.costed++
      } else {
        bucket.uncosted++
      }
    }
    return {
      owned, leased,
      units:   owned.units   + leased.units,
      monthly: owned.monthly + leased.monthly,
      weekly:  owned.weekly  + leased.weekly,
      uncosted: owned.uncosted + leased.uncosted,
    }
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows
    if      (filter === 'needs_cost') out = out.filter(needsCost)
    else if (filter === 'idle')       out = out.filter(isIdle)
    else if (filter !== 'all')        out = out.filter(r => r.cost_source === filter)
    if (typeFilter !== 'all')    out = out.filter(r => r.etype === typeFilter)
    if (q) {
      out = out.filter(r =>
        (r.unit_number || '').toLowerCase().includes(q)
        || (r.vin || '').toLowerCase().includes(q)
        || (vendorsById.get(r.lessor_vendor_id)?.name || '').toLowerCase().includes(q)
        || (loansById.get(r.loan_id)?.contract_number || '').toLowerCase().includes(q)
        || (loansById.get(r.loan_id)?.loan_id_external || '').toLowerCase().includes(q)
      )
    }
    return out
  }, [rows, filter, typeFilter, search, vendorsById, loansById])

  // Bulk action: flip selected rows' owned_outright -> true. Partitions
  // by etype so we issue at most two UPDATEs (one per table). The view's
  // precedence means a row will move from cost_source='owned_no_loan'
  // to 'owned_outright' on the next reload (or stay 'loan' if the user
  // also linked an active loan in the meantime — that's the correct
  // behavior; loan beats flag).
  async function markSelectedOutright() {
    if (selected.size === 0 || marking) return
    setMarking(true)
    const truckIds   = []
    const trailerIds = []
    for (const key of selected) {
      const [etype, id] = key.split(':')
      if (etype === 'truck')   truckIds.push(id)
      else if (etype === 'trailer') trailerIds.push(id)
    }
    const tasks = []
    const stamp = { owned_outright: true, updated_by: user?.id || null, updated_at: new Date().toISOString() }
    if (truckIds.length)   tasks.push(supabase.from('trucks').update(stamp).in('id', truckIds))
    if (trailerIds.length) tasks.push(supabase.from('trailers').update(stamp).in('id', trailerIds))
    const results = await Promise.all(tasks)
    setMarking(false)
    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      toast.error("Couldn't mark all selected as owned outright", failed[0].error)
    } else {
      toast.success(`${selected.size} unit${selected.size === 1 ? '' : 's'} marked Owned outright ($0)`)
    }
    setSelected(new Set())
    load()
  }

  function lenderLessorLabel(r) {
    if (r.cost_source === 'lease') {
      const v = vendorsById.get(r.lessor_vendor_id)
      return v
        ? <Link to="/vendors" className="text-orange-600 hover:underline" title="Open Vendor Master">{v.name}</Link>
        : <span className="italic text-amber-700 dark:text-amber-400">— (assign lessor)</span>
    }
    if (r.cost_source === 'loan' || r.cost_source === 'owned_outright') {
      const l = loansById.get(r.loan_id)
      if (!l) return '—'
      const label = l.contract_number || l.loan_id_external || l.id.slice(0, 8)
      return <Link to={`/financial-controls/debt-schedule/${l.id}`} className="text-orange-600 hover:underline">{label}</Link>
    }
    return '—'
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Equipment Cost</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Monthly + weekly carrying cost MANAS pays per unit. Loan cost auto-derives from
            active loans; lease cost is manual per unit.
          </p>
        </div>
      </div>

      {/* KPIs. 5 cards on wide screens — Total monthly / Total weekly /
          Units Costed / Needs cost / Idle Cost. Falls back to 2-col on
          mobile. The Idle Cost card is clickable and applies the Idle
          filter to the table below. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi label="Total monthly" value={fmtMoney(totals.monthly)} tone="emerald" />
        <Kpi label="Total weekly"  value={fmtMoney(totals.weekly)}  tone="cyan" />
        <Kpi
          label="Units Costed"
          value={`${totals.costedCount} / ${totals.costBearingCount} cost-bearing`}
          tone="slate"
          hint={totals.costBearingCount ? `${Math.round((totals.costedCount / totals.costBearingCount) * 100)}% coverage` : ''}
          titleAttr={
            'Cost-bearing = company-owned or leased units that should carry a cost. '
            + `Driver-owned units (${sourceCounts.driver_owned || 0}) have no cost to MANAS and are excluded. `
            + "'Needs cost' are the cost-bearing units still missing a value."
          }
        />
        <Kpi
          label="Needs cost"
          value={sourceCounts.needs_cost}
          tone="amber"
          hint="Click the ⚠️ filter →"
          onClick={() => setFilter('needs_cost')}
          titleAttr="Cost-bearing units without a fixed cost entered yet — leased units missing a manual cost, or owned units with no linked loan."
        />
        <Kpi
          label="Idle Cost"
          value={
            <span className="block">
              <span className="block">{fmtMoney(idleTotals.monthly)} <span className="text-[10px] font-normal text-gray-500 dark:text-slate-500">/ mo</span></span>
              <span className="block text-base">{fmtMoney(idleTotals.weekly)} <span className="text-[10px] font-normal text-gray-500 dark:text-slate-500">/ wk</span></span>
            </span>
          }
          tone="amber"
          hint={`Active, financed/leased, no driver — estimate if idle the full month. ${idleTotals.units} unit${idleTotals.units === 1 ? '' : 's'}.`}
          onClick={() => setFilter('idle')}
          titleAttr="Cost-bearing units that are active but have no current driver. Mark genuine yard/spare units Inactive to remove them from this total."
        />
      </div>

      {/* Filter pills */}
      <div className="flex items-center flex-wrap gap-2">
        {FILTERS.map(f => {
          const count = sourceCounts[f.key] ?? 0
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              title={f.tooltip}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                active
                  ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              {f.label} <span className="ml-1 opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-slate-500">
          Showing {visible.length} of {rows.length} unit{rows.length === 1 ? '' : 's'}
        </p>
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="text-xs">
            <option value="all">All types</option>
            <option value="truck">Trucks only</option>
            <option value="trailer">Trailers only</option>
          </Select>
          <input
            className={`${S.input} max-w-xs`}
            placeholder="Search unit, VIN, lessor, contract…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Bulk Mark-outright toolbar — only when 'Owned, no loan' is the
          active filter, per the brief's scope. Select-all checks every
          currently-visible row (respects type + search filters too). */}
      {filter === 'owned_no_loan' && (
        <div className={`${S.card} px-4 py-2.5 flex items-center justify-between flex-wrap gap-3`}>
          <div className="flex items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visible.length > 0 && visible.every(r => selected.has(`${r.etype}:${r.id}`))}
                onChange={e => {
                  if (e.target.checked) {
                    setSelected(new Set(visible.map(r => `${r.etype}:${r.id}`)))
                  } else {
                    setSelected(new Set())
                  }
                }}
                className="rounded"
              />
              <span className="text-gray-700 dark:text-slate-300">Select all visible ({visible.length})</span>
            </label>
            <span className="text-gray-500 dark:text-slate-400">
              {selected.size > 0 ? `${selected.size} selected` : 'Pick the units that are paid off / cash-owned'}
            </span>
          </div>
          <button
            type="button"
            onClick={markSelectedOutright}
            disabled={selected.size === 0 || marking}
            className={S.btnSave}
          >
            {marking ? 'Marking…' : `Mark ${selected.size} as owned outright ($0)`}
          </button>
        </div>
      )}

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {filter === 'owned_no_loan' && <th className={`${S.th} w-8`}></th>}
                <th className={`${S.th} min-w-[110px]`}>Unit</th>
                <th className={`${S.th} min-w-[70px]`}>Type</th>
                <th className={`${S.th} min-w-[170px]`}>Ownership</th>
                <th className={`${S.th} min-w-[140px]`}>Cost Source</th>
                <th className={`${S.th} text-right min-w-[120px]`}>Monthly</th>
                <th className={`${S.th} text-right min-w-[110px]`}>Weekly</th>
                <th
                  className={`${S.th} text-right min-w-[110px]`}
                  title="Lessor's per-mile charge (vendor side). Dollar total against mileage lands once Loads ingest provides per-unit miles."
                >
                  Per Mile
                </th>
                <th className={`${S.th} min-w-[200px]`}>Lender / Lessor</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={filter === 'owned_no_loan' ? 9 : 8} className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={filter === 'owned_no_loan' ? 9 : 8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No units match these filters.</td></tr>
              ) : visible.map(r => {
                const meta = COST_SOURCE_META[r.cost_source] || COST_SOURCE_META.unknown
                const isNeeds = needsCost(r)
                const k = `${r.etype}:${r.id}`
                return (
                  <tr key={k} className={`${S.tableRow} ${isNeeds ? 'bg-amber-50/30 dark:bg-amber-500/[0.03]' : ''}`}>
                    {filter === 'owned_no_loan' && (
                      <td className={S.td}>
                        <input
                          type="checkbox"
                          checked={selected.has(k)}
                          onChange={e => {
                            setSelected(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(k); else next.delete(k)
                              return next
                            })
                          }}
                          className="rounded"
                        />
                      </td>
                    )}
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                      <Link
                        to={`/fleet/${r.etype === 'truck' ? 'trucks' : 'trailers'}/${r.id}`}
                        className="hover:text-orange-600 dark:hover:text-orange-400"
                      >
                        {r.unit_number || '—'}
                      </Link>
                    </td>
                    <td className={`${S.td} text-xs uppercase tracking-wide text-gray-500 dark:text-slate-500`}>{r.etype}</td>
                    <td className={S.td}><StagePill stage={r.ownership_stage} /></td>
                    <td className={S.td}>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </td>
                    <td className={`${S.td} text-right font-mono ${r.monthly_cost == null ? 'text-amber-600 dark:text-amber-400 italic' : 'text-gray-900 dark:text-slate-200'}`}>
                      {r.monthly_cost == null ? 'needs entry' : fmtMoney(r.monthly_cost)}
                    </td>
                    <td className={`${S.td} text-right font-mono text-xs ${r.weekly_cost == null ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-600 dark:text-slate-400'}`}>
                      {r.weekly_cost == null ? '—' : fmtMoney(r.weekly_cost)}
                    </td>
                    <td className={`${S.td} text-right font-mono text-xs ${r.per_mile_rate == null ? 'text-gray-400 dark:text-slate-500' : 'text-gray-600 dark:text-slate-400'}`}>
                      {r.per_mile_rate == null
                        ? '—'
                        : `$${Number(r.per_mile_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
                    </td>
                    <td className={`${S.td} text-xs`}>{lenderLessorLabel(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone, hint, titleAttr, onClick }) {
  const toneClasses = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    cyan:    'text-cyan-700 dark:text-cyan-400',
    slate:   'text-gray-900 dark:text-slate-200',
    amber:   'text-amber-700 dark:text-amber-400',
  }[tone] || 'text-gray-900 dark:text-slate-200'
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      title={titleAttr}
      className={`${S.card} p-4 text-left w-full ${interactive ? 'hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer' : ''}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
        {label}
        {titleAttr && (
          <span
            className="ml-1 inline-flex items-center justify-center w-3 h-3 text-[8px] rounded-full border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 align-middle"
            aria-hidden
          >i</span>
        )}
      </p>
      <p className={`mt-1 text-2xl font-bold font-mono ${toneClasses}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{hint}</p>}
    </Tag>
  )
}
