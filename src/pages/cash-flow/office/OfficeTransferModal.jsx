import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { todayISO, rate2, usd2 } from './officeData'

// Record a USD→local transfer that funds an office. The exchange rate is
// DERIVED (amount_local / amount_usd) and stored server-side as a GENERATED
// column — we never write fx_rate. This transfer becomes the rate source for
// office expenses on/after its received date.

export default function OfficeTransferModal({ open, office, onClose, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const [accounts, setAccounts] = useState([])
  const [fromId, setFromId] = useState('')
  const [amountUsd, setAmountUsd] = useState('')
  const [amountLocal, setAmountLocal] = useState('')
  const [sentDate, setSentDate] = useState('')
  const [receivedDate, setReceivedDate] = useState('')
  const [method, setMethod] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ccy = office?.currency_code || ''

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const t = todayISO()
      setError(''); setFromId(''); setAmountUsd(''); setAmountLocal('')
      setMethod(''); setNotes(''); setSentDate(t); setReceivedDate(t)
      const { data } = await supabase.from('funding_accounts')
        .select('id, name, bank_name, last_four, is_active').order('name')
      if (cancelled) return
      setAccounts((data || []).filter(a => a.is_active))
    })()
    return () => { cancelled = true }
  }, [open])

  // Live derived rate — local per 1 USD. Purely a preview; the DB computes the
  // stored value identically from the two amounts.
  const derivedRate = useMemo(() => {
    const u = Number(amountUsd), l = Number(amountLocal)
    if (!u || !l || u <= 0 || l <= 0) return null
    return l / u
  }, [amountUsd, amountLocal])

  async function save() {
    const u = Number(amountUsd), l = Number(amountLocal)
    if (!fromId) return setError('Choose the funding account the money left from')
    if (!u || u <= 0) return setError('USD amount must be greater than 0')
    if (!l || l <= 0) return setError(`${ccy} amount must be greater than 0`)
    if (!sentDate) return setError('Sent date is required')
    if (!receivedDate) return setError('Received date is required')
    if (receivedDate < sentDate) return setError('Received date cannot be before the sent date')

    setSaving(true); setError('')
    // NOTE: fx_rate is GENERATED — never included in the payload.
    const { error: e } = await supabase.from('office_transfers').insert({
      office_id: office.id,
      from_funding_account_id: fromId,
      amount_usd: u,
      amount_local: l,
      sent_date: sentDate,
      received_date: receivedDate,
      method: method.trim() || null,
      notes: notes.trim() || null,
      created_by: user?.id || null,
    })
    if (e) { setError(e.message || 'Save failed'); toast.error("Couldn't record transfer", e); setSaving(false); return }
    toast.success(`Transfer recorded — ${usd2(u)} → ${office.name}`)
    setSaving(false)
    onSaved?.()
    onClose?.()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Record transfer — ${office?.name || ''}`} size="md">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div>
          <label className={S.label}>From funding account *</label>
          <select className={S.input} value={fromId} onChange={e => setFromId(e.target.value)}>
            <option value="">— Select account —</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}{a.last_four ? ` ••${a.last_four}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={S.label}>Amount sent (USD) *</label>
            <input type="number" step="0.01" min="0" className={S.input}
              value={amountUsd} onChange={e => setAmountUsd(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className={S.label}>Amount received ({ccy}) *</label>
            <input type="number" step="0.01" min="0" className={S.input}
              value={amountLocal} onChange={e => setAmountLocal(e.target.value)} placeholder="0" />
          </div>
        </div>

        {/* Derived-rate strip */}
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-cyan-50 dark:bg-cyan-500/5 border border-cyan-200 dark:border-cyan-500/20">
          <span className="text-xs font-medium text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">Derived rate</span>
          <span className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">
            {derivedRate ? `1 USD = ${rate2(derivedRate)} ${ccy}` : `— ${ccy} / USD`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={S.label}>Sent date *</label>
            <input type="date" className={S.input} value={sentDate} onChange={e => setSentDate(e.target.value)} />
          </div>
          <div>
            <label className={S.label}>Received date *</label>
            <input type="date" className={S.input} value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={S.label}>Method</label>
            <input className={S.input} value={method} onChange={e => setMethod(e.target.value)} placeholder="e.g. wire, Western Union" />
          </div>
          <div>
            <label className={S.label}>Notes</label>
            <input className={S.input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>
            {saving ? 'Saving…' : 'Record transfer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
