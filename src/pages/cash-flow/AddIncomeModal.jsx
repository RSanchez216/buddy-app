import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { CF, fmtMoney, toISO } from './calendarUtils'

const emptyRow = (defaults = {}) => ({
  expected_date: defaults.expected_date || toISO(new Date()),
  source: '',
  amount: '',
  entity_id: defaults.entity_id || '',
  description: '',
})

export default function AddIncomeModal({ open, onClose, onSaved, defaultDate, defaultEntityId }) {
  const { user } = useAuth()
  const [entities, setEntities] = useState([])
  const [rows, setRows] = useState([emptyRow({ expected_date: defaultDate, entity_id: defaultEntityId })])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRows([emptyRow({ expected_date: defaultDate, entity_id: defaultEntityId })])
    setError('')
    supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setEntities(data || []))
  }, [open, defaultDate, defaultEntityId])

  function update(i, field, val) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  function addRow() { setRows(prev => [...prev, emptyRow({ expected_date: defaultDate, entity_id: defaultEntityId })]) }
  function removeRow(i) { setRows(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)) }

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  async function handleSave() {
    const valid = rows.filter(r => r.expected_date && r.source.trim() && Number(r.amount) > 0)
    if (!valid.length) return setError('Add at least one row with date, source, and amount')
    setSaving(true); setError('')
    const payload = valid.map(r => ({
      expected_date: r.expected_date,
      source: r.source.trim(),
      amount: Number(r.amount),
      entity_id: r.entity_id || null,
      description: r.description.trim() || null,
      status: 'pending',
      created_by: user?.id || null,
    }))
    const res = await supabase.from('expected_inflows').insert(payload)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Income" size="xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
              <div className="col-span-2">
                {i === 0 && <label className={S.label}>Date *</label>}
                <input type="date" className={S.input} value={r.expected_date} onChange={e => update(i, 'expected_date', e.target.value)} />
              </div>
              <div className="col-span-3">
                {i === 0 && <label className={S.label}>Source *</label>}
                <input className={S.input} placeholder="e.g. Triumph factoring" value={r.source} onChange={e => update(i, 'source', e.target.value)} />
              </div>
              <div className="col-span-2">
                {i === 0 && <label className={S.label}>Amount ($) *</label>}
                <input type="number" step="0.01" className={S.input} value={r.amount} onChange={e => update(i, 'amount', e.target.value)} />
              </div>
              <div className="col-span-2">
                {i === 0 && <label className={S.label}>Entity</label>}
                <Select value={r.entity_id} onChange={e => update(i, 'entity_id', e.target.value)}>
                  <option value="">—</option>
                  {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                </Select>
              </div>
              <div className="col-span-2">
                {i === 0 && <label className={S.label}>Note</label>}
                <input className={S.input} value={r.description} onChange={e => update(i, 'description', e.target.value)} />
              </div>
              <div className="col-span-1 flex justify-end">
                {rows.length > 1 && (
                  <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500 px-1 py-2" title="Remove">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={addRow}
          className="w-full py-2 text-sm font-medium text-orange-600 dark:text-orange-400 border border-dashed border-orange-300 dark:border-orange-500/30 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-500/5 transition-colors">
          + Add another income line
        </button>

        <div className="flex items-baseline justify-between pt-3 border-t border-gray-100 dark:border-white/5">
          <span className="text-sm text-gray-500 dark:text-slate-400">
            <span className="font-semibold text-gray-700 dark:text-slate-300">Total:</span> {fmtMoney(total)}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={CF.btnSave}>
              {saving ? 'Saving…' : `Save ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
