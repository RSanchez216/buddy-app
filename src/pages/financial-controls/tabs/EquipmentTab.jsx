import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { FC, EQUIPMENT_STATUSES, STATUS_LABELS, equipmentStatusPill, fmtMoney, fmtDate } from '../loanUtils'
import SoldToDriverSection from '../components/SoldToDriverSection'
import { useEquipmentTypes } from '../../../hooks/useEquipmentTypes'

const empty = {
  unit_number: '', vin: '', equipment_type: '', make: '', model: '', year: '',
  purchase_date: '', purchase_price: '', has_title: false, current_status: 'active', notes: '',
}

export default function EquipmentTab({ loanId, canEdit }) {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  // All types (active + inactive) so legacy rows still resolve to a label.
  // Dropdown options filter to is_active at render time.
  const { types: allEquipmentTypes, formatLabel: formatEqLabel } = useEquipmentTypes()
  const equipmentTypes = useMemo(() => allEquipmentTypes.filter(t => t.is_active), [allEquipmentTypes])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // loans.monthly_payment is the contract total; edited inline via the panel.
  const [contractTotal, setContractTotal] = useState('')
  const [contractTotalSaving, setContractTotalSaving] = useState(false)
  const [splitting, setSplitting] = useState(false)

  useEffect(() => { load() /* eslint-disable-line */ }, [loanId])

  async function load() {
    setLoading(true)
    const [eqRes, loanRes] = await Promise.all([
      supabase.from('loan_equipment').select('*').eq('loan_id', loanId).order('unit_number', { ascending: true }),
      supabase.from('loans').select('monthly_payment').eq('id', loanId).maybeSingle(),
    ])
    setRows(eqRes.data || [])
    setContractTotal(loanRes.data?.monthly_payment != null ? String(loanRes.data.monthly_payment) : '')
    setLoading(false)
  }

  // Per-row monthly payment editing. Manual edits flip override=true so the
  // next auto-split run leaves the row alone. "Reset to auto" clears override
  // and re-runs the split.
  async function setRowMonthlyPayment(row, value) {
    if (!canEdit) return
    const num = value === '' || value === null ? null : Number(value)
    const { error } = await supabase
      .from('loan_equipment')
      .update({ monthly_payment: num, monthly_payment_override: true, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) { alert(error.message); return }
    load()
  }

  async function resetRowToAuto(row) {
    if (!canEdit) return
    await supabase
      .from('loan_equipment')
      .update({ monthly_payment_override: false, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    await supabase.rpc('auto_split_contract_monthly_payment', { p_loan_id: loanId })
    load()
  }

  async function saveContractTotal() {
    if (!canEdit) return
    setContractTotalSaving(true)
    const num = contractTotal === '' ? null : Number(contractTotal)
    await supabase.from('loans').update({ monthly_payment: num }).eq('id', loanId)
    setContractTotalSaving(false)
    load()
  }

  async function runAutoSplit() {
    if (!canEdit) return
    setSplitting(true)
    await supabase.rpc('auto_split_contract_monthly_payment', { p_loan_id: loanId })
    setSplitting(false)
    load()
  }

  const totalAllocated = rows.reduce((sum, r) => sum + (Number(r.monthly_payment) || 0), 0)
  const contractTotalNum = Number(contractTotal) || 0
  const allocatedDelta = contractTotalNum - totalAllocated

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(r) {
    setEditItem(r)
    setForm({
      unit_number: r.unit_number || '', vin: r.vin || '', equipment_type: r.equipment_type || '',
      make: r.make || '', model: r.model || '', year: r.year ?? '',
      purchase_date: r.purchase_date || '', purchase_price: r.purchase_price ?? '',
      has_title: !!r.has_title, current_status: r.current_status || 'active', notes: r.notes || '',
    })
    setError(''); setShowModal(true)
  }

  async function handleSave() {
    setSaving(true); setError('')
    const payload = {
      loan_id: loanId,
      unit_number: form.unit_number.trim() || null,
      vin: form.vin.trim() || null,
      equipment_type: form.equipment_type.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      year: form.year === '' ? null : Number(form.year),
      purchase_date: form.purchase_date || null,
      purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
      has_title: !!form.has_title,
      current_status: form.current_status,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const res = editItem
      ? await supabase.from('loan_equipment').update(payload).eq('id', editItem.id)
      : await supabase.from('loan_equipment').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); load() }
    setSaving(false)
  }

  async function quickStatusChange(row, status) {
    if (!canEdit) return
    await supabase.from('loan_equipment').update({ current_status: status, updated_at: new Date().toISOString() }).eq('id', row.id)
    load()
  }

  // Flip has_title true on a single equipment row and write a 'title_received'
  // event for the audit trail. Optimistic UI: bump the row in local state
  // so the ✓ appears immediately, then revert if the network call fails.
  async function markTitleReceived(row) {
    if (!canEdit || row.has_title) return
    const today = new Date().toISOString().slice(0, 10)
    setRows(rs => rs.map(r => r.id === row.id ? { ...r, has_title: true } : r))
    const { error } = await supabase
      .from('loan_equipment')
      .update({ has_title: true, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) {
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, has_title: false } : r))
      alert('Could not mark title received: ' + error.message)
      return
    }
    const label = row.unit_number || row.vin || 'equipment'
    await supabase.from('loan_events').insert({
      loan_id: loanId,
      event_date: today,
      event_type: 'title_received',
      description: `Title received for ${label}`,
      created_by: user?.id || null,
    })
  }

  async function handleDelete(row) {
    if (!confirm(`Delete equipment ${row.unit_number || row.vin || ''}?`)) return
    await supabase.from('loan_equipment').delete().eq('id', row.id)
    load()
  }

  const summary = useMemo(() => {
    if (!rows.length) return ''
    const counts = {}
    rows.forEach(r => { if (r.equipment_type) counts[r.equipment_type] = (counts[r.equipment_type] || 0) + 1 })
    const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${formatEqLabel(t)}`)
    return `${rows.length} equipment${rows.length !== 1 ? '' : ''} (${parts.join(', ')})`
  }, [rows, formatEqLabel])

  if (loading) return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-4">
      {/* Contract Monthly Payment Total + Auto-Split panel */}
      <div className={`${S.card} p-4`}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">
              Contract Monthly Payment Total
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400 dark:text-slate-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className={`${S.input} max-w-[180px] font-mono`}
                value={contractTotal}
                disabled={!canEdit || contractTotalSaving}
                onChange={e => setContractTotal(e.target.value)}
                onBlur={saveContractTotal}
                placeholder="0.00"
              />
              {canEdit && (
                <button
                  onClick={runAutoSplit}
                  disabled={splitting || contractTotal === '' || Number(contractTotal) <= 0 || rows.length === 0}
                  className={FC.btnPrimary}
                  title={contractTotal === '' || Number(contractTotal) <= 0
                    ? 'Set a non-zero total first'
                    : rows.length === 0
                      ? 'Add equipment first'
                      : 'Split evenly across non-overridden equipment'}
                >
                  {splitting ? 'Splitting…' : 'Auto-Split to Equipment'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1.5">
              {contractTotalNum > 0
                ? `Allocated: ${fmtMoney(totalAllocated)} of ${fmtMoney(contractTotalNum)}${Math.abs(allocatedDelta) > 0.01 ? ` · ${allocatedDelta > 0 ? 'remaining' : 'over'} ${fmtMoney(Math.abs(allocatedDelta))}` : ' ✓'}`
                : 'Enter the contract\'s total monthly payment, then click Auto-Split.'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-slate-500">{summary || 'No equipment yet'}</p>
        {canEdit && (
          <button onClick={openAdd} className={FC.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Equipment
          </button>
        )}
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Unit#', 'VIN', 'Type', 'Make', 'Model', 'Year', 'Purchase Date', 'Purchase Price', 'Monthly Payment', 'Title', 'Status', 'Notes', canEdit && ''].filter(h => h !== false).map((h, i) => (
                  <th key={i} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No equipment</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{r.unit_number || '—'}</td>
                  <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>{r.vin || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.equipment_type ? formatEqLabel(r.equipment_type) : '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.make || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.model || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.year || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(r.purchase_date)}</td>
                  <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(r.purchase_price)}</td>
                  <td className={`${S.td} whitespace-nowrap`}>
                    {canEdit ? (
                      <div className="flex items-center gap-1.5">
                        <MonthlyPaymentInput row={r} onCommit={setRowMonthlyPayment} />
                        {r.monthly_payment_override && (
                          <>
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20" title="Manually set — auto-split will skip">
                              ✋ Manual
                            </span>
                            <button
                              onClick={() => resetRowToAuto(r)}
                              className="text-[10px] text-orange-600 dark:text-orange-400 hover:underline whitespace-nowrap"
                              title="Clear override and re-run auto-split"
                            >
                              Reset to auto
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="font-mono text-gray-700 dark:text-slate-300">{fmtMoney(r.monthly_payment)}</span>
                    )}
                  </td>
                  <td className={S.td}>
                    {r.has_title ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400" title="Title on file">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                        On file
                      </span>
                    ) : canEdit ? (
                      <button
                        onClick={() => markTitleReceived(r)}
                        title="Mark title as received from lender"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors whitespace-nowrap"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="7.5" cy="15.5" r="5.5" />
                          <path d="m21 2-9.6 9.6" />
                          <path d="m15.5 7.5 3 3L22 7l-3-3" />
                        </svg>
                        Mark received
                      </button>
                    ) : (
                      <span className="text-gray-300 dark:text-slate-600">—</span>
                    )}
                  </td>
                  <td className={S.td}>
                    {canEdit ? (
                      <select
                        value={r.current_status}
                        onChange={e => quickStatusChange(r, e.target.value)}
                        className={`text-xs px-2 py-1 rounded-lg border-0 focus:ring-2 focus:ring-orange-500/40 outline-none cursor-pointer ${equipmentStatusPill(r.current_status)}`}
                      >
                        {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${equipmentStatusPill(r.current_status)}`}>
                        {STATUS_LABELS[r.current_status] || r.current_status}
                      </span>
                    )}
                  </td>
                  <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400 max-w-[180px] truncate`} title={r.notes || ''}>{r.notes || '—'}</td>
                  {canEdit && (
                    <td className={`${S.td} text-right whitespace-nowrap`}>
                      <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 mr-3" title="Edit">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => handleDelete(r)} className="text-gray-400 hover:text-red-500" title="Delete">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cross-reference: driver purchases that resold this loan's equipment.
          Self-hides when no rows match. */}
      <SoldToDriverSection loanId={loanId} />

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Equipment' : 'Add Equipment'} size="lg">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Unit Number">
              <input className={S.input} value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value }))} />
            </Field>
            <Field label="VIN">
              <input className={S.input} value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value }))} />
            </Field>
            <Field label="Type">
              <Select value={form.equipment_type} onChange={e => setForm(f => ({ ...f, equipment_type: e.target.value }))}>
                <option value="">Select…</option>
                {equipmentTypes.map(t => <option key={t.id} value={t.name}>{t.display_label || t.name}</option>)}
                {/* Preserve legacy/free-text value if it's not in the active list */}
                {form.equipment_type && !equipmentTypes.some(t => t.name === form.equipment_type) && (
                  <option value={form.equipment_type}>{formatEqLabel(form.equipment_type)} (legacy)</option>
                )}
              </Select>
            </Field>
            <Field label="Year">
              <input className={S.input} type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
            </Field>
            <Field label="Make">
              <input className={S.input} value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} />
            </Field>
            <Field label="Model">
              <input className={S.input} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
            </Field>
            <Field label="Purchase Date">
              <input className={S.input} type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))} />
            </Field>
            <Field label="Purchase Price ($)">
              <input className={S.input} type="number" step="0.01" value={form.purchase_price} onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} />
            </Field>
            <Field label="Status">
              <Select value={form.current_status} onChange={e => setForm(f => ({ ...f, current_status: e.target.value }))}>
                {EQUIPMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </Select>
            </Field>
            <Field label="Has Title">
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.has_title} onChange={e => setForm(f => ({ ...f, has_title: e.target.checked }))} className="rounded" />
                <span className="text-sm text-gray-600 dark:text-slate-400">Title on file</span>
              </label>
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={FC.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}

// Inline monthly-payment editor — commits on blur or Enter so we don't spam
// the network as the user types. Maintains its own local string state so
// values like "1500.00" survive empty-string typing.
function MonthlyPaymentInput({ row, onCommit }) {
  const [val, setVal] = useState(row.monthly_payment != null ? String(row.monthly_payment) : '')
  useEffect(() => {
    setVal(row.monthly_payment != null ? String(row.monthly_payment) : '')
  }, [row.monthly_payment])
  function commit() {
    const next = val.trim() === '' ? null : Number(val)
    const current = row.monthly_payment != null ? Number(row.monthly_payment) : null
    if (next === current) return
    onCommit(row, val.trim() === '' ? '' : next)
  }
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      placeholder="—"
      className="w-24 px-2 py-1 text-xs font-mono bg-white dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/40 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
    />
  )
}
