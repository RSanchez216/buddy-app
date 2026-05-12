import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'

// Detail / classification modal for a single reconciliation adjustment.
// Opened from the calendar chip click router OR from the Bank Accounts
// "needs review" pill popover OR from the post-save toast on the Record
// Balance modal.
//
// The adjustment row carries the raw signed amount. We reconstruct
// "projected vs actual" without a second round-trip:
//   actual_recorded  = source_entry.balance
//   projected_prior  = source_entry.balance - adjustment.amount
// (since trigger writes: amount = entry.balance - projected_prior)

const CLASSIFICATIONS = [
  { value: 'bank_fee',           label: 'Bank fee' },
  { value: 'untracked_transfer', label: 'Untracked transfer' },
  { value: 'untracked_deposit',  label: 'Untracked deposit' },
  { value: 'refund',             label: 'Refund' },
  { value: 'unauthorized_charge',label: 'Unauthorized charge' },
  { value: 'unidentified',       label: 'Unidentified — leave open' },
  { value: 'other',              label: 'Other (use notes)' },
]

function fmtMoney(n) {
  const num = Number(n || 0)
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function AdjustmentDetailsModal({ open, adjustmentId, onClose, onSaved }) {
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [row, setRow] = useState(null) // full adjustment + joined entry + account
  const [classification, setClassification] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !adjustmentId) return
    let cancelled = false
    setLoading(true); setError(''); setConfirmRemove(false)
    ;(async () => {
      const { data, error: e } = await supabase
        .from('funding_account_adjustments')
        .select(`
          id, funding_account_id, adjustment_date, amount,
          classification, notes, source_balance_entry_id,
          classified_by, classified_at,
          funding_account:funding_accounts ( id, name, bank_name, last_four ),
          source_entry:funding_account_balance_entries!source_balance_entry_id (
            id, as_of_date, balance, entered_at
          )
        `)
        .eq('id', adjustmentId)
        .maybeSingle()
      if (cancelled) return
      setLoading(false)
      if (e) { setError(e.message); return }
      setRow(data || null)
      setClassification(data?.classification || '')
      setNotes(data?.notes || '')
    })()
    return () => { cancelled = true }
  }, [open, adjustmentId])

  async function writeAuditLog(action, metadata) {
    if (!row) return
    await supabase.from('audit_log').insert({
      table_name: 'funding_account_adjustments',
      record_id: row.id,
      action,
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        funding_account_id: row.funding_account_id,
        funding_account_name: row.funding_account?.name,
        adjustment_date: row.adjustment_date,
        amount: row.amount,
        ...metadata,
      },
    })
  }

  async function saveClassification() {
    if (!row) return
    setSaving(true); setError('')
    const cls = classification || null
    const payload = {
      classification: cls,
      notes: notes.trim() || null,
      classified_by: cls ? (user?.id || null) : null,
      classified_at: cls ? new Date().toISOString() : null,
    }
    const { error: e } = await supabase
      .from('funding_account_adjustments')
      .update(payload)
      .eq('id', row.id)
    setSaving(false)
    if (e) { setError(e.message); return }
    await writeAuditLog('adjustment_classified', {
      previous_classification: row.classification,
      new_classification: cls,
    })
    onSaved?.()
    onClose?.()
  }

  async function remove() {
    if (!row) return
    setRemoving(true); setError('')
    const { error: e } = await supabase
      .from('funding_account_adjustments')
      .delete()
      .eq('id', row.id)
    setRemoving(false); setConfirmRemove(false)
    if (e) { setError(e.message); return }
    await writeAuditLog('adjustment_removed', {
      previous_classification: row.classification,
    })
    onSaved?.()
    onClose?.()
  }

  if (!open) return null

  const account = row?.funding_account
  const sourceEntry = row?.source_entry
  const amount = Number(row?.amount || 0)
  const signed = amount >= 0
  const actualRecorded = Number(sourceEntry?.balance || 0)
  const projectedPrior = sourceEntry ? actualRecorded - amount : null
  const isUnclassified = !row?.classification

  return (
    <Modal open={open} onClose={onClose} title="Reconciliation adjustment" size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {loading ? (
          <div className="py-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
          </div>
        ) : !row ? (
          <div className="text-sm text-gray-500 dark:text-slate-500 italic">
            Adjustment not found. It may have been removed.
          </div>
        ) : (
          <>
            {/* Header strip — yellow if unclassified, neutral if classified */}
            <div className={`p-3 rounded-xl border ${
              isUnclassified
                ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
                : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    {isUnclassified ? '⚑ Needs review' : '✓ Classified'}
                  </div>
                  <div className="mt-0.5 text-sm font-medium text-gray-900 dark:text-slate-200 truncate">
                    {account?.name || '—'}
                    {account?.bank_name && <span className="text-gray-400 dark:text-slate-500"> · {account.bank_name}</span>}
                    {account?.last_four && <span className="text-gray-400 dark:text-slate-500 font-mono ml-1">···{account.last_four}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-lg font-mono font-bold ${signed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                    {signed ? '+' : '−'}{fmtMoney(amount)}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-500">
                    on {fmtDate(row.adjustment_date)}
                  </div>
                </div>
              </div>
            </div>

            {/* Projected vs actual */}
            {sourceEntry && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={S.label}>Projected (prior EOD)</label>
                  <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 text-sm font-mono text-gray-700 dark:text-slate-300">
                    {fmtMoney(projectedPrior)}
                  </div>
                </div>
                <div>
                  <label className={S.label}>Recorded ({fmtDate(sourceEntry.as_of_date)})</label>
                  <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5 text-sm font-mono text-gray-700 dark:text-slate-300">
                    {fmtMoney(actualRecorded)}
                  </div>
                </div>
              </div>
            )}

            {/* Classification */}
            <div>
              <label className={S.label}>What caused the variance?</label>
              <select
                className={S.input}
                value={classification}
                onChange={e => setClassification(e.target.value)}
              >
                <option value="">— Not yet classified —</option>
                {CLASSIFICATIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1.5">
                The adjustment stays on the calendar after classification — it just stops asking for review.
              </p>
            </div>

            {/* Notes */}
            <div>
              <label className={S.label}>Notes</label>
              <textarea
                className={S.textarea}
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional — what reconciled this, transaction reference, etc."
              />
            </div>

            <div className={S.modalFooter}>
              <div className="flex-1">
                {!confirmRemove && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    disabled={removing}
                    className="text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    Remove this adjustment
                  </button>
                )}
                {confirmRemove && (
                  <div className="text-[11px] text-gray-700 dark:text-slate-300 flex items-center gap-2 flex-wrap">
                    <span>Remove? Re-recording the source balance will recreate it.</span>
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
              <button onClick={onClose} className={S.btnCancel} disabled={saving || removing}>Close</button>
              <button
                onClick={saveClassification}
                disabled={saving || removing}
                className={S.btnSave}
              >
                {saving ? 'Saving…' : (classification ? 'Save classification' : 'Save')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
