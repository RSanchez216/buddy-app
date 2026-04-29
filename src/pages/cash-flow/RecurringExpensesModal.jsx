import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { CF, EXPENSE_CATEGORIES, FREQUENCIES, WEEKDAYS, fmtMoney, toISO } from './calendarUtils'

const empty = (defaults = {}) => ({
  name: '',
  amount: '',
  category: 'other',
  entity_id: '',
  frequency: 'monthly',
  day_of_week: 1,
  day_of_month: 1,
  second_day_of_month: '',
  start_date: toISO(new Date()),
  end_date: '',
  notes: '',
  is_active: true,
  ...defaults,
})

export default function RecurringExpensesModal({ open, onClose, onSaved }) {
  const [items, setItems] = useState([])
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(null) // template object | 'new' | null
  const [form, setForm] = useState(empty())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setEditing(null); setError('')
    load()
    supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setEntities(data || []))
  }, [open])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('recurring_expense_templates').select('*').order('name')
    setItems(data || [])
    setLoading(false)
  }

  function openNew() { setEditing('new'); setForm(empty()); setError('') }
  function openEdit(it) {
    setEditing(it)
    setForm({
      name: it.name || '',
      amount: it.amount ?? '',
      category: it.category || 'other',
      entity_id: it.entity_id || '',
      frequency: it.frequency || 'monthly',
      day_of_week: it.day_of_week ?? 1,
      day_of_month: it.day_of_month ?? 1,
      second_day_of_month: it.second_day_of_month ?? '',
      start_date: it.start_date || toISO(new Date()),
      end_date: it.end_date || '',
      notes: it.notes || '',
      is_active: !!it.is_active,
    })
    setError('')
  }

  async function regenerate(templateId) {
    // Delete future planned instances tied to this template
    await supabase
      .from('custom_outflows')
      .delete()
      .eq('recurring_template_id', templateId)
      .gte('due_date', toISO(new Date()))
      .eq('status', 'planned')
    const through = new Date(); through.setFullYear(through.getFullYear() + 1)
    await supabase.rpc('generate_recurring_instances', {
      p_template_id: templateId,
      p_through_date: toISO(through),
    })
  }

  async function save() {
    if (!form.name.trim()) return setError('Name is required')
    if (!Number(form.amount)) return setError('Amount is required')
    setSaving(true); setError('')

    const payload = {
      name: form.name.trim(),
      amount: Number(form.amount),
      category: form.category || null,
      entity_id: form.entity_id || null,
      frequency: form.frequency,
      day_of_week: ['weekly', 'biweekly'].includes(form.frequency) ? Number(form.day_of_week) : null,
      day_of_month: ['monthly', 'quarterly', 'annually', 'semimonthly'].includes(form.frequency) ? Number(form.day_of_month) : null,
      second_day_of_month: form.frequency === 'semimonthly' && form.second_day_of_month
        ? Number(form.second_day_of_month) : null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes.trim() || null,
      is_active: !!form.is_active,
      updated_at: new Date().toISOString(),
    }

    let templateId = null
    if (editing === 'new') {
      const res = await supabase.from('recurring_expense_templates').insert(payload).select('id').single()
      if (res.error) { setError(res.error.message); setSaving(false); return }
      templateId = res.data.id
    } else {
      const res = await supabase.from('recurring_expense_templates').update(payload).eq('id', editing.id)
      if (res.error) { setError(res.error.message); setSaving(false); return }
      templateId = editing.id
    }

    if (form.is_active) {
      await regenerate(templateId)
    } else {
      // Cancel future planned instances if template is inactive
      await supabase
        .from('custom_outflows')
        .update({ status: 'cancelled' })
        .eq('recurring_template_id', templateId)
        .gte('due_date', toISO(new Date()))
        .eq('status', 'planned')
    }

    setSaving(false); setEditing(null); load()
    onSaved?.()
  }

  async function toggleActive(it) {
    const next = !it.is_active
    await supabase.from('recurring_expense_templates').update({ is_active: next, updated_at: new Date().toISOString() }).eq('id', it.id)
    if (next) await regenerate(it.id)
    else await supabase
      .from('custom_outflows').update({ status: 'cancelled' })
      .eq('recurring_template_id', it.id).gte('due_date', toISO(new Date())).eq('status', 'planned')
    load(); onSaved?.()
  }

  async function remove(it) {
    if (!confirm(`Delete "${it.name}"?\n\nFuture planned instances will be removed too.`)) return
    await supabase.from('custom_outflows').delete().eq('recurring_template_id', it.id).gte('due_date', toISO(new Date())).eq('status', 'planned')
    const res = await supabase.from('recurring_expense_templates').delete().eq('id', it.id)
    if (res.error) { alert(res.error.message); return }
    load(); onSaved?.()
  }

  function patternLabel(it) {
    if (['weekly', 'biweekly'].includes(it.frequency)) {
      const d = WEEKDAYS.find(x => x.value === it.day_of_week)
      return d?.label || '—'
    }
    if (it.frequency === 'semimonthly') {
      return `Day ${it.day_of_month}${it.second_day_of_month ? ` & ${it.second_day_of_month}` : ''}`
    }
    if (it.day_of_month) return `Day ${it.day_of_month}`
    return '—'
  }

  const showDayOfWeek = ['weekly', 'biweekly'].includes(form.frequency)
  const showDayOfMonth = ['monthly', 'quarterly', 'annually', 'semimonthly'].includes(form.frequency)
  const showSecondDay = form.frequency === 'semimonthly'

  return (
    <Modal open={open} onClose={onClose} title="Recurring Expenses" size="xl">
      <div className={S.modalBody}>
        {!editing ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500 dark:text-slate-400">{items.length} template{items.length !== 1 ? 's' : ''}</p>
              <button onClick={openNew} className={CF.btnPrimary}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                New Recurring Expense
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
            ) : items.length === 0 ? (
              <p className="text-center text-gray-400 dark:text-slate-600 text-sm py-12">No recurring expense templates yet</p>
            ) : (
              <div className={`${S.card} overflow-hidden`}>
                <table className="w-full text-sm">
                  <thead className={S.tableHead}>
                    <tr>
                      <th className={S.th}>Name</th>
                      <th className={S.th}>Amount</th>
                      <th className={S.th}>Frequency</th>
                      <th className={S.th}>Pattern</th>
                      <th className={S.th}>Start</th>
                      <th className={S.th}>End</th>
                      <th className={S.th}>Active</th>
                      <th className={S.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id} className={S.tableRow}>
                        <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.name}</td>
                        <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300`}>{fmtMoney(it.amount)}</td>
                        <td className={`${S.td} text-gray-600 dark:text-slate-400 capitalize`}>{it.frequency}</td>
                        <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{patternLabel(it)}</td>
                        <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{it.start_date || '—'}</td>
                        <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{it.end_date || '—'}</td>
                        <td className={S.td}>
                          <button onClick={() => toggleActive(it)} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            it.is_active
                              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400'
                          }`}>{it.is_active ? 'Active' : 'Inactive'}</button>
                        </td>
                        <td className={`${S.td} text-right whitespace-nowrap`}>
                          <button onClick={() => openEdit(it)} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 mr-3" title="Edit">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={() => remove(it)} className="text-gray-400 hover:text-red-500" title="Delete">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:text-orange-600">‹ Back to list</button>
            </div>
            {error && <div className={S.errorBox}>{error}</div>}

            {editing !== 'new' && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400">
                ⚠ Saving will regenerate future instances: existing planned rows after today are removed and re-created from this template.
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field label="Name *">
                <input className={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Amount ($) *">
                <input type="number" step="0.01" className={S.input} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </Field>
              <Field label="Category">
                <Select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Entity">
                <Select value={form.entity_id} onChange={e => setForm(f => ({ ...f, entity_id: e.target.value }))}>
                  <option value="">—</option>
                  {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                </Select>
              </Field>
              <Field label="Frequency">
                <Select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </Select>
              </Field>
              {showDayOfWeek && (
                <Field label="Day of week">
                  <Select value={form.day_of_week} onChange={e => setForm(f => ({ ...f, day_of_week: e.target.value }))}>
                    {WEEKDAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </Select>
                </Field>
              )}
              {showDayOfMonth && (
                <Field label="Day of month (1-31)">
                  <input type="number" min="1" max="31" className={S.input} value={form.day_of_month} onChange={e => setForm(f => ({ ...f, day_of_month: e.target.value }))} />
                </Field>
              )}
              {showSecondDay && (
                <Field label="Second day (semimonthly)">
                  <input type="number" min="1" max="31" className={S.input} value={form.second_day_of_month} onChange={e => setForm(f => ({ ...f, second_day_of_month: e.target.value }))} />
                </Field>
              )}
              <Field label="Start date *">
                <input type="date" className={S.input} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
              </Field>
              <Field label="End date">
                <input type="date" className={S.input} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
              <span className="text-sm text-gray-600 dark:text-slate-400">Active (generate future instances)</span>
            </label>

            <div className={S.modalFooter}>
              <button onClick={() => setEditing(null)} className={S.btnCancel}>Cancel</button>
              <button onClick={save} disabled={saving} className={CF.btnSave}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create Template' : 'Update Template'}
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
