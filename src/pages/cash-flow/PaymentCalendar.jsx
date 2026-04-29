import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Select from '../../components/Select'
import {
  CF, addDays, endOfMonthGrid, fmtRange, startOfMonthGrid, startOfWeek, toISO,
} from './calendarUtils'
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

export default function PaymentCalendar() {
  const today = new Date()
  const [view, setView] = useState('week') // 'week' | 'month'
  const [anchor, setAnchor] = useState(today)         // any date inside the visible week (week view) or month (month view)
  const [entityFilter, setEntityFilter] = useState('') // '' = all
  const [entities, setEntities] = useState([])

  const [events, setEvents] = useState([])
  const [startingCashByWeek, setStartingCashByWeek] = useState({}) // iso(monday) -> number
  const [loading, setLoading] = useState(true)

  // Modal state
  const [showAddIncome, setShowAddIncome] = useState(false)
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [showRecurring, setShowRecurring] = useState(false)
  const [showStartingCash, setShowStartingCash] = useState(false)
  const [adjustLoanEvent, setAdjustLoanEvent] = useState(null) // event obj
  const [chipDetail, setChipDetail] = useState(null)
  const [defaultDate, setDefaultDate] = useState('')
  const [toast, setToast] = useState(null) // { message, link? }

  function showToast(message) {
    setToast({ message })
    setTimeout(() => setToast(null), 5000)
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

    const [evRes, cashRes] = await Promise.all([
      query,
      supabase.from('cash_positions').select('week_start_date, starting_cash').gte('week_start_date', startISO).lte('week_start_date', endISO),
    ])

    setEvents(evRes.data || [])

    const cashMap = {}
    for (const c of (cashRes.data || [])) cashMap[c.week_start_date] = Number(c.starting_cash || 0)
    setStartingCashByWeek(cashMap)

    setLoading(false)
  }

  // Group events by ISO date
  const eventsByDate = useMemo(() => {
    const map = {}
    for (const ev of events) {
      const k = ev.event_date
      if (!map[k]) map[k] = []
      map[k].push(ev)
    }
    return map
  }, [events])

  // Current-week sums (for right rail)
  const weekSums = useMemo(() => {
    const wsISO = toISO(weekStart)
    const weISO = toISO(addDays(weekStart, 6))
    let inSum = 0, outSum = 0
    for (const ev of events) {
      if (ev.event_date >= wsISO && ev.event_date <= weISO) {
        if (ev.direction === 'inflow') inSum += Number(ev.amount || 0)
        else outSum += Number(ev.amount || 0)
      }
    }
    return { inSum, outSum }
  }, [events, weekStart])

  // 4-week outlook
  const outlookWeeks = useMemo(() => {
    const out = []
    for (let i = 0; i < 4; i++) {
      const ws = addDays(weekStart, i * 7)
      const we = addDays(ws, 6)
      const wsISO = toISO(ws), weISO = toISO(we)
      let inflow = 0, outflow = 0
      for (const ev of events) {
        if (ev.event_date >= wsISO && ev.event_date <= weISO) {
          if (ev.direction === 'inflow') inflow += Number(ev.amount || 0)
          else outflow += Number(ev.amount || 0)
        }
      }
      out.push({ weekStart: ws, inflow, outflow })
    }
    return out
  }, [events, weekStart])

  // ── Drag-to-reschedule handler ─────────────────────────────────────────
  async function handleChipDrop(event, newDateISO) {
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
    if (res.error) { alert('Reschedule failed: ' + res.error.message); return }
    loadData()
  }

  // ── Chip click router ──────────────────────────────────────────────────
  function handleChipClick(event) {
    if (event.reference_type === 'loan') {
      setAdjustLoanEvent(event)
    } else {
      setChipDetail(event)
    }
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
        <button onClick={() => { setDefaultDate(toISO(new Date())); setShowAddIncome(true) }} className={CF.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Income
        </button>
        <button onClick={() => { setDefaultDate(toISO(new Date())); setShowAddExpense(true) }} className={CF.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Expense
        </button>
        <div className="ml-auto">
          <KebabMenu onManageRecurring={() => setShowRecurring(true)} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
      ) : view === 'week' ? (
        <>
          {/* Main grid + right rail */}
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 220px' }}>
            <WeekView
              weekStart={weekStart}
              eventsByDate={eventsByDate}
              onChipClick={handleChipClick}
              onChipDrop={handleChipDrop}
            />
            <RightRail
              weekStart={weekStart}
              startingCash={startingCashByWeek[toISO(weekStart)]}
              inflowSum={weekSums.inSum}
              outflowSum={weekSums.outSum}
              onEditCash={() => setShowStartingCash(true)}
            />
          </div>

          {/* 4-week outlook */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3 uppercase tracking-wide">4-Week Outlook</h3>
            <FourWeekOutlook
              baseWeekStart={weekStart}
              weeks={outlookWeeks}
              onJumpToWeek={(ws) => setAnchor(ws)}
            />
          </div>
        </>
      ) : (
        <MonthView
          monthAnchor={anchor}
          eventsByDate={eventsByDate}
          onDayClick={(d) => { setView('week'); setAnchor(d) }}
        />
      )}

      {/* Modals */}
      <AddIncomeModal open={showAddIncome} onClose={() => setShowAddIncome(false)} onSaved={loadData}
        defaultDate={defaultDateForModals} defaultEntityId={entityFilter || undefined} />
      <AddExpenseModal open={showAddExpense} onClose={() => setShowAddExpense(false)} onSaved={loadData}
        defaultDate={defaultDateForModals} defaultEntityId={entityFilter || undefined} />
      <RecurringExpensesModal open={showRecurring} onClose={() => setShowRecurring(false)} onSaved={loadData} />
      <AdjustLoanDateModal open={!!adjustLoanEvent} event={adjustLoanEvent} onClose={() => setAdjustLoanEvent(null)} onSaved={loadData} />
      <StartingCashModal open={showStartingCash} onClose={() => setShowStartingCash(false)} weekStart={weekStart} onSaved={loadData} />
      <ChipDetailPanel
        event={chipDetail}
        onClose={() => setChipDetail(null)}
        onChange={loadData}
        onOpenAdjustLoan={(ev) => { setChipDetail(null); setAdjustLoanEvent(ev) }}
        onOpenManageRecurring={() => { setChipDetail(null); setShowRecurring(true) }}
        onSuccess={showToast}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border border-emerald-200 dark:border-emerald-500/30 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            <span>{toast.message.replace(/\s*View it in AP Control →\s*$/, '')}</span>
            {toast.message.includes('AP Control') && (
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
