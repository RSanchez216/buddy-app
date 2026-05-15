import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Select from '../../components/Select'
import { CF, fmtMoney, toISO } from './calendarUtils'

const PAYMENT_METHODS = ['ACH', 'Wire', 'Check', 'Auto-pay', 'Other']

// Shared "Mark as paid / partial" modal for loan_payments and invoices.
// kind: 'loan' | 'invoice'; mode: 'paid' | 'partial' (partial only used for loans).
//
// `record` is the underlying row from the DB:
//   - loan: row from loan_payments (with optional joined loan/lender for header)
//   - invoice: row from invoices (with optional joined vendor)
export default function MarkPaidModal({ open, kind, mode = 'paid', record, headerSubtitle, onClose, onSaved }) {
  const [paidAmount, setPaidAmount] = useState('')
  const [paidDate, setPaidDate] = useState('')
  const [method, setMethod] = useState('ACH')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset form whenever the modal opens for a new record
  useEffect(() => {
    if (!open || !record) return
    const defaultAmount = kind === 'loan'
      ? (record.scheduled_amount ?? '')
      : (record.amount ?? '')
    setPaidAmount(record.paid_amount ?? defaultAmount)
    setPaidDate(record.paid_date || toISO(new Date()))
    setMethod(record.payment_method || 'ACH')
    setReference(record.reference_number || '')
    setNotes(record.notes || '')
    setError('')
  }, [open, record, kind])

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const isPartial = mode === 'partial'
  const buttonLabel = isPartial ? 'Mark as partial' : 'Mark as paid'

  async function save() {
    if (!record) return
    if (!Number(paidAmount) || Number(paidAmount) <= 0) return setError('Paid amount is required')
    if (!paidDate) return setError('Paid date is required')

    console.log(`[MarkPaid:${kind}] saving — id:`, record.id, 'mode:', mode)
    setSaving(true); setError('')

    try {
      let res
      if (kind === 'loan') {
        // loan_payments status uses lowercase ('paid' | 'partial')
        res = await supabase.from('loan_payments').update({
          status: isPartial ? 'partial' : 'paid',
          paid_amount: Number(paidAmount),
          paid_date: paidDate,
          payment_method: method || null,
          reference_number: reference.trim() || null,
          notes: notes.trim() || null,
          updated_at: new Date().toISOString(),
        }).eq('id', record.id)
      } else {
        // invoices status check constraint requires Pascal-case. paid_at
        // stamps the moment of marking so the time-aware projection can
        // decide whether to include the cash impact on the anchor day.
        res = await supabase.from('invoices').update({
          status: 'Paid',
          paid_amount: Number(paidAmount),
          paid_date: paidDate,
          paid_at: new Date().toISOString(),
          payment_method: method || null,
          reference_number: reference.trim() || null,
          notes: notes.trim() || null,
        }).eq('id', record.id)
      }
      if (res?.error) throw new Error(res.error.message)
      console.log(`[MarkPaid:${kind}] success`)
      setSaving(false)
      onSaved?.()
    } catch (err) {
      console.error(`[MarkPaid:${kind}] failed:`, err)
      setError(err?.message || 'Save failed')
      setSaving(false)
    }
  }

  if (!open) return null

  const title = isPartial ? 'Mark as partial payment' : 'Mark as paid'
  const scheduled = kind === 'loan' ? record?.scheduled_amount : record?.amount

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Backdrop closes only this modal */}
      <div className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
            {headerSubtitle && (
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">{headerSubtitle}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className={S.modalBody}>
            {error && <div className={S.errorBox}>{error}</div>}

            {scheduled != null && (
              <div className="text-xs text-gray-500 dark:text-slate-500">
                Scheduled: <span className="font-mono font-semibold text-gray-700 dark:text-slate-300">{fmtMoney(scheduled)}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Paid amount ($) *">
                <input type="number" step="0.01" className={S.input} value={paidAmount} onChange={e => setPaidAmount(e.target.value)} />
                {isPartial && Number(paidAmount) >= Number(scheduled || 0) && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Partial usually means less than scheduled.</p>
                )}
              </Field>
              <Field label="Paid date *">
                <input type="date" className={S.input} value={paidDate} onChange={e => setPaidDate(e.target.value)} />
              </Field>
              <Field label="Payment method">
                <Select value={method} onChange={e => setMethod(e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </Field>
              <Field label="Reference number">
                <input className={S.input} value={reference} onChange={e => setReference(e.target.value)} placeholder="optional — confirmation #" />
              </Field>
            </div>

            <Field label="Notes">
              <textarea className={S.textarea} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </Field>

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel}>Cancel</button>
              <button onClick={save} disabled={saving} className={CF.btnSave}>
                {saving ? 'Saving…' : buttonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}
