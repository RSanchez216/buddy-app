// Settings UI for the factors reference table. Mirrors the
// /settings/expense-categories page pattern (active list + collapsed
// archived section + add/edit modal + archive toggle + audit_log).
//
// Special handling vs. expense_categories:
//   * fee_rate is stored as decimal (0.02) but the form shows percent
//     (2.00). parseFeeRatePercent / formatFeeRate handle the round-trip.
//   * default_deposit_account_id is an optional pointer to funding_accounts.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import {
  invalidateFactors,
  formatFeeRate,
  parseFeeRatePercent,
} from '../../hooks/useFactors'

const empty = { name: '', fee_rate_percent: '', default_deposit_account_id: '', notes: '' }

export default function SettingsFactors() {
  const { user, profile, canEdit } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [usageByFactorId, setUsageByFactorId] = useState({})
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [facRes, accRes, useRes] = await Promise.all([
      supabase.from('factors').select('*').order('is_active', { ascending: false }).order('name'),
      supabase.from('funding_accounts').select('id, name, bank_name').eq('is_active', true).order('name'),
      supabase.from('expected_inflows').select('factor_id').not('factor_id', 'is', null),
    ])
    setItems(facRes.data || [])
    setAccounts(accRes.data || [])
    const usage = {}
    for (const r of (useRes.data || [])) usage[r.factor_id] = (usage[r.factor_id] || 0) + 1
    setUsageByFactorId(usage)
    setLoading(false)
  }

  const active   = useMemo(() => items.filter(i => i.is_active),  [items])
  const archived = useMemo(() => items.filter(i => !i.is_active), [items])

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(it) {
    setEditItem(it)
    setForm({
      name: it.name || '',
      fee_rate_percent: it.fee_rate != null ? (Number(it.fee_rate) * 100).toFixed(2) : '',
      default_deposit_account_id: it.default_deposit_account_id || '',
      notes: it.notes || '',
    })
    setError(''); setShowModal(true)
  }

  async function writeAudit({ record_id, action, before, after }) {
    await supabase.from('audit_log').insert({
      table_name: 'factors',
      record_id,
      action,
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        surface: 'settings_factors',
        name:                 after?.name ?? before?.name,
        fee_rate_before:      before?.fee_rate ?? null,
        fee_rate_after:       after?.fee_rate ?? null,
        is_active_before:     before?.is_active ?? null,
        is_active_after:      after?.is_active ?? null,
        default_account_before: before?.default_deposit_account_id ?? null,
        default_account_after:  after?.default_deposit_account_id ?? null,
      },
    })
  }

  async function save() {
    const name = String(form.name || '').trim()
    if (!name) return setError('Name is required')
    const fee_rate = parseFeeRatePercent(form.fee_rate_percent)
    if (fee_rate == null) return setError('Fee rate must be a number between 0 and 100')
    const payload = {
      name,
      fee_rate,
      default_deposit_account_id: form.default_deposit_account_id || null,
      notes: form.notes?.trim() || null,
    }
    setSaving(true); setError('')

    if (editItem) {
      const { data, error: e } = await supabase
        .from('factors')
        .update(payload)
        .eq('id', editItem.id)
        .select('*').single()
      if (e || !data) { setError(e?.message || 'Save failed'); toast.error("Couldn't update factor", e); setSaving(false); return }
      await writeAudit({ record_id: data.id, action: 'update', before: editItem, after: data })
      invalidateFactors()
      toast.success(`Factor updated — ${data.name}`)
      setShowModal(false); setSaving(false); load(); return
    }

    // Add
    if (items.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      setSaving(false); return setError(`A factor named "${name}" already exists`)
    }
    const { data, error: e } = await supabase
      .from('factors')
      .insert({ ...payload, is_active: true, created_by: user?.id || null })
      .select('*').single()
    if (e || !data) { setError(e?.message || 'Save failed'); toast.error("Couldn't create factor", e); setSaving(false); return }
    await writeAudit({ record_id: data.id, action: 'insert', after: data })
    invalidateFactors()
    toast.success(`Factor created — ${data.name}`)
    setShowModal(false); setSaving(false); load()
  }

  async function setActive(it, nextActive) {
    const { data, error: e } = await supabase
      .from('factors')
      .update({ is_active: nextActive })
      .eq('id', it.id)
      .select('*').single()
    if (e || !data) { toast.error(nextActive ? "Couldn't unarchive" : "Couldn't archive", e); return }
    await writeAudit({
      record_id: data.id,
      action: nextActive ? 'unarchive' : 'archive',
      before: it, after: data,
    })
    invalidateFactors()
    toast.success(nextActive ? `${data.name} unarchived` : `${data.name} archived`)
    load()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Factors</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Companies that purchase your invoices at a discount. Fee rates here drive automatic
            fee calculation on factor-type income.
          </p>
        </div>
        {canEdit && (
          <button onClick={openAdd} className={S.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Factor
          </button>
        )}
      </div>

      <FactorTable items={active} accounts={accounts} usageByFactorId={usageByFactorId} onEdit={openEdit} onArchive={(it) => setActive(it, false)} canEdit={canEdit} />

      {archived.length > 0 && (
        <div className={`${S.card} p-0 overflow-hidden`}>
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/[0.02]"
          >
            <span>Archived ({archived.length})</span>
            <svg className={`w-4 h-4 transition-transform ${showArchived ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showArchived && (
            <FactorTable
              embedded
              items={archived}
              accounts={accounts}
              usageByFactorId={usageByFactorId}
              onEdit={openEdit}
              onUnarchive={(it) => setActive(it, true)}
              canEdit={canEdit}
            />
          )}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Factor' : 'Add Factor'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Name *</label>
            <input
              className={S.input}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. APEX"
            />
          </div>
          <div>
            <label className={S.label}>Fee rate (%) *</label>
            <div className="relative">
              <input
                type="number" step="0.01" min="0" max="100"
                className={`${S.input} pr-7`}
                value={form.fee_rate_percent}
                onChange={e => setForm(f => ({ ...f, fee_rate_percent: e.target.value }))}
                placeholder="e.g. 2.00"
              />
              <span className="absolute inset-y-0 right-3 flex items-center text-gray-400 text-sm pointer-events-none">%</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Stored as a decimal: 2 → 0.02.</p>
          </div>
          <div>
            <label className={S.label}>Default deposit account</label>
            <Select value={form.default_deposit_account_id} onChange={e => setForm(f => ({ ...f, default_deposit_account_id: e.target.value }))}>
              <option value="">— None —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name ? `${a.name} (${a.bank_name})` : a.name}</option>)}
            </Select>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Optional. Used as a hint; not auto-filled yet.</p>
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

function FactorTable({ items, accounts, usageByFactorId, onEdit, onArchive, onUnarchive, canEdit, embedded }) {
  return (
    <div className={embedded ? 'overflow-hidden border-t border-gray-100 dark:border-white/5' : `${S.card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className={S.tableHead}>
          <tr>
            <th className={S.th}>Name</th>
            <th className={S.th}>Fee rate</th>
            <th className={S.th}>Default deposit account</th>
            <th className={S.th}>Usage</th>
            <th className={S.th}></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-slate-600 text-sm">
                No factors in this section
              </td>
            </tr>
          ) : items.map(it => {
            const acc = accounts.find(a => a.id === it.default_deposit_account_id)
            const usage = usageByFactorId[it.id] || 0
            return (
              <tr key={it.id} className={S.tableRow}>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.name}</td>
                <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300`}>{formatFeeRate(it.fee_rate)}</td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400`}>
                  {acc ? (acc.bank_name ? `${acc.name} (${acc.bank_name})` : acc.name) : <span className="italic text-gray-400">none</span>}
                </td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400`}>
                  {usage === 0 ? <span className="italic text-gray-400">unused</span> : `${usage} inflow${usage === 1 ? '' : 's'}`}
                </td>
                <td className={`${S.td} text-right`}>
                  {canEdit && (
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => onEdit(it)} title="Edit" className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {onArchive && (
                        <button onClick={() => onArchive(it)} className="text-xs font-medium text-gray-400 hover:text-amber-600 dark:hover:text-amber-400">Archive</button>
                      )}
                      {onUnarchive && (
                        <button onClick={() => onUnarchive(it)} className="text-xs font-medium text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400">Unarchive</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
