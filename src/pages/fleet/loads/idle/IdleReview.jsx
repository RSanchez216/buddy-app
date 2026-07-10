import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import CopyButton from '../../../../components/CopyButton'
import { fmtMoney } from '../spotlight/spotlightShared'

// Idle review — trucks, trailers, and drivers earning $0 while still costing
// money (3+ days since last load activity). Tag a reason, watch the duration,
// resolve when sold / terminated / back to work. Read/writes go through the
// idle_subjects / set_idle_reason / resolve_idle RPCs (already deployed).

const UNIT_REASONS = ['Available', 'Driver is off', 'Pending - TBD', 'Parked', 'Dedicated lane site', 'Under repairs', 'Under claim', 'For sale', 'Lease to Purchase', 'Other']
const DRIVER_REASONS = ['Ready', 'Waiting for load', 'Pending - TBD', 'Vacation', 'Home-time', 'Under repairs', 'Health', 'Family', 'Other']

// "Available" reasons: the subject is fine / ready — not a problem — so they
// mark green, above the severity ladder. Small named set, easy to extend.
const AVAILABLE_REASONS = new Set(['Ready', 'Waiting for load', 'Available'])

// Benign reasons read as expected idle (low severity); the rest are
// "attention" (amber). Anything uncategorized, or idle 14+ days, escalates red.
const BENIGN = new Set(['Vacation', 'Parked', 'Dedicated lane site', 'For sale'])

function severity(row) {
  // Available/ready reasons are green regardless of idle age — they signal the
  // subject is fine, not idle-with-a-problem.
  if (row.reason && AVAILABLE_REASONS.has(row.reason)) return 'available'
  const chronic = (row.days_idle ?? 0) >= 14
  // A driver holding no company-owned equipment ($0 run-rate) is low severity
  // — listed for the revenue gap, but no company cost. Chronic idle still
  // nudges it to red so a long-idle driver gets a look.
  if ((row.subject_type === 'driver' || row.subject_type === 'team') && Number(row.monthly_cost) === 0 && !chronic) return 'low'
  if (chronic) return 'red'
  if (!row.reason) return 'red'
  if (BENIGN.has(row.reason)) return 'low'
  return 'amber'
}
const SEV_RANK = { red: 0, amber: 1, low: 2, available: 3 }
const SEV_DOT = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  low: 'bg-teal-500',
  available: 'bg-green-500',
}

const CAP = 10

// Compact, clearly-pressable secondary button for the per-row Resolve/Reopen.
const ROW_BTN = 'inline-flex items-center px-2 py-1 text-[11px] font-medium rounded-md border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 active:bg-gray-100 dark:active:bg-white/10 transition-colors'

const COST_TIP = "Monthly carrying cost — the lease or loan payment for this unit, which keeps being charged while it sits idle. It's the monthly run-rate, not prorated to the idle days shown. Driver-owned equipment is $0. For a driver, it's the combined carrying cost of the company truck and trailer they're holding."

// Column defs drive the sortable headers + comparator. `get` returns the sort
// value; `type` picks the comparator (text / numeric / severity). Hoisted to
// module scope so the reference is stable across renders (memoization-safe).
const UNIT_COLUMNS = [
  { key: 'label', label: 'Unit', type: 'text', get: r => r.label || '' },
  { key: 'days', label: 'Idle', type: 'num', align: 'right', get: r => r.days_idle },
  { key: 'extra', label: 'Assigned driver', type: 'text', get: r => r.extra || '' },
  { key: 'cost', label: 'Holding', type: 'num', align: 'right', tip: COST_TIP, get: r => Number(r.holding_prorated) },
  { key: 'reason', label: 'Reason', type: 'severity', get: r => SEV_RANK[severity(r)] },
]
const DRIVER_COLUMNS = [
  { key: 'label', label: 'Driver', type: 'text', get: r => r.label || '' },
  { key: 'days', label: 'Idle', type: 'num', align: 'right', get: r => r.days_idle },
  { key: 'cost', label: 'Holding', type: 'num', align: 'right', tip: COST_TIP, get: r => Number(r.holding_prorated) },
  { key: 'reason', label: 'Reason', type: 'severity', get: r => SEV_RANK[severity(r)] },
]

function fmtDays(d) {
  if (d == null) return '—'
  return `${d}d`
}

// Formats a date-only 'YYYY-MM-DD' string from idle_subjects (resolved_on,
// reason_since, last_activity) without a UTC shift. new Date('2026-06-23')
// parses as UTC midnight and renders a day early in Central; building from the
// Y-M-D parts constructs in local time, so the calendar day is preserved.
function fmtDateOnly(s) {
  if (!s) return '—'
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return '—'
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// last_reviewed_at is a timestamptz (the row's updated_at, stamped when a
// reason/note is saved). Render the calendar day in America/Chicago, e.g.
// "Jul 6". Null → null (caller shows "Not reviewed").
function fmtReviewed(ts) {
  if (!ts) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(ts))
  } catch { return null }
}

// Opens the subject's profile (truck / trailer / driver) in a new tab.
// subject_type is singular; the routes are plural (+'s'). Falls back to plain
// text when there's no id to link to.
function SubjectLink({ row }) {
  const label = row.label || '—'
  if (!row.subject_id) return label
  return (
    <Link
      to={`/fleet/${row.subject_type}s/${row.subject_id}`}
      target="_blank" rel="noopener noreferrer"
      title="Open profile in a new tab"
      className="hover:underline hover:text-orange-600 dark:hover:text-orange-400"
    >
      {label}
    </Link>
  )
}

// ── enriched-row helpers (last load, exact holding, Telegram, Excel) ─────────
// Short "Jun 30" (no year), no UTC shift.
function fmtShort(s) {
  if (!s) return ''
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const money0 = (v) => `$${Math.round(Number(v) || 0).toLocaleString('en-US')}`
const unitTag = (u) => `#${String(u || '').replace(/^#/, '').trim()}`

// Unit ownership/finance label (Telegram + reference). Mirrors FinanceBadge.
function ownershipLabel(row) {
  if (row.finance_type === 'lease') return row.finance_party ? `Lease · ${row.finance_party}` : 'Lease'
  if (row.finance_type === 'loan') return row.finance_party ? `Loan · ${row.finance_party}` : 'Loan'
  return 'Owned'
}

// One Telegram stanza per subject. Bold via **…** (Telegram's client syntax,
// renders on paste); no code fence so bold + emoji show. Holding omitted for
// now. Missing fields drop their line cleanly.
const SUBJECT_LABEL = { driver: 'Driver', truck: 'Truck', trailer: 'Trailer', team: 'Team' }
function telegramStanza(row) {
  const isUnit = row.subject_type === 'truck' || row.subject_type === 'trailer'
  const section = SUBJECT_LABEL[row.subject_type] || 'Subject'
  const typeLabel = isUnit ? ownershipLabel(row) : (row.detail || '')
  const lines = [
    `🚛 ${section}: **${row.label || '—'}**`,
    `${typeLabel ? `${typeLabel} · ` : ''}**idle ${row.days_idle ?? 0}d** ‼️`,
  ]
  if (row.last_load_number) {
    let l = `Last Load : ${unitTag(row.last_load_number)}`
    if (row.last_lane) l += ` ${row.last_lane}`
    if (row.last_delivery) l += ` · del **${fmtShort(row.last_delivery)}**`
    lines.push(l)
  }
  if (row.last_dispatcher) lines.push(`Disp: ${row.last_dispatcher}`)
  lines.push(`Reason: ${row.reason || '❓'}`)
  return lines.join('\n')
}
const telegramBlock = (rows) => (rows || []).map(telegramStanza).join('\n\n')

// Excel: Drivers / Trucks / Trailers sheets from the currently-displayed groups
// (respects the active view + review/finance filters — the caller passes them).
async function exportIdleExcel(groups) {
  const mod = await import('xlsx')
  const XLSX = mod && mod.utils ? mod : (mod.default ?? mod)
  if (!XLSX?.utils) return
  const num = (v) => Number(v) || 0
  const mapRow = (r) => ({
    'Unit / Driver': r.label || '', 'Type': r.detail || '', 'Idle days': r.days_idle ?? '',
    'Last activity': r.last_activity || '', 'Last load #': r.last_load_number || '', 'Last lane': r.last_lane || '',
    'Last delivery': r.last_delivery || '', 'Last dispatcher': r.last_dispatcher || '',
    'Truck unit': r.truck_unit || '', 'Truck holding': num(r.truck_holding),
    'Trailer unit': r.trailer_unit || '', 'Trailer holding': num(r.trailer_holding),
    'Total holding': num(r.holding_prorated), 'Monthly cost': num(r.monthly_cost),
    'Reason': r.reason || '', 'Note': r.reason_note || '',
    'Reviewed': r.last_reviewed_at ? fmtReviewed(r.last_reviewed_at) : '', 'Resolved': r.resolved ? (r.resolved_on || 'yes') : '',
  })
  const costCols = ['J', 'L', 'M', 'N'] // truck/trailer/total holding + monthly
  const wb = XLSX.utils.book_new()
  for (const [name, list] of [['Drivers', groups.driver], ['Trucks', groups.truck], ['Trailers', groups.trailer]]) {
    const ws = XLSX.utils.json_to_sheet((list || []).map(mapRow))
    const rng = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let R = 1; R <= rng.e.r; R++) for (const C of costCols) {
      const cell = ws[`${C}${R + 1}`]; if (cell && typeof cell.v === 'number') cell.z = '$#,##0'
    }
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  XLSX.writeFile(wb, `idle-report-${today}.xlsx`)
}

// Muted "last load that used this subject" line.
function LastLoadLine({ row }) {
  if (!row.last_load_number) return <div className="text-[10px] text-gray-600 dark:text-slate-400 mt-0.5">No prior load</div>
  const parts = [unitTag(row.last_load_number)]
  if (row.last_lane) parts.push(row.last_lane)
  if (row.last_delivery) parts.push(fmtShort(row.last_delivery))
  if (row.last_dispatcher) parts.push(row.last_dispatcher)
  return <div className="text-[10px] text-gray-600 dark:text-slate-400 mt-0.5 max-w-[22rem] truncate" title={`Last: ${parts.join(' · ')}`}>Last: {parts.join(' · ')}</div>
}

// Exact prorated holding for the idle span, with the truck/trailer split and the
// monthly kept as a muted reference. Owned units read $0 (owned).
function HoldingCell({ row }) {
  const held = Number(row.holding_prorated) || 0
  const monthly = Number(row.monthly_cost) || 0
  const part = (u, v) => `${unitTag(u)} ${Number(v) > 0 ? money0(v) : '$0 (owned)'}`
  const bd = []
  if (row.truck_unit) bd.push(`truck ${part(row.truck_unit, row.truck_holding)}`)
  if (row.trailer_unit) bd.push(`trailer ${part(row.trailer_unit, row.trailer_holding)}`)
  return (
    <div className="text-right">
      <div className="font-mono text-amber-600 dark:text-amber-400 whitespace-nowrap">{held > 0 ? money0(held) : '$0'} <span className="text-[9px] font-sans text-gray-600 dark:text-slate-400">held · {row.days_idle ?? 0}d</span></div>
      <div className="text-[10px] font-mono text-gray-600 dark:text-slate-400 whitespace-nowrap">{monthly > 0 ? `${money0(monthly)}/mo` : '$0 (owned)'}</div>
      {bd.length > 0 && <div className="text-[10px] text-gray-600 dark:text-slate-400">{bd.join(' + ')}</div>}
    </div>
  )
}

// Per-section "Copy for Telegram" (copy-all) with non-blocking feedback.
function CopyAllButton({ rows }) {
  const [done, setDone] = useState(false)
  const tref = useRef(null)
  useEffect(() => () => { if (tref.current) clearTimeout(tref.current) }, [])
  async function copy() {
    if (!rows?.length) return
    try {
      await navigator.clipboard.writeText(telegramBlock(rows))
      setDone(true); if (tref.current) clearTimeout(tref.current); tref.current = setTimeout(() => setDone(false), 1500)
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button onClick={copy} className="text-[11px] font-medium px-2 py-1 rounded-md border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5" title="Copy this section for Telegram">
      {done ? '✓ Copied' : '✈ Telegram'}
    </button>
  )
}

// Financing sub-line for truck/trailer rows. Leases are the priority — they
// run 3–4× the loans, so an idle lease is the expensive bleed and gets an amber
// accent pill + key glyph. Loans get a muted pill with payoff status. Owned
// (incl. sold/totaled units the RPC downgrades to 'owned') render nothing.
function FinanceBadge({ row }) {
  const t = row.finance_type
  if (t === 'lease') {
    return (
      <div className="mt-1">
        <span
          title={row.finance_party ? `Vendor lease — ${row.finance_party}` : 'Vendor lease'}
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-300/70 dark:ring-amber-500/30"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 shrink-0"><path d="M7 14a4 4 0 1 1 3.874-5H22v3h-2v2h-2v-2h-2.126A4 4 0 0 1 7 14Zm-1.5-4.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" /></svg>
          Lease{row.finance_party ? ` · ${row.finance_party}` : ''}
        </span>
      </div>
    )
  }
  if (t === 'loan') {
    const status = row.loan_status === 'paid_off' ? 'Paid off' : 'Active'
    return (
      <div className="mt-1">
        <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400">
          {row.finance_party ? `${row.finance_party} · ${status}` : status}
        </span>
      </div>
    )
  }
  return null
}

export default function IdleReview() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('active') // 'active' | 'resolved'
  const [reviewFilter, setReviewFilter] = useState('all') // 'all' | 'reviewed' | 'needs' | 'pending' — separate axis
  const [financeFilter, setFinanceFilter] = useState('all') // 'all' | 'lease' | 'loan' | 'owned' — orthogonal axis (trucks/trailers)

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

  const activeRows = useMemo(() => (rows || []).filter(r => !r.resolved), [rows])
  const resolvedRows = useMemo(() => (rows || []).filter(r => r.resolved), [rows])

  const groupOf = (list) => {
    const g = { truck: [], trailer: [], driver: [] }
    // A backend-collapsed team is a driver-type subject on this page — list it
    // in the Drivers section alongside solo drivers.
    for (const r of list) {
      const bucket = r.subject_type === 'team' ? 'driver' : r.subject_type
      ;(g[bucket] || (g[bucket] = [])).push(r)
    }
    return g
  }
  // Cards + bubble count ACTIVE only (unaffected by the review filter), so
  // resolving a case lowers them.
  const activeGroups = useMemo(() => groupOf(activeRows), [activeRows])
  // The tables honor the Reviewed/Needs-review filter on top of Active/Resolved.
  // "Reviewed" = has a last_reviewed_at. Client-side, instant, no refetch.
  const viewGroups = useMemo(() => {
    const base = view === 'resolved' ? resolvedRows : activeRows
    let list = reviewFilter === 'all'
      ? base
      : reviewFilter === 'pending'
        ? base.filter(r => r.reason === 'Pending - TBD')
        : base.filter(r => (reviewFilter === 'reviewed' ? !!r.last_reviewed_at : !r.last_reviewed_at))
    // Financing axis ANDs on top. Driver rows carry a null finance_type, so
    // they fall out of lease/loan/owned automatically and only show under All.
    if (financeFilter !== 'all') list = list.filter(r => r.finance_type === financeFilter)
    return groupOf(list)
  }, [view, activeRows, resolvedRows, reviewFilter, financeFilter])

  // Counts for the review-filter chips, within the current Active/Resolved view.
  const reviewCounts = useMemo(() => {
    const base = view === 'resolved' ? resolvedRows : activeRows
    const reviewed = base.filter(r => !!r.last_reviewed_at).length
    const pending = base.filter(r => r.reason === 'Pending - TBD').length
    return { all: base.length, reviewed, needs: base.length - reviewed, pending }
  }, [view, activeRows, resolvedRows])

  // Counts for the Financing chips, within the current Active/Resolved view.
  const financeCounts = useMemo(() => {
    const base = view === 'resolved' ? resolvedRows : activeRows
    return {
      lease: base.filter(r => r.finance_type === 'lease').length,
      loan: base.filter(r => r.finance_type === 'loan').length,
      owned: base.filter(r => r.finance_type === 'owned').length,
    }
  }, [view, activeRows, resolvedRows])

  const sumCost = (list) => list.reduce((s, r) => s + (Number(r.monthly_cost) || 0), 0)

  // One call writes BOTH reason and note (the RPC overwrites both), so callers
  // pass the field they're editing plus the row's CURRENT value for the other.
  // Returns true on success so inline editors can show non-blocking feedback.
  async function setReason(row, reason, note) {
    try {
      const { error: err } = await supabase.rpc('set_idle_reason', {
        p_subject_type: row.subject_type, p_subject_id: row.subject_id,
        p_reason: reason || null, p_note: note || null,
      })
      if (err) throw err
      await load()
      return true
    } catch (e) {
      console.error('set_idle_reason failed:', e)
      return false
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
  async function reopen(row) {
    try {
      const { error: err } = await supabase.rpc('reopen_idle', { p_subject_type: row.subject_type, p_subject_id: row.subject_id })
      if (err) throw err
      await load()
    } catch (e) {
      console.error('reopen_idle failed:', e)
    }
  }

  const loading = rows === null
  const resolvedView = view === 'resolved'

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

      {/* Summary cards — active only */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label="Idle trucks"
          count={activeGroups.truck.length}
          sub={`${fmtMoney(sumCost(activeGroups.truck))}/mo carrying`}
          loading={loading}
          tip="A subject is idle when it's been 3+ days since its last load activity (latest pickup or delivery, booked loads included). The $/mo is the monthly carrying run-rate of currently-idle equipment — not accrued loss. Equipment idle is judged by its assigned driver's activity (truck-on-load data is incomplete), so routing through the driver is the reliable signal."
        />
        <SummaryCard label="Idle trailers" count={activeGroups.trailer.length} sub={`${fmtMoney(sumCost(activeGroups.trailer))}/mo carrying`} loading={loading} />
        <SummaryCard label="Idle drivers" count={activeGroups.driver.length} sub="not moving freight" loading={loading} />
      </div>

      {/* Filters: Active/Resolved (which spell) + Reviewed/Needs (review state). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs w-fit">
          {[['active', `Active (${activeRows.length})`], ['resolved', `Resolved (${resolvedRows.length})`]].map(([k, lbl]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 whitespace-nowrap ${view === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{lbl}</button>
          ))}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs w-fit">
          {[['all', `All (${reviewCounts.all})`], ['reviewed', `Reviewed (${reviewCounts.reviewed})`], ['needs', `Needs review (${reviewCounts.needs})`], ['pending', `Pending (${reviewCounts.pending})`]].map(([k, lbl]) => (
            <button key={k} onClick={() => setReviewFilter(k)} className={`px-3 py-1.5 whitespace-nowrap ${reviewFilter === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{lbl}</button>
          ))}
        </div>
        {/* Financing — orthogonal axis (equipment only). Labeled to set it apart. */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Financing</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs w-fit">
            {[['all', 'All'], ['lease', `Vendor lease (${financeCounts.lease})`], ['loan', `On loan (${financeCounts.loan})`], ['owned', `Owned (${financeCounts.owned})`]].map(([k, lbl]) => (
              <button key={k} onClick={() => setFinanceFilter(k)} className={`px-3 py-1.5 whitespace-nowrap ${financeFilter === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <button onClick={() => exportIdleExcel(viewGroups)} disabled={loading} className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40" title="Export Drivers / Trucks / Trailers (current filters) to Excel">↓ Export Excel</button>
      </div>

      {error && <div className={S.errorBox}>Couldn't load idle data: {error}</div>}

      {loading ? (
        <div className={`${S.card} p-12 text-center text-sm text-gray-500 dark:text-slate-500 animate-pulse`}>Finding idle subjects…</div>
      ) : (
        <>
          <IdleSection title="Trucks" kind="unit" rows={viewGroups.truck} reasons={UNIT_REASONS} resolvedView={resolvedView} reviewFilter={reviewFilter} financeFilter={financeFilter} onSetReason={setReason} onResolve={resolve} onReopen={reopen} />
          <IdleSection title="Trailers" kind="unit" rows={viewGroups.trailer} reasons={UNIT_REASONS} resolvedView={resolvedView} reviewFilter={reviewFilter} financeFilter={financeFilter} onSetReason={setReason} onResolve={resolve} onReopen={reopen} />
          <IdleSection title="Drivers" kind="driver" rows={viewGroups.driver} reasons={DRIVER_REASONS} resolvedView={resolvedView} reviewFilter={reviewFilter} financeFilter={financeFilter} onSetReason={setReason} onResolve={resolve} onReopen={reopen} />
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

function IdleSection({ title, kind, rows, reasons, resolvedView, reviewFilter, financeFilter, onSetReason, onResolve, onReopen }) {
  const columns = kind === 'unit' ? UNIT_COLUMNS : DRIVER_COLUMNS

  const [sort, setSort] = useState({ key: 'days', dir: 'desc' })
  const [expanded, setExpanded] = useState(false)
  const [reasonFilter, setReasonFilter] = useState('all') // 'all' | '__none__' | a reason

  // Per-section reason filter — scoped to this section's reason set, plus All
  // and Not-set. Client-side; ANDs with the view/review/finance filters (which
  // already narrowed `rows`).
  const filtered = useMemo(() => {
    if (reasonFilter === 'all') return rows
    if (reasonFilter === '__none__') return rows.filter(r => !r.reason)
    return rows.filter(r => r.reason === reasonFilter)
  }, [rows, reasonFilter])

  const sorted = useMemo(() => {
    // Reviewed view: stalest review first (last_reviewed_at ascending) so the
    // ones most due for a refresh sit at the top.
    if (reviewFilter === 'reviewed') {
      const ts = r => (r.last_reviewed_at ? new Date(r.last_reviewed_at).getTime() : Infinity)
      return [...filtered].sort((a, b) => ts(a) - ts(b))
    }
    // Vendor-lease view: costliest idle lease first — surface the biggest bleed.
    if (financeFilter === 'lease') {
      return [...filtered].sort((a, b) => (Number(b.monthly_cost) || 0) - (Number(a.monthly_cost) || 0))
    }
    const col = columns.find(c => c.key === sort.key) || columns[1]
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (col.type === 'text') return col.get(a).localeCompare(col.get(b)) * mul
      // severity + num both numeric; null/NaN treated as lowest.
      const av = col.get(a), bv = col.get(b)
      const na = av == null || !Number.isFinite(av) ? -Infinity : av
      const nb = bv == null || !Number.isFinite(bv) ? -Infinity : bv
      if (na === nb) return 0
      return (na - nb) * mul
    })
  }, [filtered, sort, columns, reviewFilter, financeFilter])

  const visible = expanded ? sorted : sorted.slice(0, CAP)

  // Under an active Financing filter, a section with no matching rows collapses
  // entirely (header included) — e.g. Drivers under "Vendor lease". The default
  // "None idle" placeholder stays for the unfiltered/review-filtered views.
  if (rows.length === 0 && financeFilter !== 'all') return null

  function toggleSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '')

  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title} <span className="font-normal text-gray-500 dark:text-slate-500">({reasonFilter === 'all' ? rows.length : `${filtered.length} of ${rows.length}`})</span></h2>
        {rows.length > 0 && (
          <div className="flex items-center gap-2">
            <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)}
              className="text-[11px] bg-white dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 rounded-md px-1.5 py-1 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              title="Filter this section by reason">
              <option value="all">All reasons</option>
              <option value="__none__">Not set</option>
              {reasons.map(rs => <option key={rs} value={rs}>{rs}</option>)}
            </select>
            <CopyAllButton rows={filtered} />
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
          {resolvedView ? 'No resolved cases in this group.' : 'None idle — everything in this group is moving.'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">No rows match this reason.</div>
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
                      {c.tip && (
                        <span
                          onClick={e => e.stopPropagation()}
                          className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-slate-600 text-[9px] text-gray-500 dark:text-slate-400 cursor-help align-middle"
                          title={c.tip}
                        >?</span>
                      )}
                    </th>
                  ))}
                  <th className={`${S.th} text-right`} />
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <IdleRow key={`${r.subject_type}:${r.subject_id}`} row={r} kind={kind} reasons={reasons} resolvedView={resolvedView} onSetReason={onSetReason} onResolve={onResolve} onReopen={onReopen} />
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

// Per-row note affordance: a note icon (filled when a note exists, hover shows
// a preview) opening a compact inline editor. Save preserves the row's current
// reason (the setter overwrites both fields). Non-blocking feedback.
function NoteButton({ row, onSetReason }) {
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null) // fixed-position anchor (escapes table overflow)
  const [draft, setDraft] = useState(row.reason_note || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const hasNote = !!(row.reason_note && row.reason_note.trim())
  const open = pos !== null

  function openEditor() {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 252) })
    setDraft(row.reason_note || ''); setErr('')
  }
  function close() { setPos(null); setSaving(false) }
  async function save() {
    setSaving(true); setErr('')
    const ok = await onSetReason(row, row.reason || '', draft.trim())
    if (ok) close()
    else { setErr('Save failed — try again'); setSaving(false) }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? close() : openEditor())}
        aria-label={hasNote ? 'Edit note' : 'Add note'}
        title={hasNote ? row.reason_note : 'Add note'}
        className={`p-1 rounded transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/60 ${hasNote ? 'text-orange-500 dark:text-orange-400' : 'text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400'}`}
      >
        {hasNote ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V5z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V5z" strokeLinejoin="round" /><path d="M8 9h8M8 12.5h5" strokeLinecap="round" /></svg>
        )}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => !saving && close()} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left }} className={`z-50 w-60 ${S.card} p-2 shadow-lg text-left`}>
            <textarea
              autoFocus rows={3} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a note…"
              className="w-full text-xs rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-1.5 text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-y"
            />
            {err && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{err}</div>}
            <div className="flex justify-end gap-1.5 mt-1.5">
              <button onClick={close} disabled={saving} className="text-[11px] px-2 py-1 rounded-md text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">Cancel</button>
              <button onClick={save} disabled={saving} className="text-[11px] px-2 py-1 rounded-md bg-orange-500 text-white font-medium hover:brightness-105 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}

// Always-visible note text, filling the open space to the right of the reason
// control. Short notes render in full; long ones clamp to ~3 lines with a small
// click "more/less" toggle (no hover-only reveal). Nothing renders when empty.
// Full note, wrapped within a bounded width (an auto-layout table won't wrap it
// otherwise — it would stretch the row). No truncation: the row grows in height.
function InlineNote({ text }) {
  return (
    <div className="min-w-0 max-w-[22rem] text-xs leading-snug text-left text-gray-500 dark:text-slate-400 whitespace-normal break-words [overflow-wrap:anywhere]">
      {text}
    </div>
  )
}

// Small "users" glyph marking a team row.
const TEAM_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4 shrink-0 text-orange-500 dark:text-orange-400" title="Team">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-1a4 4 0 0 0-3-3.87M9 20H2v-1a4 4 0 0 1 3-3.87m10-3.13a4 4 0 1 0-6 0M16 7a3 3 0 1 1 0 0M8 7a3 3 0 1 0 0 0" />
  </svg>
)

function IdleRow({ row, kind, reasons, resolvedView, onSetReason, onResolve, onReopen }) {
  const sev = severity(row)

  const daysCls = (row.days_idle ?? 0) >= 14 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-slate-300'

  // Auto-captured on every save — shown muted under the reason control.
  const reviewLine = (
    <div className="text-[10px] text-gray-600 dark:text-slate-400 mt-0.5">
      {row.last_reviewed_at ? `Reviewed ${fmtReviewed(row.last_reviewed_at)}` : 'Not reviewed'}
    </div>
  )

  // The note reads inline in the empty space to the right of the reason control
  // (the icon stays the edit trigger). Rendered for active and resolved alike.
  const noteTrimmed = row.reason_note && row.reason_note.trim()
  const inlineNote = noteTrimmed
    ? <div className="flex-1 min-w-0"><InlineNote text={noteTrimmed} /></div>
    : null

  // Active rows: editable reason dropdown + note popover. Resolved rows: read-only.
  const reasonCell = resolvedView ? (
    <div className="flex items-start gap-3">
      <div className="flex flex-col gap-0.5 shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[sev]}`} />
          <span className="text-gray-700 dark:text-slate-300">{row.reason || '— no reason —'}</span>
        </div>
        {reviewLine}
      </div>
      {inlineNote}
    </div>
  ) : (
    <div className="flex items-start gap-3">
      <div className="flex flex-col gap-0.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[sev]}`} title={sev === 'red' ? 'Needs attention' : sev === 'amber' ? 'Watch' : sev === 'available' ? 'Available' : 'Expected idle'} />
          <select
            value={row.reason || ''}
            onChange={e => onSetReason(row, e.target.value, row.reason_note || '')}
            className={`text-xs bg-white dark:bg-slate-800/80 border rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${row.reason ? 'border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200' : 'border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-400'}`}
          >
            <option value="">{row.reason ? '— Clear —' : 'set reason'}</option>
            {reasons.map(rs => <option key={rs} value={rs}>{rs}</option>)}
          </select>
          <NoteButton row={row} onSetReason={onSetReason} />
        </div>
        {reviewLine}
      </div>
      {inlineNote}
    </div>
  )

  const actionsCell = (
    <td className={`${S.td} text-right whitespace-nowrap align-top`}>
      <span className="inline-flex items-center gap-2">
        <CopyButton value={telegramStanza(row)} label="Copy this row for Telegram" />
        {resolvedView ? (
          <>
            <span className="text-[11px] text-gray-500 dark:text-slate-500">Resolved {fmtDateOnly(row.resolved_on)}</span>
            <button onClick={() => onReopen(row)} className={ROW_BTN} title="Retract this resolve — returns the case to Active for review">Reopen</button>
          </>
        ) : (
          <button onClick={() => onResolve(row)} className={ROW_BTN} title="Close this idle spell (sold, terminated, or back to work). Reversible from the Resolved tab.">Resolve</button>
        )}
      </span>
    </td>
  )

  if (kind === 'unit') {
    return (
      <tr className={S.tableRow}>
        <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200 align-top`}>
          <span className="inline-flex items-center gap-1.5">
            <SubjectLink row={row} />
            {row.label && <CopyButton value={row.label.replace(/^#/, '').trim()} label="Copy unit number" />}
          </span>
          <FinanceBadge row={row} />
          <LastLoadLine row={row} />
        </td>
        <td className={`${S.td} text-right font-mono align-top ${daysCls}`}>{fmtDays(row.days_idle)}</td>
        <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs align-top`}>
          {row.extra ? (
            <span className="inline-flex items-center gap-1.5">
              {row.extra}
              <CopyButton value={row.extra.trim()} label="Copy driver name" />
            </span>
          ) : '—'}
        </td>
        <td className={`${S.td} align-top`}><HoldingCell row={row} /></td>
        <td className={`${S.td} align-top`}>{reasonCell}</td>
        {actionsCell}
      </tr>
    )
  }
  // driver / team — one plain white row. A team row (backend-collapsed) renders
  // identically, just marked with a small team icon + a subtle team_name caption;
  // its label already holds both names and its controls carry subject_type
  // 'team' + the team id, so reason/resolve write to the whole team.
  const isTeam = row.subject_type === 'team'
  return (
    <tr className={S.tableRow}>
      <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200 align-top`}>
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          {isTeam && TEAM_ICON}
          {isTeam ? <span>{row.label || '—'}</span> : <SubjectLink row={row} />}
          {row.label && <CopyButton value={row.label.trim()} label={isTeam ? 'Copy team' : 'Copy driver name'} />}
          {row.detail && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">{row.detail}</span>}
        </span>
        {isTeam && row.team_name && <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{row.team_name}</div>}
        <LastLoadLine row={row} />
      </td>
      <td className={`${S.td} text-right font-mono align-top ${daysCls}`}>{fmtDays(row.days_idle)}</td>
      <td className={`${S.td} align-top`}><HoldingCell row={row} /></td>
      <td className={`${S.td} align-top`}>{reasonCell}</td>
      {actionsCell}
    </tr>
  )
}
