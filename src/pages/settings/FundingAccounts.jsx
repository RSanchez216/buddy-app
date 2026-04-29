import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'

const empty = { name: '', bank_name: '', last_four: '', notes: '' }

export default function SettingsFundingAccounts() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('funding_accounts').select('*').order('name')
    setItems(data || []); setLoading(false)
  }

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(it) {
    setEditItem(it)
    setForm({
      name: it.name,
      bank_name: it.bank_name || '',
      last_four: it.last_four || '',
      notes: it.notes || '',
    })
    setError(''); setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) return setError('Name is required')
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      bank_name: form.bank_name.trim() || null,
      last_four: form.last_four.trim() || null,
      notes: form.notes.trim() || null,
    }
    const res = editItem
      ? await supabase.from('funding_accounts').update(payload).eq('id', editItem.id)
      : await supabase.from('funding_accounts').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); load() }
    setSaving(false)
  }

  async function toggleActive(it) {
    await supabase.from('funding_accounts').update({ is_active: !it.is_active }).eq('id', it.id)
    load()
  }

  async function remove(it) {
    if (!confirm(`Delete "${it.name}"? This will fail if loans reference it.`)) return
    const { error: e } = await supabase.from('funding_accounts').delete().eq('id', it.id)
    if (e) alert(e.message)
    else load()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funding Accounts</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Bank accounts that fund loan payments</p>
        </div>
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Account
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Name</th>
              <th className={S.th}>Bank</th>
              <th className={S.th}>Last 4</th>
              <th className={S.th}>Status</th>
              <th className={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No funding accounts yet</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className={S.tableRow}>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.name}</td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{it.bank_name || '—'}</td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>{it.last_four || '—'}</td>
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Account' : 'Add Account'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Name *</label>
            <input className={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Operating Account" />
          </div>
          <div>
            <label className={S.label}>Bank Name</label>
            <input className={S.input} value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="e.g. Chase" />
          </div>
          <div>
            <label className={S.label}>Last 4 Digits</label>
            <input className={S.input} value={form.last_four} onChange={e => setForm(f => ({ ...f, last_four: e.target.value }))} placeholder="1234" />
          </div>
          <div>
            <label className={S.label}>Notes</label>
            <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
