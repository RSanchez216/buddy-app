import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { useToast } from '../../../contexts/ToastContext'

// Edit / set the anchor balance for a loan. Three fields: new balance,
// as-of date (defaults Chicago today, must be <= today), optional notes.
// On save: updates loans.current_balance + as_of_date + updated_by, writes
// an audit_log entry with before/after.

function chicagoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export default function LoanBalanceEditModal({ open, loan, onClose, onSaved }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const [balance, setBalance] = useState('')
  const [asOfDate, setAsOfDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError(''); setNotes('')
    setBalance(loan?.current_balance != null ? String(loan.current_balance) : '')
    setAsOfDate(loan?.current_balance_as_of_date || chicagoToday())
  }, [open, loan])

  async function save() {
    if (!loan) return
    if (balance === '' || Number.isNaN(Number(balance))) { setError('Balance must be a number.'); return }
    if (Number(balance) < 0) { setError('Balance must be ≥ 0.'); return }
    if (!asOfDate) { setError('Pick an as-of date.'); return }
    if (asOfDate > chicagoToday()) { setError('As-of date can\'t be in the future.'); return }

    setSaving(true); setError('')
    const prev = {
      balance: loan.current_balance != null ? Number(loan.current_balance) : null,
      as_of_date: loan.current_balance_as_of_date || null,
    }
    const next = { balance: Number(balance), as_of_date: asOfDate }

    const { error: upErr } = await supabase
      .from('loans')
      .update({
        current_balance: next.balance,
        current_balance_as_of_date: next.as_of_date,
        current_balance_updated_by: user?.id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', loan.id)
    if (upErr) { setSaving(false); setError(upErr.message); toast.error("Couldn't update loan balance", upErr); return }

    await supabase.from('audit_log').insert({
      table_name: 'loans',
      record_id: loan.id,
      action: 'loan_balance_updated',
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        loan_id: loan.id,
        task_name: loan.task_name || null,
        before: prev,
        after: next,
        notes: notes.trim() || null,
      },
    })

    setSaving(false)
    toast.success('Loan balance updated')
    onSaved?.()
    onClose?.()
  }

  if (!open || !loan) return null

  return (
    <Modal open={open} onClose={onClose} title="Update loan balance" size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div>
          <label className={S.label}>Loan</label>
          <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 text-sm text-gray-700 dark:text-slate-300">
            {loan.task_name || loan.loan_id_external || '—'}
            {loan.contract_number && <span className="text-gray-400 dark:text-slate-500 font-mono ml-2">#{loan.contract_number}</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={S.label}>New balance ($) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={S.input}
              value={balance}
              onChange={e => setBalance(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className={S.label}>As of date *</label>
            <input
              type="date"
              className={S.input}
              value={asOfDate}
              max={chicagoToday()}
              onChange={e => setAsOfDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={S.label}>Notes</label>
          <textarea
            className={S.textarea}
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional — where this balance came from (lender portal, QB, etc.)"
          />
        </div>

        <p className="text-[11px] text-gray-500 dark:text-slate-500">
          The estimated balance on the Overview tab updates immediately. After this anchor, the estimate ticks down by the monthly payment for each full month elapsed.
        </p>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel} disabled={saving}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>
            {saving ? 'Saving…' : 'Update balance'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
