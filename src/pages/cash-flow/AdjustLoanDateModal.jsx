import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import { CF, fmtMoney } from './calendarUtils'

export default function AdjustLoanDateModal({ open, onClose, event, onSaved }) {
  const [details, setDetails] = useState(null) // joined loan_payment + loan + lender
  const [plannedDate, setPlannedDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !event) return
    setError(''); setDetails(null)
    // For loan rows in v_cash_flow_events, event_id is the loan_payments.id
    const paymentId = event.event_id
    supabase
      .from('loan_payments')
      .select('id, due_date, planned_pay_date, scheduled_amount, status, loan:loans(loan_id_external, contract_number, lender:loan_lenders(name))')
      .eq('id', paymentId)
      .maybeSingle()
      .then(({ data }) => {
        setDetails(data)
        setPlannedDate(data?.planned_pay_date || '')
      })
  }, [open, event])

  async function save() {
    if (!details) return
    setSaving(true); setError('')
    const res = await supabase.from('loan_payments').update({
      planned_pay_date: plannedDate || null,
      updated_at: new Date().toISOString(),
    }).eq('id', details.id)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    onSaved?.()
    onClose()
  }

  async function reset() {
    if (!details) return
    setSaving(true); setError('')
    const res = await supabase.from('loan_payments').update({
      planned_pay_date: null,
      updated_at: new Date().toISOString(),
    }).eq('id', details.id)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Adjust planned pay date" size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}
        {!details ? (
          <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
        ) : (
          <>
            <div className={`${S.card} p-4 space-y-2`}>
              <Row label="Lender" value={details.loan?.lender?.name || '—'} />
              <Row label="Loan ID" value={details.loan?.loan_id_external || '—'} mono />
              <Row label="Contract #" value={details.loan?.contract_number || '—'} mono />
              <Row label="Scheduled amount" value={fmtMoney(details.scheduled_amount)} mono bold />
              <Row label="Original due date" value={details.due_date || '—'} />
              <Row label="Current planned pay date" value={details.planned_pay_date || 'Same as due date'} muted={!details.planned_pay_date} />
            </div>

            <div>
              <label className={S.label}>New planned pay date</label>
              <input type="date" className={S.input} value={plannedDate} onChange={e => setPlannedDate(e.target.value)} />
              <button onClick={reset} className="mt-2 text-xs text-gray-500 hover:text-orange-600 dark:hover:text-orange-400">
                Reset to due date ({details.due_date})
              </button>
            </div>

            <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400">
              ⚠ This does not change the contractual due date. The lender still expects payment on <span className="font-semibold">{details.due_date}</span>.
            </div>

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel}>Cancel</button>
              <button onClick={save} disabled={saving} className={CF.btnSave}>
                {saving ? 'Saving…' : 'Save planned date'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, value, mono, bold, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : 'font-medium'} ${muted ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-700 dark:text-slate-300'}`}>
        {value}
      </span>
    </div>
  )
}
