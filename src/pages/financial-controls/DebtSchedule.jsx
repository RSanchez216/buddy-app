import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Select from '../../components/Select'
import {
  FC, STATUS_LABELS, LOAN_STATUSES,
  loanStatusPill, daysBehindCellClass,
  fmtMoney, fmtDate,
} from './loanUtils'
import AddLoanModal from './AddLoanModal'
import TitleReleasePanel from './components/TitleReleasePanel'
import { exportDebtScheduleXlsx } from './exportDebtSchedule'

// Compact money formatter for the KPI tiles. Under $10k shows the raw
// integer with commas; $10k–$999k as $XXX.Xk; ≥ $1M as $X.XM. Matches the
// spec's "tight enough that the tile width doesn't explode but still
// reads clearly" rule.
function fmtMoneyTile(n) {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '—'
  const abs = Math.abs(num)
  const sign = num < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000)    return `${sign}$${(abs / 1_000).toFixed(1)}k`
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

// One mini-tile inside a capsule. `valueColor` is a Tailwind class for the
// number (label/subtitle colors are fixed for the band layout). Min-height
// on the label keeps two-line labels aligned across the row of three.
function MiniTile({ label, value, subtitle, valueColor }) {
  return (
    <div className="flex-1 min-w-0">
      <p
        className="text-[11px] font-medium uppercase text-gray-500 dark:text-slate-500 leading-[1.3]"
        style={{ letterSpacing: '0.04em', minHeight: '28px' }}
      >
        {label}
      </p>
      <p className={`text-[20px] font-medium leading-[1.1] mt-1 ${valueColor}`}>{value}</p>
      {subtitle && (
        <p className="text-[11px] font-normal text-gray-500 dark:text-slate-500 mt-0.5">{subtitle}</p>
      )}
    </div>
  )
}

// One capsule containing 3 mini-tiles with a colored-dot header above.
// Capsule styling per spec: white bg, 0.5px border, 18px radius, 16px 18px
// padding. Header dot + uppercase label with 0.04em tracking.
function KpiBand({ dotColor, label, children }) {
  // Equal widths via flex: 1 1 0 + min-width: 0. Using flex (not grid) on
  // the parent because CSS Grid's column tracks were resolving unequal
  // for the short-content OVERVIEW capsule even with minmax(0, 1fr).
  // flex-basis: 0 forces every capsule to start from zero and grow by the
  // same factor, so content length stops influencing the final width.
  return (
    <div className="flex flex-col min-w-0" style={{ flex: '1 1 0' }}>
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: dotColor }} />
        <span
          className="text-[13px] font-semibold uppercase text-gray-700 dark:text-slate-300"
          style={{ letterSpacing: '0.04em' }}
        >
          {label}
        </span>
      </div>
      <div
        className="bg-white dark:bg-[#0d0d1f] border-gray-200 dark:border-white/5 w-full min-w-0"
        style={{
          borderWidth: '0.5px',
          borderStyle: 'solid',
          borderRadius: '18px',
          padding: '16px 18px',
        }}
      >
        <div className="flex gap-3 w-full min-w-0">{children}</div>
      </div>
    </div>
  )
}

// Sortable column header — null direction = unsorted
function SortHeader({ label, columnKey, sortKey, sortDir, onSort, align = 'left' }) {
  const active = sortKey === columnKey
  return (
    <th className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => onSort(columnKey)}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        <span className={`text-[9px] leading-none ${active ? 'text-orange-500' : 'text-gray-300 dark:text-slate-700'}`}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

export default function DebtSchedule() {
  const { profile } = useAuth()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [loans, setLoans] = useState([])
  const [equipmentByLoan, setEquipmentByLoan] = useState({})
  const [entities, setEntities] = useState([])
  const [lenders, setLenders] = useState([])
  const [equipmentTypes, setEquipmentTypes] = useState([])
  const [kpiSummary, setKpiSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [exporting, setExporting] = useState(false)

  // ── Filter + sort state lives in the URL search params, not local
  // React state. This way: copy-pasting / bookmarking the URL preserves
  // the view, and the back-from-detail flow lands users right back where
  // they were. Defaults are absent from the URL so a clean /debt-schedule
  // URL still means "everything default."
  //
  // Status defaults to 'active' (matches the prior local-state default).
  // The "All Statuses" Select option uses the explicit value 'all' so
  // the absent-param case can keep meaning "active" without ambiguity.
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  const search                = searchParams.get('q')             ?? ''
  const filterEntity          = searchParams.get('entity')        ?? ''
  const filterLender          = searchParams.get('lender')        ?? ''
  const filterStatus          = searchParams.get('status')        ?? 'active'
  const filterEquipType       = searchParams.get('equipment')     ?? ''
  const pastDueOnly           = searchParams.get('past_due')      === '1'
  const titlePendingOnly      = searchParams.get('title_pending') === '1'
  const skippedUnresolvedOnly = searchParams.get('skipped')       === '1'
  const groupByEntity         = searchParams.get('grouped')       === '1'
  const sortKey               = searchParams.get('sort')          || null
  const sortDir               = searchParams.get('dir')           === 'desc' ? 'desc' : 'asc'

  // Generic setter that drops keys when the value equals the default so
  // the URL stays clean. `opts.replace = true` is used by the search box
  // to avoid one history entry per keystroke; everything else pushes a
  // new entry so the browser back/forward buttons walk filter changes.
  const updateParam = useCallback((key, value, opts) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value == null || value === '' || value === false) {
        next.delete(key)
      } else {
        next.set(key, String(value))
      }
      return next
    }, opts)
  }, [setSearchParams])

  useEffect(() => { loadData() }, [])

  // ── Scroll restoration. Saved by the loan-row Link's onClick keyed by
  // the full URL (pathname + search). Restored once data is loaded so
  // the row we want to land on actually exists by the time we scroll.
  // `restoredKeyRef` guards against double-running when the user changes
  // filters after a restore — we only restore for the exact URL we
  // landed on.
  const restoredKeyRef = useRef(null)
  const originUrl = `${location.pathname}${location.search}`
  const scrollKey = `debt-schedule-scroll:${originUrl}`
  useEffect(() => {
    if (loading) return
    if (restoredKeyRef.current === scrollKey) return
    const saved = sessionStorage.getItem(scrollKey)
    restoredKeyRef.current = scrollKey
    if (saved != null) {
      const y = parseInt(saved, 10)
      if (!Number.isNaN(y)) {
        // Defer a frame so the just-painted rows are in the DOM.
        requestAnimationFrame(() => window.scrollTo(0, y))
      }
      sessionStorage.removeItem(scrollKey)
    }
  }, [loading, scrollKey])

  const saveScroll = useCallback(() => {
    sessionStorage.setItem(scrollKey, String(window.scrollY))
  }, [scrollKey])

  async function loadData() {
    setLoading(true)
    const [loanRes, eqRes, entRes, lndRes, etRes, kpiRes] = await Promise.all([
      supabase.from('v_loans_summary').select('*').order('next_due_date', { ascending: true, nullsFirst: false }),
      supabase.from('loan_equipment').select('id, loan_id, unit_number, vin, equipment_type, make, model, year'),
      supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name'),
      supabase.from('loan_lenders').select('id, name').eq('is_active', true).order('name'),
      supabase.from('equipment_types').select('id, name, display_label, sort_order').eq('is_active', true).order('sort_order').order('display_label'),
      supabase.rpc('debt_schedule_kpi_summary').single(),
    ])
    setLoans(loanRes.data || [])
    const grouped = {}
    for (const e of (eqRes.data || [])) {
      if (!grouped[e.loan_id]) grouped[e.loan_id] = []
      grouped[e.loan_id].push(e)
    }
    setEquipmentByLoan(grouped)
    setEntities(entRes.data || [])
    setLenders(lndRes.data || [])
    setEquipmentTypes(etRes.data || [])
    setKpiSummary(kpiRes?.data || null)
    setLoading(false)
  }

  // Apply filters + global search; tag each loan with searchHit info
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return loans
      .map(l => {
        let hit = null
        if (q) {
          const eq = equipmentByLoan[l.id] || []
          if (l.loan_id_external && l.loan_id_external.toLowerCase().includes(q)) hit = { field: 'Loan ID', value: l.loan_id_external }
          else if (l.contract_number && l.contract_number.toLowerCase().includes(q)) hit = { field: 'Contract', value: l.contract_number }
          else {
            const vinMatch = eq.find(e => e.vin && e.vin.toLowerCase().includes(q))
            if (vinMatch) hit = { field: 'VIN', value: vinMatch.vin }
            else {
              const unitMatch = eq.find(e => e.unit_number && e.unit_number.toLowerCase().includes(q))
              if (unitMatch) hit = { field: 'Unit', value: unitMatch.unit_number }
              else {
                const mmMatch = eq.find(e => (e.make && e.make.toLowerCase().includes(q)) || (e.model && e.model.toLowerCase().includes(q)))
                if (mmMatch) hit = { field: 'Equipment', value: [mmMatch.make, mmMatch.model].filter(Boolean).join(' ') }
              }
            }
          }
          if (!hit) return null
        }
        if (filterEntity && l.entity_id !== filterEntity) return null
        if (filterLender && l.lender_id !== filterLender) return null
        if (filterStatus && filterStatus !== 'all' && l.status !== filterStatus) return null
        if (pastDueOnly && (!l.days_behind || l.days_behind <= 0)) return null
        if (titlePendingOnly && !l.title_release_pending) return null
        if (skippedUnresolvedOnly && (!l.unresolved_skipped_count || l.unresolved_skipped_count <= 0)) return null
        if (filterEquipType) {
          const eq = equipmentByLoan[l.id] || []
          if (!eq.some(e => e.equipment_type === filterEquipType)) return null
        }
        return { ...l, _hit: hit }
      })
      .filter(Boolean)
  }, [loans, equipmentByLoan, search, filterEntity, filterLender, filterStatus, filterEquipType, pastDueOnly, titlePendingOnly, skippedUnresolvedOnly])

  // Apply column sort (client-side, after filters)
  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const dir = sortDir === 'asc' ? 1 : -1
    const get = (l, key) => {
      switch (key) {
        case 'next_due':       return l.next_due_date || ''
        case 'days_behind':    return Number(l.days_behind || 0)
        case 'skipped':        return Number(l.unresolved_skipped_count || 0)
        case 'monthly_pmt':    return Number(l.monthly_payment || 0)
        case 'balance':        return Number(l.current_balance || 0)
        case 'loan_id':        return (l.loan_id_external || '').toLowerCase()
        case 'entity':         return (l.entity_name || '').toLowerCase()
        case 'lender':         return (l.lender_name || '').toLowerCase()
        default:               return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const av = get(a, sortKey)
      const bv = get(b, sortKey)
      if (av < bv) return -1 * dir
      if (av > bv) return  1 * dir
      return 0
    })
  }, [filtered, sortKey, sortDir])

  // Three-state column sort: asc -> desc -> off. Drops sort/dir from the
  // URL when off so a default view stays a clean /debt-schedule.
  function onSort(key) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (sortKey !== key) {
        next.set('sort', key)
        next.delete('dir') // 'asc' is the implicit default
      } else if (sortDir === 'asc') {
        next.set('sort', key)
        next.set('dir', 'desc')
      } else {
        next.delete('sort')
        next.delete('dir')
      }
      return next
    })
  }

  // equipment_types.name → display_label lookup. Falls back to uppercase
  // raw name for orphans so we never render the lowercase internal key.
  const formatEqLabel = useMemo(() => {
    const m = new Map()
    for (const t of equipmentTypes) m.set(t.name, t.display_label)
    return (name) => {
      if (!name) return '—'
      return m.get(name) || String(name).toUpperCase()
    }
  }, [equipmentTypes])

  // Human-readable list of the active filters, for the export's info sheet.
  const exportFilterSummary = useMemo(() => {
    const out = []
    if (search.trim()) out.push(`Search: "${search.trim()}"`)
    if (filterEntity) out.push(`Entity: ${entities.find(e => e.id === filterEntity)?.name || filterEntity}`)
    if (filterLender) out.push(`Lender: ${lenders.find(l => l.id === filterLender)?.name || filterLender}`)
    out.push(`Status: ${filterStatus === 'all' ? 'All' : (STATUS_LABELS[filterStatus] || filterStatus)}`)
    if (filterEquipType) out.push(`Equipment type: ${formatEqLabel(filterEquipType)}`)
    if (pastDueOnly) out.push('Past Due Only')
    if (skippedUnresolvedOnly) out.push('Skipped Unresolved')
    if (titlePendingOnly) out.push('Title Pending Only')
    if (groupByEntity) out.push('Grouped by Entity')
    return out
  }, [search, filterEntity, filterLender, filterStatus, filterEquipType, pastDueOnly, skippedUnresolvedOnly, titlePendingOnly, groupByEntity, entities, lenders, formatEqLabel])

  // Export the currently-filtered + sorted rows (full set, not a page) to .xlsx.
  async function onExport() {
    if (!sorted.length || exporting) return
    setExporting(true)
    try {
      await exportDebtScheduleXlsx({
        rows: sorted,
        equipmentByLoan,
        formatEqLabel,
        filterSummary: exportFilterSummary,
        headerContext: `${filtered.length} loans shown · ${loans.length} total`,
      })
    } catch (e) {
      console.error('Debt schedule export failed:', e)
    } finally {
      setExporting(false)
    }
  }

  // Loans paid off but still missing one or more equipment titles.
  // Sorted oldest paid-off first so Rebeca works the longest-pending
  // ones from the top.
  const titlePendingRows = useMemo(() => (
    loans
      .filter(l => l.title_release_pending)
      .sort((a, b) => (a.updated_at || '').localeCompare(b.updated_at || ''))
  ), [loans])

  // Group view: by entity
  const grouped = useMemo(() => {
    if (!groupByEntity) return null
    const map = {}
    for (const l of sorted) {
      const key = l.entity_name || 'Unassigned'
      if (!map[key]) map[key] = []
      map[key].push(l)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [sorted, groupByEntity])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Financial Controls
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Debt Schedule</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            {filtered.length} {filterStatus ? (STATUS_LABELS[filterStatus] || filterStatus).toLowerCase() : ''} loan{filtered.length === 1 ? '' : 's'}
            <span className="text-gray-400 dark:text-slate-600"> · {loans.length} total</span>
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setShowAdd(true)} className={FC.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Loan
          </button>
        )}
      </div>

      {/* KPI bands — 3 capsules, each with 3 mini-tiles. Hydrates from
          public.debt_schedule_kpi_summary() (single RPC call). Colors
          per spec; values fall back to zero / em-dash while loading. */}
      <div className="flex gap-3 items-stretch">
        <KpiBand dotColor="#E24B4A" label="Act Now">
          {/* Tile 1 — PAST DUE LOANS. Loan count combines pending +
              skipped past-due payments (skipped here = missed, not
              lender-approved deferral). Subtext stacks the totals on
              line 1 and the pending/skipped split on line 2. */}
          <MiniTile
            label="Past Due Loans"
            value={kpiSummary?.past_due_loans_count ?? 0}
            subtitle={(() => {
              const payments = kpiSummary?.past_due_payments_count ?? 0
              if (payments === 0) return 'No past-due payments'
              const pending = kpiSummary?.past_due_pending_count ?? 0
              const skipped = kpiSummary?.past_due_skipped_count ?? 0
              return (
                <>
                  <span className="block">{payments} {payments === 1 ? 'payment' : 'payments'}</span>
                  <span className="block">{pending} pending · {skipped} skipped</span>
                </>
              )
            })()}
            valueColor="text-[#E24B4A]"
          />
          {/* Tile 2 — PAST DUE AMOUNT. Primary stays the combined dollar
              total. Subtext splits skipped vs pending across two lines,
              collapsing to one line when only one half has a value. */}
          <MiniTile
            label="Past Due Amount"
            value={fmtMoneyTile(kpiSummary?.past_due_amount ?? 0)}
            subtitle={(() => {
              const skippedAmt = Number(kpiSummary?.past_due_skipped_amount ?? 0)
              const pendingAmt = Number(kpiSummary?.past_due_pending_amount ?? 0)
              if (skippedAmt === 0 && pendingAmt === 0) return '—'
              if (skippedAmt > 0 && pendingAmt > 0) {
                return (
                  <>
                    <span className="block">{fmtMoneyTile(skippedAmt)} from skipped</span>
                    <span className="block">{fmtMoneyTile(pendingAmt)} pending</span>
                  </>
                )
              }
              if (skippedAmt > 0) return `${fmtMoneyTile(skippedAmt)} from skipped`
              return `${fmtMoneyTile(pendingAmt)} pending`
            })()}
            valueColor="text-[#E24B4A]"
          />
          {/* Tile 3 — DAYS BEHIND. Replaces Skipped Unresolved. Shows
              the worst case + the average across all past-due rows. */}
          <MiniTile
            label="Days Behind"
            value={`${kpiSummary?.days_behind_max ?? 0}d max`}
            subtitle={(kpiSummary?.days_behind_max ?? 0) === 0
              ? 'Nothing past due'
              : `${kpiSummary?.days_behind_avg ?? 0}d avg`}
            valueColor="text-[#E24B4A]"
          />
        </KpiBand>

        <KpiBand dotColor="#F97316" label="Upcoming">
          <MiniTile
            label="Due Next 30 Days"
            value={fmtMoneyTile(kpiSummary?.due_next_30d_amount ?? 0)}
            subtitle={`${kpiSummary?.due_next_30d_count ?? 0} payments`}
            valueColor="text-[#F97316]"
          />
          <MiniTile
            label="Due 31–60 Days"
            value={fmtMoneyTile(kpiSummary?.due_31_60d_amount ?? 0)}
            subtitle={`${kpiSummary?.due_31_60d_count ?? 0} payments`}
            valueColor="text-gray-900 dark:text-slate-100"
          />
          <MiniTile
            label="Due 61–90 Days"
            value={fmtMoneyTile(kpiSummary?.due_61_90d_amount ?? 0)}
            subtitle={`${kpiSummary?.due_61_90d_count ?? 0} payments`}
            valueColor="text-gray-900 dark:text-slate-100"
          />
        </KpiBand>

        <KpiBand dotColor="#888780" label="Overview">
          <MiniTile
            label="Total Active Debt"
            value={fmtMoneyTile(kpiSummary?.total_active_debt ?? 0)}
            valueColor="text-gray-900 dark:text-slate-100"
          />
          <MiniTile
            label="Active Loans"
            value={kpiSummary?.active_loans_count ?? 0}
            valueColor="text-gray-900 dark:text-slate-100"
          />
          {/* PAID OFF YTD now paired with TOTAL PAID OFF so YTD progress
              reads against the all-time baseline. YTD uses
              last_updated_at >= year_start as the proxy — same as the
              existing count — so the two YTD numbers stay consistent. */}
          <MiniTile
            label="Paid Off YTD"
            value={kpiSummary?.paid_off_ytd_count ?? 0}
            subtitle={(kpiSummary?.paid_off_ytd_count ?? 0) === 0
              ? '—'
              : fmtMoneyTile(kpiSummary?.paid_off_ytd_amount ?? 0)}
            valueColor="text-[#639922]"
          />
          <MiniTile
            label="Total Paid Off"
            value={kpiSummary?.total_paid_off_count ?? 0}
            subtitle={(kpiSummary?.total_paid_off_count ?? 0) === 0
              ? '—'
              : fmtMoneyTile(kpiSummary?.total_paid_off_amount ?? 0)}
            valueColor="text-[#639922]"
          />
        </KpiBand>
      </div>

      {/* Awaiting title release — paid-off loans with equipment titles still pending */}
      <TitleReleasePanel rows={titlePendingRows} />

      {/* Filters — every dropdown / chip / search keystroke pushes to the
          URL via updateParam(). Search input uses replace:true so typing
          doesn't pollute browser history with one entry per keystroke;
          everything else pushes new entries so back/forward walks filter
          changes naturally. */}
      <div className="flex gap-3 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search Loan ID, Contract, VIN, Unit, Make/Model…"
          value={search}
          onChange={e => updateParam('q', e.target.value, { replace: true })}
          className={`${S.input} w-80`}
        />
        <Select value={filterEntity} onChange={e => updateParam('entity', e.target.value)}>
          <option value="">All Entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select value={filterLender} onChange={e => updateParam('lender', e.target.value)}>
          <option value="">All Lenders</option>
          {lenders.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        {/* 'active' is the implicit default — picking it drops the param
            so the URL stays clean. 'all' is the explicit "no status
            filter" value (since absent != all in this scheme). */}
        <Select
          value={filterStatus}
          onChange={e => updateParam('status', e.target.value === 'active' ? null : e.target.value)}
        >
          <option value="all">All Statuses</option>
          {LOAN_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
        <Select value={filterEquipType} onChange={e => updateParam('equipment', e.target.value)}>
          <option value="">All Equipment Types</option>
          {equipmentTypes.map(t => <option key={t.id} value={t.name}>{t.display_label || t.name}</option>)}
        </Select>
        <button
          onClick={() => updateParam('past_due', !pastDueOnly ? '1' : null)}
          className={S.filterBtn(pastDueOnly)}
        >
          Past Due Only
        </button>
        <button
          onClick={() => updateParam('skipped', !skippedUnresolvedOnly ? '1' : null)}
          className={S.filterBtn(skippedUnresolvedOnly)}
          title="Show only active loans with skipped past-due rows"
        >
          Skipped Unresolved
        </button>
        <button
          onClick={() => updateParam('title_pending', !titlePendingOnly ? '1' : null)}
          className={S.filterBtn(titlePendingOnly)}
        >
          Title Pending Only
        </button>
        <button
          onClick={() => updateParam('grouped', !groupByEntity ? '1' : null)}
          className={S.filterBtn(groupByEntity)}
        >
          {groupByEntity ? 'Grouped by Entity' : 'Flat View'}
        </button>
        <button
          onClick={onExport}
          disabled={sorted.length === 0 || exporting}
          title={sorted.length === 0 ? 'No rows to export' : 'Download the filtered rows as a formatted .xlsx'}
          className="ml-auto inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <SortHeader label="Loan ID"     columnKey="loan_id"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Entity"      columnKey="entity"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Lender"      columnKey="lender"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th className={S.th}>Equipment</th>
                <SortHeader label="Monthly Pmt" columnKey="monthly_pmt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Balance"     columnKey="balance"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Next Due"    columnKey="next_due"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Days Behind" columnKey="days_behind" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Skipped"     columnKey="skipped"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <th className={S.th}>Status</th>
              </tr>
            </thead>
            {grouped ? (
              grouped.map(([entityName, rows]) => (
                <GroupedBody
                  key={entityName}
                  entityName={entityName}
                  rows={rows}
                  equipmentByLoan={equipmentByLoan}
                  formatEqLabel={formatEqLabel}
                  originUrl={originUrl}
                  saveScroll={saveScroll}
                />
              ))
            ) : (
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No loans found</td></tr>
                ) : sorted.map(l => (
                  <LoanRow
                    key={l.id}
                    loan={l}
                    equipment={equipmentByLoan[l.id] || []}
                    formatEqLabel={formatEqLabel}
                    originUrl={originUrl}
                    saveScroll={saveScroll}
                  />
                ))}
              </tbody>
            )}
          </table>
        </div>
      </div>

      <AddLoanModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => loadData()} />
    </div>
  )
}

function GroupedBody({ entityName, rows, equipmentByLoan, formatEqLabel, originUrl, saveScroll }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <thead>
        <tr
          className="bg-gray-50 dark:bg-white/[0.02] border-b border-gray-100 dark:border-white/5 cursor-pointer"
          onClick={() => setOpen(o => !o)}
        >
          <td colSpan={10} className="px-4 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">
              <svg className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {entityName}
              <span className="text-gray-400 dark:text-slate-500 font-normal normal-case">({rows.length} loans)</span>
            </div>
          </td>
        </tr>
      </thead>
      {open && (
        <tbody>
          {rows.map(l => (
            <LoanRow
              key={l.id}
              loan={l}
              equipment={equipmentByLoan[l.id] || []}
              formatEqLabel={formatEqLabel}
              originUrl={originUrl}
              saveScroll={saveScroll}
            />
          ))}
        </tbody>
      )}
    </>
  )
}

function LoanRow({ loan, equipment, formatEqLabel, originUrl, saveScroll }) {
  const days = Number(loan.days_behind) || 0
  const eqCount = equipment.length
  const primaryType = (() => {
    if (!equipment.length) return null
    const counts = {}
    equipment.forEach(e => { if (e.equipment_type) counts[e.equipment_type] = (counts[e.equipment_type] || 0) + 1 })
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return best?.[0] || null
  })()
  const primaryTypeLabel = primaryType ? formatEqLabel(primaryType) : null

  return (
    <tr className={S.tableRow}>
      <td className={`${S.td} font-medium`}>
        <Link
          to={`/financial-controls/debt-schedule/${loan.id}`}
          state={{ from: originUrl }}
          onClick={saveScroll}
          className="text-gray-900 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
        >
          {loan.loan_id_external || '—'}
        </Link>
        {loan._hit && (
          <div className="text-[10px] text-orange-600 dark:text-orange-400 font-normal mt-0.5">
            matched on {loan._hit.field}: {loan._hit.value}
          </div>
        )}
        {loan.contract_number && (
          <div className="text-[10px] text-gray-400 dark:text-slate-600 font-mono mt-0.5">{loan.contract_number}</div>
        )}
      </td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{loan.entity_name || '—'}</td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{loan.lender_name || '—'}</td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>
        {eqCount > 0 ? (
          <span>
            <span className="font-medium text-gray-700 dark:text-slate-300">{eqCount}</span>
            {primaryTypeLabel && <span className="text-gray-400 dark:text-slate-500 ml-1">({primaryTypeLabel})</span>}
          </span>
        ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(loan.monthly_payment)}</td>
      <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(loan.current_balance)}</td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(loan.next_due_date)}</td>
      <td className={`${S.td} font-semibold whitespace-nowrap ${daysBehindCellClass(days)}`}>
        {days > 0 ? `${days}d` : '0'}
      </td>
      <td
        className={`${S.td} font-semibold whitespace-nowrap`}
        title={
          loan.unresolved_skipped_count > 0
            ? `${loan.unresolved_skipped_count} skipped payment${loan.unresolved_skipped_count === 1 ? '' : 's'} past due · ${fmtMoney(loan.unresolved_skipped_amount)}`
            : 'No unresolved skipped payments'
        }
      >
        {loan.unresolved_skipped_count > 0 ? (
          <span style={{ color: '#BA7517' }}>{loan.unresolved_skipped_count}</span>
        ) : (
          <span className="text-gray-300 dark:text-slate-600">—</span>
        )}
      </td>
      <td className={S.td}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${loanStatusPill(loan.status)}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
            {STATUS_LABELS[loan.status] || loan.status}
          </span>
          {loan.title_release_pending && <TitlePendingBadge />}
        </div>
      </td>
    </tr>
  )
}

// Compact amber pill — KeyRound icon + "Title pending" — shown next to
// the status pill on rows where the loan is paid off but at least one
// piece of equipment still has has_title=false. Mirrors the driver-side
// TitlePendingBadge in PurchasesTable for cross-module consistency.
function TitlePendingBadge() {
  return (
    <span
      title="Loan paid off — at least one equipment title still pending from lender"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 whitespace-nowrap"
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7.5" cy="15.5" r="5.5" />
        <path d="m21 2-9.6 9.6" />
        <path d="m15.5 7.5 3 3L22 7l-3-3" />
      </svg>
      Title pending
    </span>
  )
}
