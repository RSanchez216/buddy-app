import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'

export default function SettingsVendorCategories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data } = await supabase.from('vendor_categories').select('*').order('name')
    setCategories(data || [])
    setLoading(false)
  }

  function openAdd() { setEditItem(null); setName(''); setError(''); setShowModal(true) }
  function openEdit(c) { setEditItem(c); setName(c.name); setError(''); setShowModal(true) }

  async function handleSave() {
    if (!name.trim()) return setError('Category name is required')
    setSaving(true); setError('')
    const res = editItem
      ? await supabase.from('vendor_categories').update({ name: name.trim() }).eq('id', editItem.id)
      : await supabase.from('vendor_categories').insert({ name: name.trim() })
    if (res.error) setError(res.error.message)
    else { setShowModal(false); loadData() }
    setSaving(false)
  }

  async function handleDelete(c) {
    if (!confirm(`Delete category "${c.name}"? This cannot be undone.`)) return
    await supabase.from('vendor_categories').delete().eq('id', c.id)
    loadData()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" /></div>

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Vendor Categories</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">These populate the Category dropdown in Vendor Master</p>
        </div>
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Category
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Category Name</th>
              <th className={S.th}>Created</th>
              <th className={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No categories yet</td></tr>
            ) : categories.map(c => (
              <tr key={c.id} className={S.tableRow}>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    {c.name}
                  </div>
                </td>
                <td className={`${S.td} text-gray-400 dark:text-slate-500 text-xs`}>{new Date(c.created_at).toLocaleDateString()}</td>
                <td className={`${S.td} text-right`}>
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => openEdit(c)} className="text-gray-400 dark:text-slate-600 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => handleDelete(c)} className="text-gray-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Category' : 'Add Category'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Category Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              className={S.input} placeholder="e.g. Tires & Parts" autoFocus />
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add Category'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
