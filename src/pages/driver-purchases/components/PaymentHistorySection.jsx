import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import RecordPaymentModal from './RecordPaymentModal'
import { logEvent } from '../utils/events'
import { fmtMoney, fmtDate } from '../utils/format'

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

// Variance traffic-lights: green ≥ 0, amber for small shorts, red for >$100 short.
function varianceClass(v) {
  const n = Number(v || 0)
  if (n >= 0) return 'text-emerald-600 dark:text-emerald-400'
  if (n > -100) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

// Returns one of: 'reversal' | 'pre-tracking' | 'reconciled' | 'missed' | 'expected'.
// Priority matches the spec: actual data always wins over pre-tracking.
function rowStatus(p, trackingStart) {
  const actual = Number(p.actual_amount || 0)
  if (actual < 0) return 'reversal'
  if (actual > 0) return 'reconciled'
  // actual === 0 from here on
  if (trackingStart && p.period_end && p.period_end < trackingStart) return 'pre-tracking'
  const ended = p.period_end && new Date(p.period_end + 'T00:00:00') < new Date()
  if (ended && Number(p.expected_amount || 0) > 0) return 'missed'
  return 'expected'
}

// Row tint: missed → red wash; reversal → blue wash; pre-tracking →
// subtle gray wash to visually de-emphasize the row; everything else neutral.
function rowTint(status) {
  switch (status) {
    case 'reversal':     return 'bg-blue-50/50 dark:bg-blue-500/5'
    case 'missed':       return 'bg-red-50/50 dark:bg-red-500/5'
    case 'pre-tracking': return 'bg-gray-50/60 dark:bg-white/[0.015]'
    default:             return ''
  }
}

export default function PaymentHistorySection({ purchase, canEdit, onChange, openSignal = 0 }) {
  const { user, profile } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [trackingStart, setTrackingStart] = useState(purchase?.payment_tracking_start_date || null)
  const [showTrackingEdit, setShowTrackingEdit] = useState(false)
  const [trackingDraft, setTrackingDraft] = useState('')
  const [savingTracking, setSavingTracking] = useState(false)

  // Reconcile-undo toast: { paymentId, prevValues, periodStart, timer }.
  // Only ever shown for user-initiated reconciles, not bulk imports.
  const [undoToast, setUndoToast] = useState(null)
  const [unreconcileTarget, setUnreconcileTarget] = useState(null)  // payment row
  const [reconcileBusy, setReconcileBusy] = useState(false)
  // Lookup for the unreconcile popover's "originally reconciled by" line —
  // populated lazily when the popover opens.
  const [reconcilerName, setReconcilerName] = useState('')

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
    setRows(data || [])
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

  function openNew() { setEditRow(null); setShowModal(true) }
  function openEdit(row) { if (!canEdit) return; setEditRow(row); setShowModal(true) }
  function onModalClose() { setShowModal(false); setEditRow(null) }
  function onRecorded() {
    setShowModal(false); setEditRow(null)
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

  async function reconcilePayment(p) {
    setReconcileBusy(true)
    const nowIso = new Date().toISOString()
    const prev = { reconciled: p.reconciled, reconciled_at: p.reconciled_at, reconciled_by: p.reconciled_by }
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
      alert('Could not reconcile: ' + error.message)
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
    // Replace any existing undo toast (and clear its timer)
    if (undoToast?.timer) clearTimeout(undoToast.timer)
    const timer = setTimeout(() => setUndoToast(null), 10000)
    setUndoToast({ paymentId: p.id, prev, periodStart: p.period_start, periodEnd: p.period_end, timer })
  }

  async function undoReconcile() {
    if (!undoToast) return
    clearTimeout(undoToast.timer)
    const { paymentId, prev, periodStart, periodEnd } = undoToast
    setUndoToast(null)
    setReconcileBusy(true)
    setRows(rs => rs.map(r => r.id === paymentId ? { ...r, ...prev } : r))
    const { error } = await supabase
      .from('driver_purchase_payments')
      .update({ reconciled: false, reconciled_at: null, reconciled_by: null })
      .eq('id', paymentId)
    setReconcileBusy(false)
    if (error) { alert('Undo failed: ' + error.message); load(); return }
    await logEvent(
      purchase.id,
      'payment_unreconciled',
      `Unreconciled payment for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)} (undo)`,
      { payment_id: paymentId, undo: true },
      user?.id,
    )
  }

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
      alert('Could not unreconcile: ' + error.message)
      return
    }
    await logEvent(
      purchase.id,
      'payment_unreconciled',
      `Unreconciled payment for ${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`,
      { payment_id: p.id },
      user?.id,
    )
  }

  function openTrackingEdit() {
    setTrackingDraft(trackingStart || '')
    setShowTrackingEdit(true)
  }

  async function saveTrackingStart() {
    const next = trackingDraft || null
    const today = new Date().toISOString().slice(0, 10)
    if (next && next > today) { alert('Tracking start date cannot be in the future.'); return }
    setSavingTracking(true)
    const { error } = await supabase
      .from('driver_purchases')
      .update({ payment_tracking_start_date: next, updated_by: user?.id || null })
      .eq('id', purchase.id)
    setSavingTracking(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setTrackingStart(next)
    setShowTrackingEdit(false)
    onChange?.()
  }

  const trackingDateLabel = useMemo(() => trackingStart ? fmtDate(trackingStart) : '—', [trackingStart])

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
                <th className="text-left py-2 px-3">Method</th>
                <th className="text-left py-2 px-3">Source</th>
                <th className="text-center py-2 px-3">Reconciled</th>
                <th className="text-left py-2 pl-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const status = rowStatus(p, trackingStart)
                const muted = status === 'pre-tracking'
                const amountClass = muted
                  ? 'text-gray-400 dark:text-slate-600'
                  : 'text-gray-700 dark:text-slate-300'
                const actualClass = muted
                  ? 'text-gray-400 dark:text-slate-600'
                  : 'text-gray-900 dark:text-slate-200'
                return (
                  <tr
                    key={p.id}
                    onClick={() => openEdit(p)}
                    className={`border-b border-gray-50 dark:border-white/[0.03] ${rowTint(status)} ${
                      canEdit ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]' : ''
                    }`}
                    title={canEdit ? 'Click to edit' : undefined}
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
                      muted ? 'text-gray-400 dark:text-slate-600' : varianceClass(p.variance)
                    }`}>
                      {muted ? '—' : (Number(p.variance) >= 0 ? '+' : '') + fmtMoney(p.variance)}
                    </td>
                    <td className={`py-1.5 px-3 text-xs ${muted ? 'text-gray-400 dark:text-slate-600' : 'text-gray-500 dark:text-slate-400'}`}>
                      {METHOD_LABEL[p.payment_method] || p.payment_method || '—'}
                    </td>
                    <td className="py-1.5 px-3 text-[11px]">
                      {status === 'pre-tracking' ? (
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
                      ) : canEdit ? (
                        <button
                          onClick={(e) => onReconcileCellClick(e, p)}
                          disabled={reconcileBusy}
                          title={p.reconciled ? 'Click to unreconcile' : 'Click to reconcile'}
                          className={`w-6 h-6 inline-flex items-center justify-center rounded transition-colors disabled:opacity-50 ${
                            p.reconciled
                              ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
                              : 'text-gray-300 dark:text-slate-600 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-500 dark:hover:text-slate-400'
                          }`}
                        >
                          {p.reconciled ? '✓' : '○'}
                        </button>
                      ) : (
                        p.reconciled
                          ? <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                          : <span className="text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className={`py-1.5 pl-3 text-xs ${muted ? 'text-gray-400 dark:text-slate-600' : 'text-gray-500 dark:text-slate-400'} max-w-[14rem] truncate`} title={p.reason || ''}>
                      {p.reason || (status === 'missed'
                        ? <span className="italic text-red-600/80 dark:text-red-400/80">Missed</span>
                        : '—')}
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
        onRecorded={onRecorded}
      />

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

      {/* Unreconcile confirmation (when user clicks an already-reconciled ✓) */}
      <Modal open={!!unreconcileTarget} onClose={() => setUnreconcileTarget(null)} title="Unreconcile this payment?" size="sm">
        {unreconcileTarget && (
          <div className={S.modalBody}>
            <p className="text-sm text-gray-700 dark:text-slate-300">
              Mark the payment for {fmtDate(unreconcileTarget.period_start)} – {fmtDate(unreconcileTarget.period_end)} as not reconciled.
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-500">
              Originally reconciled by {reconcilerName || (unreconcileTarget.reconciled_by ? 'a user' : 'unknown')}
              {unreconcileTarget.reconciled_at && <> on {fmtDate(unreconcileTarget.reconciled_at)}</>}.
            </p>
            <div className={S.modalFooter}>
              <button onClick={() => setUnreconcileTarget(null)} disabled={reconcileBusy} className={S.btnCancel}>Cancel</button>
              <button
                onClick={confirmUnreconcile}
                disabled={reconcileBusy}
                className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-white rounded-xl transition-colors disabled:opacity-50"
              >
                {reconcileBusy ? 'Working…' : 'Unreconcile'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reconcile-undo toast — 10s window */}
      {undoToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border border-emerald-200 dark:border-emerald-500/30 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
        >
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-emerald-500" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            Reconciled {fmtDate(undoToast.periodStart)} payment.{' '}
            <button onClick={undoReconcile} className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline ml-1">
              Undo (10s)
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
    </div>
  )
}
