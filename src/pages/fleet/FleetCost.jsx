import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import { StagePill } from './fleetUtils'
import Select from '../../components/Select'
import InfoIcon, { COST_PERIOD_TOOLTIP } from '../../components/InfoIcon'

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
  { key: 'needs_cost',  label: '⚠️ Needs cost', tooltip: "Owned or leased units that still need a cost. Click to see them." },
  { key: 'idle',        label: '⚠️ Idle (active · no driver)', tooltip: "What we pay each month for active trucks/trailers with no driver — money going out on equipment that isn't being used." },
  { key: 'loan',        label: 'Loan',           tooltip: "Has a loan — cost comes from the loan payment automatically." },
  { key: 'lease',       label: 'Lease',          tooltip: "Rented from a vendor — you enter the cost." },
  { key: 'owned_outright', label: 'Owned outright', tooltip: "Paid off / owned free and clear — $0 cost." },
  { key: 'owned_no_loan',  label: 'Owned, no loan', tooltip: "Owned, but no loan on file yet. Check each: if paid off, mark it Owned outright; if still financed, add its loan." },
  { key: 'driver_owned',   label: 'Driver owned',   tooltip: "The driver owns it — no cost to us." },
  { key: 'unknown',        label: 'Unknown',        tooltip: "Not yet classified." },
]

function fmtMoney(n) {
  if (n == null || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

// Whole-dollar money for the KPI cards — the cent-precise figures
// still live in the table cells. Keeps card values clean and visually
// uniform.
function fmtMoneyWhole(n) {
  if (n == null || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// Cost-bearing = the categories that SHOULD have a cost (loan, lease,
// owned_outright, owned_no_loan). Driver-owned and unknown carry no
// company cost and don't belong in the "Units Costed" denominator —
// including them was making coverage look worse than it is.
const COST_BEARING_SOURCES = new Set(['loan', 'lease', 'owned_outright', 'owned_no_loan'])

// Cost-bearing = a category that should carry a cost, MINUS total-loss
// units the lessor has stopped charging. A unit that's both written off
// (is_total_loss) AND no longer billed (lease_charge_active=false) has no
// cost obligation, so it must not inflate the coverage denominator or
// show up as "Needs cost". A totaled unit that's STILL charged stays
// cost-bearing (it should be costed). Owned units are unaffected —
// lease_charge_active is a no-op there; the loan answers "still paying".
function isCostBearing(row) {
  if (!COST_BEARING_SOURCES.has(row.cost_source)) return false
  return !(row.is_total_loss === true && row.lease_charge_active === false)
}

// Needs cost = any cost-bearing unit with no monthly cost yet, across
// every cost_source. This catches the easy-to-miss case of a loan unit
// whose per-unit split payment isn't populated in loan_equipment —
// without this, those units sit hidden inside "Loan" with no cost.
// Reconciles exactly with cost_bearing − costed.
function needsCost(row) {
  return isCostBearing(row) && row.monthly_cost == null
}

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
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [vendorsById, setVendorsById] = useState(new Map())
  const [loansById, setLoansById] = useState(new Map())
  const [loading, setLoading] = useState(true)
  // Filter / type / search live in the URL so the table state is
  // restorable on refresh and survives the round-trip into a unit's
  // edit page (the unit page navigates back here via `returnTo`).
  // Initial state hydrates from search params; setters write back so
  // the URL and the UI stay in sync.
  const [filter, setFilter] = useState(() => searchParams.get('filter') || 'all')
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get('type') || 'all')
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  // Bulk action selection. Only used when the user is in the
  // 'owned_no_loan' filter — the brief's bulk Mark-outright is scoped
  // there. The Set is keyed `${etype}:${id}` to match the rendered row.
  const [selected, setSelected] = useState(() => new Set())
  const [marking, setMarking] = useState(false)

  useEffect(() => { load() }, [])
  // Reset selection whenever the filter or rowset shifts so a stale
  // checkbox-set from one filter can't leak into a bulk action on
  // another.
  useEffect(() => { setSelected(new Set()) }, [filter, rows])

  // Mirror filter / type / search back to the URL on change. `replace`
  // keeps the browser history clean — repeated filter-flipping doesn't
  // pollute the Back button with intermediate states. The empty
  // defaults (all / all / '') are written as missing params so a
  // bare /fleet/cost URL stays bare.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (filter === 'all') next.delete('filter'); else next.set('filter', filter)
    if (typeFilter === 'all') next.delete('type'); else next.set('type', typeFilter)
    if (!search) next.delete('q'); else next.set('q', search)
    // Only call setSearchParams when the string actually shifted —
    // avoids a render loop with the dep array below.
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, typeFilter, search])

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

  // Lease units not yet linked to a tracked vendor. Surfaces when the
  // Lease filter is active so Rebeca can find the remaining ones to
  // alias or new-vendor. resolve_lessor_vendors() runs every weekly
  // import and only fills NULLs, so the count shrinks as aliases are
  // added without manual re-runs.
  const leaseUnlinkedCount = useMemo(
    () => rows.reduce((n, r) => n + (r.cost_source === 'lease' && !r.lessor_vendor_id ? 1 : 0), 0),
    [rows]
  )

  const totals = useMemo(() => {
    let monthly = 0, weekly = 0, costedCount = 0, costBearingCount = 0
    // Total-loss segment: written-off units we're STILL paying on
    // (monthly_cost survives because lease_charge_active is on, or it's an
    // owned unit on an active loan). Surfaced as a labeled sub-line under
    // the Total Carrying Cost figure so the "why is a totaled unit still
    // costing us" question is answered in place.
    let tlMonthly = 0, tlWeekly = 0, tlCount = 0
    for (const r of rows) {
      if (isCostBearing(r)) costBearingCount++
      if (r.monthly_cost != null) {
        monthly += Number(r.monthly_cost)
        weekly  += Number(r.weekly_cost || 0)
        costedCount++
        if (r.is_total_loss === true) {
          tlMonthly += Number(r.monthly_cost)
          tlWeekly  += Number(r.weekly_cost || 0)
          tlCount++
        }
      }
    }
    return {
      monthly, weekly, costedCount, costBearingCount, total: rows.length,
      totalLoss: { monthly: tlMonthly, weekly: tlWeekly, count: tlCount },
    }
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

  // Footer totals for whatever's currently filtered/searched — aggregates
  // the SAME `visible` array the table renders, so it tracks chip / type /
  // search changes live. Rows with no cost (monthly_cost == null:
  // "needs entry", driver-owned, unknown) are excluded from the sums AND
  // the average denominator. $0 units (owned-outright) have a non-null 0,
  // so they DO count as costed — they add $0 and pull the average down.
  // Per-mile isn't additive, so it's averaged over rows that have one.
  const visibleTotals = useMemo(() => {
    let monthly = 0, weekly = 0, costedCount = 0
    let pmSum = 0, pmCount = 0
    let penSum = 0, penCount = 0
    for (const r of visible) {
      if (r.monthly_cost != null) {
        monthly += Number(r.monthly_cost)
        weekly  += Number(r.weekly_cost || 0)
        costedCount++
      }
      if (r.per_mile_rate != null) {
        pmSum += Number(r.per_mile_rate)
        pmCount++
      }
      // Penalty/overage rate is a rate, not money — averaged over rows
      // that carry one, same as base per-mile. Omitted entirely when no
      // filtered row has a penalty rate.
      if (r.penalty_per_mile_rate != null) {
        penSum += Number(r.penalty_per_mile_rate)
        penCount++
      }
    }
    return {
      shownCount: visible.length,
      costedCount,
      monthly,
      weekly,
      avgMonthly: costedCount ? monthly / costedCount : null,
      avgPerMile: pmCount ? pmSum / pmCount : null,
      avgPenalty: penCount ? penSum / penCount : null,
    }
  }, [visible])

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

      {/* KPI row — 4 uniform cards. Each card uses the same shape:
          11px uppercase muted label (+ optional info icon) · 20px
          primary value · optional 13px secondary value (mo/wk) · 11px
          subtext. Whole-dollar rounding here; the table cells keep
          cent precision. */}
      {(() => {
        const coverage = totals.costBearingCount
          ? Math.round((totals.costedCount / totals.costBearingCount) * 100)
          : 0
        return (
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              label="Total carrying cost"
              tone="emerald"
              primary={`${fmtMoneyWhole(totals.monthly)} /mo`}
              secondary={`${fmtMoneyWhole(totals.weekly)} /wk`}
              subtext={`${totals.costedCount} costed unit${totals.costedCount === 1 ? '' : 's'}`}
              footnote={totals.totalLoss.count > 0 ? (
                <span
                  className="text-amber-700 dark:text-amber-400"
                  title="Lease/lease-purchase charges we're still paying on units written off as total losses (e.g., accident, insurance pending). These stay in the total until the lessor stops billing or the unit is paid off."
                >
                  Incl. {fmtMoneyWhole(totals.totalLoss.monthly)}/mo
                  {' '}({fmtMoneyWhole(totals.totalLoss.weekly)}/wk) from {totals.totalLoss.count}{' '}
                  total-loss unit{totals.totalLoss.count === 1 ? '' : 's'} still charged
                </span>
              ) : null}
            />
            <KpiCard
              label="Costed"
              tone="slate"
              titleAttr="How many owned or leased units have a cost set. Driver-owned units cost us nothing, so they're left out."
              primary={
                <span>
                  {totals.costedCount}
                  <span className="text-gray-400 dark:text-slate-500"> / {totals.costBearingCount}</span>
                </span>
              }
              subtext="cost-bearing units"
              progressPct={coverage}
              progressLabel={`${coverage}% covered`}
            />
            <KpiCard
              label="Needs cost"
              tone="amber"
              titleAttr="Owned or leased units that still need a cost. Click to see them."
              primary={sourceCounts.needs_cost}
              subtext="units missing a cost"
              action={{ label: 'View these →', onClick: () => setFilter('needs_cost') }}
            />
            <KpiCard
              label="Idle cost"
              tone="red"
              titleAttr="What we pay each month for active trucks/trailers with no driver — money going out on equipment that isn't being used."
              primary={`${fmtMoneyWhole(idleTotals.monthly)} /mo`}
              secondary={`${fmtMoneyWhole(idleTotals.weekly)} /wk`}
              subtext={`${idleTotals.units} active unit${idleTotals.units === 1 ? '' : 's'}, no driver`}
              onClick={() => setFilter('idle')}
            />
          </div>
        )
      })()}

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
        <p className="text-xs text-gray-500 dark:text-slate-500 flex items-center gap-2 flex-wrap">
          <span>Showing {visible.length} of {rows.length} unit{rows.length === 1 ? '' : 's'}</span>
          {filter === 'lease' && leaseUnlinkedCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20"
              title="Leased units whose Equipment Owner doesn't yet match a tracked vendor name or alias. Open each unit and pick a Lessor in the Lease Cost section — or add the raw owner as an alias on the corresponding vendor and re-run the next weekly import."
            >
              ⚠️ {leaseUnlinkedCount} unlinked to a vendor
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {/* min-w keeps the longest option ("Trailers only") + chevron
              from clipping to "All typ"; min- rather than fixed so it
              still flexes on narrow layouts. */}
          <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="text-xs min-w-[9rem]">
            <option value="all">All types</option>
            <option value="truck">Trucks only</option>
            <option value="trailer">Trailers only</option>
          </Select>
          {/* Clearable search. The × clears only the search text — the
              existing URL-sync effect drops ?q= when search is empty, so
              one click returns to the full set while any active chip /
              type filter stays put. */}
          <div className="relative max-w-xs">
            <input
              className={`${S.input} ${search ? 'pr-8' : ''}`}
              placeholder="Search unit, VIN, lessor, contract…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape' && search) setSearch('') }}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => setSearch('')}
                className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
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
                <th className={`${S.th} text-right min-w-[120px]`}>Monthly<InfoIcon tip={COST_PERIOD_TOOLTIP} /></th>
                <th className={`${S.th} text-right min-w-[110px]`}>Weekly<InfoIcon tip={COST_PERIOD_TOOLTIP} /></th>
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
                        // returnTo carries the current filtered URL via
                        // router state so the unit page can navigate
                        // back to this exact filtered view after the
                        // user saves or hits Back.
                        state={{ returnTo: location.pathname + location.search, returnLabel: 'Equipment Cost' }}
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
                      {/* Penalty/overage rate as a light secondary line —
                          reference only (miles-over-allowance bill), not a
                          total. Shown whenever the row carries a penalty
                          rate, even if base per-mile is blank. */}
                      {r.penalty_per_mile_rate != null && (
                        <span
                          className="block text-[10px] text-gray-400 dark:text-slate-500 leading-tight"
                          title="Overage rate billed on miles over the free mileage allowance — reference only until mileage arrives."
                        >
                          +${Number(r.penalty_per_mile_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} penalty
                        </span>
                      )}
                    </td>
                    <td className={`${S.td} text-xs`}>{lenderLessorLabel(r)}</td>
                  </tr>
                )
              })}
            </tbody>
            {/* Filtered totals — aggregates the visible set so it reads as
                "what this filter/lessor costs me." Sums skip uncosted rows;
                the average is over costed units only. Hidden while loading
                or when nothing matches. */}
            {!loading && visible.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.02] font-medium">
                  <td
                    className={`${S.td} text-xs text-gray-600 dark:text-slate-300`}
                    colSpan={filter === 'owned_no_loan' ? 5 : 4}
                  >
                    Totals · {visibleTotals.shownCount} unit{visibleTotals.shownCount === 1 ? '' : 's'}
                    {visibleTotals.costedCount < visibleTotals.shownCount && (
                      <span className="text-gray-400 dark:text-slate-500"> · {visibleTotals.costedCount} costed</span>
                    )}
                  </td>
                  <td className={`${S.td} text-right font-mono text-gray-900 dark:text-slate-200`}>
                    {fmtMoney(visibleTotals.monthly)} <span className="text-gray-400 dark:text-slate-500">/mo</span>
                    {visibleTotals.avgMonthly != null && (
                      <span className="block text-[11px] font-normal text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                        avg {fmtMoney(visibleTotals.avgMonthly)}/unit
                      </span>
                    )}
                  </td>
                  <td className={`${S.td} text-right font-mono text-xs text-gray-600 dark:text-slate-400 align-top`}>
                    {fmtMoney(visibleTotals.weekly)} <span className="text-gray-400 dark:text-slate-500">/wk</span>
                  </td>
                  <td className={`${S.td} text-right font-mono text-xs text-gray-600 dark:text-slate-400 align-top`}>
                    {visibleTotals.avgPerMile == null
                      ? '—'
                      : `$${visibleTotals.avgPerMile.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
                    {/* Penalty avg mirrors the per-row secondary line —
                        averaged across filtered rows that carry a penalty
                        rate, omitted when none do. */}
                    {visibleTotals.avgPenalty != null && (
                      <span className="block text-[10px] text-gray-400 dark:text-slate-500 leading-tight">
                        +${visibleTotals.avgPenalty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} penalty avg
                      </span>
                    )}
                  </td>
                  <td className={`${S.td} align-top`}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}

// Uniform KPI card for the Equipment Cost screen.
//   * label (uppercase, muted) + optional info-icon when titleAttr is set
//   * primary value (20px, accent-toned)
//   * optional secondary value below primary (13px, muted) — used for
//     "mo / wk" stacks on the dollar cards
//   * optional thin progress bar + companion progressLabel
//   * optional subtext (11px, muted)
//   * optional inline action link (e.g. "View these →") OR an onClick
//     on the whole card (mutually compatible; both render). Clickable
//     cards become buttons with hover background.
function KpiCard({
  label, tone, titleAttr,
  primary, secondary, subtext, footnote,
  progressPct, progressLabel,
  onClick, action,
}) {
  const toneClasses = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    cyan:    'text-cyan-700 dark:text-cyan-400',
    slate:   'text-gray-900 dark:text-slate-200',
    amber:   'text-amber-700 dark:text-amber-400',
    red:     'text-red-700 dark:text-red-400',
  }[tone] || 'text-gray-900 dark:text-slate-200'
  const progressTone = {
    emerald: 'bg-emerald-500',
    cyan:    'bg-cyan-500',
    slate:   'bg-gray-400 dark:bg-slate-500',
    amber:   'bg-amber-500',
    red:     'bg-red-500',
  }[tone] || 'bg-gray-400 dark:bg-slate-500'
  const interactive = typeof onClick === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      title={titleAttr}
      className={`${S.card} p-4 text-left w-full flex flex-col gap-1 ${interactive ? 'hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer' : ''}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400 leading-tight">
        {label}
        {titleAttr && (
          <span
            className="ml-1 inline-flex items-center justify-center w-3 h-3 text-[8px] rounded-full border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 align-middle"
            aria-hidden
          >i</span>
        )}
      </p>
      <p className={`text-xl font-medium font-mono leading-tight ${toneClasses}`}>{primary}</p>
      {secondary && (
        <p className="text-[13px] font-mono text-gray-500 dark:text-slate-400 leading-tight">{secondary}</p>
      )}
      {progressPct != null && (
        <div className="mt-1">
          <div className="h-1 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
            <div
              className={`h-full ${progressTone}`}
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
          {progressLabel && (
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight mt-1">{progressLabel}</p>
          )}
        </div>
      )}
      {subtext && progressPct == null && (
        <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">{subtext}</p>
      )}
      {footnote && (
        <p className="text-[11px] leading-tight mt-0.5 cursor-help">{footnote}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); action.onClick?.() }}
          className="self-start text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline mt-0.5"
        >
          {action.label}
        </button>
      )}
    </Tag>
  )
}
