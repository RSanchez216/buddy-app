import { useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import { logEvent } from './utils/events'
import { fmtDate, fmtMoney } from './utils/format'
import { exportPurchasesXlsx } from './utils/exportPurchasesXlsx'
import KpiCards from './components/KpiCards'
import WarningPanels from './components/WarningPanels'
import PurchasesTable from './components/PurchasesTable'
import PurchaseFormModal from './components/PurchaseFormModal'

// Columns the user can sort by, with their default first-click direction.
// Anything else in the URL falls back to the application default (last
// charged DESC), keeping bookmarked URLs robust against typos.
const SORT_DEFAULT_DIR = {
  driver_name:       'asc',
  status:            'desc',
  payment_amount:    'asc',
  current_balance:   'desc',
  periods_behind:    'desc',
  owner_days_idle:   'desc',
  last_charged_date: 'desc',
  last_update_at:    'desc',
  linked:            'desc',
}

// Returns the final signed result for the (a, b, direction) triple,
// already accounting for direction. Returning final-signed (vs. raw +
// caller-multiplies) lets us pin NULLS LAST regardless of asc/desc:
// the null branches return a fixed +1/-1 instead of being flipped by
// the caller.
function compareByKey(a, b, key, dir) {
  const flip = dir === 'asc' ? 1 : -1
  if (key === 'status') {
    // Composite: active rows always group on top, then alphabetical by
    // status_name. The direction flip only affects the alphabetical
    // half — active-first is invariant.
    const aActive = a.is_active_state ? 1 : 0
    const bActive = b.is_active_state ? 1 : 0
    if (aActive !== bActive) return bActive - aActive
    return (a.status_name || '').localeCompare(b.status_name || '') * flip
  }
  if (key === 'linked') {
    const av = a.underlying_loan_id ? 1 : 0
    const bv = b.underlying_loan_id ? 1 : 0
    return (av - bv) * flip
  }
  if (key === 'driver_name') {
    return (a.driver_name || '').localeCompare(b.driver_name || '') * flip
  }
  if (key === 'payment_amount' || key === 'current_balance' || key === 'periods_behind') {
    return (Number(a[key] || 0) - Number(b[key] || 0)) * flip
  }
  if (key === 'owner_days_idle') {
    // Idle now follows the unit's effective driver (current driver if the unit
    // is used by someone other than the owner, else the owner). Falls back to
    // the owner_* fields when no unit-activity row merged. Running counts as 0
    // (least idle); no-completed-loads (null) sort last regardless of dir.
    const eff = (r) => {
      const running = r.effective_running ?? r.owner_running
      const idle = r.effective_days_idle ?? r.owner_days_idle
      return running ? 0 : (idle == null ? null : Number(idle))
    }
    const av = eff(a)
    const bv = eff(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1   // NULLS LAST
    if (bv == null) return -1
    return (av - bv) * flip
  }
  if (key === 'last_charged_date' || key === 'last_update_at') {
    const av = a[key]
    const bv = b[key]
    if (!av && !bv) return 0
    if (!av) return 1   // NULLS LAST regardless of dir
    if (!bv) return -1
    return (av < bv ? -1 : av > bv ? 1 : 0) * flip
  }
  return 0
}

const FILTERS = [
  { id: 'all',              label: 'All' },
  { id: 'active',           label: 'Active' },
  { id: 'behind',           label: 'Behind' },
  { id: 'under_review',     label: 'Under review' },
  { id: 'fully_paid',       label: 'Fully paid' },
  { id: 'title_pending',    label: 'Title pending', tone: 'amber' },
  { id: 'cancelled',        label: 'Cancelled' },
]

export default function DriverPurchasesPage() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const toast = useToast()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Inline-reconcile bookkeeping: a single undo toast at the page level
  // (records OR reconciles, depending on which target was clicked) and
  // a busy flag to suppress double-clicks while a request is in flight.
  // Live countdown via the same expiresAt + 1Hz forceTick pattern used
  // in PaymentHistorySection's toasts.
  const [inlineToast, setInlineToast] = useState(null)
  const [inlineBusy, setInlineBusy] = useState(false)
  const [, forceTick] = useReducer(x => x + 1, 0)
  useEffect(() => {
    if (!inlineToast) return
    const id = setInterval(forceTick, 1000)
    return () => clearInterval(id)
  }, [inlineToast])
  function remainingSeconds(t) {
    if (!t?.expiresAt) return 0
    return Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 1000))
  }

  // All list-page filter/sort state lives in the URL so refresh,
  // bookmarking, and back-from-detail preserve it. Filter + sort write
  // synchronously on click; search debounces (300ms) to avoid spamming
  // history with every keystroke.
  const [searchParams, setSearchParams] = useSearchParams()
  const rawKey = searchParams.get('sort')
  const rawDir = searchParams.get('dir')
  const sortKey = rawKey && SORT_DEFAULT_DIR[rawKey] ? rawKey : null
  const sortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : (sortKey ? SORT_DEFAULT_DIR[sortKey] : 'desc')
  // Filter is URL-derived with allowlist fallback. Bookmarks with
  // unknown values gracefully default to 'all' instead of breaking.
  const rawFilter = searchParams.get('filter')
  const filter = FILTERS.some(f => f.id === rawFilter) ? rawFilter : 'all'
  const urlQ = searchParams.get('q') || ''
  // Local search state mirrors what's in the input so keystrokes filter
  // immediately. A debounced effect (below) syncs it to the URL.
  const [search, setSearch] = useState(urlQ)

  // Back/forward navigation: URL changes → re-sync local search input
  // so the field doesn't drift away from what's actually being filtered.
  useEffect(() => { setSearch(urlQ) }, [urlQ])

  // Debounced URL write for search. The user sees their keystrokes
  // filter the table immediately (via local `search`), and 300ms after
  // the last keystroke we push the value to the URL via `replace` so
  // history doesn't get one entry per keystroke.
  useEffect(() => {
    if (search === urlQ) return
    const t = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        if (search.trim()) next.set('q', search.trim())
        else next.delete('q')
        return next
      }, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [search, urlQ, setSearchParams])

  function setFilter(nextId) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      // 'all' is the implicit default — keep the URL tidy by omitting it.
      if (nextId === 'all') next.delete('filter')
      else next.set('filter', nextId)
      return next
    }, { replace: true })
  }

  // 3-state cycle: unsorted → default direction → reverse → cleared.
  // Clicking a different column starts fresh on its default direction.
  function handleSort(nextKey) {
    if (!SORT_DEFAULT_DIR[nextKey]) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (sortKey !== nextKey) {
        next.set('sort', nextKey)
        next.set('dir', SORT_DEFAULT_DIR[nextKey])
      } else if (sortDir === SORT_DEFAULT_DIR[nextKey]) {
        // Currently at default direction → flip to opposite
        next.set('dir', SORT_DEFAULT_DIR[nextKey] === 'asc' ? 'desc' : 'asc')
      } else {
        // Already flipped → clear
        next.delete('sort')
        next.delete('dir')
      }
      return next
    }, { replace: true })
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // v_dp_unit_activity is one small row per contract keyed by dp_id — pull
    // it alongside the summary and merge so the idle cell can follow whoever
    // actually drives the unit now (not just the purchaser).
    // under_review lives on driver_purchases (not the summary view), so pull
    // the one boolean per contract and merge it by id (= summary row id).
    const [sumRes, actRes, urRes] = await Promise.all([
      supabase.from('v_driver_purchase_summary').select('*').order('driver_name'),
      supabase.from('v_dp_unit_activity').select('*'),
      supabase.from('driver_purchases').select('id, under_review'),
    ])
    if (sumRes.error) {
      console.error('Driver purchases load error:', sumRes.error)
      setRows([])
      setLoading(false)
      return
    }
    if (actRes.error) console.error('Unit activity load error:', actRes.error)
    if (urRes.error) console.error('Under-review flags load error:', urRes.error)
    const actById = new Map((actRes.data || []).map(a => [a.dp_id, a]))
    const reviewById = new Map((urRes.data || []).map(u => [u.id, u.under_review === true]))
    setRows((sumRes.data || []).map(r => {
      const act = actById.get(r.id)
      const base = act ? { ...r, ...act } : r
      return { ...base, under_review: reviewById.get(r.id) === true }
    }))
    setLoading(false)
  }

  // Inline reconcile click handler. Mirrors the logic in
  // PaymentHistorySection.reconcilePayment but works against the row's
  // view-computed target id rather than a payment passed by reference.
  // Two branches: combo (next_record_target_id present) or
  // reconcile-only (next_reconcile_only_target_id present).
  async function handleInlineReconcile(row) {
    if (!canEdit || inlineBusy || !row) return
    const nowIso = new Date().toISOString()

    if (row.next_record_target_id) {
      // Combo: record + reconcile in one UPDATE.
      const targetId = row.next_record_target_id
      const expected = Number(row.next_record_target_amount || 0)
      if (expected <= 0) {
        alert('No expected amount on this period — open the contract to record a custom amount.')
        return
      }
      setInlineBusy(true)
      // Fetch the row's current state so we can capture previousState
      // for the undo + check payment_source for the method default.
      const { data: payment, error: fetchErr } = await supabase
        .from('driver_purchase_payments')
        .select('id, payment_method, payment_source, actual_amount, reconciled, reconciled_at, reconciled_by, period_start, period_end')
        .eq('id', targetId)
        .single()
      if (fetchErr || !payment) {
        setInlineBusy(false)
        alert('Could not load target payment: ' + (fetchErr?.message || 'not found'))
        load()
        return
      }
      const methodDefault = payment.payment_method
        || (payment.payment_source === 'generated' ? 'payroll' : 'manual')
      const prev = {
        actual_amount: payment.actual_amount,
        payment_method: payment.payment_method,
        reconciled: payment.reconciled,
        reconciled_at: payment.reconciled_at,
        reconciled_by: payment.reconciled_by,
      }
      const { error } = await supabase
        .from('driver_purchase_payments')
        .update({
          actual_amount: expected,
          payment_method: methodDefault,
          reconciled: true,
          reconciled_at: nowIso,
          reconciled_by: user?.id || null,
          updated_at: nowIso,
        })
        .eq('id', targetId)
      setInlineBusy(false)
      if (error) { alert('Could not reconcile: ' + error.message); return }
      await logEvent(row.id, 'payment_recorded',
        `Recorded ${fmtMoney(expected)} for ${fmtDate(payment.period_start)} – ${fmtDate(payment.period_end)}`,
        { payment_id: targetId, amount: expected, method: methodDefault, combo: true, source: 'list_inline' },
        user?.id)
      await logEvent(row.id, 'payment_reconciled',
        `Reconciled payment for ${fmtDate(payment.period_start)} – ${fmtDate(payment.period_end)} (${fmtMoney(expected)})`,
        { payment_id: targetId, amount: expected, combo: true, source: 'list_inline' },
        user?.id)
      // Arm 10s undo toast and refetch so the row's targets advance.
      if (inlineToast?.timer) clearTimeout(inlineToast.timer)
      const timer = setTimeout(() => setInlineToast(null), 10000)
      setInlineToast({
        kind: 'combo',
        paymentId: targetId,
        purchaseId: row.id,
        prev,
        amount: expected,
        periodStart: payment.period_start,
        periodEnd: payment.period_end,
        timer,
        expiresAt: Date.now() + 10000,
      })
      load()
      return
    }

    if (row.next_reconcile_only_target_id) {
      // Amber-dot path: just flip reconciled.
      const targetId = row.next_reconcile_only_target_id
      setInlineBusy(true)
      const { data: payment, error: fetchErr } = await supabase
        .from('driver_purchase_payments')
        .select('id, actual_amount, reconciled, reconciled_at, reconciled_by, period_start, period_end')
        .eq('id', targetId)
        .single()
      if (fetchErr || !payment) {
        setInlineBusy(false); alert('Could not load target payment: ' + (fetchErr?.message || 'not found')); load(); return
      }
      const prev = {
        reconciled: payment.reconciled,
        reconciled_at: payment.reconciled_at,
        reconciled_by: payment.reconciled_by,
      }
      const { error } = await supabase
        .from('driver_purchase_payments')
        .update({ reconciled: true, reconciled_at: nowIso, reconciled_by: user?.id || null })
        .eq('id', targetId)
      setInlineBusy(false)
      if (error) { alert('Could not reconcile: ' + error.message); return }
      await logEvent(row.id, 'payment_reconciled',
        `Reconciled payment for ${fmtDate(payment.period_start)} – ${fmtDate(payment.period_end)} (${fmtMoney(payment.actual_amount)})`,
        { payment_id: targetId, amount: payment.actual_amount, source: 'list_inline' },
        user?.id)
      if (inlineToast?.timer) clearTimeout(inlineToast.timer)
      const timer = setTimeout(() => setInlineToast(null), 10000)
      setInlineToast({
        kind: 'reconcile',
        paymentId: targetId,
        purchaseId: row.id,
        prev,
        periodStart: payment.period_start,
        periodEnd: payment.period_end,
        timer,
        expiresAt: Date.now() + 10000,
      })
      load()
    }
  }

  async function undoInlineReconcile() {
    if (!inlineToast) return
    const { kind, paymentId, purchaseId, prev, periodStart, periodEnd, amount, timer } = inlineToast
    clearTimeout(timer)
    setInlineToast(null)
    setInlineBusy(true)
    const revert = kind === 'combo'
      ? {
          actual_amount: prev.actual_amount ?? 0,
          payment_method: prev.payment_method ?? null,
          reconciled: false,
          reconciled_at: null,
          reconciled_by: null,
          updated_at: new Date().toISOString(),
        }
      : { reconciled: false, reconciled_at: null, reconciled_by: null }
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update(revert)
      .eq('id', paymentId)
    setInlineBusy(false)
    if (error) { alert('Undo failed: ' + error.message); load(); return }
    if (kind === 'combo') {
      await logEvent(purchaseId, 'payment_unreconciled',
        `Unreconciled payment for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (undo)`,
        { payment_id: paymentId, undo: true, combo: true, source: 'list_inline' },
        user?.id)
      await logEvent(purchaseId, 'payment_record_undone',
        `Recording undone for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (${fmtMoney(amount)}) (undo)`,
        { payment_id: paymentId, amount, undo: true, combo: true, source: 'list_inline' },
        user?.id)
    } else {
      await logEvent(purchaseId, 'payment_unreconciled',
        `Unreconciled payment for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (undo)`,
        { payment_id: paymentId, undo: true, source: 'list_inline' },
        user?.id)
    }
    load()
  }

  // Toggle a contract's shared "under review" flag via the manager-gated RPC.
  // Optimistic: flip the row (and the tab count) immediately, reconcile to the
  // value the RPC returns, and roll back + toast if it errors/rejects.
  async function handleToggleReview(row) {
    if (!row) return
    const nextFlag = !row.under_review
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, under_review: nextFlag } : r))
    const { data, error } = await supabase.rpc('set_dp_under_review', { p_dp_id: row.id, p_flag: nextFlag })
    if (error) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, under_review: !nextFlag } : r))
      toast.error(nextFlag ? "Couldn't flag for review" : "Couldn't remove review flag", error)
      return
    }
    // RPC returns the new value — reconcile in case it differs from our guess.
    if (typeof data === 'boolean') {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, under_review: data } : r))
    }
  }

  // Counts per filter chip — computed off the unfiltered set
  const counts = useMemo(() => {
    const active     = rows.filter(r => r.is_active_state).length
    const fullyPaid  = rows.filter(r => r.status_name === 'Fully Paid').length
    const cancelled  = rows.filter(r =>
      r.status_name === 'Contract Broken' ||
      r.status_name === 'Driver Left' ||
      r.status_name === 'Owner Left' ||
      r.status_name === 'Total Loss'
    ).length
    const behind = rows.filter(r => r.is_behind).length
    const titlePending = rows.filter(r => r.title_release_pending).length
    // Live count of contracts flagged for review — updates as rows are
    // flagged/unflagged (rows carries the optimistic under_review value).
    const underReview = rows.filter(r => r.under_review).length
    return {
      all: rows.length, active, behind, under_review: underReview,
      fully_paid: fullyPaid, title_pending: titlePending, cancelled,
    }
  }, [rows])

  const visible = useMemo(() => {
    let list = rows
    if (filter === 'active')      list = list.filter(r => r.is_active_state)
    else if (filter === 'fully_paid') list = list.filter(r => r.status_name === 'Fully Paid')
    else if (filter === 'cancelled')  list = list.filter(r =>
      r.status_name === 'Contract Broken' ||
      r.status_name === 'Driver Left' ||
      r.status_name === 'Owner Left' ||
      r.status_name === 'Total Loss'
    )
    else if (filter === 'behind') list = list.filter(r => r.is_behind)
    else if (filter === 'under_review') list = list.filter(r => r.under_review)
    else if (filter === 'title_pending') list = list.filter(r => r.title_release_pending)

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(r =>
        (r.driver_name || '').toLowerCase().includes(q) ||
        (r.truck_number || '').toLowerCase().includes(q) ||
        (r.vin || '').toLowerCase().includes(q)
      )
    }

    // Apply sort. When no user sort is set, default to most-recently-
    // charged at the top with never-charged contracts at the bottom
    // (compareByKey pins nulls last regardless of direction).
    const effectiveKey = sortKey || 'last_charged_date'
    const effectiveDir = sortKey ? sortDir : 'desc'
    const sorted = [...list].sort((a, b) => {
      const cmp = compareByKey(a, b, effectiveKey, effectiveDir)
      // Tiebreaker on driver_name keeps sort output stable when the
      // primary key ties (common for $0 balances, status groups, etc).
      if (cmp !== 0) return cmp
      return (a.driver_name || '').localeCompare(b.driver_name || '')
    })
    return sorted
  }, [rows, filter, search, sortKey, sortDir])

  const underwaterRows = useMemo(() => rows.filter(r => r.is_underwater), [rows])

  // Fully paid + title not yet handed to driver. Sorted oldest-first so
  // the longest-overdue hand-offs surface at the top of the panel.
  const titlePendingRows = useMemo(() => {
    return rows
      .filter(r => r.title_release_pending)
      .sort((a, b) => {
        const da = a.fully_paid_date || a.updated_at || ''
        const db = b.fully_paid_date || b.updated_at || ''
        return da.localeCompare(db)
      })
  }, [rows])

  // Behind = view's is_behind flag, sorted by amount_behind desc so the
  // most severe contracts surface first. Each row carries amount_behind
  // and periods_behind so the warning panel can render a meaningful
  // secondary metric ("3 wks · $3,000").
  const behindRows = useMemo(() => {
    return rows
      .filter(r => r.is_behind)
      .map(r => ({
        ...r,
        // Friendly secondary string consumed by WarningPanels via its
        // existing { primary, secondary } shape — but we now also pass
        // the raw amount/periods through so the panel can format.
        periods_behind: Number(r.periods_behind || 0),
        amount_behind: Number(r.amount_behind || 0),
      }))
      .sort((a, b) => b.amount_behind - a.amount_behind)
  }, [rows])

  // Export the currently-visible set (active tab + search, all rows — the
  // list isn't paginated, so `visible` is the whole filtered result).
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      await exportPurchasesXlsx(visible)
    } catch (e) {
      console.error('Driver purchases export failed:', e)
      toast.error("Couldn't export to Excel", e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Financial Controls
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Driver Purchases</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Trucks and trailers sold to drivers, collected via payroll deduction.
          </p>
        </div>

        {canEdit && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white bg-orange-500 hover:bg-orange-400 transition-all shadow-lg shadow-orange-500/20"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New purchase
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : (
        <>
          <KpiCards rows={rows} />

          <WarningPanels
            behindRows={behindRows}
            underwaterRows={underwaterRows}
            titlePendingRows={titlePendingRows}
          />

          {/* Filter chips + search */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {FILTERS.map(f => {
                const isActive = filter === f.id
                // Amber-toned chips echo the title-release alert so the
                // visual relationship between panel ↔ chip ↔ badge is
                // obvious. Other chips keep the default cyan accent.
                const cls = f.tone === 'amber'
                  ? `px-3 py-1.5 text-sm rounded-xl border transition-colors ${
                      isActive
                        ? 'bg-amber-100 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300'
                        : 'border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                    }`
                  : S.filterBtn(isActive)
                return (
                  <button key={f.id} onClick={() => setFilter(f.id)} className={cls}>
                    {f.label}
                    <span className="ml-1.5 text-xs opacity-70">{counts[f.id] ?? 0}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search driver, unit, or VIN…"
                  className={`${S.input} pl-8 w-72`}
                />
                <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <button
                onClick={handleExport}
                disabled={exporting || visible.length === 0}
                title={visible.length === 0 ? 'Nothing to export' : `Export ${visible.length} row${visible.length === 1 ? '' : 's'} to Excel`}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-white/10 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                {exporting ? 'Exporting…' : 'Export to Excel'}
              </button>
            </div>
          </div>

          <PurchasesTable
            rows={visible}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            canEdit={canEdit}
            inlineBusy={inlineBusy}
            onInlineReconcile={handleInlineReconcile}
            onToggleReview={handleToggleReview}
            emptyMessage={filter === 'under_review' ? 'No contracts flagged for review yet.' : undefined}
          />
        </>
      )}

      <PurchaseFormModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onSaved={(newId) => {
          setShowNew(false)
          if (newId) navigate(`/financial-controls/driver-purchases/${newId}`)
        }}
      />

      {/* Inline reconcile undo toast — single page-level slot. Live
          countdown via the same expiresAt + 1Hz pattern used in the
          payment-history toasts. */}
      {inlineToast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 ${
            inlineToast.kind === 'combo'
              ? 'border-emerald-200 dark:border-emerald-500/30'
              : 'border-emerald-200 dark:border-emerald-500/30'
          }`}
        >
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-emerald-500" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            {inlineToast.kind === 'combo'
              ? <>Recorded &amp; reconciled {fmtMoney(inlineToast.amount)} for {fmtDate(inlineToast.periodStart)}.</>
              : <>Reconciled {fmtDate(inlineToast.periodStart)} payment.</>}
            {' '}
            <button onClick={undoInlineReconcile} className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline ml-1">
              Undo ({remainingSeconds(inlineToast)}s)
            </button>
          </div>
          <button
            onClick={() => { clearTimeout(inlineToast.timer); setInlineToast(null) }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
