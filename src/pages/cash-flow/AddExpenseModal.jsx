import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { CF, EXPENSE_CATEGORIES, FREQUENCIES, WEEKDAYS, fmtMoney, toISO } from './calendarUtils'

const emptyOneTime = (defaults = {}) => ({
  due_date: defaults.due_date || toISO(new Date()),
  description: '',
  amount: '',
  category: 'other',
  entity_id: defaults.entity_id || '',
})

const emptyRecurring = (defaults = {}) => ({
  name: '',
  amount: '',
  category: 'other',
  entity_id: defaults.entity_id || '',
  frequency: 'monthly',
  day_of_week: 1,
  day_of_month: 1,
  second_day_of_month: '',
  start_date: defaults.due_date || toISO(new Date()),
  end_date: '',
  notes: '',
})

export default function AddExpenseModal({ open, onClose, onSaved, defaultDate, defaultEntityId }) {
  const { user } = useAuth()
  const [mode, setMode] = useState('one-time') // 'one-time' | 'recurring'
  const [entities, setEntities] = useState([])
  const [oneTimeRows, setOneTimeRows] = useState([emptyOneTime({ due_date: defaultDate, entity_id: defaultEntityId })])
  const [recurring, setRecurring] = useState(emptyRecurring({ due_date: defaultDate, entity_id: defaultEntityId }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setMode('one-time')
    setOneTimeRows([emptyOneTime({ due_date: defaultDate, entity_id: defaultEntityId })])
    setRecurring(emptyRecurring({ due_date: defaultDate, entity_id: defaultEntityId }))
    setError('')
    supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setEntities(data || []))
  }, [open, defaultDate, defaultEntityId])

  function updateRow(i, field, val) {
    setOneTimeRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }
  function addRow() { setOneTimeRows(prev => [...prev, emptyOneTime({ due_date: defaultDate, entity_id: defaultEntityId })]) }
  function removeRow(i) { setOneTimeRows(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)) }

  const total = oneTimeRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  async function saveOneTime() {
    const valid = oneTimeRows.filter(r => r.due_date && r.description.trim() && Number(r.amount) > 0)
    if (!valid.length) return setError('Add at least one row with date, description, and amount')
    setSaving(true); setError('')
    const payload = valid.map(r => ({
      due_date: r.due_date,
      description: r.description.trim(),
      amount: Number(r.amount),
      category: r.category || null,
      entity_id: r.entity_id || null,
      status: 'planned',
      created_by: user?.id || null,
    }))
    const res = await supabase.from('custom_outflows').insert(payload)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    onSaved?.()
    onClose()
  }

  async function saveRecurring() {
    if (!recurring.name.trim()) return setError('Name is required')
    if (!Number(recurring.amount)) return setError('Amount is required')
    if (!recurring.start_date) return setError('Start date is required')

    setSaving(true); setError('')
    const payload = {
      name: recurring.name.trim(),
      amount: Number(recurring.amount),
      category: recurring.category || null,
      entity_id: recurring.entity_id || null,
      frequency: recurring.frequency,
      day_of_week: ['weekly', 'biweekly'].includes(recurring.frequency) ? Number(recurring.day_of_week) : null,
      day_of_month: ['monthly', 'quarterly', 'annually', 'semimonthly'].includes(recurring.frequency) ? Number(recurring.day_of_month) : null,
      second_day_of_month: recurring.frequency === 'semimonthly' && recurring.second_day_of_month
        ? Number(recurring.second_day_of_month) : null,
      start_date: recurring.start_date,
      end_date: recurring.end_date || null,
      notes: recurring.notes.trim() || null,
      is_active: true,
      created_by: user?.id || null,
    }

    const tplRes = await supabase.from('recurring_expense_templates').insert(payload).select('id').single()
    if (tplRes.error) { setError(tplRes.error.message); setSaving(false); return }

    // Materialize 12 months of instances
    const through = new Date(); through.setFullYear(through.getFullYear() + 1)
    const genRes = await supabase.rpc('generate_recurring_instances', {
      p_template_id: tplRes.data.id,
      p_through_date: toISO(through),
    })
    if (genRes.error) {
      setError('Template saved, but instance generation failed: ' + genRes.error.message)
      setSaving(false); return
    }
    setSaving(false)
    onSaved?.()
    onClose()
  }

  const showDayOfWeek = ['weekly', 'biweekly'].includes(recurring.frequency)
  const showDayOfMonth = ['monthly', 'quarterly', 'annually', 'semimonthly'].includes(recurring.frequency)
  const showSecondDay = recurring.frequency === 'semimonthly'

  return (
    <Modal open={open} onClose={onClose} title="Add Expense" size="xl">
      <div className={S.modalBody}>
        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-xl w-fit">
          <button onClick={() => setMode('one-time')}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
              mode === 'one-time' ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm' : 'text-gray-500 dark:text-slate-400'
            }`}>One-time</button>
          <button onClick={() => setMode('recurring')}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${
              mode === 'recurring' ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm' : 'text-gray-500 dark:text-slate-400'
            }`}>Recurring</button>
        </div>

        {error && <div className={S.errorBox}>{error}</div>}

        {mode === 'one-time' ? (
          <>
            <div className="space-y-2">
              {oneTimeRows.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 rounded-xl bg-gray-50 dark:bg-white/[0.02]">
                  <div className="col-span-2">
                    {i === 0 && <label className={S.label}>Date *</label>}
                    <input type="date" className={S.input} value={r.due_date} onChange={e => updateRow(i, 'due_date', e.target.value)} />
                  </div>
                  <div className="col-span-3">
                    {i === 0 && <label className={S.label}>Description *</label>}
                    <input className={S.input} placeholder="e.g. Payroll" value={r.description} onChange={e => updateRow(i, 'description', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <label className={S.label}>Amount ($) *</label>}
                    <input type="number" step="0.01" className={S.input} value={r.amount} onChange={e => updateRow(i, 'amount', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <label className={S.label}>Category</label>}
                    <Select value={r.category} onChange={e => updateRow(i, 'category', e.target.value)}>
                      {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <label className={S.label}>Entity</label>}
                    <Select value={r.entity_id} onChange={e => updateRow(i, 'entity_id', e.target.value)}>
                      <option value="">—</option>
                      {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                    </Select>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {oneTimeRows.length > 1 && (
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
              + Add another expense line
            </button>

            <div className="flex items-baseline justify-between pt-3 border-t border-gray-100 dark:border-white/5">
              <span className="text-sm text-gray-500 dark:text-slate-400">
                <span className="font-semibold text-gray-700 dark:text-slate-300">Total:</span> {fmtMoney(total)}
              </span>
              <div className="flex gap-2">
                <button onClick={onClose} className={S.btnCancel}>Cancel</button>
                <button onClick={saveOneTime} disabled={saving} className={CF.btnSave}>
                  {saving ? 'Saving…' : `Save ${oneTimeRows.length} ${oneTimeRows.length === 1 ? 'entry' : 'entries'}`}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name *">
                <input className={S.input} value={recurring.name} onChange={e => setRecurring(r => ({ ...r, name: e.target.value }))} placeholder="e.g. Weekly Payroll" />
              </Field>
              <Field label="Amount ($) *">
                <input type="number" step="0.01" className={S.input} value={recurring.amount} onChange={e => setRecurring(r => ({ ...r, amount: e.target.value }))} />
              </Field>
              <Field label="Category">
                <Select value={recurring.category} onChange={e => setRecurring(r => ({ ...r, category: e.target.value }))}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Entity">
                <Select value={recurring.entity_id} onChange={e => setRecurring(r => ({ ...r, entity_id: e.target.value }))}>
                  <option value="">—</option>
                  {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                </Select>
              </Field>
              <Field label="Frequency">
                <Select value={recurring.frequency} onChange={e => setRecurring(r => ({ ...r, frequency: e.target.value }))}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </Select>
              </Field>
              {showDayOfWeek && (
                <Field label="Day of week">
                  <Select value={recurring.day_of_week} onChange={e => setRecurring(r => ({ ...r, day_of_week: e.target.value }))}>
                    {WEEKDAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </Select>
                </Field>
              )}
              {showDayOfMonth && (
                <Field label="Day of month (1-31)">
                  <input type="number" min="1" max="31" className={S.input} value={recurring.day_of_month} onChange={e => setRecurring(r => ({ ...r, day_of_month: e.target.value }))} />
                </Field>
              )}
              {showSecondDay && (
                <Field label="Second day of month (semimonthly)">
                  <input type="number" min="1" max="31" className={S.input} value={recurring.second_day_of_month} onChange={e => setRecurring(r => ({ ...r, second_day_of_month: e.target.value }))} placeholder="e.g. 15" />
                </Field>
              )}
              <Field label="Start date *">
                <input type="date" className={S.input} value={recurring.start_date} onChange={e => setRecurring(r => ({ ...r, start_date: e.target.value }))} />
              </Field>
              <Field label="End date (optional)">
                <input type="date" className={S.input} value={recurring.end_date} onChange={e => setRecurring(r => ({ ...r, end_date: e.target.value }))} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={S.textarea} rows={2} value={recurring.notes} onChange={e => setRecurring(r => ({ ...r, notes: e.target.value }))} />
            </Field>

            <div className="rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 p-3 text-xs text-orange-700 dark:text-orange-400">
              We'll generate 12 months of instances now. You can edit or delete the template later in Recurring Expenses.
            </div>

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel}>Cancel</button>
              <button onClick={saveRecurring} disabled={saving} className={CF.btnSave}>
                {saving ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
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
