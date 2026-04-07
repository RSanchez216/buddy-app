import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import { pmLabel } from '../../lib/deptUtils'

const emptyForm = { name: '', account_reference: '' }

export default function SettingsPaymentMethods() {
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data } = await supabase.from('payment_methods').select('*').order('name')
    setMethods(data || [])
    setLoading(false)
  }

  function openAdd() { setEditItem(null); setForm(emptyForm); setError(''); setShowModal(true) }
  function openEdit(m) { setEditItem(m); setForm({ name: m.name, account_reference: m.account_reference || '' }); setError(''); setShowModal(true) }

  async function handleSave() {
    if (!form.name.trim()) return setError('Method name is required')
    setSaving(true); setError('')
    const payload = { name: form.name.trim(), account_reference: form.account_reference.trim() || null }
    const res = editItem
      ? await supabase.from('payment_methods').update(payload).eq('id', editItem.id)
      : await supabase.from('payment_methods').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); loadData() }
    setSaving(false)
  }

  async function handleDelete(m) {
    if (!confirm(`Delete "${pmLabel(m)}"?`)) return
    await supabase.from('payment_methods').delete().eq('id', m.id)
    loadData()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" /></div>

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payment Methods</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">These populate the Payment Method dropdown in Vendor Master</p>
        </div>
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Method
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Method</th>
              <th className={S.th}>Account Reference</th>
              <th className={S.th}>Display As</th>
              <th className={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {methods.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No payment methods yet</td></tr>
            ) : methods.map(m => (
              <tr key={m.id} className={S.tableRow}>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{m.name}</td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>
                  {m.account_reference || <span className="text-gray-300 dark:text-slate-600">—</span>}
                </td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400 text-xs`}>
                  <span className="px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 font-medium text-gray-700 dark:text-slate-300">
                    {pmLabel(m)}
                  </span>
                </td>
                <td className={`${S.td} text-right`}>
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => openEdit(m)} className="text-gray-400 dark:text-slate-600 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => handleDelete(m)} className="text-gray-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Helper note */}
      <div className="rounded-xl border border-cyan-200 dark:border-cyan-500/20 bg-cyan-50 dark:bg-cyan-500/5 p-4 text-sm text-cyan-700 dark:text-cyan-400">
        <strong>Account Reference</strong> is optional — use it to identify the bank account or card (e.g. last 4 digits). It shows in dropdowns as <span className="font-mono">ACH — 6589</span>.
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Payment Method' : 'Add Payment Method'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Method Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={S.input} placeholder="e.g. ACH, Credit Card, Wire Transfer" />
          </div>
          <div>
            <label className={S.label}>Account Reference (optional)</label>
            <input value={form.account_reference} onChange={e => setForm(f => ({ ...f, account_reference: e.target.value }))}
              className={S.input} placeholder="e.g. 6589 (last 4 of account)" />
            <p className="text-xs text-gray-400 dark:text-slate-600 mt-1">Will display as "{form.name || 'ACH'}{form.account_reference ? ` — ${form.account_reference}` : ''}" in dropdowns</p>
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add Method'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
