import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { logEvent } from '../utils/events'
import { fmtMoney, fmtDate } from '../utils/format'

const PAYMENT_METHODS = [
  { v: 'manual',  l: 'Manual / cash' },
  { v: 'wire',    l: 'Wire' },
  { v: 'check',   l: 'Check' },
  { v: 'payroll', l: 'Payroll deduction' },
  { v: 'other',   l: 'Other' },
]

const SOURCE_LABEL = {
  generated:      'Generated',
  manual:         'Manual',
  payroll_import: 'Payroll import',
  reversal:       'Reversal',
}

// Smart-default the Method dropdown for the Edit path. Generated rows
// (cron-produced weeklies that represent expected payroll deductions)
// default to payroll; anything else falls back to manual/cash. The
// New-record path always defaults to payroll regardless of mode —
// payroll deduction is overwhelmingly the common case at Manas Express.
function smartDefaultMethod(payment_source) {
  if (payment_source === 'generated') return 'payroll'
  return 'manual'
}

// Modal for recording a single payment against a driver purchase.
// Two modes:
//   • Apply to existing period — UPDATEs the matching pre-generated row
//   • Custom period — INSERTs a new row (covers cases where the schedule
//     drifted from reality, e.g. catch-up wires that don't fit a week)
//
// Edit mode (existingPayment prop) re-opens an already-recorded row
// pre-filled. The reversal flag negates the entered amount on save.
export default function RecordPaymentModal({
  open,
  onClose,
  purchase,                  // raw driver_purchases row
  existingPayment,           // optional — if set, edit that row
  onRecorded,                // (info) => void
  reconcilerMap = {},        // { user_id → display name } for audit display
}) {
  const { user } = useAuth()
  const isEdit = !!existingPayment

  const [periods, setPeriods] = useState([])      // unreconciled / open periods
  const [mode, setMode] = useState('existing')    // 'existing' | 'custom'
  const [pickedPeriodId, setPickedPeriodId] = useState('')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('manual')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [reason, setReason] = useState('')
  const [isReversal, setIsReversal] = useState(false)
  // Reconciled is only user-controlled in Edit mode. New records always
  // get reconciled=true on save (recording a payment is itself a
  // confirmation). Edit lets you uncheck — e.g. zero-out a wrong entry
  // without leaving an orphaned ✓.
  const [reconciledOnSave, setReconciledOnSave] = useState(true)
  // Sticky flag — flips to true the first time the user clicks the
  // checkbox directly. Once true, the smart-default auto-check/uncheck
  // logic stops firing so we don't silently overwrite their override
  // when they tweak Amount Received or toggle the reversal flag.
  const [reconciledUserTouched, setReconciledUserTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Populate from the existing row in edit mode; otherwise fetch open
  // periods and pre-select the most-recent one for new entries.
  useEffect(() => {
    if (!open || !purchase) return

    setError('')
    setBusy(false)

    if (isEdit) {
      const p = existingPayment
      setMode('existing')
      setPickedPeriodId(p.id)
      setCustomStart(p.period_start || '')
      setCustomEnd(p.period_end || '')
      // Reversal flag is inferred from sign; users set/unset it here too
      const rev = Number(p.actual_amount) < 0
      setIsReversal(rev)
      setAmount(rev ? String(Math.abs(p.actual_amount)) : String(p.actual_amount || p.expected_amount || ''))
      // Smart default: existing method wins; otherwise infer from source
      // (generated → payroll, anything else → manual).
      setPaymentMethod(p.payment_method || smartDefaultMethod(p.payment_source))
      setReferenceNumber(p.reference_number || '')
      setReason(p.reason || '')
      // Edit-mode smart default for "Mark as reconciled":
      //   actual > 0 (recorded already, with or without prior reconcile)
      //     → pre-check; user's clear intent on opening the row is to
      //       confirm it (or re-save the existing confirmation).
      //   actual = 0 (empty/unrecorded row)
      //     → start unchecked; the amount-onChange auto-check fires
      //       once the user actually enters a value.
      // Either way, reset the "touched" flag — the modal is opening
      // fresh and the user hasn't picked anything yet.
      setReconciledOnSave(Number(p.actual_amount || 0) !== 0)
      setReconciledUserTouched(false)
      setPeriods([{
        id: p.id, period_start: p.period_start, period_end: p.period_end,
        expected_amount: p.expected_amount, actual_amount: p.actual_amount,
      }])
      return
    }

    // New mode: fetch open periods (actual_amount = 0) for this contract
    let cancelled = false
    ;(async () => {
      // Pull every period at/after the contract's tracking-start cutoff,
      // chronological ascending. Both paid and unpaid rows are included
      // so the user can target a paid row for reversal/correction; the
      // option label distinguishes them visually. Limit raised to 200
      // (~4 years of weekly periods) so long contracts don't get cut off.
      let q = supabase
        .from('driver_purchase_payments')
        .select('id, period_start, period_end, expected_amount, actual_amount, payment_source, period_type')
        .eq('driver_purchase_id', purchase.id)
      if (purchase.payment_tracking_start_date) {
        q = q.gte('period_end', purchase.payment_tracking_start_date)
      }
      const { data } = await q
        .order('period_start', { ascending: true })
        .limit(200)
      if (cancelled) return
      const all = data || []
      setPeriods(all)
      setMode(all.length ? 'existing' : 'custom')
      // Default selection: earliest unpaid period (smallest period_start
      // where actual_amount = 0). This is the natural "next payment to
      // record" target. If everything's paid (contract caught up),
      // fall back to the most recent paid period for the rare
      // reversal/correction case.
      const earliestUnpaid = all.find(p => Number(p.actual_amount || 0) === 0)
      const fallbackPaid = [...all].reverse().find(p => Number(p.actual_amount || 0) !== 0)
      const picked = earliestUnpaid || fallbackPaid
      if (picked) {
        setPickedPeriodId(picked.id)
        setAmount(String(picked.expected_amount || ''))
      } else {
        setPickedPeriodId('')
        setAmount(String(purchase.payment_amount || ''))
      }
      setCustomStart(new Date().toISOString().slice(0, 10))
      setCustomEnd(new Date().toISOString().slice(0, 10))
      // Default to payroll for ALL new-record paths (existing-period
      // AND custom-period) — payroll deduction is the common case, and
      // having one consistent default avoids the cognitive overhead of
      // remembering which mode picks which default. User can still
      // change to manual/wire/check/other before saving.
      setPaymentMethod('payroll')
      setReferenceNumber('')
      setReason('')
      setIsReversal(false)
      // New-record path implicitly confirms the payment — the user
      // wouldn't be entering an amount otherwise. The auto-check
      // useEffect will keep this in sync with Amount Received as the
      // user edits (down to 0 → uncheck), until they manually toggle
      // the checkbox themselves (touched=true sticks).
      setReconciledOnSave(true)
      setReconciledUserTouched(false)
    })()
    return () => { cancelled = true }
  }, [open, purchase, isEdit, existingPayment])

  // When the user switches the selected existing period, autofill amount
  // with that period's expected (unless they've already typed something).
  useEffect(() => {
    if (mode !== 'existing' || !pickedPeriodId || isEdit) return
    const p = periods.find(x => x.id === pickedPeriodId)
    if (p) setAmount(String(p.expected_amount || ''))
  }, [pickedPeriodId, mode, periods, isEdit])

  // Smart-default for "Mark as reconciled": keep the checkbox in sync
  // with the entered amount until the user takes manual control. Any
  // positive amount with reversal off ⇒ pre-check; zero/empty ⇒ uncheck;
  // reversal on ⇒ uncheck (reversals aren't payroll confirmations).
  // Once reconciledUserTouched flips true (user clicked the checkbox
  // themselves), this effect becomes a no-op so we don't fight them.
  useEffect(() => {
    if (reconciledUserTouched) return
    const n = Number(amount)
    const positive = Number.isFinite(n) && n > 0
    if (isReversal) {
      setReconciledOnSave(false)
    } else if (positive) {
      setReconciledOnSave(true)
    } else {
      setReconciledOnSave(false)
    }
  }, [amount, isReversal, reconciledUserTouched])

  const signedAmount = useMemo(() => {
    const n = Number(amount)
    if (!Number.isFinite(n)) return null
    return isReversal ? -Math.abs(n) : n
  }, [amount, isReversal])

  async function save() {
    if (!purchase) return
    if (signedAmount == null) { setError('Enter a numeric amount'); return }
    setBusy(true); setError('')

    const nowIso = new Date().toISOString()
    // reconciledOnSave drives the audit-flag fields. When unchecked,
    // we explicitly null the audit fields too — keeping them stale
    // would misattribute the prior reconcile to this save.
    const reconciledFields = reconciledOnSave
      ? { reconciled: true, reconciled_at: nowIso, reconciled_by: user?.id || null }
      : { reconciled: false, reconciled_at: null, reconciled_by: null }
    const payload = {
      actual_amount: signedAmount,
      payment_method: paymentMethod || null,
      reference_number: referenceNumber.trim() || null,
      reason: reason.trim() || null,
      ...reconciledFields,
      payment_source: isReversal ? 'reversal' : (isEdit ? existingPayment.payment_source : 'manual'),
      updated_at: nowIso,
    }

    let row, opError, periodStart, periodEnd
    // previousState captures the row's state BEFORE this save — needed
    // so the parent can offer an undo path that reverts to whatever was
    // there (not just "actual=0"). For inserts, isNewlyInserted=true
    // signals the undo should delete the row instead of reverting.
    let previousState = null
    let isNewlyInserted = false
    if (isEdit) {
      previousState = {
        actual_amount: existingPayment.actual_amount,
        payment_method: existingPayment.payment_method,
        reference_number: existingPayment.reference_number,
        reason: existingPayment.reason,
        reconciled: existingPayment.reconciled,
        reconciled_at: existingPayment.reconciled_at,
        reconciled_by: existingPayment.reconciled_by,
        payment_source: existingPayment.payment_source,
      }
      periodStart = existingPayment.period_start
      periodEnd = existingPayment.period_end
      const res = await supabase
        .from('driver_purchase_payments')
        .update(payload)
        .eq('id', existingPayment.id)
        .select('id')
        .single()
      row = res.data; opError = res.error
    } else if (mode === 'existing' && pickedPeriodId) {
      // Updating a pre-generated row. Its prior state was actual=0,
      // reconciled=false (otherwise it wouldn't have been listed as an
      // open period), but pull the full row to be safe.
      const picked = periods.find(x => x.id === pickedPeriodId)
      previousState = picked ? {
        actual_amount: picked.actual_amount,
        payment_method: null,
        reference_number: null,
        reason: null,
        reconciled: false,
        reconciled_at: null,
        reconciled_by: null,
        payment_source: picked.payment_source || 'generated',
      } : null
      periodStart = picked?.period_start
      periodEnd = picked?.period_end
      const res = await supabase
        .from('driver_purchase_payments')
        .update(payload)
        .eq('id', pickedPeriodId)
        .select('id')
        .single()
      row = res.data; opError = res.error
    } else {
      // Custom period: insert a new row. period_type defaults to the
      // contract's payment_frequency.
      if (!customStart || !customEnd) { setBusy(false); setError('Pick start and end dates'); return }
      isNewlyInserted = true
      periodStart = customStart
      periodEnd = customEnd
      const res = await supabase
        .from('driver_purchase_payments')
        .insert({
          driver_purchase_id: purchase.id,
          period_start: customStart,
          period_end: customEnd,
          period_type: purchase.payment_frequency || 'weekly',
          expected_amount: 0,                 // custom rows have no schedule expectation
          ...payload,
        })
        .select('id')
        .single()
      row = res.data; opError = res.error
    }

    setBusy(false)
    if (opError) { setError(opError.message); return }

    // Audit event. Distinct event_type for edits so the activity feed
    // and audit query can tell record-from-scratch from edit-after-the-fact.
    if (isEdit) {
      const prevAmt = Number(previousState?.actual_amount || 0)
      const newAmt = Number(signedAmount)
      const fields = []
      if (prevAmt !== newAmt) fields.push(`actual ${fmtMoney(prevAmt)} → ${fmtMoney(newAmt)}`)
      if ((previousState?.payment_method || '') !== (paymentMethod || '')) {
        fields.push(`method ${previousState?.payment_method || '—'} → ${paymentMethod || '—'}`)
      }
      if (!!previousState?.reconciled !== true) fields.push('reconciled true')
      await logEvent(
        purchase.id,
        'payment_edited',
        `Edited payment for ${fmtDate(periodStart)} – ${fmtDate(periodEnd)}${fields.length ? ': ' + fields.join(', ') : ''}`,
        { payment_id: row?.id, before: previousState, after: payload },
        user?.id,
      )
    } else {
      await logEvent(
        purchase.id,
        'payment_recorded',
        isReversal
          ? `Reversal of ${fmtMoney(Math.abs(signedAmount))} recorded for ${fmtDate(periodStart)}`
          : `Recorded ${fmtMoney(signedAmount)} for ${fmtDate(periodStart)}`,
        {
          payment_id: row?.id,
          amount: signedAmount,
          method: paymentMethod,
          reversal: !!isReversal,
        },
        user?.id,
      )
    }

    onRecorded?.({
      paymentId: row?.id,
      amount: signedAmount,
      periodStart,
      periodEnd,
      isEdit,
      isReversal: !!isReversal,
      isNewlyInserted,
      previousState,
    })
  }

  if (!purchase) return null

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit payment' : 'Record payment'} size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {/* Period selection */}
        {!isEdit && (
          <div className="space-y-2">
            <label className={S.label}>Period</label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'existing'}
                disabled={periods.length === 0}
                onChange={() => setMode('existing')}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-700 dark:text-slate-300">Apply to existing period</span>
                {periods.length > 0 ? (
                  <Select
                    value={pickedPeriodId}
                    onChange={e => setPickedPeriodId(e.target.value)}
                    disabled={mode !== 'existing'}
                    className="mt-1"
                  >
                    {periods.map(p => {
                      const paid = Number(p.actual_amount || 0) !== 0
                      // Native <option> can't be richly styled, so the
                      // visual distinction lives in the text itself —
                      // "✓ paid $X" on paid rows reads as a clearly
                      // different state from "expected $X".
                      return (
                        <option key={p.id} value={p.id}>
                          {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                          {' · '}
                          {paid
                            ? `✓ paid ${fmtMoney(p.actual_amount)}`
                            : `expected ${fmtMoney(p.expected_amount)}`}
                        </option>
                      )
                    })}
                  </Select>
                ) : (
                  <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">No open periods. Use a custom period below.</p>
                )}
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-700 dark:text-slate-300">Custom period</span>
                {mode === 'custom' && (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <input type="date" className={S.input} value={customStart} onChange={e => setCustomStart(e.target.value)} />
                    <input type="date" className={S.input} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
                  </div>
                )}
              </div>
            </label>
          </div>
        )}

        {isEdit && (() => {
          const recName = existingPayment.reconciled_by ? reconcilerMap[existingPayment.reconciled_by] : ''
          return (
            <div className="rounded-lg bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 px-3 py-2 space-y-1 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-500 dark:text-slate-500">
                  Editing payment for {fmtDate(existingPayment.period_start)} – {fmtDate(existingPayment.period_end)}
                </span>
                {existingPayment.payment_source && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">
                    {SOURCE_LABEL[existingPayment.payment_source] || existingPayment.payment_source}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-slate-500 space-x-2">
                {existingPayment.created_at && (
                  <span>Created {fmtDate(existingPayment.created_at)}</span>
                )}
                {existingPayment.reconciled && existingPayment.reconciled_at && (
                  <span>
                    · Reconciled {fmtDate(existingPayment.reconciled_at)}
                    {recName && <> by {recName}</>}
                  </span>
                )}
              </div>
            </div>
          )
        })()}

        <div>
          <label className={S.label}>Amount received</label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-slate-400">$</span>
            <input
              className={S.input}
              type="number"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          {isReversal && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
              Will be stored as <span className="font-mono">{fmtMoney(signedAmount)}</span> (reversal).
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={S.label}>Method</label>
            <Select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              {PAYMENT_METHODS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </Select>
          </div>
          <div>
            <label className={S.label}>Reference #</label>
            <input className={S.input} value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} placeholder="optional" />
          </div>
        </div>

        <div>
          <label className={S.label}>Reason / notes</label>
          <textarea
            className={S.textarea}
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder='e.g. "Cash this week", "Refund issued for over-deduction"'
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isReversal} onChange={e => setIsReversal(e.target.checked)} />
          <span className="text-sm text-gray-700 dark:text-slate-300">This is a reversal (negative amount)</span>
        </label>

        {/* Reconciled toggle. The smart-default useEffect keeps this in
            sync with Amount Received and the reversal flag — until the
            user clicks the checkbox directly, which sticks via the
            touched flag and disables the auto behavior. Helper text
            below is deliberately explicit about the balance-vs-flag
            distinction; the prior wording ("audit-confirmed; does not
            affect the balance") was the same idea but used jargon
            ("audit-confirmed") that didn't land. */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={reconciledOnSave}
              onChange={e => {
                setReconciledOnSave(e.target.checked)
                setReconciledUserTouched(true)
              }}
            />
            <span className="text-sm text-gray-700 dark:text-slate-300">Mark as reconciled</span>
          </label>
          <p className="mt-1 ml-6 text-[11px] text-gray-500 dark:text-slate-500">
            Confirms the payment was verified against payroll. The balance updates from
            {' '}<span className="font-medium">Amount Received</span> above — not from this checkbox.
          </p>
        </div>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel} disabled={busy}>Cancel</button>
          <button onClick={save} disabled={busy} className={S.btnSave}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Record payment')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
