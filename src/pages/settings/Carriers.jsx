import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'

// Managed carriers list. Direct analog of the Loan Entities settings
// page — same shape, same affordances (add / rename / deactivate /
// delete). The selected carrier is still stored as TEXT on
// drivers/trucks/trailers, so renaming here does NOT cascade — that's
// noted on the modal.

const empty = { name: '' }

export default function SettingsCarriers() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('carriers').select('*').order('name')
    setItems(data || []); setLoading(false)
  }

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(it) { setEditItem(it); setForm({ name: it.name }); setError(''); setShowModal(true) }

  async function save() {
    if (!form.name.trim()) return setError('Name is required')
    setSaving(true); setError('')
    const payload = { name: form.name.trim(), updated_at: new Date().toISOString() }
    const res = editItem
      ? await supabase.from('carriers').update(payload).eq('id', editItem.id)
      : await supabase.from('carriers').insert(payload)
    if (res.error) {
      // Friendly message for the unique-name constraint.
      const msg = /duplicate.*carriers|unique.*carriers/i.test(res.error.message || '')
        ? `A carrier named "${payload.name}" already exists.`
        : res.error.message
      setError(msg)
      toast.error(editItem ? "Couldn't update carrier" : "Couldn't create carrier", msg)
    } else {
      toast.success(editItem ? `Carrier updated — ${payload.name}` : `Carrier added — ${payload.name}`)
      setShowModal(false); load()
    }
    setSaving(false)
  }

  async function toggleActive(it) {
    const { error: e } = await supabase
      .from('carriers')
      .update({ is_active: !it.is_active, updated_at: new Date().toISOString() })
      .eq('id', it.id)
    if (e) toast.error(it.is_active ? "Couldn't deactivate carrier" : "Couldn't activate carrier", e)
    else toast.success(it.is_active ? `Carrier deactivated — ${it.name}` : `Carrier activated — ${it.name}`)
    load()
  }

  async function remove(it) {
    if (!confirm(`Delete "${it.name}"? Units already assigned this carrier name will keep the text value; deactivate instead if you want to keep the history.`)) return
    const { error: e } = await supabase.from('carriers').delete().eq('id', it.id)
    if (e) toast.error("Couldn't delete carrier", e)
    else { toast.success(`Carrier deleted — ${it.name}`); load() }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Carriers</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Managed carrier list used by truck / trailer / driver dropdowns</p>
        </div>
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Carrier
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Name</th>
              <th className={S.th}>Status</th>
              <th className={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No carriers yet</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className={S.tableRow}>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.name}</td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Carrier' : 'Add Carrier'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Name *</label>
            <input className={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Acme Carrier Inc" />
            {editItem && (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 leading-tight">
                Stored as text on units. Renaming here does NOT update existing trucks / trailers / drivers — they keep the old text until edited.
              </p>
            )}
          </div>
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
