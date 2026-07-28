import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import { markExpensePaid, todayChicago, PAYMENT_METHODS } from './officeData'

// Compact centered dialog to mark an expense paid. Captures date (default today
// in Chicago), method, and an optional note; paid_by + paid_at are recorded
// server-side (the RPC uses auth.uid() / now()). Admin/manager only — the caller
// gates the trigger button, and the RPC rejects others.
export default function MarkPaidPopover({ open, expense, onClose, onDone }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(todayChicago())
  const [method, setMethod] = useState(PAYMENT_METHODS[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDate(todayChicago()); setMethod(PAYMENT_METHODS[0]); setNote(''); setBusy(false)
  }, [open])

  if (!open || !expense) return null

  async function confirm() {
    if (!date) { toast.error('Pick a payment date'); return }
    setBusy(true)
    try {
      await markExpensePaid(expense.id, date, method, note)
      toast.success('Marked paid')
      onDone?.()
    } catch (e) {
      toast.error("Couldn't mark paid", e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Mark expense paid</h3>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 truncate">{expense.category} · {expense.expense_date}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={S.label}>Payment date</label>
            <input type="date" className={S.input} value={date} onChange={e => setDate(e.target.value || date)} />
          </div>
          <div>
            <label className={S.label}>Method</label>
            <select className={S.input} value={method} onChange={e => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={S.label}>Note <span className="font-normal normal-case text-gray-400">(optional)</span></label>
          <input className={S.input} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. paid with July payroll" />
        </div>

        <p className="text-[11px] text-gray-400 dark:text-slate-500">Marked by {profile?.full_name || 'you'} · {todayChicago()}</p>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className={S.btnCancel}>Cancel</button>
          <button onClick={confirm} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl transition-colors">
            {busy ? 'Saving…' : 'Confirm paid'}
          </button>
        </div>
      </div>
    </div>
  )
}
