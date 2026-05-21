// Quick line-add modal for the Payment Calendar toolbar.
//
// One parameterized component for all three flow types — the table-of-rows
// pattern is identical, only the row schema and insert path differ. Each
// modal row is its own normalized entry (no batch_id, no shared identity);
// the BatchCard rendering in Phase 1 is the only thing that groups them
// visually on the day column.
//
// Existing modals (AddIncomeModal / AddExpenseModal / AddTransferModal)
// remain for chip edit flows. This is the lighter toolbar entry path.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Link } from 'react-router-dom'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import SuggestInput from '../../components/SuggestInput'
import { CF, fmtMoney, fmtMoneyExact, FREQUENCIES, WEEKDAYS } from './calendarUtils'
import { useFactors, formatFeeRate } from '../../hooks/useFactors'
import {
  useExpenseCategories,
  invalidateExpenseCategories,
} from '../../hooks/useExpenseCategories'
import {
  isValidCategoryName,
  dedupeCategory,
  defaultDisplayLabelFor,
} from '../../constants/expenseCategories'

const SURFACE = 'payment_calendar_quick_line_add'

// Verbatim per the rename brief. Reused on both the column header and
// every row's checkbox so the canonical example ("factoring fees
// deducted at source") is always one hover away.
const BANK_IMPACT_TOOLTIP =
  'Affects bank balance. Check for transactions that move money in or '
  + 'out of a bank account. Uncheck only for items netted from another '
  + 'transaction (e.g., factoring fees deducted at source).'

const KIND_LABEL = {
  income:   { title: 'Add income lines',   verb: 'income',   accent: 'emerald' },
  expense:  { title: 'Add expense lines',  verb: 'expense',  accent: 'red'     },
  transfer: { title: 'Add transfer lines', verb: 'transfer', accent: 'cyan'    },
}

function emptyIncomeRow(date)   {
  return {
    source_type: 'other',
    amount: '', source: '',
    factor_id: '', gross_amount: '',
    funding_account_id: '', expected_date: date || '', notes: '',
  }
}
function emptyExpenseRow(date)  { return { amount: '', description: '', category: '', funding_account_id: '', planned_pay_date: date || '', cash_impacting: true } }
function emptyTransferRow(date) { return { from_funding_account_id: '', to_funding_account_id: '', amount: '', debit_date: date || '', credit_date: date || '' } }

function emptyRow(kind, date) {
  if (kind === 'income')   return emptyIncomeRow(date)
  if (kind === 'transfer') return emptyTransferRow(date)
  return emptyExpenseRow(date)
}

function rowDate(row, kind) {
  if (kind === 'income')   return row.expected_date
  if (kind === 'transfer') return row.debit_date
  return row.planned_pay_date
}

function fmtAccountOption(a) {
  return a.bank_name ? `${a.name} (${a.bank_name})` : a.name
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

// Single source of truth for "net" — the dollar value that actually hits
// the bank — across an income row. Other rows: net = amount. Factor rows:
// net = gross × (1 − fee_rate), with a 0 fallback when factor / gross
// isn't filled in yet so the footer total degrades gracefully on partial
// rows. Both the row-level NET cell and the footer Total call this so
// the displayed number can't drift from the one in the total.
function computeIncomeNet(row, factorsById) {
  if (!row) return 0
  if (row.source_type === 'factor') {
    const gross = Number(row.gross_amount)
    if (!gross || gross <= 0) return 0
    const factor = row.factor_id ? factorsById?.get(row.factor_id) : null
    if (!factor) return 0
    const feeRate = Number(factor.fee_rate || 0)
    return round2(gross * (1 - feeRate))
  }
  const amt = Number(row.amount)
  if (!amt || amt <= 0) return 0
  return amt
}

// ── Recurring tab — pure helpers and constants ─────────────────────────────

const FREQUENCY_LABEL = {
  weekly:       'Weekly',
  biweekly:     'Biweekly (every 2 weeks)',
  semimonthly:  'Semimonthly (twice a month)',
  monthly:      'Monthly',
  quarterly:    'Quarterly',
  annually:     'Annually',
}

const WEEKLY_FREQS    = new Set(['weekly', 'biweekly'])
const MONTHLY_FREQS   = new Set(['semimonthly', 'monthly', 'quarterly', 'annually'])

function emptyRecurringForm() {
  return {
    name: '',
    amount: '',
    category: '',
    funding_account_id: '',
    frequency: 'monthly',
    day_of_week: 4,         // Thursday — common payroll/transfer day
    day_of_month: 1,
    second_day_of_month: 15,
    start_date: '',
    end_date: '',
    notes: '',
  }
}

// Chicago-local YYYY-MM-DD. Same idea as the helper in AddTransferModal —
// we never let `new Date()` drive a date field directly because it would
// silently shift on UTC-evening edits.
function chicagoTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function _parseISODate(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate()
}

// Next future date matching the chosen weekday (0 Sun … 6 Sat). If today
// matches, today qualifies — the brief says "next future occurrence" with
// the example of Tue → Thu landing on the immediate Thursday, implying
// inclusive-of-today.
function nextDateForWeekday(targetDow) {
  const todayISO = chicagoTodayISO()
  const today = _parseISODate(todayISO)
  const diff = (Number(targetDow) - today.getDay() + 7) % 7
  const target = new Date(today)
  target.setDate(today.getDate() + diff)
  return toISOLocal(target)
}

// Next future date matching the chosen day-of-month (1–31). If today's
// day-of-month is on/before the target, use this month; otherwise roll
// to next month. Day-of-month clamps to the month's actual length when
// the target exceeds the month (e.g., 31 in February).
function nextDateForDayOfMonth(targetDom) {
  const todayISO = chicagoTodayISO()
  const today = _parseISODate(todayISO)
  const day = Math.max(1, Math.min(31, Number(targetDom) || 1))
  let year = today.getFullYear()
  let month = today.getMonth()
  if (today.getDate() > day) {
    month += 1
    if (month > 11) { month = 0; year += 1 }
  }
  const clamped = Math.min(day, daysInMonth(year, month))
  return toISOLocal(new Date(year, month, clamped))
}

function toISOLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Smart start_date suggestion based on the current frequency + day fields.
// Returns null when the relevant day field isn't filled in yet.
function suggestStartDate(form) {
  if (WEEKLY_FREQS.has(form.frequency))  return nextDateForWeekday(form.day_of_week)
  if (MONTHLY_FREQS.has(form.frequency)) {
    if (form.frequency === 'semimonthly') {
      // Earliest of the two days that's on/after today.
      const a = nextDateForDayOfMonth(form.day_of_month)
      const b = nextDateForDayOfMonth(form.second_day_of_month)
      return a < b ? a : b
    }
    return nextDateForDayOfMonth(form.day_of_month)
  }
  return null
}

// Returns a warning string when the picked start_date doesn't line up with
// the chosen day pattern. Empty string when consistent or unanswerable.
function startDateWarning(form) {
  if (!form.start_date) return ''
  const d = _parseISODate(form.start_date)
  if (!d) return ''
  if (WEEKLY_FREQS.has(form.frequency)) {
    if (d.getDay() !== Number(form.day_of_week)) {
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' })
      return `Start date is a ${dayName} — recurrences will follow this date, not the selected day.`
    }
  } else if (MONTHLY_FREQS.has(form.frequency)) {
    const dom = d.getDate()
    if (form.frequency === 'semimonthly') {
      if (dom !== Number(form.day_of_month) && dom !== Number(form.second_day_of_month)) {
        return `Start date day-of-month (${dom}) doesn't match either of the selected days — recurrences will follow this date.`
      }
    } else if (dom !== Number(form.day_of_month)) {
      return `Start date day-of-month (${dom}) doesn't match the selected day (${form.day_of_month}) — recurrences will follow this date.`
    }
  }
  return ''
}

// Per-row validation. Returns { isValid, errors } where errors is keyed by
// the field name that failed. Field names match the row keys so the render
// can red-flag the right input.
function validateRow(row, kind, factorsById) {
  const errors = {}
  if (kind === 'income') {
    if (!row.funding_account_id) errors.funding_account_id = 'Required'
    if (!row.expected_date)      errors.expected_date = 'Required'
    if (row.source_type === 'factor') {
      if (!row.factor_id)         errors.factor_id = 'Required'
      const gross = Number(row.gross_amount)
      if (!row.gross_amount || Number.isNaN(gross) || gross <= 0) errors.gross_amount = 'Gross must be > 0'
      // Factor must still exist (defensive — if user picked one then it
      // got archived in a parallel tab, the dropdown still shows it but
      // a sanity-check here surfaces the issue early).
      if (row.factor_id && factorsById && !factorsById.get(row.factor_id)) errors.factor_id = 'Pick a factor'
    } else {
      const amt = Number(row.amount)
      if (!row.amount || Number.isNaN(amt) || amt <= 0) errors.amount = 'Amount must be > 0'
      if (!row.source?.trim()) errors.source = 'Required'
    }
    return { isValid: Object.keys(errors).length === 0, errors }
  }
  const amt = Number(row.amount)
  if (!row.amount || Number.isNaN(amt) || amt <= 0) errors.amount = 'Amount must be > 0'
  if (kind === 'expense') {
    if (!row.description?.trim())  errors.description = 'Required'
    if (!row.category?.trim())     errors.category = 'Required'
    if (!row.funding_account_id)   errors.funding_account_id = 'Required'
    if (!row.planned_pay_date)     errors.planned_pay_date = 'Required'
  } else if (kind === 'transfer') {
    if (!row.from_funding_account_id) errors.from_funding_account_id = 'Required'
    if (!row.to_funding_account_id)   errors.to_funding_account_id = 'Required'
    if (row.from_funding_account_id && row.to_funding_account_id
        && row.from_funding_account_id === row.to_funding_account_id) {
      errors.to_funding_account_id = 'From and To must differ'
    }
    if (!row.debit_date)  errors.debit_date = 'Required'
    if (!row.credit_date) errors.credit_date = 'Required'
    if (row.debit_date && row.credit_date && row.credit_date < row.debit_date) {
      errors.credit_date = 'Credit on/after debit'
    }
  }
  return { isValid: Object.keys(errors).length === 0, errors }
}

export default function QuickLineModal({ open, kind, focusedDate, defaultSubTab, onClose, onSaved }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const { active: activeFactors, byId: factorsById } = useFactors()
  const {
    active: activeCategories,
    archived: archivedCategories,
    labelByName: categoryLabelByName,
    refetch: refetchCategories,
  } = useExpenseCategories()
  // Per-row inline "+ Add new category" mode — when set, that row's
  // Category cell renders a small text input with Save / Cancel instead
  // of the dropdown.
  const [addingCategoryForRowIdx, setAddingCategoryForRowIdx] = useState(null)
  // Sub-tab for the expense kind: 'one-time' (existing multi-row form) or
  // 'recurring' (single template form). Income / transfer ignore this state.
  const [expenseSubTab, setExpenseSubTab] = useState('one-time')
  const [recurringForm, setRecurringForm] = useState(emptyRecurringForm())
  const [recurringErrors, setRecurringErrors] = useState({})
  // User-edited flag — once the user has touched start_date, stop auto-
  // recomputing it from the frequency / day inputs so we don't stomp on
  // an intentional pick.
  const [recurringStartTouched, setRecurringStartTouched] = useState(false)

  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [knownSources, setKnownSources] = useState([])
  const [rowErrors, setRowErrors] = useState({}) // { [index]: { field: msg } }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Initial / reset state when the modal opens (or kind changes).
  useEffect(() => {
    if (!open || !kind) return
    setRows([emptyRow(kind, focusedDate)])
    setRowErrors({})
    setAddingCategoryForRowIdx(null)
    setError('')
    // Expense tabs + recurring form reset together with the rest. The
    // recurring form is only rendered when kind === 'expense' but we
    // reset anyway so re-opening the modal in the same session starts
    // fresh.
    // defaultSubTab lets callers (e.g. the Recurring Expenses settings
    // page's deep link) open straight onto the Recurring tab. Falls
    // back to 'one-time' which matches the prior default.
    setExpenseSubTab(defaultSubTab === 'recurring' ? 'recurring' : 'one-time')
    setRecurringForm(emptyRecurringForm())
    setRecurringErrors({})
    setRecurringStartTouched(false)
    let cancelled = false
    ;(async () => {
      const tasks = [
        supabase.from('funding_accounts')
          .select('id, name, bank_name')
          .eq('is_active', true)
          .order('name'),
      ]
      if (kind === 'income') {
        // Source suggestions are the prior 'other' sources only — factor
        // entries have their source synthesized from the factor name, so
        // surfacing them as autocomplete suggestions would just clutter
        // the picker.
        tasks.push(
          supabase.from('expected_inflows')
            .select('source')
            .not('source', 'is', null)
            .eq('source_type', 'other')
        )
      }
      const results = await Promise.all(tasks)
      if (cancelled) return
      setAccounts(results[0].data || [])
      if (kind === 'income') {
        const sources = [...new Set((results[1].data || []).map(r => r.source).filter(Boolean))].sort()
        setKnownSources(sources)
      }
      // Expense categories now come from the useExpenseCategories hook
      // (reference table) rather than DISTINCT-from-data; no fetch here.
    })()
    return () => { cancelled = true }
  }, [open, kind, focusedDate, defaultSubTab])

  // Smart start_date suggestion for the recurring tab. Re-runs when
  // frequency / day fields change, but never overrides a user-typed
  // start_date — recurringStartTouched flips the first time the user
  // edits the field directly.
  useEffect(() => {
    if (!open || kind !== 'expense' || expenseSubTab !== 'recurring') return
    if (recurringStartTouched) return
    const suggested = suggestStartDate(recurringForm)
    if (!suggested || suggested === recurringForm.start_date) return
    setRecurringForm(f => ({ ...f, start_date: suggested }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open, kind, expenseSubTab, recurringStartTouched,
    recurringForm.frequency,
    recurringForm.day_of_week,
    recurringForm.day_of_month,
    recurringForm.second_day_of_month,
  ])

  const meta = kind ? KIND_LABEL[kind] : null

  function addRow() {
    setRows(prev => {
      // New rows inherit the first row's date — the user is filling THIS
      // day's batch, not today's by default.
      const firstDate = prev[0] ? rowDate(prev[0], kind) : focusedDate
      return [...prev, emptyRow(kind, firstDate)]
    })
  }
  function removeRow(i) {
    setRows(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))
    // Drop any error entry for the removed row and re-index the rest.
    setRowErrors(prev => {
      const next = {}
      for (const k of Object.keys(prev)) {
        const idx = Number(k)
        if (idx === i) continue
        next[idx > i ? idx - 1 : idx] = prev[k]
      }
      return next
    })
  }
  function updateRow(i, field, value) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
    // Clear field-level error as soon as the user touches the field.
    if (rowErrors[i]?.[field]) {
      setRowErrors(prev => {
        const next = { ...prev }
        const { [field]: _, ...rest } = next[i] || {}
        if (Object.keys(rest).length === 0) delete next[i]
        else next[i] = rest
        return next
      })
    }
  }

  // Footer Total. Income kind uses computeIncomeNet so factor rows
  // contribute their computed NET (the dollar that hits the bank) rather
  // than the empty `amount` field; expense / transfer kinds sum the
  // typed amount as before.
  const totalAmount = useMemo(() => {
    if (kind === 'income') {
      return rows.reduce((s, r) => s + computeIncomeNet(r, factorsById), 0)
    }
    return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  }, [rows, kind, factorsById])

  async function writeAuditLogEntries(tableName, recordIds, total) {
    // Best-effort audit batch. If this fails the user's save still
    // succeeded — log to console and move on.
    if (!recordIds.length) return
    const entries = recordIds.map((id, idx) => ({
      table_name: tableName,
      record_id: id,
      action: 'insert',
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: { surface: SURFACE, line_index: idx, line_total: total },
    }))
    const { error: e } = await supabase.from('audit_log').insert(entries)
    if (e) console.warn('[QuickLineModal] audit_log batch insert failed:', e.message)
  }

  async function saveIncome() {
    // Per row, compute the net amount + synthesized source for factor
    // entries. Both branches collapse to a (parent expected_inflows,
    // child expected_inflow_deposit) pair, matching the existing
    // single-deposit-per-inflow pattern.
    const parents = rows.map(r => {
      if (r.source_type === 'factor') {
        const factor = factorsById.get(r.factor_id)
        const gross = round2(Number(r.gross_amount))
        const net   = round2(gross * (1 - Number(factor?.fee_rate || 0)))
        return {
          source: `Factor — ${factor?.name || ''}`,
          source_type: 'factor',
          factor_id: r.factor_id,
          gross_amount: gross,
          amount: net,
          expected_date: r.expected_date,
          description: r.notes?.trim() || null,
          status: 'pending',
          created_by: user?.id || null,
        }
      }
      return {
        source: r.source.trim(),
        source_type: 'other',
        factor_id: null,
        gross_amount: null,
        amount: Number(r.amount),
        expected_date: r.expected_date,
        description: r.notes?.trim() || null,
        status: 'pending',
        created_by: user?.id || null,
      }
    })

    const { data: inserted, error: pErr } = await supabase
      .from('expected_inflows')
      .insert(parents)
      .select('id')
    if (pErr || !inserted) throw new Error(pErr?.message || 'Failed to create inflow rows')
    const ids = inserted.map(p => p.id)

    const deposits = rows.map((r, i) => {
      const netAmount = r.source_type === 'factor'
        ? round2(Number(r.gross_amount) * (1 - Number(factorsById.get(r.factor_id)?.fee_rate || 0)))
        : Number(r.amount)
      return {
        expected_inflow_id: ids[i],
        funding_account_id: r.funding_account_id,
        amount: netAmount,
        position: 0,
      }
    })
    const { error: dErr } = await supabase.from('expected_inflow_deposits').insert(deposits)
    if (dErr) {
      await supabase.from('expected_inflows').delete().in('id', ids)
      throw new Error(dErr.message)
    }

    // Per-row audit metadata captures the factor distinction so future
    // reporting can filter by surface + source_type.
    const auditMeta = rows.map((r, idx) => ({
      surface: SURFACE,
      line_index: idx,
      line_total: rows.length,
      source_type: r.source_type,
      factor_id: r.source_type === 'factor' ? r.factor_id : null,
    }))
    await supabase.from('audit_log').insert(ids.map((id, i) => ({
      table_name: 'expected_inflows',
      record_id: id,
      action: 'insert',
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: auditMeta[i],
    })))
    return ids
  }

  async function saveExpense() {
    const payload = rows.map(r => ({
      due_date: r.planned_pay_date,
      planned_pay_date: r.planned_pay_date,
      description: r.description.trim(),
      amount: Number(r.amount),
      category: r.category.trim(),
      funding_account_id: r.funding_account_id,
      cash_impacting: !!r.cash_impacting,
      status: 'planned',
      created_by: user?.id || null,
    }))
    const { data: inserted, error: e } = await supabase
      .from('custom_outflows')
      .insert(payload)
      .select('id')
    if (e || !inserted) throw new Error(e?.message || 'Failed to create expense rows')
    const ids = inserted.map(r => r.id)
    await writeAuditLogEntries('custom_outflows', ids, rows.length)
    return ids
  }

  async function saveTransfer() {
    const payload = rows.map(r => ({
      from_funding_account_id: r.from_funding_account_id,
      to_funding_account_id: r.to_funding_account_id,
      amount: Number(r.amount),
      debit_date: r.debit_date,
      credit_date: r.credit_date,
      created_by: user?.id || null,
    }))
    const { data: inserted, error: e } = await supabase
      .from('funding_account_transfers')
      .insert(payload)
      .select('id')
    if (e || !inserted) throw new Error(e?.message || 'Failed to create transfer rows')
    const ids = inserted.map(r => r.id)
    await writeAuditLogEntries('funding_account_transfers', ids, rows.length)
    return ids
  }

  // Per-field validation for the recurring template form. Mirrors the
  // brief's validation table; warnings (start_date weekday / day-of-month
  // mismatch) are surfaced inline via startDateWarning() and NOT
  // blocking.
  function validateRecurring(form) {
    const errors = {}
    if (!form.name?.trim())            errors.name = 'Required'
    const amt = Number(form.amount)
    if (!form.amount || Number.isNaN(amt) || amt <= 0) errors.amount = 'Amount must be > 0'
    if (!form.category?.trim())        errors.category = 'Required'
    if (!form.funding_account_id)      errors.funding_account_id = 'Required'
    if (!form.frequency)               errors.frequency = 'Required'
    if (WEEKLY_FREQS.has(form.frequency)) {
      const dow = Number(form.day_of_week)
      if (!(dow >= 0 && dow <= 6))     errors.day_of_week = 'Required'
    } else if (MONTHLY_FREQS.has(form.frequency)) {
      const dom = Number(form.day_of_month)
      if (!(dom >= 1 && dom <= 31))    errors.day_of_month = '1–31'
      if (form.frequency === 'semimonthly') {
        const dom2 = Number(form.second_day_of_month)
        if (!(dom2 >= 1 && dom2 <= 31)) errors.second_day_of_month = '1–31'
        if (dom === dom2)               errors.second_day_of_month = 'Must differ from the first day'
      }
    }
    if (!form.start_date)              errors.start_date = 'Required'
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      errors.end_date = 'End date must be on or after start date'
    }
    return { isValid: Object.keys(errors).length === 0, errors }
  }

  async function saveRecurring() {
    const { isValid, errors } = validateRecurring(recurringForm)
    if (!isValid) {
      setRecurringErrors(errors)
      setError('Fix the highlighted fields before saving.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const f = recurringForm
      const payload = {
        name: f.name.trim(),
        amount: Number(f.amount),
        category: f.category.trim(),
        funding_account_id: f.funding_account_id,
        frequency: f.frequency,
        day_of_week:   WEEKLY_FREQS.has(f.frequency)  ? Number(f.day_of_week)   : null,
        day_of_month:  MONTHLY_FREQS.has(f.frequency) ? Number(f.day_of_month)  : null,
        second_day_of_month: f.frequency === 'semimonthly' ? Number(f.second_day_of_month) : null,
        start_date: f.start_date,
        end_date: f.end_date || null,
        notes: f.notes?.trim() || null,
        is_active: true,
        entity_id: null,
        created_by: user?.id || null,
      }
      const { data: tpl, error: insErr } = await supabase
        .from('recurring_expense_templates')
        .insert(payload)
        .select('id, name')
        .single()
      if (insErr || !tpl) throw new Error(insErr?.message || 'Template insert failed')

      // Materialize instances. Default horizon (now+1y) is set by the
      // function — we don't pass p_through_date.
      const { data: instanceCount, error: rpcErr } = await supabase
        .rpc('generate_recurring_instances', { p_template_id: tpl.id })

      // One audit_log entry per template, separate from any per-instance
      // audit handled by future surfaces. Surface name follows the
      // existing quick-line-add convention.
      await supabase.from('audit_log').insert({
        table_name: 'recurring_expense_templates',
        record_id: tpl.id,
        action: 'insert',
        performed_by: user?.id || null,
        performed_by_email: profile?.email || null,
        metadata: {
          surface: SURFACE,
          variant: 'recurring',
          name: tpl.name,
          frequency: payload.frequency,
          instance_count: rpcErr ? null : Number(instanceCount || 0),
        },
      }).then(({ error: aErr }) => {
        if (aErr) console.warn('[QuickLineModal] audit_log insert failed', aErr.message)
      })

      setSaving(false)
      if (rpcErr) {
        toast.error('Recurring expense saved, but instance generation failed. You can regenerate from settings.', rpcErr)
      } else {
        toast.success(`Recurring expense created. ${Number(instanceCount || 0)} instance${Number(instanceCount) === 1 ? '' : 's'} scheduled.`)
      }
      onSaved?.()
      onClose?.()
    } catch (e) {
      console.error('[QuickLineModal] saveRecurring failed:', e)
      setError(e?.message || 'Save failed')
      toast.error("Couldn't save recurring expense", e)
      setSaving(false)
    }
  }

  async function handleSave() {
    // Route the expense kind's recurring tab to its own save path. All
    // other tabs / kinds go through the row-based validation + save.
    if (kind === 'expense' && expenseSubTab === 'recurring') {
      return saveRecurring()
    }
    setError('')
    // All-or-nothing validation: collect errors for every row, abort if any.
    const allErrors = {}
    rows.forEach((r, i) => {
      const { isValid, errors } = validateRow(r, kind, factorsById)
      if (!isValid) allErrors[i] = errors
    })
    if (Object.keys(allErrors).length) {
      setRowErrors(allErrors)
      setError(`Fix ${Object.keys(allErrors).length} row${Object.keys(allErrors).length === 1 ? '' : 's'} before saving.`)
      return
    }
    setSaving(true)
    try {
      if (kind === 'income')   await saveIncome()
      else if (kind === 'expense')  await saveExpense()
      else if (kind === 'transfer') await saveTransfer()
      toast.success(`${rows.length} ${meta.verb} line${rows.length === 1 ? '' : 's'} saved`)
      setSaving(false)
      onSaved?.()
      onClose?.()
    } catch (e) {
      console.error('[QuickLineModal] save failed:', e)
      setError(e?.message || 'Save failed')
      toast.error(`Couldn't save ${meta.verb} lines`, e)
      setSaving(false)
    }
  }

  if (!open || !kind) return null

  return (
    <Modal open={open} onClose={onClose} title={meta.title} size="2xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {/* Expense kind only — pair of tabs above the body content.
            Switching tabs preserves both panes' state for the modal's
            lifetime; reset happens on modal open via the useEffect
            above. Income / transfer kinds skip the tab strip. */}
        {kind === 'expense' && (
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-xl w-fit">
            <SubTabButton active={expenseSubTab === 'one-time'} onClick={() => setExpenseSubTab('one-time')}>One-time</SubTabButton>
            <SubTabButton active={expenseSubTab === 'recurring'} onClick={() => setExpenseSubTab('recurring')}>Recurring</SubTabButton>
          </div>
        )}

        {kind === 'expense' && expenseSubTab === 'recurring' ? (
          <RecurringExpenseForm
            form={recurringForm}
            errors={recurringErrors}
            accounts={accounts}
            activeCategories={activeCategories}
            archivedCategories={archivedCategories}
            categoryLabelByName={categoryLabelByName}
            warning={startDateWarning(recurringForm)}
            onChange={(field, value) => {
              setRecurringForm(prev => ({ ...prev, [field]: value }))
              if (field === 'start_date') setRecurringStartTouched(true)
              if (recurringErrors[field]) {
                setRecurringErrors(prev => {
                  const { [field]: _, ...rest } = prev
                  return rest
                })
              }
            }}
          />
        ) : (
        <>
        <div className="space-y-2">
          {rows.map((row, i) => (
            <LineRow
              key={i}
              kind={kind}
              index={i}
              row={row}
              errors={rowErrors[i] || {}}
              accounts={accounts}
              knownSources={knownSources}
              activeCategories={activeCategories}
              archivedCategories={archivedCategories}
              categoryLabelByName={categoryLabelByName}
              addingCategoryForThisRow={addingCategoryForRowIdx === i}
              startAddingCategory={() => setAddingCategoryForRowIdx(i)}
              finishAddingCategory={async (newName) => {
                if (newName) {
                  const known = [
                    ...activeCategories.map(c => c.name),
                    ...archivedCategories.map(c => c.name),
                  ]
                  const finalName = dedupeCategory(newName, known)
                  if (!known.includes(finalName)) {
                    const { data: inserted, error } = await supabase
                      .from('expense_categories')
                      .insert({
                        name: finalName,
                        display_label: defaultDisplayLabelFor(finalName),
                        sort_order: 500,
                        is_active: true,
                      })
                      .select('id, name, display_label')
                      .single()
                    if (!error && inserted) {
                      await supabase.from('audit_log').insert({
                        table_name: 'expense_categories',
                        record_id: inserted.id,
                        action: 'insert',
                        performed_by: user?.id || null,
                        performed_by_email: profile?.email || null,
                        metadata: {
                          surface: 'quick_line_add_add_new',
                          name: inserted.name,
                          display_label_after: inserted.display_label,
                          is_active_after: true,
                        },
                      })
                      invalidateExpenseCategories()
                      await refetchCategories()
                    }
                  }
                  updateRow(i, 'category', finalName)
                }
                setAddingCategoryForRowIdx(null)
              }}
              activeFactors={activeFactors}
              factorsById={factorsById}
              isFirst={i === 0}
              showLabels={i === 0}
              canRemove={rows.length > 1}
              onChange={(field, value) => updateRow(i, field, value)}
              onChangeRow={(patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))}
              onRemove={() => removeRow(i)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="w-full py-2 text-sm font-medium text-orange-600 dark:text-orange-400 border border-dashed border-orange-300 dark:border-orange-500/30 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-500/5 transition-colors"
        >
          + Add another line
        </button>
        </>
        )}

        {/* Footer — single shared row across kinds and tabs. Total / line
            count only show for the row-based UIs; the recurring tab
            replaces them with a small descriptive caption. Save button
            label and disabled state branch on tab. */}
        <div className="flex items-baseline justify-between pt-3 border-t border-gray-100 dark:border-white/5">
          {kind === 'expense' && expenseSubTab === 'recurring' ? (
            <span className="text-xs text-gray-500 dark:text-slate-400">
              Saving will create one template and materialize a year of instances.
              {' · '}
              <Link
                to="/settings/recurring-expenses"
                className="text-orange-600 dark:text-orange-400 hover:underline font-medium"
              >
                Manage existing recurring expenses →
              </Link>
            </span>
          ) : (
            <span className="text-sm text-gray-500 dark:text-slate-400">
              <span className="font-semibold text-gray-700 dark:text-slate-300">Total:</span> {fmtMoney(totalAmount)}
              <span className="ml-3 text-xs text-gray-400 dark:text-slate-500">
                {rows.length} {rows.length === 1 ? 'line' : 'lines'}
              </span>
            </span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={CF.btnSave}>
              {saving
                ? 'Saving…'
                : (kind === 'expense' && expenseSubTab === 'recurring'
                    ? 'Save recurring expense'
                    : `Save ${rows.length} ${meta.verb} line${rows.length === 1 ? '' : 's'}`)}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// Small tab button used by the expense-kind sub-tab strip. Mirrors the
// pill styling from the calendar header's view toggle so it's visually
// consistent with other in-app tabs.
function SubTabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
        active
          ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm'
          : 'text-gray-500 dark:text-slate-400'
      }`}
    >
      {children}
    </button>
  )
}

// Recurring template form. Single-row layout in a two-column grid; day
// fields are conditional on the selected frequency per the brief.
function RecurringExpenseForm({
  form, errors, accounts, activeCategories, archivedCategories, categoryLabelByName, warning, onChange,
}) {
  const isWeekly  = WEEKLY_FREQS.has(form.frequency)
  const isMonthly = MONTHLY_FREQS.has(form.frequency)
  const isSemi    = form.frequency === 'semimonthly'

  // Pin archived current category at the top of the dropdown so a
  // long-saved template's category doesn't disappear from the picker
  // after its category gets archived in settings.
  const archivedHit = form.category
    && (archivedCategories || []).find(c => c.name === form.category)
  const activeHit = form.category
    && (activeCategories || []).find(c => c.name === form.category)

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Name *" error={errors.name} colSpan={2}>
        <input
          className={`${S.input} ${errClass(errors.name)}`}
          value={form.name}
          placeholder="e.g. Vanguard contribution"
          onChange={e => onChange('name', e.target.value)}
        />
      </Field>
      <Field label="Amount *" error={errors.amount}>
        <input
          type="number" step="0.01"
          className={`${S.input} ${errClass(errors.amount)}`}
          value={form.amount}
          placeholder="0.00"
          onChange={e => onChange('amount', e.target.value)}
        />
      </Field>
      <Field label="Funding account *" error={errors.funding_account_id}>
        <Select
          value={form.funding_account_id}
          onChange={e => onChange('funding_account_id', e.target.value)}
          className={errors.funding_account_id ? errClass(true) : ''}
        >
          <option value="">— Select —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
        </Select>
      </Field>
      <Field label="Category *" error={errors.category}>
        <Select
          value={form.category || ''}
          onChange={e => onChange('category', e.target.value)}
          className={errors.category ? errClass(true) : ''}
        >
          <option value="">— Select —</option>
          {archivedHit && !activeHit && (
            <option value={archivedHit.name}>{archivedHit.display_label} (archived)</option>
          )}
          {(activeCategories || []).map(c => (
            <option key={c.id} value={c.name}>{c.display_label}</option>
          ))}
        </Select>
        {form.category && categoryLabelByName?.get(form.category) && !activeHit && !archivedHit && (
          <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 truncate">
            {categoryLabelByName.get(form.category)}
          </p>
        )}
      </Field>
      <Field label="Frequency *" error={errors.frequency}>
        <Select
          value={form.frequency}
          onChange={e => onChange('frequency', e.target.value)}
        >
          {FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f] || f}</option>)}
        </Select>
      </Field>
      {isWeekly && (
        <Field label="Day of week *" error={errors.day_of_week}>
          <Select value={form.day_of_week} onChange={e => onChange('day_of_week', e.target.value)}>
            {WEEKDAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </Select>
        </Field>
      )}
      {isMonthly && (
        <Field label={isSemi ? 'First day of month *' : 'Day of month *'} error={errors.day_of_month}>
          <input
            type="number" min="1" max="31"
            className={`${S.input} ${errClass(errors.day_of_month)}`}
            value={form.day_of_month}
            onChange={e => onChange('day_of_month', e.target.value)}
            onBlur={e => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange('day_of_month', Math.max(1, Math.min(31, n)))
            }}
          />
        </Field>
      )}
      {isSemi && (
        <Field label="Second day of month *" error={errors.second_day_of_month}>
          <input
            type="number" min="1" max="31"
            className={`${S.input} ${errClass(errors.second_day_of_month)}`}
            value={form.second_day_of_month}
            onChange={e => onChange('second_day_of_month', e.target.value)}
            onBlur={e => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange('second_day_of_month', Math.max(1, Math.min(31, n)))
            }}
          />
        </Field>
      )}
      <Field label="Start date *" error={errors.start_date}>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.start_date)}`}
          value={form.start_date}
          onChange={e => onChange('start_date', e.target.value)}
        />
        {warning && (
          <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 leading-snug">
            {warning}
          </p>
        )}
      </Field>
      <Field label="End date" error={errors.end_date}>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.end_date)}`}
          value={form.end_date}
          placeholder="Optional"
          onChange={e => onChange('end_date', e.target.value)}
        />
        <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">Leave blank for indefinite.</p>
      </Field>
      <Field label="Notes" colSpan={2}>
        <textarea
          className={S.textarea}
          rows={2}
          value={form.notes}
          onChange={e => onChange('notes', e.target.value)}
        />
      </Field>
    </div>
  )
}

function Field({ label, error, colSpan, children }) {
  const span = colSpan === 2 ? 'col-span-2' : ''
  return (
    <div className={span}>
      <label className={S.label}>{label}</label>
      {children}
      {error && <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">{error}</p>}
    </div>
  )
}

function LineRow({
  kind, index, row, errors, accounts, knownSources,
  activeCategories, archivedCategories, categoryLabelByName,
  addingCategoryForThisRow, startAddingCategory, finishAddingCategory,
  activeFactors, factorsById,
  isFirst, showLabels, canRemove, onChange, onChangeRow, onRemove,
}) {
  void isFirst, index
  // Trash kept in the DOM at a fixed slot regardless of canRemove so the
  // row geometry doesn't shift on hover; the button itself is hidden when
  // there's only one row left (always keep at least one) or when the row
  // isn't being hovered/focused. focus-within keeps it visible for
  // keyboard users tabbing through.
  const trashButton = (
    <button
      onClick={onRemove}
      disabled={!canRemove}
      aria-label="Remove this line"
      title="Remove this line"
      type="button"
      className={`text-gray-400 hover:text-red-500 px-1 py-2 shrink-0 transition-opacity ${
        canRemove
          ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100'
          : 'opacity-0 pointer-events-none'
      }`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )

  // Income rows render a Type toggle row on top + a conditional field
  // block below. The expense/transfer kinds stay in the original 14-col
  // single-row grid.
  if (kind === 'income') {
    return (
      <div className="group p-2 rounded-xl bg-gray-50 dark:bg-white/[0.02] flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {incomeFields({ row, errors, accounts, knownSources, activeFactors, factorsById, showLabels, onChange, onChangeRow })}
        </div>
        <div className="pt-3 w-7 flex justify-end shrink-0">{trashButton}</div>
      </div>
    )
  }

  return (
    <div
      className="grid gap-2 items-end p-2 rounded-xl bg-gray-50 dark:bg-white/[0.02]"
      style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}
    >
      {kind === 'expense'  && expenseFields({
        row, errors, accounts, showLabels, onChange,
        activeCategories, archivedCategories, categoryLabelByName,
        addingCategoryForThisRow, startAddingCategory, finishAddingCategory,
      })}
      {kind === 'transfer' && transferFields(row, errors, accounts, showLabels, onChange)}
      <div className="col-span-1 flex justify-end">{trashButton}</div>
    </div>
  )
}

function errClass(hasError) {
  return hasError ? 'ring-2 ring-red-400/60 border-red-400/60' : ''
}

function FieldLabel({ show, children }) {
  if (!show) return null
  return <label className={S.label}>{children}</label>
}

function incomeFields({ row, errors, accounts, knownSources, activeFactors, factorsById, showLabels, onChange, onChangeRow }) {
  const isFactor = row.source_type === 'factor'

  // Toggling Type preserves common fields (funding account / expected
  // date / notes) and resets type-specific fields so stale values from
  // the other mode don't sneak into the save payload.
  function switchType(nextType) {
    if (nextType === row.source_type) return
    if (nextType === 'factor') {
      onChangeRow({ source_type: 'factor', amount: '', source: '', factor_id: '', gross_amount: '' })
    } else {
      onChangeRow({ source_type: 'other',  amount: '', source: '', factor_id: '', gross_amount: '' })
    }
  }

  const factor = isFactor && row.factor_id ? factorsById.get(row.factor_id) : null
  const grossNum = isFactor ? Number(row.gross_amount) : 0
  const feeRate = factor ? Number(factor.fee_rate) : 0
  const fee = isFactor && grossNum > 0 ? round2(grossNum * feeRate) : 0
  // NET comes from the shared helper so the row's display and the
  // footer's Total can't drift; defining `net` locally only when we have
  // a complete row keeps the "—" placeholder behavior intact.
  const net = isFactor && grossNum > 0 && factor ? computeIncomeNet(row, factorsById) : 0

  return (
    <>
      {/* Type toggle — always visible at the top of the income row */}
      <div className="flex items-center gap-1.5 mb-2">
        <TypePill active={!isFactor} onClick={() => switchType('other')}>Other</TypePill>
        <TypePill active={isFactor}  onClick={() => switchType('factor')}>Factor</TypePill>
      </div>

      {/* Conditional fields.
          The Factor branch uses an explicit grid-template-columns string
          instead of repeat(14, 1fr) because the columns have very
          different content needs: dropdowns (FACTOR / FUNDING ACCOUNT)
          must absorb extra width as flex tracks, while DATE has a fixed
          minimum that's high enough for native `MM/DD/YYYY` rendering
          (~140px in Chrome/Safari). The read-only computed cells
          (FEE %, FEE, NET) take fixed pixel widths so they don't expand
          and starve the dropdowns at narrower modal widths. */}
      {isFactor ? (
        <div
          className="grid gap-2 items-end"
          style={{ gridTemplateColumns: 'minmax(180px, 2fr) 110px 65px 100px 115px minmax(180px, 2fr) 140px minmax(100px, 1fr)' }}
        >
          <div className="min-w-0">
            <FieldLabel show={showLabels}>Factor *</FieldLabel>
            <Select
              value={row.factor_id || ''}
              onChange={e => onChange('factor_id', e.target.value)}
              className={errors.factor_id ? errClass(true) : ''}
            >
              <option value="">— Select —</option>
              {activeFactors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              {row.factor_id
                && !activeFactors.find(f => f.id === row.factor_id)
                && factorsById.get(row.factor_id) && (
                <option value={row.factor_id}>{factorsById.get(row.factor_id).name} (archived)</option>
              )}
            </Select>
          </div>
          <div className="min-w-0">
            <FieldLabel show={showLabels}>Gross *</FieldLabel>
            <input
              type="number" step="0.01"
              className={`${S.input} text-right`}
              value={row.gross_amount}
              placeholder="0.00"
              onChange={e => onChange('gross_amount', e.target.value)}
            />
          </div>
          <div className="min-w-0">
            <FieldLabel show={showLabels}>Fee %</FieldLabel>
            <div className="px-2 py-2 text-xs font-mono text-gray-600 dark:text-slate-400 text-right">
              {factor ? formatFeeRate(factor.fee_rate) : '—'}
            </div>
          </div>
          <div className="min-w-0">
            <FieldLabel show={showLabels}>Fee</FieldLabel>
            <div className="px-2 py-2 text-xs font-mono text-red-600 dark:text-red-400 text-right whitespace-nowrap">
              {factor && grossNum > 0 ? `− ${fmtMoneyExact(fee)}` : '—'}
            </div>
          </div>
          <div className="min-w-0">
            {showLabels && (
              <label className={`${S.label} flex items-center justify-end gap-1`}>
                <span>Net</span>
                <span
                  className="inline-flex items-center justify-center w-3 h-3 text-[9px] rounded-full border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 cursor-help"
                  tabIndex={0}
                  aria-label="Net definition"
                  title="Net = Gross − Fee. This is what hits the bank."
                >i</span>
              </label>
            )}
            <div className="px-2 py-2 text-sm font-mono font-bold text-emerald-700 dark:text-emerald-400 text-right whitespace-nowrap">
              {factor && grossNum > 0 ? fmtMoneyExact(net) : '—'}
            </div>
          </div>
          <div className="min-w-0">
            <FieldLabel show={showLabels}>Funding account *</FieldLabel>
            <Select
              value={row.funding_account_id}
              onChange={e => onChange('funding_account_id', e.target.value)}
              className={errors.funding_account_id ? errClass(true) : ''}
            >
              <option value="">— Select —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
            </Select>
          </div>
          <div className="min-w-0">
            <FieldLabel show={showLabels}>Date *</FieldLabel>
            <input
              type="date"
              className={`${S.input} ${errClass(errors.expected_date)}`}
              value={row.expected_date}
              onChange={e => onChange('expected_date', e.target.value)}
            />
          </div>
          <div className="min-w-0">
            <FieldLabel show={showLabels}>Notes</FieldLabel>
            <input
              className={`${S.input} truncate`}
              value={row.notes}
              placeholder="Optional"
              title={row.notes || ''}
              onChange={e => onChange('notes', e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-2 items-end" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Amount *</FieldLabel>
            <input
              type="number" step="0.01"
              className={`${S.input} ${errClass(errors.amount)}`}
              value={row.amount}
              placeholder="0.00"
              onChange={e => onChange('amount', e.target.value)}
            />
          </div>
          <div className="col-span-4">
            <FieldLabel show={showLabels}>Source *</FieldLabel>
            <SuggestInput
              value={row.source}
              suggestions={knownSources}
              placeholder="e.g. RTS Financial"
              onChange={v => onChange('source', v)}
              className={errors.source ? errClass(true) : ''}
            />
          </div>
          <div className="col-span-4">
            <FieldLabel show={showLabels}>Funding account *</FieldLabel>
            <Select
              value={row.funding_account_id}
              onChange={e => onChange('funding_account_id', e.target.value)}
              className={errors.funding_account_id ? errClass(true) : ''}
            >
              <option value="">— Select —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
            </Select>
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Expected date *</FieldLabel>
            <input
              type="date"
              className={`${S.input} ${errClass(errors.expected_date)}`}
              value={row.expected_date}
              onChange={e => onChange('expected_date', e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Notes</FieldLabel>
            <input
              className={S.input}
              value={row.notes}
              placeholder="—"
              onChange={e => onChange('notes', e.target.value)}
            />
          </div>
        </div>
      )}
    </>
  )
}

function TypePill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
        active
          ? 'bg-orange-500 text-white shadow-sm'
          : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function expenseFields({
  row, errors, accounts, showLabels, onChange,
  activeCategories, archivedCategories, categoryLabelByName,
  addingCategoryForThisRow, startAddingCategory, finishAddingCategory,
}) {
  // The Category dropdown matches the Batch Detail modal: pulls from
  // the expense_categories reference table, displays display_label,
  // stores name. Archived current value is pinned at the top so users
  // don't lose visibility of a retired category that this row already
  // references.
  const archivedHit = row.category
    && (archivedCategories || []).find(c => c.name === row.category)
  const activeHit = row.category
    && (activeCategories || []).find(c => c.name === row.category)

  return (
    <>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Amount *</FieldLabel>
        <input
          type="number" step="0.01"
          className={`${S.input} ${errClass(errors.amount)}`}
          value={row.amount}
          placeholder="0.00"
          onChange={e => onChange('amount', e.target.value)}
        />
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>Description *</FieldLabel>
        <input
          className={`${S.input} ${errClass(errors.description)}`}
          value={row.description}
          placeholder="e.g. Telematics fee"
          onChange={e => onChange('description', e.target.value)}
        />
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Category *</FieldLabel>
        {addingCategoryForThisRow ? (
          <InlineAddCategoryInput
            onSave={(v) => finishAddingCategory(v)}
            onCancel={() => finishAddingCategory(null)}
          />
        ) : (
          <Select
            value={row.category || ''}
            onChange={e => {
              if (e.target.value === '__add_new__') {
                startAddingCategory()
              } else {
                onChange('category', e.target.value)
              }
            }}
            className={errors.category ? errClass(true) : ''}
          >
            <option value="">— Select —</option>
            {archivedHit && !activeHit && (
              <option value={archivedHit.name}>
                {archivedHit.display_label} (archived)
              </option>
            )}
            {(activeCategories || []).map(c => (
              <option key={c.id} value={c.name}>{c.display_label}</option>
            ))}
            <option value="__add_new__">+ Add new category</option>
          </Select>
        )}
        {/* Tiny readout when the row holds a value the dropdown didn't
            render (e.g., an archived category) — keeps the display
            label visible at a glance. */}
        {row.category && categoryLabelByName?.get(row.category) && !activeHit && !archivedHit && (
          <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 truncate">
            {categoryLabelByName.get(row.category)}
          </p>
        )}
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>Funding account *</FieldLabel>
        <Select
          value={row.funding_account_id}
          onChange={e => onChange('funding_account_id', e.target.value)}
        >
          <option value="">— Select —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
        </Select>
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Planned date *</FieldLabel>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.planned_pay_date)}`}
          value={row.planned_pay_date}
          onChange={e => onChange('planned_pay_date', e.target.value)}
        />
      </div>
      {/* Bank-impact column. Column header rendered slightly smaller so
          "BANK IMPACT" (two words + uppercase tracking) fits col-span-1
          without truncation. The checkbox wrapper matches the height of
          a regular S.input so the parent grid's items-end lines the
          checkbox up with the inputs in the adjacent cells. */}
      <div className="col-span-1 flex flex-col items-center">
        {showLabels && (
          <label
            className="block text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5 text-center whitespace-nowrap leading-tight"
            title={BANK_IMPACT_TOOLTIP}
          >
            Bank impact
          </label>
        )}
        <div className="flex items-center justify-center w-full h-[38px]">
          <input
            type="checkbox"
            checked={!!row.cash_impacting}
            onChange={e => onChange('cash_impacting', e.target.checked)}
            title={BANK_IMPACT_TOOLTIP}
            className="rounded"
          />
        </div>
      </div>
    </>
  )
}

// Inline "+ Add new category" text input that takes over the Category
// cell when the user picks the sentinel option. Save validates against
// isValidCategoryName; the parent's finishAddingCategory passes through
// dedupeCategory + the INSERT + audit + refetch flow. Esc cancels,
// Enter saves.
function InlineAddCategoryInput({ onSave, onCancel }) {
  const [value, setValue] = useState('')
  const [errMsg, setErrMsg] = useState('')

  function attemptSave() {
    const v = value.trim()
    if (!v) { onCancel(); return }
    if (!isValidCategoryName(v)) {
      setErrMsg('lowercase / digits / underscores, max 30')
      return
    }
    onSave(v)
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        className={`${S.input} ${errMsg ? 'ring-2 ring-red-400/60 border-red-400/60' : ''}`}
        value={value}
        placeholder="new_category"
        maxLength={30}
        title={errMsg || ''}
        onChange={e => { setValue(e.target.value); if (errMsg) setErrMsg('') }}
        onKeyDown={e => {
          if (e.key === 'Enter')        { e.preventDefault(); attemptSave() }
          else if (e.key === 'Escape')  { e.preventDefault(); onCancel() }
        }}
      />
      <button type="button" onClick={attemptSave} title="Save category" className="shrink-0 text-emerald-600 hover:text-emerald-500">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </button>
      <button type="button" onClick={onCancel} title="Cancel" className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function transferFields(row, errors, accounts, showLabels, onChange) {
  return (
    <>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>From *</FieldLabel>
        <Select
          value={row.from_funding_account_id}
          onChange={e => onChange('from_funding_account_id', e.target.value)}
        >
          <option value="">— Select —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
        </Select>
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>To *</FieldLabel>
        <Select
          value={row.to_funding_account_id}
          onChange={e => onChange('to_funding_account_id', e.target.value)}
        >
          <option value="">— Select —</option>
          {accounts
            .filter(a => a.id !== row.from_funding_account_id)
            .map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
        </Select>
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Amount *</FieldLabel>
        <input
          type="number" step="0.01"
          className={`${S.input} ${errClass(errors.amount)}`}
          value={row.amount}
          placeholder="0.00"
          onChange={e => onChange('amount', e.target.value)}
        />
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Debit date *</FieldLabel>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.debit_date)}`}
          value={row.debit_date}
          onChange={e => onChange('debit_date', e.target.value)}
        />
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>Credit date *</FieldLabel>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.credit_date)}`}
          value={row.credit_date}
          onChange={e => onChange('credit_date', e.target.value)}
        />
      </div>
    </>
  )
}
