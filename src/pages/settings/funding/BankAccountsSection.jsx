// Bank Accounts section of the Funding & Sources page.
// Behavior unchanged from the prior FundingAccounts page —
// fields, validation, and admin gating around current_balance / balance_as_of_date
// are preserved verbatim.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'

const empty = {
  name: '', bank_name: '', last_four: '', notes: '',
  current_balance: '', balance_as_of_date: '',
}

const STALE_DAYS = 7

function fmtCurrency(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtAsOfShort(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysSince(iso) {
  if (!iso) return Infinity
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return Infinity
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - d.getTime()) / 86400000)
}

export default function BankAccountsSection() {
  const { user, isAdmin } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('funding_accounts')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name')
    setItems(data || []); setLoading(false)
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
      bank_name: it.bank_name || '',
      last_four: it.last_four || '',
      notes: it.notes || '',
      current_balance: it.current_balance ?? '',
      balance_as_of_date: it.balance_as_of_date || '',
    })
    setError(''); setShowModal(true)
  }

  async function save() {
    if (!form.name.trim()) return setError('Name is required')

    // Coupled balance validation — both fields or neither.
    const hasBalance = form.current_balance !== '' && form.current_balance !== null
    const hasDate    = !!form.balance_as_of_date
    if (hasBalance && !hasDate) return setError('Set "As of Date" when entering a balance.')
    if (hasDate && !hasBalance) return setError('Set "Current Balance" when entering an as-of date.')
    if (hasBalance && Number.isNaN(Number(form.current_balance))) {
      return setError('Current balance must be a number.')
    }

    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      bank_name: form.bank_name.trim() || null,
      last_four: form.last_four.trim() || null,
      notes: form.notes.trim() || null,
    }

    if (isAdmin) {
      const newBalance = hasBalance ? Number(form.current_balance) : null
      const newDate    = hasDate    ? form.balance_as_of_date     : null
      const balanceChanged =
        editItem
          ? (Number(editItem.current_balance ?? null) !== Number(newBalance ?? null)
             || (editItem.balance_as_of_date || null) !== newDate)
          : (hasBalance || hasDate)

      payload.current_balance    = newBalance
      payload.balance_as_of_date = newDate
      if (balanceChanged) payload.balance_updated_by = user?.id || null
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

  if (loading) {
    return (
      <SectionCard title="Bank Accounts" subtitle="Bank accounts that fund loan payments">
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
      </SectionCard>
    )
  }

  const activeCount = items.filter(it => it.is_active).length
  const inactiveCount = items.length - activeCount

  return (
    <SectionCard
      title="Bank Accounts"
      subtitle="Bank accounts that fund loan payments"
      headerRight={isAdmin && (
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Account
        </button>
      )}
    >
      {/* Filter bar */}
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
                <th className={S.th}>Name</th>
                <th className={S.th}>Bank</th>
                <th className={S.th}>Last 4</th>
                <th className={S.th}>Balance</th>
                <th className={S.th}>Status</th>
                <th className={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">{items.length === 0 ? 'No funding accounts yet' : 'No accounts match this filter'}</td></tr>
              ) : visibleItems.map(it => {
                const stale = it.balance_as_of_date && daysSince(it.balance_as_of_date) > STALE_DAYS
                const muted = !it.is_active
                return (
                  <tr key={it.id} className={`${S.tableRow} ${muted ? 'opacity-55' : ''}`}>
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.name}</td>
                    <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{it.bank_name || '—'}</td>
                    <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>{it.last_four || '—'}</td>
                    <td className={`${S.td} whitespace-nowrap`}>
                      <div className="font-mono text-gray-900 dark:text-slate-200">{fmtCurrency(it.current_balance)}</div>
                      {it.balance_as_of_date && (
                        <div className={`text-[11px] mt-0.5 ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-slate-500'}`}>
                          as of {fmtAsOfShort(it.balance_as_of_date)}
                          {stale && <span className="ml-1">·  {daysSince(it.balance_as_of_date)}d old</span>}
                        </div>
                      )}
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Account' : 'Add Account'} size="md">
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

          <div className="pt-2 border-t border-gray-100 dark:border-white/5">
            <div className="flex items-baseline justify-between mb-2">
              <h4 className="text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">Reconciled balance</h4>
              {!isAdmin && (
                <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">Read-only</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={S.label}>Current Balance ($)</label>
                <input
                  type="number" step="0.01"
                  className={S.input}
                  value={form.current_balance}
                  disabled={!isAdmin}
                  onChange={e => setForm(f => ({ ...f, current_balance: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className={S.label}>As of Date</label>
                <input
                  type="date"
                  className={S.input}
                  value={form.balance_as_of_date}
                  disabled={!isAdmin}
                  onChange={e => setForm(f => ({ ...f, balance_as_of_date: e.target.value }))}
                />
                {isAdmin && !form.balance_as_of_date && form.current_balance !== '' && (
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, balance_as_of_date: new Date().toISOString().slice(0, 10) }))}
                    className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline mt-1"
                  >
                    Use today
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-2">
              Balance is used to project end-of-day cash on the Payment Calendar. Update whenever you reconcile.
            </p>
            {editItem?.balance_updated_at && (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
                Last updated {new Date(editItem.balance_updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
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
    </SectionCard>
  )
}

// Shared section card layout (also used by FactorsSection —
// duplicated locally to keep components self-contained).
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
