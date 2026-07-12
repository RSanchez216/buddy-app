import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import RecordPaymentModal from './RecordPaymentModal'
import DriverPicker from './DriverPicker'
import { logEvent } from '../utils/events'
import { fmtMoney, fmtDate } from '../utils/format'
import { deriveAssignedDriver, driverInitials } from '../utils/collectedFrom'
import { useToast } from '../../../contexts/ToastContext'

// Resolve who a week's deduction was collected from:
//   1. collected_from_driver_id override wins.
//   2. else the assigned driver whose drove-window overlaps the period.
//   3. else null (unassigned).
// Skipped rows are handled by the caller (rendered as '—').
function resolveCollectedFrom(p, contractDrivers, nameById) {
  if (p.collected_from_driver_id) {
    return { driverId: p.collected_from_driver_id, name: nameById[p.collected_from_driver_id] || 'Driver', override: true }
  }
  const chosen = deriveAssignedDriver(contractDrivers, p.period_start, p.period_end)
  if (!chosen) return null
  return { driverId: chosen.driver_id, name: chosen.full_name, override: false }
}

const SOURCE_LABEL = {
  generated:      'Generated',
  manual:         'Manual',
  payroll_import: 'Payroll',
  reversal:       'Reversal',
}

const METHOD_LABEL = {
  manual:  'Manual',
  cash:    'Cash',
  wire:    'Wire',
  check:   'Check',
  payroll: 'Payroll',
  other:   'Other',
}

// A row is "recorded" when a real payment was entered, it's been reconciled,
// or it's an agreed skip. Empty rows (missed or upcoming — no amount, not
// reconciled, not skipped) route to Record instead of Edit, so recording an
// empty period never overlaps with the Edit form.
const isRecorded = (p) =>
  Number(p.actual_amount) > 0 || p.reconciled === true || p.skipped === true

// Clear per-row status tag. Skipped / pre-tracking are labeled in the Source
// column, so this only renders for paid (reconciled or recorded-unconfirmed),
// missed, upcoming, and reversal rows.
const STATUS_TAG = {
  reconciled:             { label: 'Paid',     tone: 'emerald' },
  'recorded-unconfirmed': { label: 'Paid',     tone: 'emerald' },
  missed:                 { label: 'Missed',   tone: 'red' },
  upcoming:               { label: 'Upcoming', tone: 'gray' },
  reversal:               { label: 'Reversal', tone: 'blue' },
}
const TAG_TONE = {
  emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  red:     'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  gray:    'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-600/30',
  blue:    'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
}
function StatusTag({ status }) {
  const meta = STATUS_TAG[status]
  if (!meta) return null
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${TAG_TONE[meta.tone]}`}>
      {meta.label}
    </span>
  )
}

// Variance traffic-lights: green ≥ 0, amber for small shorts, red for >$100 short.
function varianceClass(v) {
  const n = Number(v || 0)
  if (n >= 0) return 'text-emerald-600 dark:text-emerald-400'
  if (n > -100) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

// Overdue-beyond-grace test for an unpaid period. Grace mirrors the list's
// behind logic: 7 days for weekly/biweekly, 35 for monthly. Compares the
// period_end date-string against a computed cutoff (today − grace), both as
// yyyy-mm-dd strings, so there's no new Date('yyyy-mm-dd') parsing / TZ shift.
function isOverdueBeyondGrace(periodEnd, frequency) {
  if (!periodEnd) return false
  const graceDays = frequency === 'monthly' ? 35 : 7
  const c = new Date()
  c.setHours(0, 0, 0, 0)
  c.setDate(c.getDate() - graceDays)
  const cutoff = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
  return periodEnd < cutoff
}

// Returns one of: 'reversal' | 'reconciled' | 'recorded-unconfirmed' |
// 'skipped' | 'pre-tracking' | 'missed' | 'upcoming'.
// Priority: actual data wins over skipped/pre-tracking (the either-or
// invariant prevents skipped + actual>0 at the DB level, but defending
// here keeps the UI sane against any drift). Then skipped wins over
// pre-tracking/missed because a deliberate skip is an explicit override.
// An unpaid period only counts as 'missed' once it's overdue beyond grace;
// future weeks and the current in-grace week are 'upcoming' (no red).
function rowStatus(p, trackingStart, frequency) {
  const actual = Number(p.actual_amount || 0)
  if (actual < 0) return 'reversal'
  if (actual > 0) return p.reconciled ? 'reconciled' : 'recorded-unconfirmed'
  // actual === 0 from here on
  if (p.skipped) return 'skipped'
  if (trackingStart && p.period_end && p.period_end < trackingStart) return 'pre-tracking'
  if (Number(p.expected_amount || 0) > 0 && isOverdueBeyondGrace(p.period_end, frequency)) return 'missed'
  return 'upcoming'
}

// Relative "Xd ago" label for a reconciled timestamp. Matches the
// Last Charged column pattern on the list page so the relative-time
// vocabulary stays consistent across the app. Returns null for falsy
// input so the caller can fall back to a static "✓".
function relativeAgo(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays <= 30) return `${diffDays}d ago`
  if (diffDays <= 60) return `${Math.floor(diffDays / 7)}w ago`
  return `${Math.floor(diffDays / 30)}mo ago`
}

// Absolute timestamp for tooltip — "May 4, 2026, 3:43 PM".
function fmtAbsTimestamp(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Row tint: missed → red wash; reversal → blue wash; pre-tracking →
// subtle gray wash; recorded-unconfirmed → subtle amber wash so the
// "needs confirmation" rows stand apart from both reconciled (green)
// and missed (red) at-a-glance.
function rowTint(status) {
  switch (status) {
    case 'reversal':             return 'bg-blue-50/50 dark:bg-blue-500/5'
    case 'missed':               return 'bg-red-50/50 dark:bg-red-500/5'
    case 'pre-tracking':         return 'bg-gray-50/60 dark:bg-white/[0.015]'
    case 'recorded-unconfirmed': return 'bg-amber-50/40 dark:bg-amber-500/[0.04]'
    case 'reconciled':           return 'bg-emerald-50/30 dark:bg-emerald-500/[0.04]'
    // Neutral gray for skipped — a deliberate, non-alarming, non-payment
    // state. Kept muted (like pre-tracking) so it never reads as missed.
    case 'skipped':              return 'bg-gray-50/60 dark:bg-white/[0.015]'
    // 'upcoming' (future / current in-grace week) gets no tint.
    default:                     return ''
  }
}

export default function PaymentHistorySection({ purchase, canEdit, onChange, openSignal = 0 }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRow, setEditRow] = useState(null)
  // New-mode preselection: set when an empty history row is clicked, so the
  // Record modal opens targeted at that exact period. null for the header
  // "+ Record payment" button (normal default selection).
  const [preselectPeriodId, setPreselectPeriodId] = useState(null)
  const [trackingStart, setTrackingStart] = useState(purchase?.payment_tracking_start_date || null)
  const [showTrackingEdit, setShowTrackingEdit] = useState(false)
  const [trackingDraft, setTrackingDraft] = useState('')
  const [savingTracking, setSavingTracking] = useState(false)

  // Reconcile-undo toast: { paymentId, prevValues, periodStart, timer }.
  // Only ever shown for user-initiated reconciles, not bulk imports.
  const [undoToast, setUndoToast] = useState(null)
  // Record-payment undo toast — the production-bug fix. Distinct from
  // the reconcile undo above because this one reverts actual_amount
  // (which moves the balance via the sync trigger), not just the
  // reconciled bool. Set after a successful RecordPaymentModal save in
  // new-record mode (NOT edit mode).
  const [recordUndoToast, setRecordUndoToast] = useState(null)
  // Skip-undo toast — sibling to record/reconcile undo. Reverts the
  // skip flag + restores the previous state (amount, reconcile, etc.)
  // captured in previousState. Always armed after a fresh skip; not
  // armed when the user re-saves an existing skipped row (no state
  // change worth offering to undo).
  const [skipUndoToast, setSkipUndoToast] = useState(null)
  // Single shared 1-Hz tick — forces a re-render every second so every
  // undo toast's "(Ns)" label recomputes live. The setTimeout that
  // actually dismisses the toast at 10s is unchanged (per toast); this
  // is purely the visible countdown layer. One interval covers all
  // toasts; only runs while at least one is armed.
  const [, forceTick] = useReducer(x => x + 1, 0)
  useEffect(() => {
    if (!undoToast && !recordUndoToast && !skipUndoToast) return
    const id = setInterval(forceTick, 1000)
    return () => clearInterval(id)
  }, [undoToast, recordUndoToast, skipUndoToast])
  function remainingSeconds(toast) {
    if (!toast?.expiresAt) return 0
    return Math.max(0, Math.ceil((toast.expiresAt - Date.now()) / 1000))
  }
  const [unreconcileTarget, setUnreconcileTarget] = useState(null)  // payment row
  const [unskipTarget, setUnskipTarget] = useState(null)            // payment row
  const [reconcileBusy, setReconcileBusy] = useState(false)
  // Lookup for the unreconcile popover's "originally reconciled by" line —
  // populated lazily when the popover opens.
  const [reconcilerName, setReconcilerName] = useState('')
  // { user_id → display name } batch-fetched alongside rows so the
  // tooltip on every reconciled cell can say "by {name}" without doing
  // one query per row.
  const [reconcilerMap, setReconcilerMap] = useState({})
  // Contract drivers (get_contract_drivers) + driver_id→name map, for the
  // "Collected from" column. setDriverTarget holds the payment row whose
  // collected-from override is being set via the picker modal.
  const [contractDrivers, setContractDrivers] = useState([])
  const [driverNameById, setDriverNameById] = useState({})
  const [setDriverTarget, setSetDriverTarget] = useState(null)
  const [savingCollectedFrom, setSavingCollectedFrom] = useState(false)

  // Keep local tracking state in sync if the underlying purchase row
  // changes (e.g. after the parent reloads on save).
  useEffect(() => {
    setTrackingStart(purchase?.payment_tracking_start_date || null)
  }, [purchase?.payment_tracking_start_date])

  const load = useCallback(async () => {
    if (!purchase) return
    setLoading(true)
    const { data } = await supabase
      .from('driver_purchase_payments')
      .select('*')
      .eq('driver_purchase_id', purchase.id)
      .order('period_end', { ascending: false })
      .limit(100)
    const list = data || []
    setRows(list)
    // Batch-resolve the unique reconciler ids on this contract so the
    // tooltip on every reconciled cell can show "by {name}". One query
    // covers the whole page (usually 1-2 distinct users).
    const ids = Array.from(new Set(list.map(r => r.reconciled_by).filter(Boolean)))
    if (ids.length) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name, email')
        .in('id', ids)
      const map = {}
      ;(users || []).forEach(u => { map[u.id] = u.full_name || u.email || '' })
      setReconcilerMap(map)
    } else {
      setReconcilerMap({})
    }

    // Contract drivers (for the Collected-from column) + a driver_id→name map.
    // The map covers the contract drivers plus any collected-from override id
    // that points to a driver outside the contract set.
    const { data: cd } = await supabase.rpc('get_contract_drivers', { p_dp_id: purchase.id })
    const drivers = cd || []
    setContractDrivers(drivers)
    const nameMap = {}
    drivers.forEach(d => { nameMap[d.driver_id] = d.full_name })
    const overrideIds = Array.from(new Set(
      list.map(r => r.collected_from_driver_id).filter(id => id && !nameMap[id])))
    if (overrideIds.length) {
      const { data: extra } = await supabase.from('drivers').select('id, full_name').in('id', overrideIds)
      ;(extra || []).forEach(d => { nameMap[d.id] = d.full_name })
    }
    setDriverNameById(nameMap)

    setLoading(false)
  }, [purchase])

  useEffect(() => { load() }, [load])

  // External opener — DriverPurchaseDetail's header "+ Record payment"
  // bumps openSignal to trigger the new-payment modal from here. Skip
  // the initial 0 so the modal doesn't open on mount.
  const lastSignalRef = useRef(0)
  useEffect(() => {
    if (openSignal && openSignal !== lastSignalRef.current) {
      lastSignalRef.current = openSignal
      openNew()
    }
  }, [openSignal])

  function openNew() { setEditRow(null); setPreselectPeriodId(null); setShowModal(true) }
  // State-aware row click: a recorded row (paid / reconciled / skipped) opens
  // Edit; an empty row (missed or upcoming) opens Record preselected to that
  // period — the two forms no longer overlap on empty rows.
  function onRowClick(row) {
    if (!canEdit) return
    if (isRecorded(row)) {
      setEditRow(row); setPreselectPeriodId(null); setShowModal(true)
    } else {
      setEditRow(null); setPreselectPeriodId(row.id); setShowModal(true)
    }
  }
  function onModalClose() { setShowModal(false); setEditRow(null); setPreselectPeriodId(null) }
  function onRecorded(info) {
    setShowModal(false); setEditRow(null); setPreselectPeriodId(null)
    load()
    onChange?.()
    // Skip flow gets its own undo toast — distinct shape from the
    // record toast because the revert path needs to restore the
    // previous skip+amount+reconcile triplet, not delete a row.
    if (info && info.isSkip && info.paymentId) {
      if (skipUndoToast?.timer) clearTimeout(skipUndoToast.timer)
      const timer = setTimeout(() => setSkipUndoToast(null), 10000)
      setSkipUndoToast({
        paymentId: info.paymentId,
        periodStart: info.periodStart,
        periodEnd: info.periodEnd,
        expiresAt: Date.now() + 10000,
        previousState: info.previousState,
        timer,
      })
      return
    }
    // Fresh record (not edit, not skip) → arm the record-undo toast.
    if (info && !info.isEdit && info.paymentId) {
      if (recordUndoToast?.timer) clearTimeout(recordUndoToast.timer)
      const timer = setTimeout(() => setRecordUndoToast(null), 10000)
      setRecordUndoToast({
        paymentId: info.paymentId,
        amount: info.amount,
        periodStart: info.periodStart,
        expiresAt: Date.now() + 10000,
        periodEnd: info.periodEnd,
        isNewlyInserted: info.isNewlyInserted,
        previousState: info.previousState,
        timer,
      })
    }
  }

  async function undoSkip() {
    if (!skipUndoToast) return
    const { paymentId, periodStart, periodEnd, previousState, timer } = skipUndoToast
    clearTimeout(timer)
    setSkipUndoToast(null)
    // Revert to whatever the row was before the skip — usually
    // actual=0, reconciled=false, but we preserve previousState fully
    // so an unskip can never silently mutate the row's history.
    const revert = previousState ? {
      skipped: previousState.skipped,
      skipped_at: previousState.skipped_at,
      skipped_by: previousState.skipped_by,
      skip_reason: previousState.skip_reason,
      actual_amount: previousState.actual_amount,
      payment_method: previousState.payment_method,
      reference_number: previousState.reference_number,
      reason: previousState.reason,
      reconciled: previousState.reconciled,
      reconciled_at: previousState.reconciled_at,
      reconciled_by: previousState.reconciled_by,
      updated_at: new Date().toISOString(),
    } : {
      skipped: false, skipped_at: null, skipped_by: null, skip_reason: null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update(revert)
      .eq('id', paymentId)
    if (error) { toast.error("Couldn't undo", error); load(); return }
    await logEvent(
      purchase.id,
      'payment_skip_undone',
      `Skip undone for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (undo)`,
      { payment_id: paymentId, undo: true },
      user?.id,
    )
    load(); onChange?.()
  }

  async function confirmUnskip() {
    if (!unskipTarget) return
    const p = unskipTarget
    setUnskipTarget(null)
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update({
        skipped: false, skipped_at: null, skipped_by: null, skip_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.id)
    if (error) { toast.error("Couldn't unskip", error); return }
    toast.success('Skip undone')
    await logEvent(
      purchase.id,
      'payment_skip_undone',
      `Skip undone for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`,
      { payment_id: p.id },
      user?.id,
    )
    load(); onChange?.()
  }

  async function undoRecordPayment() {
    if (!recordUndoToast) return
    const { paymentId, amount, periodStart, periodEnd, isNewlyInserted, previousState, timer } = recordUndoToast
    clearTimeout(timer)
    setRecordUndoToast(null)
    if (isNewlyInserted) {
      // The row was just inserted by the modal — drop it. The balance
      // trigger will re-sum on delete.
      const { error } = await supabase
        .from('driver_purchase_payments')
        .delete()
        .eq('id', paymentId)
      if (error) { toast.error("Couldn't undo", error); load(); return }
    } else {
      // Pre-generated row was updated. Revert to whatever was there
      // before (typically actual=0, no method, not reconciled). Trigger
      // re-sums actual_amount automatically.
      const revert = previousState
        ? {
            actual_amount: previousState.actual_amount,
            payment_method: previousState.payment_method,
            reference_number: previousState.reference_number,
            reason: previousState.reason,
            reconciled: previousState.reconciled,
            reconciled_at: previousState.reconciled_at,
            reconciled_by: previousState.reconciled_by,
            payment_source: previousState.payment_source,
            updated_at: new Date().toISOString(),
          }
        : { actual_amount: 0, payment_method: null, reconciled: false, reconciled_at: null, reconciled_by: null, updated_at: new Date().toISOString() }
      const { error } = await supabase
        .from('driver_purchase_payments')
        .update(revert)
        .eq('id', paymentId)
      if (error) { toast.error("Couldn't undo", error); load(); return }
    }
    await logEvent(
      purchase.id,
      'payment_record_undone',
      `Recording undone for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (${fmtMoney(amount)})`,
      { payment_id: paymentId, amount },
      user?.id,
    )
    load()
    onChange?.()
  }

  // Reconcile click: stop the row from also opening the edit modal,
  // route to the right flow based on current state.
  function onReconcileCellClick(e, p) {
    e.stopPropagation()
    if (!canEdit || reconcileBusy) return
    if (p.reconciled) {
      setUnreconcileTarget(p)
      lookupReconciler(p)
    } else {
      reconcilePayment(p)
    }
  }

  // Fetch the full name of whoever originally reconciled, so the
  // unreconcile popover can say "by {name} on {date}". Lookup is
  // lazy + best-effort; falls back to email or "a user".
  async function lookupReconciler(p) {
    setReconcilerName('')
    if (!p.reconciled_by) return
    const { data } = await supabase
      .from('users')
      .select('full_name, email')
      .eq('id', p.reconciled_by)
      .maybeSingle()
    if (data) setReconcilerName(data.full_name || data.email || '')
  }

  // Hybrid table-click handler. Branches on the row's current actual:
  //   actual === 0 → COMBO fast path: record expected + reconcile in
  //                  one UPDATE, smart-default payment_method, write
  //                  BOTH payment_recorded AND payment_reconciled
  //                  events for an honest audit trail, show a unified
  //                  "Recorded & reconciled" toast.
  //   actual !== 0 → amber-dot fast path: just flip the reconciled
  //                  flag; actual is already correct, balance unaffected.
  // The Edit Payment modal remains the precision tool — used when
  // actual differs from expected or for after-the-fact corrections.
  async function reconcilePayment(p) {
    setReconcileBusy(true)
    const nowIso = new Date().toISOString()
    const isCombo = Number(p.actual_amount || 0) === 0
    // previousState snapshot drives the undo — for combo we need to
    // revert actual_amount + payment_method too, not just the audit flag.
    const prev = isCombo
      ? {
          actual_amount: p.actual_amount,
          payment_method: p.payment_method,
          reconciled: p.reconciled,
          reconciled_at: p.reconciled_at,
          reconciled_by: p.reconciled_by,
        }
      : { reconciled: p.reconciled, reconciled_at: p.reconciled_at, reconciled_by: p.reconciled_by }

    if (isCombo) {
      const expected = Number(p.expected_amount || 0)
      if (expected <= 0) {
        setReconcileBusy(false)
        toast.error('No expected amount on this row', 'Use Edit to record a custom amount.')
        return
      }
      // Smart payment_method default: payroll for generated rows
      // (the cron-created weekly), manual otherwise. Existing method
      // wins (defensive — shouldn't normally exist on actual=0 rows).
      const methodDefault = p.payment_method
        || (p.payment_source === 'generated' ? 'payroll' : 'manual')
      setRows(rs => rs.map(r => r.id === p.id
        ? { ...r, actual_amount: expected, payment_method: methodDefault,
            reconciled: true, reconciled_at: nowIso, reconciled_by: user?.id || null }
        : r))
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
        .eq('id', p.id)
      if (error) {
        setRows(rs => rs.map(r => r.id === p.id ? { ...r, ...prev } : r))
        setReconcileBusy(false)
        toast.error("Couldn't reconcile", error)
        return
      }
      // Two events in order: record first, then reconcile. Keeps the
      // audit trail symmetric with how Phase 3B bulk imports write
      // these (and with the undo flow which fires the matching pair
      // of "undone" events).
      await logEvent(purchase.id, 'payment_recorded',
        `Recorded ${fmtMoney(expected)} for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`,
        { payment_id: p.id, amount: expected, method: methodDefault, combo: true },
        user?.id)
      await logEvent(purchase.id, 'payment_reconciled',
        `Reconciled payment for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)} (${fmtMoney(expected)})`,
        { payment_id: p.id, amount: expected, combo: true },
        user?.id)
      setReconcileBusy(false)
      if (undoToast?.timer) clearTimeout(undoToast.timer)
      const timer = setTimeout(() => setUndoToast(null), 10000)
      setUndoToast({
        paymentId: p.id, prev, periodStart: p.period_start, periodEnd: p.period_end,
        isCombo: true, amount: expected, timer,
        expiresAt: Date.now() + 10000,
      })
      return
    }

    // Amber-dot path: just flip reconciled.
    setRows(rs => rs.map(r => r.id === p.id
      ? { ...r, reconciled: true, reconciled_at: nowIso, reconciled_by: user?.id || null }
      : r))
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update({ reconciled: true, reconciled_at: nowIso, reconciled_by: user?.id || null })
      .eq('id', p.id)
    if (error) {
      setRows(rs => rs.map(r => r.id === p.id ? { ...r, ...prev } : r))
      setReconcileBusy(false)
      toast.error("Couldn't reconcile", error)
      return
    }
    await logEvent(
      purchase.id,
      'payment_reconciled',
      `Reconciled payment for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)} (${fmtMoney(p.actual_amount)})`,
      { payment_id: p.id, amount: p.actual_amount },
      user?.id,
    )
    setReconcileBusy(false)
    if (undoToast?.timer) clearTimeout(undoToast.timer)
    const timer = setTimeout(() => setUndoToast(null), 10000)
    setUndoToast({ paymentId: p.id, prev, periodStart: p.period_start, periodEnd: p.period_end, isCombo: false, timer, expiresAt: Date.now() + 10000 })
  }

  async function undoReconcile() {
    if (!undoToast) return
    clearTimeout(undoToast.timer)
    const { paymentId, prev, periodStart, periodEnd, isCombo, amount } = undoToast
    setUndoToast(null)
    setReconcileBusy(true)
    setRows(rs => rs.map(r => r.id === paymentId ? { ...r, ...prev } : r))
    // Combo undo reverts actual_amount + payment_method back to prior
    // values (which the balance trigger will pick up automatically) AND
    // clears the audit flag. Reconcile-only undo just flips the flag.
    const revert = isCombo
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
    setReconcileBusy(false)
    if (error) { toast.error("Couldn't undo", error); load(); return }
    if (isCombo) {
      // Symmetric to the combo action: two events, in reverse order
      // (unreconcile first, then record-undone) so the activity feed
      // reads like a logical "undo what just happened".
      await logEvent(purchase.id, 'payment_unreconciled',
        `Unreconciled payment for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (undo)`,
        { payment_id: paymentId, undo: true, combo: true },
        user?.id)
      await logEvent(purchase.id, 'payment_record_undone',
        `Recording undone for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (${fmtMoney(amount)}) (undo)`,
        { payment_id: paymentId, amount, undo: true, combo: true },
        user?.id)
    } else {
      await logEvent(purchase.id, 'payment_unreconciled',
        `Unreconciled payment for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (undo)`,
        { payment_id: paymentId, undo: true },
        user?.id)
    }
    load(); onChange?.()
  }

  // Unreconcile-only: keeps the recording. Use when "I confirmed the
  // wrong week" — the money is still correctly recorded, just remove
  // the confirmation flag.
  async function confirmUnreconcile() {
    if (!unreconcileTarget) return
    const p = unreconcileTarget
    setUnreconcileTarget(null)
    setReconcileBusy(true)
    const prev = { reconciled: p.reconciled, reconciled_at: p.reconciled_at, reconciled_by: p.reconciled_by }
    setRows(rs => rs.map(r => r.id === p.id ? { ...r, reconciled: false, reconciled_at: null, reconciled_by: null } : r))
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update({ reconciled: false, reconciled_at: null, reconciled_by: null })
      .eq('id', p.id)
    setReconcileBusy(false)
    if (error) {
      setRows(rs => rs.map(r => r.id === p.id ? { ...r, ...prev } : r))
      toast.error("Couldn't unreconcile", error)
      return
    }
    await logEvent(
      purchase.id,
      'payment_unreconciled',
      `Unreconciled payment for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`,
      { payment_id: p.id },
      user?.id,
    )
    load(); onChange?.()
  }

  // Unrecord & unreconcile: full reversal. Zeros actual_amount (balance
  // trigger recovers), clears payment_method, removes the confirmation
  // flag. Use when "I shouldn't have recorded this; it didn't happen."
  async function confirmUnrecordAndUnreconcile() {
    if (!unreconcileTarget) return
    const p = unreconcileTarget
    setUnreconcileTarget(null)
    setReconcileBusy(true)
    const prev = {
      actual_amount: p.actual_amount,
      payment_method: p.payment_method,
      reconciled: p.reconciled,
      reconciled_at: p.reconciled_at,
      reconciled_by: p.reconciled_by,
    }
    setRows(rs => rs.map(r => r.id === p.id
      ? { ...r, actual_amount: 0, payment_method: null, reconciled: false, reconciled_at: null, reconciled_by: null }
      : r))
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update({
        actual_amount: 0,
        payment_method: null,
        reconciled: false,
        reconciled_at: null,
        reconciled_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.id)
    setReconcileBusy(false)
    if (error) {
      setRows(rs => rs.map(r => r.id === p.id ? { ...r, ...prev } : r))
      toast.error("Couldn't undo payment", error)
      return
    }
    await logEvent(purchase.id, 'payment_unreconciled',
      `Unreconciled payment for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`,
      { payment_id: p.id },
      user?.id)
    await logEvent(purchase.id, 'payment_record_undone',
      `Recording undone for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)} (${fmtMoney(prev.actual_amount)})`,
      { payment_id: p.id, amount: prev.actual_amount },
      user?.id)
    load(); onChange?.()
  }

  function openTrackingEdit() {
    setTrackingDraft(trackingStart || '')
    setShowTrackingEdit(true)
  }

  async function saveTrackingStart() {
    const next = trackingDraft || null
    const today = new Date().toISOString().slice(0, 10)
    if (next && next > today) { toast.error('Tracking start date cannot be in the future.'); return }
    setSavingTracking(true)
    const { error } = await supabase
      .from('driver_purchases')
      .update({ payment_tracking_start_date: next, updated_by: user?.id || null })
      .eq('id', purchase.id)
    setSavingTracking(false)
    if (error) { toast.error("Couldn't save tracking start date", error); return }
    toast.success('Tracking start date saved')
    setTrackingStart(next)
    setShowTrackingEdit(false)
    onChange?.()
  }

  const trackingDateLabel = useMemo(() => trackingStart ? fmtDate(trackingStart) : '—', [trackingStart])

  // Write a manual collected-from override on the target payment row, then
  // update local state optimistically so the cell reflects it immediately —
  // no full reload (the previous load() left the cell stale until refresh).
  async function saveCollectedFrom(driverId, driverRow) {
    if (!setDriverTarget || !driverId) return
    setSavingCollectedFrom(true)
    const p = setDriverTarget
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update({ collected_from_driver_id: driverId, updated_at: new Date().toISOString() })
      .eq('id', p.id)
    setSavingCollectedFrom(false)
    if (error) { toast.error("Couldn't set driver", error); return }
    // Keep the picked driver's name available, then patch the row in place.
    if (driverRow?.full_name) setDriverNameById(m => ({ ...m, [driverId]: driverRow.full_name }))
    setRows(rs => rs.map(r => r.id === p.id ? { ...r, collected_from_driver_id: driverId } : r))
    toast.success('Collected-from driver set')
    await logEvent(
      purchase.id,
      'updated',
      `Set collected-from driver for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`,
      { payment_id: p.id, collected_from_driver_id: driverId },
      user?.id,
    )
    setSetDriverTarget(null)
    onChange?.()
  }

  return (
    <div className={`${S.card} p-5 space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Payment history</h3>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-500">
            <span>Tracking payments since {trackingDateLabel}</span>
            {canEdit && (
              <button
                onClick={openTrackingEdit}
                title="Change tracking start date"
                className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
          </div>
        </div>
        {canEdit && (
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors shrink-0"
          >
            + Record payment
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 dark:text-slate-600">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-600 italic py-2">
          No payment history yet. {canEdit ? 'Click + Record payment to log the first one.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 dark:border-white/5">
              <tr className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                <th className="text-left py-2 pr-3">Period</th>
                <th className="text-right py-2 px-3">Expected</th>
                <th className="text-right py-2 px-3">Actual</th>
                <th className="text-right py-2 px-3">Variance</th>
                <th className="text-left py-2 px-3">Collected from</th>
                <th className="text-left py-2 px-3">Method</th>
                <th className="text-left py-2 px-3">Source</th>
                <th className="text-center py-2 px-3">Reconciled</th>
                <th className="text-left py-2 pl-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const status = rowStatus(p, trackingStart, purchase?.payment_frequency)
                // pre-tracking + skipped share the muted styling: their
                // amounts/variance don't read as actionable data, and the
                // Reconciled column doesn't apply (skipped is an explicit
                // non-payment; reconciling something with no payment is
                // meaningless).
                const muted = status === 'pre-tracking' || status === 'skipped'
                // Variance is meaningless (and must not read as a shortfall)
                // for skipped, pre-tracking, and not-yet-overdue upcoming
                // weeks — show '—' instead of a red −$expected.
                const varMuted = muted || status === 'upcoming'
                const amountClass = muted
                  ? 'text-gray-400 dark:text-slate-600'
                  : 'text-gray-700 dark:text-slate-300'
                const actualClass = muted
                  ? 'text-gray-400 dark:text-slate-600'
                  : 'text-gray-900 dark:text-slate-200'
                return (
                  <tr
                    key={p.id}
                    onClick={() => onRowClick(p)}
                    className={`border-b border-gray-50 dark:border-white/[0.03] ${rowTint(status)} ${
                      canEdit ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]' : ''
                    }`}
                    title={canEdit ? (isRecorded(p) ? 'Click to edit' : 'Click to record payment') : undefined}
                  >
                    <td className={`py-1.5 pr-3 whitespace-nowrap text-xs ${muted ? 'text-gray-400 dark:text-slate-600' : 'text-gray-700 dark:text-slate-300'}`}>
                      {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                    </td>
                    <td className={`py-1.5 px-3 text-right font-mono text-xs ${amountClass}`}>
                      {fmtMoney(p.expected_amount)}
                    </td>
                    <td className={`py-1.5 px-3 text-right font-mono text-xs ${actualClass}`}>
                      {fmtMoney(p.actual_amount)}
                    </td>
                    <td className={`py-1.5 px-3 text-right font-mono text-xs font-semibold ${
                      varMuted ? 'text-gray-400 dark:text-slate-600' : varianceClass(p.variance)
                    }`}>
                      {varMuted ? '—' : (Number(p.variance) >= 0 ? '+' : '') + fmtMoney(p.variance)}
                    </td>
                    <td className="py-1.5 px-3 text-xs whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {status === 'skipped' ? (
                        <span className="text-gray-300 dark:text-slate-600">—</span>
                      ) : (() => {
                        const c = resolveCollectedFrom(p, contractDrivers, driverNameById)
                        if (c) {
                          return (
                            <span className="inline-flex items-center gap-1.5 min-w-0" title={c.override ? 'Manually set' : 'Assigned driver for this week'}>
                              <span className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600/40">
                                {driverInitials(c.name)}
                              </span>
                              <span className="truncate text-gray-700 dark:text-slate-300">{c.name}</span>
                            </span>
                          )
                        }
                        return (
                          <span className="inline-flex items-center gap-2">
                            <span className="italic text-gray-400 dark:text-slate-600">unassigned</span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => setSetDriverTarget(p)}
                                className="text-[11px] font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
                              >
                                set driver
                              </button>
                            )}
                          </span>
                        )
                      })()}
                    </td>
                    <td className={`py-1.5 px-3 text-xs ${muted ? 'text-gray-400 dark:text-slate-600' : 'text-gray-500 dark:text-slate-400'}`}>
                      {METHOD_LABEL[p.payment_method] || p.payment_method || '—'}
                    </td>
                    <td className="py-1.5 px-3 text-[11px]">
                      {status === 'skipped' ? (
                        canEdit ? (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setUnskipTarget(p) }}
                            title={p.skip_reason ? `Skipped: ${p.skip_reason} · Click to unskip` : 'Click to unskip'}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-600/30 hover:bg-gray-200 dark:hover:bg-slate-700/60 font-semibold transition-colors"
                          >
                            Skipped
                          </button>
                        ) : (
                          <span
                            title={p.skip_reason ? `Skipped: ${p.skip_reason}` : 'Skipped'}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-600/30 font-semibold"
                          >
                            Skipped
                          </span>
                        )
                      ) : status === 'pre-tracking' ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400">
                          Pre-tracking
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">
                          {SOURCE_LABEL[p.payment_source] || p.payment_source}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-center text-xs">
                      {muted ? (
                        <span className="text-gray-300 dark:text-slate-600">—</span>
                      ) : (() => {
                        // Build the reconciled tooltip once so it's identical
                        // whether the cell is a button (canEdit) or a span.
                        const reconcilerLabel = p.reconciled_by && reconcilerMap[p.reconciled_by]
                          ? ` by ${reconcilerMap[p.reconciled_by]}`
                          : ''
                        const reconciledTitle = p.reconciled
                          ? `Reconciled ${fmtAbsTimestamp(p.reconciled_at)}${reconcilerLabel}`
                          : status === 'recorded-unconfirmed'
                            ? 'Payment recorded but not yet reconciled. Click to confirm.'
                            : 'Click to reconcile'
                        const relAgo = p.reconciled ? relativeAgo(p.reconciled_at) : null
                        const inner = p.reconciled
                          ? (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                <span>✓</span>
                                {relAgo && <span className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">{relAgo}</span>}
                              </span>
                            )
                          : status === 'recorded-unconfirmed'
                            ? <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 inline-block" aria-label="needs confirmation" />
                            : '○'
                        if (canEdit) {
                          return (
                            <button
                              onClick={(e) => onReconcileCellClick(e, p)}
                              disabled={reconcileBusy}
                              title={canEdit && p.reconciled ? `${reconciledTitle} · Click to unreconcile` : reconciledTitle}
                              className={`inline-flex items-center justify-center px-1.5 py-0.5 min-w-[1.5rem] h-6 rounded transition-colors disabled:opacity-50 ${
                                p.reconciled
                                  ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
                                  : status === 'recorded-unconfirmed'
                                    ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/15'
                                    : 'text-gray-300 dark:text-slate-600 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-500 dark:hover:text-slate-400'
                              }`}
                            >
                              {inner}
                            </button>
                          )
                        }
                        return p.reconciled
                          ? <span className="text-emerald-600 dark:text-emerald-400" title={reconciledTitle}>{inner}</span>
                          : status === 'recorded-unconfirmed'
                            ? <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 inline-block" title="Payment recorded but not yet reconciled" />
                            : <span className="text-gray-300 dark:text-slate-600">—</span>
                      })()}
                    </td>
                    <td className="py-1.5 pl-3 text-xs max-w-[16rem]"
                        title={status === 'skipped' ? (p.skip_reason || 'Skipped') : (p.reason || '')}>
                      {/* Skipped/pre-tracking already carry their status word in
                          the Source column — here they show just the reason so
                          the word isn't duplicated. Paid/Missed/Upcoming get a
                          clear status tag (their only status label). */}
                      {status === 'skipped' ? (
                        <span className="italic text-gray-500 dark:text-slate-500 block truncate">{p.skip_reason || '—'}</span>
                      ) : status === 'pre-tracking' ? (
                        <span className="text-gray-400 dark:text-slate-600">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <StatusTag status={status} />
                          {p.reason && <span className="truncate text-gray-500 dark:text-slate-400">{p.reason}</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <RecordPaymentModal
        open={showModal}
        onClose={onModalClose}
        purchase={purchase}
        existingPayment={editRow}
        preselectPeriodId={preselectPeriodId}
        onRecorded={onRecorded}
        reconcilerMap={reconcilerMap}
        contractDrivers={contractDrivers}
        driverNameById={driverNameById}
      />

      {/* Collected-from driver picker — manual override for one week's row. */}
      <Modal open={!!setDriverTarget} onClose={() => !savingCollectedFrom && setSetDriverTarget(null)} title="Collected from" size="sm">
        {setDriverTarget && (
          <div className={S.modalBody}>
            <p className="text-xs text-gray-500 dark:text-slate-500">
              Who was the deduction for {fmtDate(setDriverTarget.period_start)} – {fmtDate(setDriverTarget.period_end)} collected from? This sets a manual override on this week only.
            </p>
            <DriverPicker value={null} driver={null} onChange={(id, row) => saveCollectedFrom(id, row)} placeholder="Search driver…" />
            <div className={S.modalFooter}>
              <button onClick={() => setSetDriverTarget(null)} disabled={savingCollectedFrom} className={S.btnCancel}>Cancel</button>
            </div>
          </div>
        )}
      </Modal>

      {/* "Tracking since" date editor */}
      <Modal open={showTrackingEdit} onClose={() => !savingTracking && setShowTrackingEdit(false)} title="Tracking start date" size="sm">
        <div className={S.modalBody}>
          <p className="text-xs text-gray-500 dark:text-slate-500">
            Weeks ending before this date render as <span className="font-semibold">Pre-tracking</span> instead of <span className="font-semibold">Missed</span>. Set this to cover the period BUDDY actually tracks for this contract.
          </p>
          <input
            type="date"
            className={S.input}
            value={trackingDraft}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setTrackingDraft(e.target.value)}
          />
          <div className={S.modalFooter}>
            <button onClick={() => setShowTrackingEdit(false)} disabled={savingTracking} className={S.btnCancel}>Cancel</button>
            <button onClick={saveTrackingStart} disabled={savingTracking} className={S.btnSave}>
              {savingTracking ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Green-✓ click popover. Two options because there are two
          distinct undo scenarios:
            • Unreconcile only — keep the recording, just remove the
              audit flag. "I confirmed the wrong week; the payment
              itself is correct." Balance unchanged.
            • Unrecord & unreconcile — full reversal. "This payment
              didn't happen at all." Balance recovers via the trigger. */}
      <Modal open={!!unreconcileTarget} onClose={() => setUnreconcileTarget(null)} title="Undo this payment?" size="sm">
        {unreconcileTarget && (
          <div className={S.modalBody}>
            <p className="text-xs text-gray-500 dark:text-slate-500">
              Reconciled
              {unreconcileTarget.reconciled_at && <> {fmtDate(unreconcileTarget.reconciled_at)}</>}
              {' '}by {reconcilerName || (unreconcileTarget.reconciled_by ? 'a user' : 'unknown')} for{' '}
              {fmtDate(unreconcileTarget.period_start)} – {fmtDate(unreconcileTarget.period_end)} ({fmtMoney(unreconcileTarget.actual_amount)}).
            </p>
            <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-1">
              <button
                onClick={confirmUnreconcile}
                disabled={reconcileBusy}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50"
              >
                <div className="text-sm font-medium text-gray-900 dark:text-slate-200">Unreconcile only</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-500">
                  Removes the confirmation flag. Keeps the recording. Balance unchanged.
                </div>
              </button>
              <button
                onClick={confirmUnrecordAndUnreconcile}
                disabled={reconcileBusy}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
              >
                <div className="text-sm font-medium text-red-700 dark:text-red-400">Unrecord &amp; unreconcile</div>
                <div className="text-[11px] text-red-700/70 dark:text-red-400/70">
                  Zeros the recorded amount and clears the method. Balance recovers.
                </div>
              </button>
            </div>
            <div className={S.modalFooter}>
              <button onClick={() => setUnreconcileTarget(null)} disabled={reconcileBusy} className={S.btnCancel}>Cancel</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Unskip confirmation — sibling to the unreconcile popover above */}
      <Modal open={!!unskipTarget} onClose={() => setUnskipTarget(null)} title="Unskip this period?" size="sm">
        {unskipTarget && (
          <div className={S.modalBody}>
            <p className="text-sm text-gray-700 dark:text-slate-300">
              Mark the period for {fmtDate(unskipTarget.period_start)} – {fmtDate(unskipTarget.period_end)} as not skipped. It will return to the standard expected/missed treatment.
            </p>
            {unskipTarget.skip_reason && (
              <p className="text-xs text-gray-500 dark:text-slate-500">
                Original reason: <span className="italic">{unskipTarget.skip_reason}</span>
              </p>
            )}
            <div className={S.modalFooter}>
              <button onClick={() => setUnskipTarget(null)} className={S.btnCancel}>Cancel</button>
              <button
                onClick={confirmUnskip}
                className="px-4 py-2 text-sm font-semibold bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl transition-colors"
              >
                Unskip
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reconcile-undo toast — 10s window. Stacks above the record-
          undo toast when both are visible (rare but possible if Rebeca
          reconciles immediately after recording). */}
      {undoToast && (
        <div
          role="status"
          className={`fixed right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border border-emerald-200 dark:border-emerald-500/30 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 ${
            recordUndoToast ? 'bottom-24' : 'bottom-6'
          }`}
        >
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-emerald-500" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            {undoToast.isCombo
              ? <>Recorded &amp; reconciled {fmtMoney(undoToast.amount)} for {fmtDate(undoToast.periodStart)}.</>
              : <>Reconciled {fmtDate(undoToast.periodStart)} payment.</>}
            {' '}
            <button onClick={undoReconcile} className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline ml-1">
              Undo ({remainingSeconds(undoToast)}s)
            </button>
          </div>
          <button
            onClick={() => { clearTimeout(undoToast.timer); setUndoToast(null) }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Record-payment undo toast — distinct from the reconcile toast.
          This one moves the BALANCE (via actual_amount), which is what
          the production bug was actually trying to undo. */}
      {recordUndoToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border border-cyan-200 dark:border-cyan-500/30 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
        >
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-cyan-500" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            Recorded {fmtMoney(recordUndoToast.amount)} for {fmtDate(recordUndoToast.periodStart)}.{' '}
            <button onClick={undoRecordPayment} className="font-semibold text-cyan-600 dark:text-cyan-400 hover:underline ml-1">
              Undo ({remainingSeconds(recordUndoToast)}s)
            </button>
          </div>
          <button
            onClick={() => { clearTimeout(recordUndoToast.timer); setRecordUndoToast(null) }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Skip-undo toast — distinct from reconcile/record toasts.
          Doesn't touch the balance (skipped rows have actual=0); just
          restores the row to its pre-skip state via previousState. */}
      {skipUndoToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border border-indigo-200 dark:border-indigo-500/30 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
        >
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-indigo-500" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            Payment skipped for {fmtDate(skipUndoToast.periodStart)}.{' '}
            <button onClick={undoSkip} className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline ml-1">
              Undo ({remainingSeconds(skipUndoToast)}s)
            </button>
          </div>
          <button
            onClick={() => { clearTimeout(skipUndoToast.timer); setSkipUndoToast(null) }}
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
