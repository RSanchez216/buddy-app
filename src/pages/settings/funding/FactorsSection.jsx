// Factors (factoring companies) section of the Funding & Sources page.
// Reads/writes the `factors` table. Stores fee_rate as a decimal fraction
// (1% → 0.0100); the UI works in percent-as-typed and converts on save/load.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { useToast } from '../../../contexts/ToastContext'

const empty = {
  name: '',
  fee_rate_pct: '',           // user-typed percentage, e.g. "1" or "1.5"
  default_deposit_account_id: '',
  notes: '',
  is_active: true,
}

function fmtFeePct(decimalRate) {
  if (decimalRate === null || decimalRate === undefined || decimalRate === '') return '—'
  const num = Number(decimalRate)
  if (Number.isNaN(num)) return '—'
  // Trim trailing zeros for clean display: 0.0100 → "1%", 0.0125 → "1.25%"
  const pct = num * 100
  const trimmed = pct.toFixed(4).replace(/\.?0+$/, '')
  return `${trimmed}%`
}

export default function FactorsSection() {
  const { isAdmin } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [itemsRes, accountsRes] = await Promise.all([
      supabase
        // Embed without naming the FK constraint — there's only one FK
        // between factors and funding_accounts, so PostgREST can resolve it
        // without us hard-coding the constraint name (which is brittle).
        .from('factors')
        .select('*, default_deposit_account:funding_accounts(id, name, bank_name)')
        .order('is_active', { ascending: false })
        .order('name'),
      supabase
        .from('funding_accounts')
        .select('id, name, bank_name')
        .eq('is_active', true)
        .order('name'),
    ])
    setItems(itemsRes.data || [])
    setAccounts(accountsRes.data || [])
    setLoading(false)
  }

  const visibleItems = useMemo(
    () => showInactive ? items : items.filter(it => it.is_active),
    [items, showInactive]
  )

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(it) {
    setEditItem(it)
    setForm({
      name: it.name,
      fee_rate_pct: it.fee_rate == null ? '' : String(Number(it.fee_rate) * 100),
      default_deposit_account_id: it.default_deposit_account_id || '',
      notes: it.notes || '',
      is_active: !!it.is_active,
    })
    setError(''); setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) return setError('Name is required.')
    if (form.fee_rate_pct !== '' && Number.isNaN(Number(form.fee_rate_pct))) {
      return setError('Fee rate must be a number.')
    }

    setSaving(true); setError('')
    const decimalRate = form.fee_rate_pct === '' ? null : Number(form.fee_rate_pct) / 100
    const payload = {
      name: form.name.trim(),
      fee_rate: decimalRate,
      default_deposit_account_id: form.default_deposit_account_id || null,
      notes: form.notes.trim() || null,
      is_active: !!form.is_active,
    }

    const res = editItem
      ? await supabase.from('factors').update(payload).eq('id', editItem.id)
      : await supabase.from('factors').insert(payload)
    if (res.error) {
      setError(res.error.message)
      toast.error(editItem ? "Couldn't update factor" : "Couldn't create factor", res.error)
    } else {
      toast.success(editItem ? `Factor updated — ${payload.name}` : `Factor created — ${payload.name}`)
      setShowModal(false); load()
    }
    setSaving(false)
  }

  async function toggleActive(it) {
    const { error } = await supabase.from('factors').update({ is_active: !it.is_active }).eq('id', it.id)
    if (error) toast.error(it.is_active ? "Couldn't deactivate factor" : "Couldn't reactivate factor", error)
    else toast.success(it.is_active ? `Factor deactivated — ${it.name}` : `Factor reactivated — ${it.name}`)
    load()
  }

  async function remove(it) {
    if (!confirm(`Delete "${it.name}"?`)) return
    const { error: e } = await supabase.from('factors').delete().eq('id', it.id)
    if (e) toast.error("Couldn't delete factor", e)
    else toast.success(`Factor deleted — ${it.name}`)
    load()
  }

  if (loading) {
    return (
      <SectionCard title="Factoring Companies" subtitle="Factors that advance against your invoices">
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
      </SectionCard>
    )
  }

  const activeCount = items.filter(it => it.is_active).length
  const inactiveCount = items.length - activeCount

  return (
    <SectionCard
      title="Factoring Companies"
      subtitle="Factors that advance against your invoices"
      headerRight={isAdmin && (
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Factor
        </button>
      )}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-slate-500">
          {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <th className={`${S.th} min-w-[200px]`}>Name</th>
                <th className={`${S.th} w-28`}>Fee Rate</th>
                <th className={`${S.th} min-w-[240px]`}>Default Deposit</th>
                <th className={`${S.th} min-w-[100px]`}>Status</th>
                <th className={`${S.th} min-w-[180px] text-right`}></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">{items.length === 0 ? 'No factoring companies yet' : 'No factors match this filter'}</td></tr>
              ) : visibleItems.map(it => {
                const muted = !it.is_active
                const deposit = it.default_deposit_account
                return (
                  <tr key={it.id} className={`${S.tableRow} ${muted ? 'opacity-55' : ''}`}>
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.name}</td>
                    <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300`}>{fmtFeePct(it.fee_rate)}</td>
                    <td className={`${S.td} text-gray-500 dark:text-slate-400`}>
                      {deposit ? (
                        <span>
                          <span className="text-gray-700 dark:text-slate-300">{deposit.name}</span>
                          {deposit.bank_name && <span className="text-gray-400 dark:text-slate-500"> ({deposit.bank_name})</span>}
                        </span>
                      ) : '—'}
                    </td>
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
                        {isAdmin && (
                          <button onClick={() => toggleActive(it)} className={`text-xs font-medium transition-colors ${it.is_active ? 'text-gray-400 hover:text-red-500' : 'text-gray-400 hover:text-emerald-600'}`}>
                            {it.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                        {isAdmin && (
                          <button onClick={() => remove(it)} className="text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Factor' : 'Add Factor'} size="md">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          {!isAdmin && (
            <div className="rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 p-3 text-xs text-gray-600 dark:text-slate-400">
              Read-only — only admins can edit factoring companies.
            </div>
          )}
          <div>
            <label className={S.label}>Name *</label>
            <input
              className={S.input}
              value={form.name}
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Triumph Business Capital"
            />
          </div>
          <div>
            <label className={S.label}>Fee Rate</label>
            <div className="relative">
              <input
                type="number" step="0.001" min="0"
                className={`${S.input} pr-8`}
                value={form.fee_rate_pct}
                disabled={!isAdmin}
                onChange={e => setForm(f => ({ ...f, fee_rate_pct: e.target.value }))}
                placeholder="1"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-slate-500 pointer-events-none">%</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">% kept by factor per advance</p>
          </div>
          <div>
            <label className={S.label}>Default Deposit Account</label>
            <Select
              value={form.default_deposit_account_id}
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, default_deposit_account_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.bank_name ? `${a.name} (${a.bank_name})` : a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className={S.label}>Notes</label>
            <textarea
              className={S.textarea}
              rows={2}
              value={form.notes}
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active}
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded"
            />
            <span className="text-sm text-gray-600 dark:text-slate-400">Active</span>
          </label>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            {isAdmin && (
              <button onClick={save} disabled={saving} className={S.btnSave}>
                {saving ? 'Saving…' : editItem ? 'Update' : 'Add'}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </SectionCard>
  )
}

function SectionCard({ title, subtitle, headerRight, children }) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children}
    </section>
  )
}
