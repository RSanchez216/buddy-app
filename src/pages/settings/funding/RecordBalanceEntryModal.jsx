import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { useToast } from '../../../contexts/ToastContext'

// Record (create or update) a balance entry on funding_account_balance_entries.
// Single modal handles both cases via the (funding_account_id, as_of_date)
// UNIQUE constraint — on save, ON CONFLICT swaps to UPDATE semantics.
//
// Date default: today in America/Chicago. Don't use `new Date().toISOString()
// .slice(0, 10)` for the default — at 7pm Chicago UTC has already rolled to
// tomorrow. Intl.DateTimeFormat with the explicit timeZone is the safe path.
function chicagoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export default function RecordBalanceEntryModal({ open, account, onClose, onSaved }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(chicagoToday())
  const [balance, setBalance] = useState('')
  const [notes, setNotes] = useState('')
  const [existingEntry, setExistingEntry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState('')

  // Reset state on each open and re-query the existing entry at the
  // default (account, today) tuple.
  useEffect(() => {
    if (!open || !account) return
    const today = chicagoToday()
    setDate(today)
    setBalance('')
    setNotes('')
    setExistingEntry(null)
    setConfirmRemove(false)
    setError('')
    fetchEntry(account.id, today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id])

  // Date change → re-query. Selecting a date with an existing entry
  // hydrates the form; selecting an empty date clears it (don't carry
  // over the previous date's balance — that would be auto-suggestion).
  useEffect(() => {
    if (!open || !account || !date) return
    fetchEntry(account.id, date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  async function fetchEntry(accountId, asOfDate) {
    setLoading(true)
    const { data } = await supabase
      .from('funding_account_balance_entries')
      .select('id, balance, notes, entered_at, source')
      .eq('funding_account_id', accountId)
      .eq('as_of_date', asOfDate)
      .maybeSingle()
    setLoading(false)
    if (data) {
      setExistingEntry(data)
      setBalance(String(data.balance ?? ''))
      setNotes(data.notes || '')
    } else {
      setExistingEntry(null)
      setBalance('')
      setNotes('')
    }
  }

  async function writeAuditLog(action, metadata) {
    await supabase.from('audit_log').insert({
      table_name: 'funding_account_balance_entries',
      record_id: metadata.record_id,
      action,
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        funding_account_id: account.id,
        funding_account_name: account.name,
        as_of_date: metadata.as_of_date,
        balance: metadata.balance,
        ...(metadata.previous_balance !== undefined ? { previous_balance: metadata.previous_balance } : {}),
      },
    })
  }

  async function save() {
    if (!account) return
    if (!date) { setError('Pick an as-of date.'); return }
    const numericBalance = Number(balance)
    if (balance === '' || Number.isNaN(numericBalance)) {
      setError('Balance must be a number.')
      return
    }
    setSaving(true); setError('')
    const payload = {
      funding_account_id: account.id,
      as_of_date: date,
      balance: numericBalance,
      source: 'manual',
      entered_by: user?.id || null,
      entered_at: new Date().toISOString(),
      notes: notes.trim() || null,
    }
    // Upsert by the (funding_account_id, as_of_date) unique constraint.
    // The audit-log row needs the resulting id, so we round-trip with
    // .select() — and capture previous_balance for the update case.
    const previousBalance = existingEntry ? Number(existingEntry.balance) : null
    const { data, error: e } = await supabase
      .from('funding_account_balance_entries')
      .upsert(payload, { onConflict: 'funding_account_id,as_of_date' })
      .select('id')
      .single()
    setSaving(false)
    if (e || !data) {
      setError(e?.message || 'Save failed')
      toast.error("Couldn't record balance", e)
      return
    }
    toast.success(`Balance recorded — ${account.name}`)
    await writeAuditLog(
      existingEntry ? 'balance_entry_updated' : 'balance_entry_created',
      {
        record_id: data.id,
        as_of_date: date,
        balance: numericBalance,
        ...(existingEntry ? { previous_balance: previousBalance } : {}),
      },
    )
    // The trigger on funding_account_balance_entries may have just created
    // (or removed) a variance adjustment. Look up the result so the parent
    // can decide whether to show a "matched projection" or "variance →
    // review" toast. Returning the entry id lets the parent open the
    // AdjustmentDetailsModal directly if the user clicks the toast.
    let adjustment = null
    {
      const { data: adj } = await supabase
        .from('funding_account_adjustments')
        .select('id, amount, adjustment_date, classification')
        .eq('source_balance_entry_id', data.id)
        .maybeSingle()
      adjustment = adj || null
    }
    onSaved?.({ entryId: data.id, asOfDate: date, adjustment })
    onClose?.()
  }

  async function remove() {
    if (!existingEntry) return
    setRemoving(true); setError('')
    const previousBalance = Number(existingEntry.balance)
    const { error: e } = await supabase
      .from('funding_account_balance_entries')
      .delete()
      .eq('id', existingEntry.id)
    setRemoving(false); setConfirmRemove(false)
    if (e) { setError(e.message); toast.error("Couldn't remove balance entry", e); return }
    toast.success(`Balance entry removed — ${account.name}`)
    await writeAuditLog('balance_entry_deleted', {
      record_id: existingEntry.id,
      as_of_date: date,
      balance: previousBalance,
    })
    onSaved?.()
    onClose?.()
  }

  if (!account) return null

  const isUpdate = !!existingEntry
  const buttonLabel = saving
    ? 'Saving…'
    : isUpdate ? 'Update entry' : 'Save entry'

  return (
    <Modal open={open} onClose={onClose} title="Record balance" size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div>
          <label className={S.label}>Account</label>
          <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 text-sm text-gray-700 dark:text-slate-300">
            {account.name}
            {account.bank_name && <span className="text-gray-400 dark:text-slate-500"> · {account.bank_name}</span>}
            {account.last_four && <span className="text-gray-400 dark:text-slate-500 font-mono ml-1">···{account.last_four}</span>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={S.label}>As of date *</label>
            <input
              type="date"
              className={S.input}
              value={date}
              max={chicagoToday()}
              onChange={e => setDate(e.target.value)}
            />
            {loading && (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Checking for existing entry…</p>
            )}
            {!loading && isUpdate && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                Existing entry for this date — saving will update it.
              </p>
            )}
          </div>
          <div>
            <label className={S.label}>Balance ($) *</label>
            <input
              type="number"
              step="0.01"
              className={S.input}
              value={balance}
              onChange={e => setBalance(e.target.value)}
              placeholder="0.00"
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
            placeholder="Optional — what reconciled this balance, etc."
          />
        </div>

        <p className="text-[11px] text-gray-500 dark:text-slate-500">
          The Payment Calendar projects forward from the most recent entry. Recording today's actual bank balance sets the new anchor for everything after.
        </p>

        <div className={S.modalFooter}>
          <div className="flex-1">
            {isUpdate && !confirmRemove && (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                disabled={removing}
                className="text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                Remove this entry
              </button>
            )}
            {isUpdate && confirmRemove && (
              <div className="text-[11px] text-gray-700 dark:text-slate-300 flex items-center gap-2">
                <span>Remove the recorded balance for {date}? Calendar projections will fall back to the next-earliest entry.</span>
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
            disabled={saving || removing || !date || balance === ''}
            className={S.btnSave}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
