import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { FC, PAYMENT_STATUSES, STATUS_LABELS, paymentStatusPill, fmtMoney, fmtDate } from '../loanUtils'

export default function PaymentScheduleTab({ loanId, canEdit }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editRow, setEditRow] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() /* eslint-disable-line */ }, [loanId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('loan_payments').select('*').eq('loan_id', loanId).order('due_date', { ascending: true })
    setRows(data || [])
    setLoading(false)
  }

  async function quickStatus(row, status) {
    if (!canEdit) return
    const patch = {
      status,
      updated_at: new Date().toISOString(),
    }
    if (status === 'paid' && !row.paid_amount) {
      patch.paid_amount = row.scheduled_amount
      patch.paid_date = new Date().toISOString().slice(0, 10)
    }
    await supabase.from('loan_payments').update(patch).eq('id', row.id)
    load()
  }

  function openEdit(row) {
    setEditRow(row)
    setForm({
      due_date: row.due_date || '',
      scheduled_amount: row.scheduled_amount ?? '',
      status: row.status,
      paid_amount: row.paid_amount ?? '',
      paid_date: row.paid_date || '',
      payment_method: row.payment_method || '',
      reference_number: row.reference_number || '',
      notes: row.notes || '',
    })
  }

  async function saveEdit() {
    setSaving(true)
    await supabase.from('loan_payments').update({
      due_date: form.due_date || null,
      scheduled_amount: form.scheduled_amount === '' ? null : Number(form.scheduled_amount),
      status: form.status,
      paid_amount: form.paid_amount === '' ? null : Number(form.paid_amount),
      paid_date: form.paid_date || null,
      payment_method: form.payment_method.trim() || null,
      reference_number: form.reference_number.trim() || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', editRow.id)
    setSaving(false); setEditRow(null); load()
  }

  async function deleteRow(row) {
    if (!confirm(`Delete payment for ${fmtDate(row.due_date)}?`)) return
    await supabase.from('loan_payments').delete().eq('id', row.id)
    load()
  }

  async function addBlankRow() {
    if (!canEdit) return
    const last = rows[rows.length - 1]
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const nextDate = last?.due_date
      ? (() => {
          const d = new Date(`${last.due_date}T00:00:00`); d.setMonth(d.getMonth() + 1)
          return d.toISOString().slice(0, 10)
        })()
      : today.toISOString().slice(0, 10)
    const nextDueMonth = `${nextDate.slice(0, 7)}-01`
    await supabase.from('loan_payments').insert({
      loan_id: loanId,
      due_month: nextDueMonth,
      due_date: nextDate,
      scheduled_amount: last?.scheduled_amount ?? 0,
      status: 'pending',
    })
    load()
  }

  // Running totals
  const totals = useMemo(() => {
    const yearStart = new Date(); yearStart.setMonth(0, 1); yearStart.setHours(0, 0, 0, 0)
    let paidYTD = 0, skippedYTD = 0, remaining = 0
    for (const r of rows) {
      const due = r.due_date ? new Date(`${r.due_date}T00:00:00`) : null
      if (r.status === 'paid' && due >= yearStart) paidYTD += Number(r.paid_amount || r.scheduled_amount || 0)
      if (r.status === 'skipped' && due >= yearStart) skippedYTD += Number(r.scheduled_amount || 0)
      if (r.status === 'pending' || r.status === 'partial') remaining += Number(r.scheduled_amount || 0) - Number(r.paid_amount || 0)
    }
    return { paidYTD, skippedYTD, remaining }
  }, [rows])

  if (loading) return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Paid YTD" value={fmtMoney(totals.paidYTD)} accent="green" />
        <Stat label="Skipped YTD" value={fmtMoney(totals.skippedYTD)} accent="red" />
        <Stat label="Remaining" value={fmtMoney(totals.remaining)} accent="orange" />
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={addBlankRow} className={FC.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Payment Row
          </button>
        </div>
      )}

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Month', 'Due Date', 'Scheduled', 'Status', 'Paid', 'Paid Date', 'Notes', canEdit && ''].filter(h => h !== false).map((h, i) => (
                  <th key={i} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No payments scheduled</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className={S.tableRow}>
                  <td className={`${S.td} text-gray-700 dark:text-slate-300 font-medium whitespace-nowrap`}>
                    {r.due_month ? new Date(`${r.due_month}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(r.due_date)}</td>
                  <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(r.scheduled_amount)}</td>
                  <td className={S.td}>
                    {canEdit ? (
                      <div className="flex gap-1">
                        {PAYMENT_STATUSES.map(s => (
                          <button key={s} onClick={() => quickStatus(r, s)}
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-all ${
                              r.status === s
                                ? paymentStatusPill(s)
                                : 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-white/5 hover:bg-gray-100 dark:hover:bg-white/10'
                            }`}>
                            {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusPill(r.status)}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    )}
                  </td>
                  <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{r.paid_amount != null ? fmtMoney(r.paid_amount) : '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(r.paid_date)}</td>
                  <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400 max-w-[180px] truncate`} title={r.notes || ''}>{r.notes || '—'}</td>
                  {canEdit && (
                    <td className={`${S.td} text-right whitespace-nowrap`}>
                      <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 mr-3" title="Edit">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => deleteRow(r)} className="text-gray-400 hover:text-red-500" title="Delete">
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

      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Payment" size="md">
        {editRow && (
          <div className={S.modalBody}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Due Date">
                <input className={S.input} type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </Field>
              <Field label="Scheduled Amount ($)">
                <input className={S.input} type="number" step="0.01" value={form.scheduled_amount} onChange={e => setForm(f => ({ ...f, scheduled_amount: e.target.value }))} />
              </Field>
              <Field label="Status">
                <select className={S.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </Field>
              <Field label="Paid Amount ($)">
                <input className={S.input} type="number" step="0.01" value={form.paid_amount} onChange={e => setForm(f => ({ ...f, paid_amount: e.target.value }))} />
              </Field>
              <Field label="Paid Date">
                <input className={S.input} type="date" value={form.paid_date} onChange={e => setForm(f => ({ ...f, paid_date: e.target.value }))} />
              </Field>
              <Field label="Payment Method">
                <input className={S.input} value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} />
              </Field>
              <Field label="Reference #">
                <input className={S.input} value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
            <div className={S.modalFooter}>
              <button onClick={() => setEditRow(null)} className={S.btnCancel}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} className={FC.btnSave}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Stat({ label, value, accent }) {
  const colors = {
    green: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
    orange: 'text-orange-600 dark:text-orange-400',
  }
  return (
    <div className={`${S.card} p-4`}>
      <p className="text-[11px] font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${colors[accent]}`}>{value}</p>
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
