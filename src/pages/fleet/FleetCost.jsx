import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
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
  { key: 'needs_cost',  label: '⚠️ Needs cost' },
  { key: 'loan',        label: 'Loan' },
  { key: 'lease',       label: 'Lease' },
  { key: 'owned_outright', label: 'Owned outright' },
  { key: 'owned_no_loan',  label: 'Owned, no loan' },
  { key: 'driver_owned',   label: 'Driver owned' },
  { key: 'unknown',        label: 'Unknown' },
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

export default function FleetCost() {
  const [rows, setRows] = useState([])
  const [vendorsById, setVendorsById] = useState(new Map())
  const [loansById, setLoansById] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // all | truck | trailer

  useEffect(() => { load() }, [])

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
    const c = { all: rows.length, needs_cost: 0 }
    for (const k of Object.keys(COST_SOURCE_META)) c[k] = 0
    for (const r of rows) {
      c[r.cost_source] = (c[r.cost_source] || 0) + 1
      if (needsCost(r)) c.needs_cost++
    }
    return c
  }, [rows])

  const totals = useMemo(() => {
    let monthly = 0, weekly = 0, costedCount = 0
    for (const r of rows) {
      if (r.monthly_cost != null) {
        monthly += Number(r.monthly_cost)
        weekly  += Number(r.weekly_cost || 0)
        costedCount++
      }
    }
    return { monthly, weekly, costedCount, total: rows.length }
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows
    if (filter === 'needs_cost') out = out.filter(needsCost)
    else if (filter !== 'all')   out = out.filter(r => r.cost_source === filter)
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

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total monthly" value={fmtMoney(totals.monthly)} tone="emerald" />
        <Kpi label="Total weekly"  value={fmtMoney(totals.weekly)}  tone="cyan" />
        <Kpi
          label="Units costed"
          value={`${totals.costedCount} / ${totals.total}`}
          tone="slate"
          hint={totals.total ? `${Math.round((totals.costedCount / totals.total) * 100)}% coverage` : ''}
        />
        <Kpi
          label="Needs cost"
          value={sourceCounts.needs_cost}
          tone="amber"
          hint="Click the ⚠️ filter →"
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

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
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
                <tr><td colSpan={8} className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No units match these filters.</td></tr>
              ) : visible.map(r => {
                const meta = COST_SOURCE_META[r.cost_source] || COST_SOURCE_META.unknown
                const isNeeds = needsCost(r)
                return (
                  <tr key={`${r.etype}:${r.id}`} className={`${S.tableRow} ${isNeeds ? 'bg-amber-50/30 dark:bg-amber-500/[0.03]' : ''}`}>
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

function Kpi({ label, value, tone, hint }) {
  const toneClasses = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    cyan:    'text-cyan-700 dark:text-cyan-400',
    slate:   'text-gray-900 dark:text-slate-200',
    amber:   'text-amber-700 dark:text-amber-400',
  }[tone] || 'text-gray-900 dark:text-slate-200'
  return (
    <div className={`${S.card} p-4`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold font-mono ${toneClasses}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-gray-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}
