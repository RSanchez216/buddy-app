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
  onRecorded,                // (paymentId) => void
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
      setPaymentMethod(p.payment_method || 'manual')
      setReferenceNumber(p.reference_number || '')
      setReason(p.reason || '')
      setPeriods([{
        id: p.id, period_start: p.period_start, period_end: p.period_end,
        expected_amount: p.expected_amount, actual_amount: p.actual_amount,
      }])
      return
    }

    // New mode: fetch open periods (actual_amount = 0) for this contract
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('driver_purchase_payments')
        .select('id, period_start, period_end, expected_amount, actual_amount, payment_source, period_type')
        .eq('driver_purchase_id', purchase.id)
        .eq('actual_amount', 0)
        .order('period_end', { ascending: false })
        .limit(20)
      if (cancelled) return
      const open = data || []
      setPeriods(open)
      setMode(open.length ? 'existing' : 'custom')
      const first = open[0]
      if (first) {
        setPickedPeriodId(first.id)
        setAmount(String(first.expected_amount || ''))
      } else {
        setPickedPeriodId('')
        setAmount(String(purchase.payment_amount || ''))
      }
      setCustomStart(new Date().toISOString().slice(0, 10))
      setCustomEnd(new Date().toISOString().slice(0, 10))
      setPaymentMethod('manual')
      setReferenceNumber('')
      setReason('')
      setIsReversal(false)
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
    const payload = {
      actual_amount: signedAmount,
      payment_method: paymentMethod || null,
      reference_number: referenceNumber.trim() || null,
      reason: reason.trim() || null,
      reconciled: true,
      reconciled_at: nowIso,
      reconciled_by: user?.id || null,
      payment_source: isReversal ? 'reversal' : (isEdit ? existingPayment.payment_source : 'manual'),
      updated_at: nowIso,
    }

    let row, opError
    if (isEdit) {
      const res = await supabase
        .from('driver_purchase_payments')
        .update(payload)
        .eq('id', existingPayment.id)
        .select('id')
        .single()
      row = res.data; opError = res.error
    } else if (mode === 'existing' && pickedPeriodId) {
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

    // Audit event so the activity feed reflects the action
    await logEvent(
      purchase.id,
      'payment_recorded',
      isReversal
        ? `Reversal of ${fmtMoney(Math.abs(signedAmount))} recorded`
        : `Payment of ${fmtMoney(signedAmount)} recorded`,
      {
        payment_id: row?.id,
        amount: signedAmount,
        method: paymentMethod,
        reversal: !!isReversal,
        edit: !!isEdit,
      },
      user?.id,
    )

    onRecorded?.(row?.id)
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
                    {periods.map(p => (
                      <option key={p.id} value={p.id}>
                        {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                        {' · '}expected {fmtMoney(p.expected_amount)}
                      </option>
                    ))}
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

        {isEdit && (
          <div className="text-xs text-gray-500 dark:text-slate-500">
            Editing payment for {fmtDate(existingPayment.period_start)} – {fmtDate(existingPayment.period_end)}
          </div>
        )}

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
