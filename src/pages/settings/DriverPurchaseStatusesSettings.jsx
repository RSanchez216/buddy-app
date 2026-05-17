import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'

const HEX_RX = /^#[0-9A-Fa-f]{6}$/
const empty = { name: '', description: '', color_hex: '#5F5E5A', is_active_state: false, is_terminal: false, sort_order: 0 }

export default function DriverPurchaseStatusesSettings() {
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
    const { data } = await supabase
      .from('driver_purchase_statuses')
      .select('*')
      .order('sort_order')
      .order('name')
    setItems(data || []); setLoading(false)
  }

  function openAdd() {
    const nextOrder = items.length ? Math.max(...items.map(i => i.sort_order || 0)) + 10 : 10
    setEditItem(null); setForm({ ...empty, sort_order: nextOrder }); setError(''); setShowModal(true)
  }
  function openEdit(it) {
    setEditItem(it)
    setForm({
      name: it.name,
      description: it.description || '',
      color_hex: it.color_hex || '#5F5E5A',
      is_active_state: !!it.is_active_state,
      is_terminal: !!it.is_terminal,
      sort_order: it.sort_order ?? 0,
    })
    setError(''); setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) return setError('Name is required')
    if (!HEX_RX.test(form.color_hex)) return setError('Color must be a 6-digit hex like #1D9E75')
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      color_hex: form.color_hex,
      is_active_state: !!form.is_active_state,
      is_terminal: !!form.is_terminal,
      sort_order: Number(form.sort_order) || 0,
    }
    const res = editItem
      ? await supabase.from('driver_purchase_statuses').update(payload).eq('id', editItem.id)
      : await supabase.from('driver_purchase_statuses').insert(payload)
    setSaving(false)
    if (res.error) {
      const msg = res.error.code === '23505' ? 'A status with that name already exists' : res.error.message
      setError(msg)
      toast.error(editItem ? "Couldn't update status" : "Couldn't create status", msg)
      return
    }
    toast.success(editItem ? `Status updated — ${payload.name}` : `Status created — ${payload.name}`)
    setShowModal(false); load()
  }

  async function bumpOrder(it, delta) {
    const next = (it.sort_order || 0) + delta
    const { error } = await supabase.from('driver_purchase_statuses').update({ sort_order: next }).eq('id', it.id)
    if (error) toast.error("Couldn't reorder status", error)
    load()
  }

  async function remove(it) {
    if (!confirm(`Delete status "${it.name}"? This will fail if any driver purchases reference it.`)) return
    const { count } = await supabase
      .from('driver_purchases')
      .select('id', { count: 'exact', head: true })
      .eq('status_id', it.id)
    if ((count || 0) > 0) {
      const msg = `${count} driver purchase${count === 1 ? '' : 's'} use this status. Reassign them first.`
      toast.error(`Cannot delete "${it.name}"`, msg)
      return
    }
    const { error: e } = await supabase.from('driver_purchase_statuses').delete().eq('id', it.id)
    if (e) {
      if (e.code === '23503') toast.error(`Cannot delete "${it.name}"`, 'Driver purchases reference this status.')
      else toast.error("Couldn't delete status", e)
      return
    }
    toast.success(`Status deleted — ${it.name}`)
    load()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Driver Purchase Statuses</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Lifecycle states for driver purchase contracts</p>
        </div>
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Status
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Order</th>
              <th className={S.th}>Color</th>
              <th className={S.th}>Name</th>
              <th className={S.th}>Active state</th>
              <th className={S.th}>Terminal</th>
              <th className={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No statuses yet</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className={S.tableRow}>
                <td className={S.td}>
                  <div className="flex items-center gap-1">
                    <button onClick={() => bumpOrder(it, -10)} className="text-gray-400 hover:text-cyan-600 transition-colors" title="Move up">▲</button>
                    <span className="font-mono text-xs text-gray-400 dark:text-slate-500 mx-1">{it.sort_order}</span>
                    <button onClick={() => bumpOrder(it, +10)} className="text-gray-400 hover:text-cyan-600 transition-colors" title="Move down">▼</button>
                  </div>
                </td>
                <td className={S.td}>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-5 h-5 rounded border border-gray-200 dark:border-white/10" style={{ backgroundColor: it.color_hex }} />
                    <span className="font-mono text-xs text-gray-500 dark:text-slate-500">{it.color_hex}</span>
                  </div>
                </td>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                  {it.name}
                  {it.description && <div className="text-xs text-gray-400 dark:text-slate-500 font-normal">{it.description}</div>}
                </td>
                <td className={S.td}>
                  <FlagPill on={it.is_active_state} onLabel="Active" offLabel="—" tone="emerald" />
                </td>
                <td className={S.td}>
                  <FlagPill on={it.is_terminal} onLabel="Terminal" offLabel="—" tone="gray" />
                </td>
                <td className={`${S.td} text-right`}>
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => openEdit(it)} className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" title="Edit">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button onClick={() => remove(it)} className="text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Status' : 'Add Status'}>
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Name *</label>
            <input className={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className={S.label}>Description</label>
            <input className={S.input} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={S.label}>Color (hex)</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={HEX_RX.test(form.color_hex) ? form.color_hex : '#5F5E5A'}
                  onChange={e => setForm(f => ({ ...f, color_hex: e.target.value.toUpperCase() }))}
                  className="w-10 h-10 rounded-lg border border-gray-300 dark:border-slate-700 cursor-pointer bg-white dark:bg-slate-800"
                />
                <input
                  className={`${S.input} font-mono uppercase`}
                  value={form.color_hex}
                  onChange={e => setForm(f => ({ ...f, color_hex: e.target.value }))}
                  placeholder="#5F5E5A"
                />
              </div>
            </div>
            <div>
              <label className={S.label}>Sort order</label>
              <input
                type="number"
                className={S.input}
                value={form.sort_order}
                onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active_state}
                onChange={e => setForm(f => ({ ...f, is_active_state: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-gray-700 dark:text-slate-300">Is active state</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_terminal}
                onChange={e => setForm(f => ({ ...f, is_terminal: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-gray-700 dark:text-slate-300">Is terminal</span>
            </label>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            <span className="font-semibold">Active state</span> means the system expects a deduction this period.{' '}
            <span className="font-semibold">Terminal</span> means the contract has reached an end state.
          </p>
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

function FlagPill({ on, onLabel, offLabel, tone }) {
  if (!on) return <span className="text-xs text-gray-400 dark:text-slate-600">{offLabel}</span>
  const tones = {
    emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
    gray: 'bg-gray-100 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-slate-600/30',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${tones[tone] || tones.gray}`}>
      {onLabel}
    </span>
  )
}
