import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../contexts/ToastContext'
import { S } from '../../../../lib/styles'
import { supabase } from '../../../../lib/supabase'
import { fetchContribution } from './contributionData'
import { fmtMoney, fmtNum, formatRange, shiftYmd, spanDays, thisMonth, thisWeek } from '../spotlight/spotlightShared'

// Profit Contribution — the fleet ranked by what each unit actually leaves
// behind after its equipment carrying cost and truck-purchase deduction.
// This is a PARTIAL margin (driver pay, fuel, insurance aren't in BUDDY yet)
// and every surface of the page says so. Additive route — the existing
// Profitability page, calendar, and Spotlight are untouched.

const PRESET_LABEL = { week: 'This week', month: 'This month', custom: 'Custom' }

const fmtSignedMoney = (n) => (n < 0 ? `−${fmtMoney(-n)}` : fmtMoney(n || 0)) // `|| 0` keeps −0 from rendering as "-$0"
const fmtCpm = (n) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`)
const fmtPct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`)

// Sortable columns. `get` returns the sort value; nulls always sink.
const COLUMNS = [
  { key: 'revenue',      label: 'Revenue',        get: r => r.revenue },
  { key: 'equipCost',    label: 'Equipment',      get: r => r.equipCost },
  { key: 'purchase',     label: 'Purchase',       get: r => r.purchase },
  { key: 'contribution', label: 'Contribution',   get: r => r.contribution },
  { key: 'cpm',          label: 'Contrib / mi',   get: r => r.cpm },
  { key: 'util',         label: 'Util',           get: r => r.util },
]

// ── Mini waterfall: revenue → −equipment → −purchase → contribution ──────
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

  // Fetch driver pay estimates (parallel to equipment data, always driver-keyed)
  useEffect(() => {
    let stale = false
    const fetchDriverPay = async () => {
      try {
        const { data, error } = await supabase.rpc('driver_pay_estimate_rollup', {
          p_from: range.from,
          p_to: range.to,
          p_basis: basis,
        })
        if (error) throw error
        if (!stale) setDriverPayState({ key: driverPayKey, data: data || [] })
      } catch (err) {
        if (!stale) {
          console.error('Failed to load driver pay data:', err)
          setDriverPayState({ key: driverPayKey, data: [] })
        }
      }
    }
    fetchDriverPay()
    return () => { stale = true }
  }, [driverPayKey, range.from, range.to, basis])

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
    const col = COLUMNS.find(c => c.key === sort.key) || COLUMNS[3]
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = col.get(a), bv = col.get(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return (av - bv) * dir
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
  const driverPayData = driverPayState.key === driverPayKey ? driverPayState.data : null
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
      {/* ── Header ── */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profit Contribution</h1>
        <p className="text-sm text-gray-700 dark:text-slate-500 mt-0.5">
          What each {nounSingular} leaves behind after its equipment carrying cost — money-losers flagged.
          <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 align-middle whitespace-nowrap" title="Driver pay, fuel, and insurance aren't in BUDDY yet, so this is contribution after equipment & purchase only — not net profit.">
            Partial — driver pay &amp; fuel pending. Not net profit.
          </span>
        </p>
      </div>

      {/* ── Controls: view · dimension · filter · period · basis ── */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center flex-wrap gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs shrink-0">
            {[['equipment', 'Equipment Contrib'], ['driver-pay', 'Est. Driver Pay']].map(([k, lbl]) => (
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

      {/* ── Fleet totals strip ── */}
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

      {/* ── Equipment Contribution Table ── */}
      {viewMode === 'equipment' && (
        <div className={`${S.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={`${S.th} w-10`}>#</th>
                  <th className={S.th}>{dimension === 'truck' ? 'Truck · driver' : 'Driver · trucks'}</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className={`${S.th} text-right cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => toggleSort(c.key)}>
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
                  <tr className="border-t border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02] font-semibold">
                    <td className={S.td} />
                    <td className={`${S.td} text-gray-700 dark:text-slate-200`}>Fleet total · {sorted.length} {nounSingular}s</td>
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
                    <th className={`${S.th} w-10`}>#</th>
                    <th className={S.th}>Driver · type</th>
                    {[
                      { key: 'loads', label: 'Loads' },
                      { key: 'linehaul_revenue', label: 'Linehaul revenue' },
                      { key: 'est_driver_pay', label: 'Est. driver pay' },
                      { key: 'est_company_contribution', label: 'Est. company earn' },
                    ].map(c => (
                      <th key={c.key} className={`${S.th} text-right cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => setDriverPaySort(s => (s.key === c.key ? { key: c.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: 'desc' }))}>
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
                  ) : [...driverPayData].sort((a, b) => {
                    const av = driverPaySort.key === 'loads' ? Number(a.loads) : driverPaySort.key === 'linehaul_revenue' ? Number(a.linehaul_revenue) : driverPaySort.key === 'est_driver_pay' ? Number(a.est_driver_pay) : Number(a.est_company_contribution)
                    const bv = driverPaySort.key === 'loads' ? Number(b.loads) : driverPaySort.key === 'linehaul_revenue' ? Number(b.linehaul_revenue) : driverPaySort.key === 'est_driver_pay' ? Number(b.est_driver_pay) : Number(b.est_company_contribution)
                    return (av - bv) * (driverPaySort.dir === 'desc' ? -1 : 1)
                  }).map((d, i) => (
                    <tr key={d.driver_id} className="border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                      <td className={`${S.td} font-mono text-gray-400 dark:text-slate-500 text-xs`}>{i + 1}</td>
                      <td className={`${S.td} font-medium`}>
                        <div className="text-gray-900 dark:text-slate-200">{d.driver_name}</div>
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
            <span className={`font-medium ${negative ? 'text-rose-700 dark:text-rose-300' : 'text-gray-900 dark:text-slate-100'}`}>{row.name || '—'}</span>
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
