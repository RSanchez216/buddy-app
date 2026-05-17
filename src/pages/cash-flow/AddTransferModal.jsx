import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { useToast } from '../../contexts/ToastContext'

// Create / edit / delete a single inter-account transfer.
// Two-date model: debit_date is when money leaves source, credit_date is when
// it arrives at destination. Same-day same-bank transfers leave both equal;
// inter-bank wires set credit_date to the expected settlement date.
//
// Validations:
//   - From != To (DB CHECK enforces; UI blocks pre-save)
//   - amount > 0 (DB CHECK enforces; UI blocks pre-save)
//   - credit_date >= debit_date (DB CHECK enforces; UI blocks pre-save)
//
// Edit mode loads the row, prefills fields, and offers a "Remove this transfer"
// link with a confirm step. Audit log writes on every create/update/delete.

function chicagoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function daysBetween(aISO, bISO) {
  if (!aISO || !bISO) return 0
  const a = new Date(`${aISO}T00:00:00`)
  const b = new Date(`${bISO}T00:00:00`)
  return Math.round((b - a) / 86_400_000)
}

export default function AddTransferModal({
  open,
  transferId = null,
  defaultFromAccountId = '',
  defaultDate = '',
  onClose,
  onSaved,
}) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const [accounts, setAccounts] = useState([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [debitDate, setDebitDate] = useState('')
  const [creditDate, setCreditDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState('')
  // Original row snapshot for audit-log diff on update / delete.
  const [originalRow, setOriginalRow] = useState(null)

  const isEdit = !!transferId

  // Hydrate accounts + (in edit mode) the transfer row.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(''); setConfirmRemove(false)
    ;(async () => {
      setLoading(true)
      const today = chicagoToday()
      // Active accounts for the picker. In edit mode we also need to include
      // any deactivated account the existing row references — fetch separately
      // if needed.
      const accRes = await supabase
        .from('funding_accounts')
        .select('id, name, bank_name, last_four, is_active')
        .order('name')

      let row = null
      if (isEdit) {
        const { data } = await supabase
          .from('funding_account_transfers')
          .select('id, from_funding_account_id, to_funding_account_id, amount, debit_date, credit_date, notes')
          .eq('id', transferId)
          .maybeSingle()
        row = data || null
      }

      if (cancelled) return
      setAccounts(accRes.data || [])
      if (isEdit && row) {
        setOriginalRow(row)
        setFromId(row.from_funding_account_id)
        setToId(row.to_funding_account_id)
        setAmount(String(row.amount))
        setDebitDate(row.debit_date)
        setCreditDate(row.credit_date)
        setNotes(row.notes || '')
      } else {
        setOriginalRow(null)
        setFromId(defaultFromAccountId || '')
        setToId('')
        setAmount('')
        setDebitDate(defaultDate || today)
        setCreditDate(defaultDate || today)
        setNotes('')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transferId])

  // Auto-sync credit_date when user adjusts debit_date upward past credit.
  useEffect(() => {
    if (!debitDate) return
    if (!creditDate || creditDate < debitDate) setCreditDate(debitDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debitDate])

  // Active accounts only for new picks; in edit mode keep the existing
  // selections visible even if the account has since been deactivated.
  const fromOptions = accounts.filter(a => a.is_active || a.id === fromId)
  const toOptions   = accounts.filter(a => (a.is_active || a.id === toId) && a.id !== fromId)

  const numericAmount = Number(amount)
  const validationError = (() => {
    if (!fromId) return 'Pick a From account.'
    if (!toId) return 'Pick a To account.'
    if (fromId === toId) return 'From and To accounts must be different.'
    if (!amount || Number.isNaN(numericAmount)) return 'Amount must be a number.'
    if (numericAmount <= 0) return 'Amount must be greater than zero.'
    if (!debitDate) return 'Pick a debit date.'
    if (!creditDate) return 'Pick a credit date.'
    if (creditDate < debitDate) return 'Credit date must be on or after debit date.'
    return ''
  })()

  const transitDays = daysBetween(debitDate, creditDate)
  const fromAcc = accounts.find(a => a.id === fromId)
  const toAcc   = accounts.find(a => a.id === toId)

  async function writeAuditLog(action, recordId, metadata) {
    await supabase.from('audit_log').insert({
      table_name: 'funding_account_transfers',
      record_id: recordId,
      action,
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata,
    })
  }

  async function save() {
    if (validationError) { setError(validationError); return }
    setSaving(true); setError('')
    const payload = {
      from_funding_account_id: fromId,
      to_funding_account_id: toId,
      amount: numericAmount,
      debit_date: debitDate,
      credit_date: creditDate,
      notes: notes.trim() || null,
    }
    let res
    if (isEdit) {
      res = await supabase
        .from('funding_account_transfers')
        .update(payload)
        .eq('id', transferId)
        .select('id')
        .single()
    } else {
      res = await supabase
        .from('funding_account_transfers')
        .insert({ ...payload, created_by: user?.id || null })
        .select('id')
        .single()
    }
    setSaving(false)
    if (res.error || !res.data) {
      setError(res.error?.message || 'Save failed')
      toast.error(isEdit ? "Couldn't update transfer" : "Couldn't create transfer", res.error)
      return
    }
    toast.success(isEdit ? 'Transfer updated' : `Transfer created — ${fromAcc?.name || '?'} → ${toAcc?.name || '?'}`)

    const metadata = {
      from_funding_account_id: fromId,
      from_funding_account_name: fromAcc?.name || null,
      to_funding_account_id: toId,
      to_funding_account_name: toAcc?.name || null,
      amount: numericAmount,
      debit_date: debitDate,
      credit_date: creditDate,
      notes: payload.notes,
      ...(isEdit && originalRow ? {
        previous_from_funding_account_id: originalRow.from_funding_account_id,
        previous_to_funding_account_id: originalRow.to_funding_account_id,
        previous_amount: Number(originalRow.amount),
        previous_debit_date: originalRow.debit_date,
        previous_credit_date: originalRow.credit_date,
        previous_notes: originalRow.notes,
      } : {}),
    }
    await writeAuditLog(isEdit ? 'transfer_updated' : 'transfer_created', res.data.id, metadata)
    onSaved?.()
    onClose?.()
  }

  async function remove() {
    if (!isEdit || !originalRow) return
    setRemoving(true); setError('')
    const { error: e } = await supabase
      .from('funding_account_transfers')
      .delete()
      .eq('id', transferId)
    setRemoving(false); setConfirmRemove(false)
    if (e) { setError(e.message); toast.error("Couldn't delete transfer", e); return }
    toast.success('Transfer deleted')
    await writeAuditLog('transfer_deleted', transferId, {
      from_funding_account_id: originalRow.from_funding_account_id,
      to_funding_account_id: originalRow.to_funding_account_id,
      amount: Number(originalRow.amount),
      debit_date: originalRow.debit_date,
      credit_date: originalRow.credit_date,
      notes: originalRow.notes,
    })
    onSaved?.()
    onClose?.()
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit transfer' : 'Record transfer'} size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {loading ? (
          <div className="py-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={S.label}>From account *</label>
                <Select value={fromId} onChange={e => setFromId(e.target.value)}>
                  <option value="">— Select —</option>
                  {fromOptions.map(a => (
                    <option key={a.id} value={a.id} disabled={!a.is_active && a.id !== fromId}>
                      {a.name}{!a.is_active && ' (inactive)'}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className={S.label}>To account *</label>
                <Select value={toId} onChange={e => setToId(e.target.value)}>
                  <option value="">— Select —</option>
                  {toOptions.map(a => (
                    <option key={a.id} value={a.id} disabled={!a.is_active && a.id !== toId}>
                      {a.name}{!a.is_active && ' (inactive)'}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <label className={S.label}>Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-slate-500 pointer-events-none">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className={`${S.input} pl-7`}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={S.label}>Debit date *</label>
                <input
                  type="date"
                  className={S.input}
                  value={debitDate}
                  onChange={e => setDebitDate(e.target.value)}
                />
                <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">When money leaves the source.</p>
              </div>
              <div>
                <label className={S.label}>Credit date *</label>
                <input
                  type="date"
                  className={S.input}
                  value={creditDate}
                  min={debitDate || undefined}
                  onChange={e => setCreditDate(e.target.value)}
                />
                <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">
                  Same-day same-bank: leave equal. Inter-bank wire: expected settlement date.
                </p>
              </div>
            </div>

            {transitDays > 0 && (
              <div className="px-3 py-2 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/30 text-[12px] text-cyan-800 dark:text-cyan-300">
                Money will be in transit for {transitDays} day{transitDays === 1 ? '' : 's'} — neither account will reflect the funds during this gap.
              </div>
            )}

            <div>
              <label className={S.label}>Notes</label>
              <textarea
                className={S.textarea}
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional — what this transfer is funding, reference numbers, etc."
              />
            </div>

            <div className={S.modalFooter}>
              <div className="flex-1">
                {isEdit && !confirmRemove && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    disabled={removing}
                    className="text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    Remove this transfer
                  </button>
                )}
                {isEdit && confirmRemove && (
                  <div className="text-[11px] text-gray-700 dark:text-slate-300 flex items-center gap-2 flex-wrap">
                    <span>Remove this transfer? Both legs disappear from the calendar.</span>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="text-gray-500 dark:text-slate-400 hover:underline"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={remove}
                      disabled={removing}
                      className="font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                    >
                      {removing ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                )}
              </div>
              <button onClick={onClose} className={S.btnCancel} disabled={saving || removing}>Cancel</button>
              <button
                onClick={save}
                disabled={saving || removing || !!validationError}
                className={S.btnSave}
                title={validationError || ''}
              >
                {saving ? 'Saving…' : isEdit ? 'Update transfer' : 'Record transfer'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
