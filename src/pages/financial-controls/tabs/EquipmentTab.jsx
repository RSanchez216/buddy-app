import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { FC, EQUIPMENT_STATUSES, STATUS_LABELS, equipmentStatusPill, fmtMoney, fmtDate } from '../loanUtils'

const empty = {
  unit_number: '', vin: '', equipment_type: '', make: '', model: '', year: '',
  purchase_date: '', purchase_price: '', has_title: false, current_status: 'active', notes: '',
}

export default function EquipmentTab({ loanId, canEdit }) {
  const [rows, setRows] = useState([])
  const [equipmentTypes, setEquipmentTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() /* eslint-disable-line */ }, [loanId])

  async function load() {
    setLoading(true)
    const [eqRes, typeRes] = await Promise.all([
      supabase.from('loan_equipment').select('*').eq('loan_id', loanId).order('unit_number', { ascending: true }),
      supabase.from('equipment_types').select('id, name, display_label, sort_order').eq('is_active', true).order('sort_order').order('display_label'),
    ])
    setRows(eqRes.data || [])
    setEquipmentTypes(typeRes.data || [])
    setLoading(false)
  }

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(r) {
    setEditItem(r)
    setForm({
      unit_number: r.unit_number || '', vin: r.vin || '', equipment_type: r.equipment_type || '',
      make: r.make || '', model: r.model || '', year: r.year ?? '',
      purchase_date: r.purchase_date || '', purchase_price: r.purchase_price ?? '',
      has_title: !!r.has_title, current_status: r.current_status || 'active', notes: r.notes || '',
    })
    setError(''); setShowModal(true)
  }

  async function handleSave() {
    setSaving(true); setError('')
    const payload = {
      loan_id: loanId,
      unit_number: form.unit_number.trim() || null,
      vin: form.vin.trim() || null,
      equipment_type: form.equipment_type.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      year: form.year === '' ? null : Number(form.year),
      purchase_date: form.purchase_date || null,
      purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
      has_title: !!form.has_title,
      current_status: form.current_status,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const res = editItem
      ? await supabase.from('loan_equipment').update(payload).eq('id', editItem.id)
      : await supabase.from('loan_equipment').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); load() }
    setSaving(false)
  }

  async function quickStatusChange(row, status) {
    if (!canEdit) return
    await supabase.from('loan_equipment').update({ current_status: status, updated_at: new Date().toISOString() }).eq('id', row.id)
    load()
  }

  async function handleDelete(row) {
    if (!confirm(`Delete equipment ${row.unit_number || row.vin || ''}?`)) return
    await supabase.from('loan_equipment').delete().eq('id', row.id)
    load()
  }

  const summary = useMemo(() => {
    if (!rows.length) return ''
    const counts = {}
    rows.forEach(r => { if (r.equipment_type) counts[r.equipment_type] = (counts[r.equipment_type] || 0) + 1 })
    const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}${n !== 1 ? 's' : ''}`)
    return `${rows.length} equipment${rows.length !== 1 ? '' : ''} (${parts.join(', ')})`
  }, [rows])

  if (loading) return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-slate-500">{summary || 'No equipment yet'}</p>
        {canEdit && (
          <button onClick={openAdd} className={FC.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Equipment
          </button>
        )}
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Unit#', 'VIN', 'Type', 'Make', 'Model', 'Year', 'Purchase Date', 'Purchase Price', 'Title', 'Status', 'Notes', canEdit && ''].filter(h => h !== false).map((h, i) => (
                  <th key={i} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No equipment</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{r.unit_number || '—'}</td>
                  <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>{r.vin || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.equipment_type || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.make || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.model || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.year || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(r.purchase_date)}</td>
                  <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(r.purchase_price)}</td>
                  <td className={`${S.td}`}>{r.has_title ? <span className="text-emerald-600">✓</span> : <span className="text-gray-300 dark:text-slate-600">—</span>}</td>
                  <td className={S.td}>
                    {canEdit ? (
                      <select
                        value={r.current_status}
                        onChange={e => quickStatusChange(r, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-lg border-0 focus:ring-2 focus:ring-orange-500/40 outline-none cursor-pointer ${equipmentStatusPill(r.current_status)}`}
                      >
                        {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${equipmentStatusPill(r.current_status)}`}>
                        {STATUS_LABELS[r.current_status] || r.current_status}
                      </span>
                    )}
                  </td>
                  <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400 max-w-[180px] truncate`} title={r.notes || ''}>{r.notes || '—'}</td>
                  {canEdit && (
                    <td className={`${S.td} text-right whitespace-nowrap`}>
                      <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 mr-3" title="Edit">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => handleDelete(r)} className="text-gray-400 hover:text-red-500" title="Delete">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Equipment' : 'Add Equipment'} size="lg">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit Number">
              <input className={S.input} value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value }))} />
            </Field>
            <Field label="VIN">
              <input className={S.input} value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value }))} />
            </Field>
            <Field label="Type">
              <Select value={form.equipment_type} onChange={e => setForm(f => ({ ...f, equipment_type: e.target.value }))}>
                <option value="">Select…</option>
                {equipmentTypes.map(t => <option key={t.id} value={t.name}>{t.display_label || t.name}</option>)}
                {/* Preserve legacy/free-text value if it's not in the active list */}
                {form.equipment_type && !equipmentTypes.some(t => t.name === form.equipment_type) && (
                  <option value={form.equipment_type}>{form.equipment_type} (legacy)</option>
                )}
              </Select>
            </Field>
            <Field label="Year">
              <input className={S.input} type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
            </Field>
            <Field label="Make">
              <input className={S.input} value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} />
            </Field>
            <Field label="Model">
              <input className={S.input} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </Field>
            <Field label="Purchase Date">
              <input className={S.input} type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
            </Field>
            <Field label="Purchase Price ($)">
              <input className={S.input} type="number" step="0.01" value={form.purchase_price} onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} />
            </Field>
            <Field label="Status">
              <Select value={form.current_status} onChange={e => setForm(f => ({ ...f, current_status: e.target.value }))}>
                {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </Select>
            </Field>
            <Field label="Has Title">
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.has_title} onChange={e => setForm(f => ({ ...f, has_title: e.target.checked }))} className="rounded" />
                <span className="text-sm text-gray-600 dark:text-slate-400">Title on file</span>
              </label>
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={FC.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
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
