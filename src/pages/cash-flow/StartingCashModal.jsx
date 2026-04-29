import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import { CF, fmtMoney, startOfWeek, toISO } from './calendarUtils'

export default function StartingCashModal({ open, onClose, onSaved, weekStart }) {
  const { user } = useAuth()
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError(''); setLoaded(false)
    const monday = startOfWeek(weekStart || new Date())
    const iso = toISO(monday)
    setDate(iso)
    fetchExisting(iso)
  }, [open, weekStart])

  async function fetchExisting(iso) {
    const { data } = await supabase
      .from('cash_positions')
      .select('starting_cash, notes')
      .eq('week_start_date', iso)
      .maybeSingle()
    setAmount(data?.starting_cash ?? '')
    setNotes(data?.notes || '')
    setLoaded(true)
  }

  function changeDate(v) {
    if (!v) return
    const monday = startOfWeek(new Date(`${v}T00:00:00`))
    const iso = toISO(monday)
    setDate(iso)
    fetchExisting(iso)
  }

  async function save() {
    if (!date) return setError('Pick a week')
    if (amount === '' || isNaN(Number(amount))) return setError('Enter a starting cash amount')
    setSaving(true); setError('')
    const res = await supabase.from('cash_positions').upsert({
      week_start_date: date,
      starting_cash: Number(amount),
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null,
    }, { onConflict: 'week_start_date' })
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Starting Cash" size="sm">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}
        <div>
          <label className={S.label}>Week (snaps to Monday)</label>
          <input type="date" className={S.input} value={date} onChange={e => changeDate(e.target.value)} />
        </div>
        <div>
          <label className={S.label}>Starting cash for week of {date} ($)</label>
          <input type="number" step="0.01" className={S.input} value={amount} onChange={e => setAmount(e.target.value)} />
          {loaded && amount !== '' && (
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Current saved value: {fmtMoney(amount)}</p>
          )}
        </div>
        <div>
          <label className={S.label}>Notes</label>
          <textarea className={S.textarea} rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={CF.btnSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
