import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Select from '../../components/Select'
import {
  CF, addDays, endOfMonthGrid, fmtRange, startOfMonthGrid, startOfWeek, toISO, isPaidStatus,
} from './calendarUtils'
import {
  bucketByDayAndBank, fetchProjectedBalances,
  sumByBankInRange, worstShortfallInRange,
} from './balanceCalc'
import WeekView from './WeekView'
import MonthView from './MonthView'
import RightRail from './RightRail'
import FourWeekOutlook from './FourWeekOutlook'
import AddIncomeModal from './AddIncomeModal'
import AddExpenseModal from './AddExpenseModal'
import RecurringExpensesModal from './RecurringExpensesModal'
import AdjustLoanDateModal from './AdjustLoanDateModal'
import StartingCashModal from './StartingCashModal'
import ChipDetailPanel from './ChipDetailPanel'
import UnassignedItemsPanel from './UnassignedItemsPanel'
import BalanceUpdatePromptBanner from './BalanceUpdatePromptBanner'
import { useAccountsNeedingBalanceUpdate } from './useAccountsNeedingBalanceUpdate'
import RecordBalanceEntryModal from '../settings/funding/RecordBalanceEntryModal'
import AdjustmentDetailsModal from '../settings/funding/AdjustmentDetailsModal'
import AddTransferModal from './AddTransferModal'
import QuickLineModal from './QuickLineModal'
import CoverTransferModal from './CoverTransferModal'
import BatchDetailModal from './BatchDetailModal'
import { useToast } from '../../contexts/ToastContext'

const SHOW_PAID_KEY = 'cf-show-paid'
const GROUP_BY_BANK_KEY = 'cf-group-by-bank'
const RAIL_MODE_KEY = 'cf-rail-mode'

export default function PaymentCalendar() {
  const { canEdit } = useAuth()
  const globalToast = useToast()
  const today = new Date()
  const [view, setView] = useState('week') // 'week' | 'month'
  const [anchor, setAnchor] = useState(today)         // any date inside the visible week (week view) or month (month view)
  const [entityFilter, setEntityFilter] = useState('') // '' = all
  const [entities, setEntities] = useState([])

  // "Show paid / received" toggle — persists in localStorage
  const [showPaid, setShowPaid] = useState(() => {
    try { return localStorage.getItem(SHOW_PAID_KEY) === 'true' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(SHOW_PAID_KEY, String(showPaid)) } catch (e) { /* noop */ }
  }, [showPaid])

  // Quick filter when toggle is ON: 'all' | 'pending' | 'paid'
  const [paidFilter, setPaidFilter] = useState('all')
  useEffect(() => { if (!showPaid) setPaidFilter('all') }, [showPaid])

  // Group-by-bank toggle — persists in localStorage
  const [groupByBank, setGroupByBank] = useState(() => {
    try { return localStorage.getItem(GROUP_BY_BANK_KEY) === 'true' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(GROUP_BY_BANK_KEY, String(groupByBank)) } catch (e) { /* noop */ }
  }, [groupByBank])

  // Right-rail mode — 'week' (weekly summary) or 'day' (single-day breakdown).
  // Persisted; selected day itself is NOT persisted.
  const [railMode, setRailMode] = useState(() => {
    try { return localStorage.getItem(RAIL_MODE_KEY) === 'day' ? 'day' : 'week' } catch { return 'week' }
  })
  useEffect(() => {
    try { localStorage.setItem(RAIL_MODE_KEY, railMode) } catch (e) { /* noop */ }
  }, [railMode])
  const [selectedDay, setSelectedDay] = useState(null) // ISO string or null

  const [events, setEvents] = useState([])
  const [accounts, setAccounts] = useState([])
  const [startingCashByWeek, setStartingCashByWeek] = useState({}) // iso(monday) -> number
  // Sub-category lookup for custom/recurring rows (Payroll / Insurance / etc.).
  // The view exposes the high-level bucket ('custom' | 'recurring') but the
  // batch line tag wants the fine-grained category — fetched once per load
  // and keyed by custom_outflows.id.
  const [customCategoryById, setCustomCategoryById] = useState({})
  const [loading, setLoading] = useState(true)

  // Modal state
  // The original AddIncome/AddExpense/AddTransfer modals stay mounted for
  // chip-edit flows; the toolbar uses QuickLineModal (kind='income'|'expense'|
  // 'transfer') as the lighter quick line-add path. null = closed.
  const [showAddIncome, setShowAddIncome] = useState(false)
  const [editInflowRow, setEditInflowRow] = useState(null) // expected_inflows row for edit, null for add
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [quickLineKind, setQuickLineKind] = useState(null) // 'income' | 'expense' | 'transfer' | null
  // Sub-tab seed for the Quick Line Add expense kind — only honored on
  // open; once the modal mounts it owns its own tab state. Used by the
  // Recurring Expenses settings page's deep link (`?add=recurring`).
  const [quickLineSubTab, setQuickLineSubTab] = useState(null)
  // Cover-with-transfer modal — null when closed. Shape:
  //   { mode: 'cover'|'list', targetAccountId: uuid|null }
  const [coverModalState, setCoverModalState] = useState(null)
  // Batch detail modal — null when closed. Shape:
  //   { kind: 'inflows'|'transfers'|'expenses', dayISO: 'YYYY-MM-DD' }
  const [batchModalState, setBatchModalState] = useState(null)
  const [showRecurring, setShowRecurring] = useState(false)
  const [showStartingCash, setShowStartingCash] = useState(false)
  const [adjustLoanEvent, setAdjustLoanEvent] = useState(null) // event obj
  const [chipDetail, setChipDetail] = useState(null)
  const [adjustmentDetail, setAdjustmentDetail] = useState(null) // adjustment id when classification modal is open
  // Transfer modal — null = closed, { transferId: null } = create, { transferId: <uuid> } = edit
  const [transferTarget, setTransferTarget] = useState(null)
  const [defaultDate, setDefaultDate] = useState('')
  // Toast can carry either:
  //   { message } — plain text, optional AP Control link inline
  //   { message, onClick, actionLabel } — clickable CTA (variance review)
  const [toast, setToast] = useState(null)

  function showToast(message) {
    setToast({ message })
    setTimeout(() => setToast(null), 5000)
  }
  function showVarianceToast(adjustmentId, amount, dateISO) {
    const sign = Number(amount) >= 0 ? '+' : '−'
    const abs = Math.abs(Number(amount || 0))
    const fmt = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
    setToast({
      tone: 'amber',
      message: `Variance of ${sign}${fmt} created an adjustment on ${dateISO}.`,
      actionLabel: 'Review →',
      onClick: () => { setAdjustmentDetail(adjustmentId); setToast(null) },
    })
    setTimeout(() => setToast(prev => (prev && prev.tone === 'amber' ? null : prev)), 12000)
  }

  const weekStart = useMemo(() => startOfWeek(anchor), [anchor])

  // Outlook spans current week + 3 weeks ahead — fetch range covers that
  const fetchRange = useMemo(() => {
    if (view === 'week') {
      const start = weekStart
      const end = addDays(weekStart, 6 + 7 * 3) // 4 weeks total
      return { start, end }
    }
    // Month view: fetch the visible month grid (5-6 weeks)
    return { start: startOfMonthGrid(anchor), end: endOfMonthGrid(anchor) }
  }, [view, weekStart, anchor])

  useEffect(() => { loadEntities() }, [])

  // Deep-link from /settings/recurring-expenses → ?add=recurring opens
  // the Quick Line Add modal pre-seeded on the Recurring tab so the
  // user can create a template from there (creation lives on this
  // page, not the settings list). Clear the param after consuming so
  // refreshes don't keep re-opening.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('add') === 'recurring') {
      setQuickLineKind('expense')
      setQuickLineSubTab('recurring')
      setSearchParams(prev => {
        const next = new URLSearchParams(prev)
        next.delete('add')
        return next
      }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadEntities() {
    const { data } = await supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name')
    setEntities(data || [])
  }

  useEffect(() => { loadData() /* eslint-disable-line */ }, [fetchRange.start.getTime(), fetchRange.end.getTime(), entityFilter])

  async function loadData() {
    setLoading(true)
    const startISO = toISO(fetchRange.start)
    const endISO = toISO(fetchRange.end)

    let query = supabase
      .from('v_cash_flow_events')
      .select('*')
      .gte('event_date', startISO)
      .lte('event_date', endISO)
    if (entityFilter) query = query.eq('entity_id', entityFilter)

    const [evRes, cashRes, accRes] = await Promise.all([
      query,
      supabase.from('cash_positions').select('week_start_date, starting_cash').gte('week_start_date', startISO).lte('week_start_date', endISO),
      supabase.from('funding_accounts')
        .select('id, name, bank_name, last_four, current_balance, balance_as_of_date, is_active')
        .eq('is_active', true)
        .order('name'),
    ])

    const allEvents = evRes.data || []
    setEvents(allEvents)
    setAccounts(accRes.data || [])

    // Sub-category fetch for the BatchCard line tag (Payroll / Insurance /
    // Telematics / etc.). v_cash_flow_events flattens this to 'custom' or
    // 'recurring'; we want the fine grain. One-shot lookup by id.
    const customIds = allEvents
      .filter(e => e.reference_type === 'custom' || e.reference_type === 'recurring')
      .map(e => e.reference_id)
    if (customIds.length) {
      const { data: cats } = await supabase
        .from('custom_outflows')
        .select('id, category')
        .in('id', customIds)
      const map = {}
      for (const r of (cats || [])) map[r.id] = r.category
      setCustomCategoryById(map)
    } else {
      setCustomCategoryById({})
    }

    const cashMap = {}
    for (const c of (cashRes.data || [])) cashMap[c.week_start_date] = Number(c.starting_cash || 0)
    setStartingCashByWeek(cashMap)

    setLoading(false)
  }

  // Visible events after the Show-paid toggle and quick-filter pill.
  // - Toggle OFF: drops paid/received entirely
  // - Toggle ON + filter='paid':    only paid/received
  // - Toggle ON + filter='pending': only not-yet-settled
  // - Toggle ON + filter='all':     everything
  const visibleEvents = useMemo(() => {
    return events.filter(ev => {
      const settled = isPaidStatus(ev.status)
      if (!showPaid) return !settled
      if (paidFilter === 'paid')    return settled
      if (paidFilter === 'pending') return !settled
      return true
    })
  }, [events, showPaid, paidFilter])

  // Group visible events by ISO date
  const eventsByDate = useMemo(() => {
    const map = {}
    for (const ev of visibleEvents) {
      const k = ev.event_date
      if (!map[k]) map[k] = []
      map[k].push(ev)
    }
    return map
  }, [visibleEvents])

  // Pick a sensible selectedDay when none is set or it falls outside the
  // visible week. Prefer today if it lands in this week; otherwise the first
  // day with events; otherwise the Monday.
  useEffect(() => {
    const wsISO = toISO(weekStart)
    const weISO = toISO(addDays(weekStart, 6))
    if (selectedDay && selectedDay >= wsISO && selectedDay <= weISO) return
    const todayISO = toISO(new Date())
    if (todayISO >= wsISO && todayISO <= weISO) { setSelectedDay(todayISO); return }
    const firstWithEvents = Array.from({ length: 7 }, (_, i) => toISO(addDays(weekStart, i)))
      .find(iso => (eventsByDate[iso] || []).length > 0)
    setSelectedDay(firstWithEvents || wsISO)
  }, [weekStart, eventsByDate, selectedDay])

  // Per-day per-bank totals + running-balance projections.
  // Projections always use the FULL event set (not filtered) so paid events
  // continue to affect future cash flow even when hidden by the toggle.
  const dayBuckets = useMemo(
    () => bucketByDayAndBank(visibleEvents, accounts),
    [visibleEvents, accounts]
  )

  const viewEndISO = useMemo(() => toISO(fetchRange.end), [fetchRange.end])
  // Projections now come from the projected_balances() RPC — one call
  // per active account, parallelized. Re-fetch when accounts, viewEnd,
  // or the underlying flow data (events / deposits) changes; the RPC
  // doesn't read those props, but their reload signals new data on the
  // server side that the projection should reflect.
  const [projections, setProjections] = useState({ timelines: {}, shortfallDays: new Set() })
  // Bumping balanceRefreshKey re-runs the projection effect AND the
  // stale-prompt hook below — both need to invalidate when a balance
  // entry lands. Neither otherwise re-runs on balance saves (accounts
  // / events / deposits don't change), so this is the explicit kick.
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    fetchProjectedBalances(accounts, viewEndISO).then(p => {
      if (!cancelled) setProjections(p)
    })
    return () => { cancelled = true }
  }, [accounts, viewEndISO, events, balanceRefreshKey])

  // Day mode (selectedDay set) collapses start = end = that day.
  // Otherwise the window is the visible week (Mon..Sun). Month view
  // also uses the current week — the prompt is a "this week's work"
  // surface, not a month-aggregate roll-up.
  const promptStartISO = selectedDay || toISO(weekStart)
  const promptEndISO = selectedDay || toISO(addDays(weekStart, 6))
  const { accounts: needsUpdateAccounts, idSet: needsUpdateIdSet, refetch: refetchNeedsUpdate } =
    useAccountsNeedingBalanceUpdate({ startDate: promptStartISO, endDate: promptEndISO })
  // Modal state — opened from the banner click OR the row Update link.
  // presetAccount carries the minimum shape the modal needs (id, name,
  // bank_name, last_four), built from either the hook row or the
  // calendar's full accounts list.
  const [recordTarget, setRecordTarget] = useState(null)
  function openRecordModal(account) {
    if (!account) return
    setRecordTarget({
      id: account.id || account.funding_account_id,
      name: account.name,
      bank_name: account.bank_name || null,
      last_four: account.last_four || null,
    })
  }
  function closeRecordModal() { setRecordTarget(null) }
  function onBalanceSaved(result) {
    setRecordTarget(null)
    setBalanceRefreshKey(k => k + 1)  // re-runs projection effect
    refetchNeedsUpdate()               // re-runs stale-prompt hook
    loadData()                          // pulls the adjustment chip into the visible event set
    // Variance feedback. If the trigger created an adjustment, surface it
    // with a clickable "Review" toast that opens the classification modal.
    // If projection matched (no adjustment row), give a quiet "matched" nudge.
    if (result?.adjustment) {
      // Trigger amount is signed; we kept it raw on the adjustment row.
      showVarianceToast(result.adjustment.id, result.adjustment.amount, result.adjustment.adjustment_date)
    } else if (result?.entryId) {
      showToast('Recorded balance matched projection — no variance.')
    }
  }

  const accountsMissingBalance = useMemo(
    () => accounts.filter(a => a.current_balance == null || !a.balance_as_of_date).length,
    [accounts]
  )

  // Current-week sums for the right rail.
  // Pending and settled are split — pending feeds the forward-looking Net /
  // projected end-of-week, settled feeds the new "Paid this week" lines.
  const weekSums = useMemo(() => {
    const wsISO = toISO(weekStart)
    const weISO = toISO(addDays(weekStart, 6))
    let inPending = 0, outPending = 0, inPaid = 0, outPaid = 0
    for (const ev of events) {
      if (ev.event_date < wsISO || ev.event_date > weISO) continue
      const settled = isPaidStatus(ev.status)
      const amt = Number(ev.amount || 0)
      if (ev.direction === 'inflow') {
        if (settled) inPaid += amt
        else inPending += amt
      } else {
        if (settled) outPaid += amt
        else outPending += amt
      }
    }
    return { inPending, outPending, inPaid, outPaid }
  }, [events, weekStart])

  // Per-bank net for the visible week — feeds the right-rail BY BANK section.
  const weekByBank = useMemo(() => {
    const wsISO = toISO(weekStart)
    const weISO = toISO(addDays(weekStart, 6))
    return sumByBankInRange(visibleEvents, accounts, wsISO, weISO)
  }, [visibleEvents, accounts, weekStart])

  // Worst-affected account in the visible week (negative balance forecast).
  const weekShortfall = useMemo(() => {
    const wsISO = toISO(weekStart)
    const weISO = toISO(addDays(weekStart, 6))
    return worstShortfallInRange(projections.timelines, wsISO, weISO)
  }, [projections, weekStart])

  // ── Day-mode rail data ───────────────────────────────────────────────────
  // The week-wide projections.timelines only contains rows from the most
  // recent anchor onward (the RPC walks forward from anchor → p_end_date).
  // When the user navigates to a past date that's BEFORE the current
  // anchor, byDate[selectedDay] is undefined → "balance not set" — even
  // though the function returns the right number if we call it with
  // p_end_date = selectedDay (it picks the most recent anchor on or before
  // that date). We do that second call here, in parallel per account.
  //
  // Value semantics for dayEndingByAccount[accId]:
  //   missing key → not yet fetched (fall back to week-wide timeline)
  //   number      → RPC found the selectedDay row; render this balance
  //   null        → RPC returned zero rows; render "balance not set"
  const [dayEndingByAccount, setDayEndingByAccount] = useState({})
  useEffect(() => {
    if (!selectedDay || accounts.length === 0) {
      setDayEndingByAccount({})
      return
    }
    let cancelled = false
    Promise.all(
      accounts.filter(a => a.is_active).map(async acc => {
        const { data } = await supabase.rpc('projected_balances', {
          p_funding_account_id: acc.id,
          p_end_date: selectedDay,
        })
        const row = (data || []).find(r => r.as_of_date === selectedDay)
        return [acc.id, row ? Number(row.ending_balance) : null]
      })
    ).then(entries => {
      if (cancelled) return
      setDayEndingByAccount(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [accounts, selectedDay, balanceRefreshKey])

  // Per-bank EOD balance for the selected day. Prefer the day-specific RPC
  // result (correct for past dates too) and fall back to the week-wide
  // timeline while the day-specific fetch is in flight.
  const dayProjections = useMemo(() => {
    if (!selectedDay) return []
    return accounts.map(acc => {
      if (acc.id in dayEndingByAccount) {
        return { account: acc, balance: dayEndingByAccount[acc.id] }
      }
      const t = projections.timelines[acc.id]
      const balance = t ? t.byDate[selectedDay] : null
      return { account: acc, balance: balance == null ? null : balance }
    })
  }, [accounts, projections, selectedDay, dayEndingByAccount])

  // Worst shortfall on the selected day. Prefer the day-specific RPC
  // values (correct for past dates) over the week-wide timelines (which
  // miss dates before the current anchor).
  const dayShortfall = useMemo(() => {
    if (!selectedDay) return null
    let worst = null
    for (const acc of accounts) {
      const balance = (acc.id in dayEndingByAccount)
        ? dayEndingByAccount[acc.id]
        : (projections.timelines[acc.id]?.byDate?.[selectedDay] ?? null)
      if (balance == null || balance >= 0) continue
      if (!worst || balance < worst.balance) worst = { account: acc, balance }
    }
    return worst
  }, [accounts, projections, selectedDay, dayEndingByAccount])

  // 4-week outlook — same split (pending vs paid) per week
  const outlookWeeks = useMemo(() => {
    const out = []
    for (let i = 0; i < 4; i++) {
      const ws = addDays(weekStart, i * 7)
      const we = addDays(ws, 6)
      const wsISO = toISO(ws), weISO = toISO(we)
      let inflow = 0, outflow = 0, paidOut = 0, receivedIn = 0
      for (const ev of events) {
        if (ev.event_date < wsISO || ev.event_date > weISO) continue
        const settled = isPaidStatus(ev.status)
        const amt = Number(ev.amount || 0)
        if (ev.direction === 'inflow') {
          if (settled) receivedIn += amt
          else inflow += amt
        } else {
          if (settled) paidOut += amt
          else outflow += amt
        }
      }
      out.push({ weekStart: ws, inflow, outflow, paidOut, receivedIn })
    }
    return out
  }, [events, weekStart])

  // ── Drag-to-reschedule handler ─────────────────────────────────────────
  async function handleChipDrop(event, newDateISO) {
    if (!canEdit) return
    if (!event.is_draggable) return
    const refType = event.reference_type
    const refId = event.reference_id
    let res
    if (refType === 'invoice') {
      res = await supabase.from('invoices').update({ planned_pay_date: newDateISO }).eq('id', refId)
    } else if (refType === 'custom' || refType === 'recurring') {
      res = await supabase.from('custom_outflows').update({ planned_pay_date: newDateISO, updated_at: new Date().toISOString() }).eq('id', refId)
    } else {
      return
    }
    if (res.error) { globalToast.error("Couldn't reschedule", res.error); return }
    globalToast.success(`Rescheduled to ${newDateISO}`)
    loadData()
  }

  // ── Chip click router ──────────────────────────────────────────────────
  // Most chips route through the side panel. Reconciliation adjustments
  // get a dedicated modal — different action set (classify, remove)
  // than the normal "open invoice / adjust loan" panel. Transfer legs
  // (both out and in) open the transfer edit modal — clicking either leg
  // edits the underlying transfer row.
  function handleChipClick(event) {
    if (event?.reference_type === 'adjustment') {
      setAdjustmentDetail(event.reference_id)
      return
    }
    if (event?.reference_type === 'transfer'
     || event?.reference_type === 'transfer_in'
     || event?.reference_type === 'transfer_out') {
      setTransferTarget({ transferId: event.reference_id })
      return
    }
    setChipDetail(event)
  }

  // ── Date nav ───────────────────────────────────────────────────────────
  function nav(delta) {
    if (view === 'week') {
      setAnchor(addDays(weekStart, delta * 7))
    } else {
      const next = new Date(anchor); next.setMonth(next.getMonth() + delta)
      setAnchor(next)
    }
  }
  function goToday() { setAnchor(new Date()) }

  // For Add modals — when user clicks +Add Income/Expense from a day cell future enhancement;
  // for now, default to current Monday.
  const defaultDateForModals = defaultDate || toISO(weekStart)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Cash Flow
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payment Calendar</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            {view === 'week' ? fmtRange(weekStart) : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* View toggle */}
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-xl">
            <button onClick={() => setView('week')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${view === 'week' ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm' : 'text-gray-500 dark:text-slate-400'}`}>
              Week
            </button>
            <button onClick={() => setView('month')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${view === 'month' ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm' : 'text-gray-500 dark:text-slate-400'}`}>
              Month
            </button>
          </div>

          {/* Show paid toggle */}
          <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border cursor-pointer transition-colors text-sm ${
            showPaid
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-white dark:bg-[#0d0d1f] border-gray-200 dark:border-white/5 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
          }`}>
            <input type="checkbox" checked={showPaid} onChange={e => setShowPaid(e.target.checked)} className="rounded" />
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Show paid
          </label>

          {/* Group-by-bank toggle */}
          <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border cursor-pointer transition-colors text-sm ${
            groupByBank
              ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
              : 'bg-white dark:bg-[#0d0d1f] border-gray-200 dark:border-white/5 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
          }`}>
            <input type="checkbox" checked={groupByBank} onChange={e => setGroupByBank(e.target.checked)} className="rounded" />
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Group by bank
          </label>

          {/* Date nav */}
          <div className="flex items-center gap-1 bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-xl">
            <button onClick={() => nav(-1)} className="px-2 py-1.5 text-gray-500 hover:text-orange-600 dark:hover:text-orange-400" title={view === 'week' ? 'Previous week' : 'Previous month'}>‹</button>
            <button onClick={goToday} className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-slate-300 hover:text-orange-600 dark:hover:text-orange-400 border-x border-gray-200 dark:border-white/5">
              {view === 'week' ? 'This Week' : 'This Month'}
            </button>
            <button onClick={() => nav(1)} className="px-2 py-1.5 text-gray-500 hover:text-orange-600 dark:hover:text-orange-400" title={view === 'week' ? 'Next week' : 'Next month'}>›</button>
          </div>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center flex-wrap gap-3">
        <Select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
          <option value="">All entities</option>
          {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
        </Select>
        {canEdit && (
          <>
            <QuickLineButton tone="income"   onClick={() => { setDefaultDate(selectedDay || toISO(new Date())); setQuickLineKind('income') }}>
              + Income line
            </QuickLineButton>
            <QuickLineButton tone="expense"  onClick={() => { setDefaultDate(selectedDay || toISO(new Date())); setQuickLineKind('expense') }}>
              + Expense line
            </QuickLineButton>
            <QuickLineButton tone="transfer" onClick={() => { setDefaultDate(selectedDay || toISO(new Date())); setQuickLineKind('transfer') }}>
              + Transfer line
            </QuickLineButton>
          </>
        )}
        {canEdit && (
          <div className="ml-auto">
            <KebabMenu onManageRecurring={() => setShowRecurring(true)} />
          </div>
        )}
      </div>

      {/* Unassigned items warning panel — sits above the grid; self-
          hides when zero items. Refetches the calendar on tag/undo so
          the "BY BANK: Unassigned" buckets clear in real time. */}
      <UnassignedItemsPanel onAssigned={loadData} />

      {/* Stale-balance prompt — soft blue, sits below the amber
          Unassigned panel. Renders only when the SQL function returns
          accounts with both staleness AND in-window movement. Click
          opens the Record Balance modal pre-filled with the first
          account; chain by clicking again after each save. */}
      <BalanceUpdatePromptBanner
        accounts={needsUpdateAccounts}
        isDayMode={!!selectedDay}
        dayISO={selectedDay}
        onOpenModal={openRecordModal}
      />

      {/* Quick filter pills — only visible when toggle is on */}
      {showPaid && (
        <div className="flex items-center gap-2 flex-wrap -mt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mr-1">View</span>
          {[
            { id: 'all', label: 'All' },
            { id: 'pending', label: 'Pending only' },
            { id: 'paid', label: 'Paid only' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setPaidFilter(f.id)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                paidFilter === f.id
                  ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
      ) : view === 'week' ? (
        <>
          {/* Main grid + right rail */}
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 240px' }}>
            <WeekView
              weekStart={weekStart}
              eventsByDate={eventsByDate}
              dayBuckets={dayBuckets}
              groupByBank={groupByBank}
              customCategoryById={customCategoryById}
              projectionTimelines={projections.timelines}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onChipClick={handleChipClick}
              onChipDrop={handleChipDrop}
              onOpenBatch={(kind, dayISO) => setBatchModalState({ kind, dayISO })}
            />
            <RightRail
              mode={railMode}
              setMode={setRailMode}
              weekStart={weekStart}
              startingCash={startingCashByWeek[toISO(weekStart)]}
              inflowSum={weekSums.inPending}
              outflowSum={weekSums.outPending}
              paidOutSum={weekSums.outPaid}
              receivedInSum={weekSums.inPaid}
              showPaid={showPaid}
              byBank={weekByBank}
              shortfall={weekShortfall}
              accountsMissingBalance={accountsMissingBalance}
              onEditCash={() => setShowStartingCash(true)}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              dayBucket={selectedDay ? dayBuckets[selectedDay] : null}
              dayShortfall={dayShortfall}
              dayProjections={dayProjections}
              needsUpdateIdSet={needsUpdateIdSet}
              onRecordBalance={openRecordModal}
              onCoverShortfall={(req) => setCoverModalState(req)}
            />
          </div>

          {/* 4-week outlook */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3 uppercase tracking-wide">4-Week Outlook</h3>
            <FourWeekOutlook
              baseWeekStart={weekStart}
              weeks={outlookWeeks}
              showPaid={showPaid}
              onJumpToWeek={(ws) => setAnchor(ws)}
            />
          </div>
        </>
      ) : (
        <MonthView
          monthAnchor={anchor}
          eventsByDate={eventsByDate}
          shortfallDays={projections.shortfallDays}
          showPaid={showPaid}
          onDayClick={(d) => { setView('week'); setAnchor(d) }}
        />
      )}

      {!loading && <CalendarLegend />}

      {/* Modals */}
      <AddIncomeModal
        open={showAddIncome || !!editInflowRow}
        editInflow={editInflowRow}
        onClose={() => { setShowAddIncome(false); setEditInflowRow(null) }}
        onSaved={loadData}
        defaultDate={defaultDateForModals}
        defaultEntityId={entityFilter || undefined}
      />
      <AddExpenseModal open={showAddExpense} onClose={() => setShowAddExpense(false)} onSaved={loadData}
        defaultDate={defaultDateForModals} defaultEntityId={entityFilter || undefined} />
      <RecurringExpensesModal open={showRecurring} onClose={() => setShowRecurring(false)} onSaved={loadData} />
      <AdjustLoanDateModal open={!!adjustLoanEvent} event={adjustLoanEvent} onClose={() => setAdjustLoanEvent(null)} onSaved={loadData} />
      <StartingCashModal open={showStartingCash} onClose={() => setShowStartingCash(false)} weekStart={weekStart} onSaved={loadData} />

      {/* Record Balance modal — opened from BalanceUpdatePromptBanner
          or the RightRail inline "Update" link. On save, kicks both
          the projection refetch (via balanceRefreshKey bump) and the
          stale-prompt hook refetch. */}
      <RecordBalanceEntryModal
        open={!!recordTarget}
        account={recordTarget}
        onClose={closeRecordModal}
        onSaved={onBalanceSaved}
      />
      <AdjustmentDetailsModal
        open={!!adjustmentDetail}
        adjustmentId={adjustmentDetail}
        onClose={() => setAdjustmentDetail(null)}
        onSaved={() => { setAdjustmentDetail(null); loadData(); setBalanceRefreshKey(k => k + 1) }}
      />
      <AddTransferModal
        open={!!transferTarget}
        transferId={transferTarget?.transferId || null}
        defaultDate={defaultDate || toISO(new Date())}
        onClose={() => setTransferTarget(null)}
        onSaved={() => { setTransferTarget(null); loadData(); setBalanceRefreshKey(k => k + 1) }}
      />
      <QuickLineModal
        open={!!quickLineKind}
        kind={quickLineKind}
        focusedDate={defaultDate || selectedDay || toISO(new Date())}
        defaultSubTab={quickLineSubTab}
        onClose={() => { setQuickLineKind(null); setQuickLineSubTab(null) }}
        onSaved={() => { setQuickLineKind(null); setQuickLineSubTab(null); loadData(); setBalanceRefreshKey(k => k + 1) }}
      />
      <CoverTransferModal
        open={!!coverModalState}
        initialTargetId={coverModalState?.mode === 'cover' ? coverModalState.targetAccountId : null}
        accountsWithEod={dayProjections.map(({ account, balance }) => ({ account, projEod: balance }))}
        todayISO={toISO(new Date())}
        onClose={() => setCoverModalState(null)}
        onSaved={() => { setCoverModalState(null); loadData(); setBalanceRefreshKey(k => k + 1) }}
      />
      <BatchDetailModal
        open={!!batchModalState}
        kind={batchModalState?.kind}
        dayISO={batchModalState?.dayISO}
        accounts={accounts}
        onClose={() => setBatchModalState(null)}
        onSaved={() => { setBatchModalState(null); loadData(); setBalanceRefreshKey(k => k + 1) }}
      />
      <ChipDetailPanel
        event={chipDetail}
        canEdit={canEdit}
        onClose={() => setChipDetail(null)}
        onChange={loadData}
        onOpenAdjustLoan={(ev) => { setChipDetail(null); setAdjustLoanEvent(ev) }}
        onOpenManageRecurring={() => { setChipDetail(null); setShowRecurring(true) }}
        onOpenEditInflow={(row) => { setChipDetail(null); setEditInflowRow(row) }}
        onSuccess={showToast}
      />

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 ${
          toast.tone === 'amber'
            ? 'border-amber-300 dark:border-amber-500/40'
            : 'border-emerald-200 dark:border-emerald-500/30'
        }`}>
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
            toast.tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
          }`} />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            <span>{toast.message.replace(/\s*View it in AP Control →\s*$/, '')}</span>
            {toast.onClick && toast.actionLabel && (
              <>
                {' '}
                <button onClick={toast.onClick} className="text-orange-600 dark:text-orange-400 hover:underline font-semibold">
                  {toast.actionLabel}
                </button>
              </>
            )}
            {!toast.onClick && toast.message.includes('AP Control') && (
              <>
                {' '}
                <Link to="/invoices" className="text-orange-600 dark:text-orange-400 hover:underline font-semibold">
                  View it in AP Control →
                </Link>
              </>
            )}
          </div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// Compact horizontal legend rendered below the calendar so it never
// competes for vertical space with the right rail.
function CalendarLegend() {
  return (
    <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Legend</span>
        <LegendItem swatchClass="bg-[#EAF3DE] dark:bg-[#1d2e0e]" textClass="text-[#27500A] dark:text-emerald-300" label="Inflow" />
        <LegendItem swatchClass="bg-[#FAEEDA] dark:bg-[#3a2710]" textClass="text-[#633806] dark:text-orange-300" label="Loan payment (locked)" />
        <LegendItem swatchClass="bg-[#E6F1FB] dark:bg-[#0f2233]" textClass="text-[#0C447C] dark:text-sky-300" label="AP bill" />
        <LegendItem swatchClass="bg-[#FCEBEB] dark:bg-[#371616]" textClass="text-[#791F1F] dark:text-red-300" label="Custom expense" />
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded bg-[#FCEBEB] dark:bg-[#371616]" style={{ borderLeft: '2px dashed #E24B4A' }} />
          <span className="text-gray-600 dark:text-slate-400 font-medium">Recurring (dashed left)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded bg-[#FEF3C7] dark:bg-[#3a2a05]" style={{ borderLeft: '3px solid #B45309' }} />
          <span className="text-[#854D0E] dark:text-amber-300 font-medium">Reconciliation — needs review</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded bg-[#E0F7FA] dark:bg-[#0e2a30]" style={{ borderLeft: '3px solid #0E7490' }} />
          <span className="text-[#0E7490] dark:text-cyan-300 font-medium">Inter-account transfer</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded bg-[#E0F7FA] dark:bg-[#0e2a30]" style={{ borderLeft: '2px dashed #0E7490' }} />
          <span className="text-[#0E7490] dark:text-cyan-300 font-medium">Transfer in transit (dashed left)</span>
        </span>
      </div>
    </div>
  )
}

function LegendItem({ swatchClass, textClass, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-3.5 h-3.5 rounded ${swatchClass}`} />
      <span className={`${textClass} font-medium`}>{label}</span>
    </span>
  )
}

// Lighter-weight toolbar button for the three quick line-add entry points.
// Tone controls the text accent only; the chrome is intentionally muted
// vs. the old solid Add buttons, since each click is one row in a multi-row
// form rather than a full standalone modal.
function QuickLineButton({ tone, onClick, children }) {
  const toneClass = {
    income:   'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 border-emerald-300/60 dark:border-emerald-500/30',
    expense:  'text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border-red-300/60 dark:border-red-500/30',
    transfer: 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 border-amber-300/60 dark:border-amber-500/30',
  }[tone] || ''
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-xl border bg-white dark:bg-[#0d0d1f] transition-colors ${toneClass}`}
    >
      {children}
    </button>
  )
}

// Kebab dropdown — overflow actions for the calendar header
function KebabMenu({ onManageRecurring }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onClickAway(e) {
      if (!e.target.closest?.('[data-kebab-menu]')) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [open])

  return (
    <div className="relative" data-kebab-menu>
      <button
        onClick={() => setOpen(o => !o)}
        title="More actions"
        className="w-9 h-9 inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-xl bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-xl py-1 z-20">
          <button
            onClick={() => { setOpen(false); onManageRecurring?.() }}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            Manage recurring expenses
          </button>
        </div>
      )}
    </div>
  )
}
