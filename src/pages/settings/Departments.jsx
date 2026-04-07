import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import { buildDeptOptions } from '../../lib/deptUtils'
import Select from '../../components/Select'

const emptyForm = { name: '', parent_id: '' }

export default function SettingsDepartments() {
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data } = await supabase.from('departments').select('*').order('name')
    setDepartments(data || [])
    setLoading(false)
  }

  function openAdd() { setEditItem(null); setForm(emptyForm); setError(''); setShowModal(true) }
  function openEdit(d) {
    setEditItem(d)
    setForm({ name: d.name, parent_id: d.parent_id || '' })
    setError(''); setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return setError('Department name is required')
    setSaving(true); setError('')
    const payload = { name: form.name.trim(), parent_id: form.parent_id || null }
    const res = editItem
      ? await supabase.from('departments').update(payload).eq('id', editItem.id)
      : await supabase.from('departments').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); loadData() }
    setSaving(false)
  }

  async function toggleActive(d) {
    await supabase.from('departments').update({ is_active: !d.is_active }).eq('id', d.id)
    loadData()
  }

  // Build indented options for parent dropdown (exclude self when editing)
  const parentOptions = buildDeptOptions(
    departments.filter(d => !d.parent_id && (!editItem || d.id !== editItem.id))
  )

  // Display list: parents + indented children
  const displayList = []
  const parents = departments.filter(d => !d.parent_id)
  parents.forEach(p => {
    displayList.push({ ...p, _indent: false })
    departments.filter(d => d.parent_id === p.id).forEach(c => displayList.push({ ...c, _indent: true }))
  })
  departments.filter(d => d.parent_id && !parents.find(p => p.id === d.parent_id))
    .forEach(d => displayList.push({ ...d, _indent: true }))

  const parentName = (d) => departments.find(p => p.id === d.parent_id)?.name || null

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" /></div>

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Departments</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Manage departments and sub-departments</p>
        </div>
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Department
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Name</th>
              <th className={S.th}>Parent</th>
              <th className={S.th}>Created</th>
              <th className={`${S.th} text-center`}>Status</th>
              <th className={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {displayList.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No departments yet</td></tr>
            ) : displayList.map(d => (
              <tr key={d.id} className={S.tableRow}>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                  {d._indent && <span className="mr-2 text-gray-300 dark:text-slate-600">—</span>}
                  {d.name}
                </td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400 text-xs`}>{parentName(d) || '—'}</td>
                <td className={`${S.td} text-gray-400 dark:text-slate-500 text-xs`}>{new Date(d.created_at).toLocaleDateString()}</td>
                <td className={`${S.td} text-center`}>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.is_active !== false ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'}`}>
                    {d.is_active !== false ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className={`${S.td} text-right`}>
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => openEdit(d)} className="text-gray-400 dark:text-slate-600 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => toggleActive(d)} className={`text-xs font-medium transition-colors ${d.is_active !== false ? 'text-gray-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400' : 'text-gray-400 dark:text-slate-600 hover:text-emerald-600 dark:hover:text-emerald-400'}`}>
                      {d.is_active !== false ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Department' : 'Add Department'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Department Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={S.input} placeholder="e.g. Fleet North" />
          </div>
          <div>
            <label className={S.label}>Parent Department (optional)</label>
            <Select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}>
              <option value="">None (top-level)</option>
              {parentOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
            <p className="text-xs text-gray-400 dark:text-slate-600 mt-1">Sub-departments appear indented in all dropdowns</p>
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add Department'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
