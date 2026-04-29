import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'

const empty = { display_label: '', name: '', sort_order: 100, is_active: true }

export default function SettingsEquipmentTypes() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('equipment_types').select('*').order('sort_order').order('display_label')
    setItems(data || []); setLoading(false)
  }

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(it) {
    setEditItem(it)
    setForm({
      display_label: it.display_label || '',
      name: it.name || '',
      sort_order: it.sort_order ?? 100,
      is_active: !!it.is_active,
    })
    setError(''); setShowModal(true)
  }

  async function save() {
    if (!form.display_label.trim()) return setError('Display label is required')
    if (!form.name.trim()) return setError('Internal name is required')
    setSaving(true); setError('')
    const payload = {
      display_label: form.display_label.trim(),
      name: form.name.trim().toLowerCase(),
      sort_order: Number(form.sort_order) || 100,
      is_active: !!form.is_active,
    }
    const res = editItem
      ? await supabase.from('equipment_types').update(payload).eq('id', editItem.id)
      : await supabase.from('equipment_types').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); load() }
    setSaving(false)
  }

  async function toggleActive(it) {
    await supabase.from('equipment_types').update({ is_active: !it.is_active }).eq('id', it.id)
    load()
  }

  async function remove(it) {
    if (!confirm(`Delete "${it.display_label || it.name}"?\n\nLoans currently using this type will keep the text value, but it will no longer appear in dropdowns.`)) return
    const { error: e } = await supabase.from('equipment_types').delete().eq('id', it.id)
    if (e) alert(e.message)
    else load()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Equipment Types</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Reference list used in Debt Schedule equipment dropdowns</p>
        </div>
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Type
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Display Label</th>
              <th className={S.th}>Internal Name</th>
              <th className={S.th}>Sort Order</th>
              <th className={S.th}>Status</th>
              <th className={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No equipment types yet</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className={S.tableRow}>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.display_label || '—'}</td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>{it.name}</td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{it.sort_order}</td>
                <td className={S.td}>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                    it.is_active
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                      : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
                  }`}>{it.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className={`${S.td} text-right`}>
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => openEdit(it)} className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" title="Edit">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => toggleActive(it)} className={`text-xs font-medium transition-colors ${it.is_active ? 'text-gray-400 hover:text-red-500' : 'text-gray-400 hover:text-emerald-600'}`}>
                      {it.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => remove(it)} className="text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Equipment Type' : 'Add Equipment Type'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Display Label *</label>
            <input className={S.input} value={form.display_label} onChange={e => setForm(f => ({ ...f, display_label: e.target.value }))} placeholder="e.g. Truck" />
          </div>
          <div>
            <label className={S.label}>Internal Name *</label>
            <input className={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. truck (lowercase, used as key)" />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Stored on loan_equipment.equipment_type. Lowercase, no spaces.</p>
          </div>
          <div>
            <label className={S.label}>Sort Order</label>
            <input className={S.input} type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Lower = appears first in dropdowns. Default 100.</p>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
            <span className="text-sm text-gray-600 dark:text-slate-400">Active (show in dropdowns)</span>
          </label>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={save} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
