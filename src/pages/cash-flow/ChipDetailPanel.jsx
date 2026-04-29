import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import { CF, chipPalette, fmtMoney, fmtMoneySigned } from './calendarUtils'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function ChipDetailPanel({ event, onClose, onChange, onOpenAdjustLoan, onOpenManageRecurring }) {
  const [details, setDetails] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!event) { setDetails(null); return }
    setError(''); setEditing(false); loadDetails()
    /* eslint-disable-next-line */
  }, [event?.event_id])

  async function loadDetails() {
    if (!event) return
    const { reference_type, reference_id, event_id } = event
    if (reference_type === 'inflow') {
      const { data } = await supabase.from('expected_inflows')
        .select('*, entity:loan_entities(name)')
        .eq('id', reference_id).maybeSingle()
      setDetails({ kind: 'inflow', row: data })
    } else if (reference_type === 'invoice') {
      const { data } = await supabase.from('invoices')
        .select('id, invoice_number, vendor_id, amount, due_date, planned_pay_date, status, notes, vendor:vendors(name)')
        .eq('id', reference_id).maybeSingle()
      setDetails({ kind: 'invoice', row: data })
    } else if (reference_type === 'custom' || reference_type === 'recurring') {
      const { data } = await supabase.from('custom_outflows')
        .select('*, entity:loan_entities(name), template:recurring_expense_templates(id, name, frequency)')
        .eq('id', reference_id).maybeSingle()
      setDetails({ kind: 'custom_outflow', row: data })
    } else if (reference_type === 'loan') {
      // For loan events, event_id is the loan_payments.id (reference_id is the loan)
      const { data } = await supabase.from('loan_payments')
        .select('*, loan:loans(loan_id_external, contract_number, lender:loan_lenders(name))')
        .eq('id', event_id).maybeSingle()
      setDetails({ kind: 'loan_payment', row: data })
    }
  }

  function startEdit() {
    if (!details) return
    if (details.kind === 'inflow') {
      setForm({
        expected_date: details.row.expected_date || '',
        source: details.row.source || '',
        amount: details.row.amount ?? '',
        description: details.row.description || '',
      })
    } else if (details.kind === 'custom_outflow') {
      setForm({
        due_date: details.row.due_date || '',
        planned_pay_date: details.row.planned_pay_date || '',
        description: details.row.description || '',
        amount: details.row.amount ?? '',
        category: details.row.category || '',
        notes: details.row.notes || '',
      })
    } else if (details.kind === 'invoice') {
      setForm({
        planned_pay_date: details.row.planned_pay_date || '',
        notes: details.row.notes || '',
      })
    }
    setEditing(true)
  }

  async function saveEdit() {
    if (!details) return
    setSaving(true); setError('')
    let res
    if (details.kind === 'inflow') {
      res = await supabase.from('expected_inflows').update({
        expected_date: form.expected_date,
        source: form.source,
        amount: form.amount === '' ? null : Number(form.amount),
        description: form.description || null,
        updated_at: new Date().toISOString(),
      }).eq('id', details.row.id)
    } else if (details.kind === 'custom_outflow') {
      res = await supabase.from('custom_outflows').update({
        due_date: form.due_date,
        planned_pay_date: form.planned_pay_date || null,
        description: form.description,
        amount: form.amount === '' ? null : Number(form.amount),
        category: form.category || null,
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', details.row.id)
    } else if (details.kind === 'invoice') {
      res = await supabase.from('invoices').update({
        planned_pay_date: form.planned_pay_date || null,
        notes: form.notes || null,
      }).eq('id', details.row.id)
    }
    setSaving(false)
    if (res?.error) { setError(res.error.message); return }
    setEditing(false)
    await loadDetails()
    onChange?.()
  }

  async function softCancel() {
    if (!details) return
    if (!confirm('Cancel this event? It will be hidden from the calendar.')) return
    let res
    if (details.kind === 'inflow') {
      res = await supabase.from('expected_inflows').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', details.row.id)
    } else if (details.kind === 'custom_outflow') {
      res = await supabase.from('custom_outflows').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', details.row.id)
    } else {
      alert('Loan payments and invoices can only be cancelled in their own modules.')
      return
    }
    if (res?.error) { alert(res.error.message); return }
    onChange?.()
    onClose?.()
  }

  if (!event) return null

  const palette = chipPalette(event)

  return (
    <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50 pointer-events-auto" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-[#0d0d1f] border-l border-gray-200 dark:border-white/10 shadow-2xl pointer-events-auto overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-100 dark:border-white/5">
          <div className="min-w-0">
            <span className={`inline-block text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${palette.bg} ${palette.text}`}>
              {palette.legend}
            </span>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-2">{event.label || '—'}</h3>
            <p className={`text-sm font-mono font-bold mt-0.5 ${event.direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {fmtMoneySigned(event.amount, event.direction)}
              <span className="text-gray-400 dark:text-slate-500 font-normal ml-2">({fmtMoney(event.amount)})</span>
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
              {fmtDate(event.event_date)}
              {event.entity_name && <span className="ml-2">· {event.entity_name}</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-white shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {error && <div className={S.errorBox}>{error}</div>}
          {!details ? (
            <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
          ) : details.kind === 'inflow' ? (
            <InflowDetail row={details.row} editing={editing} form={form} setForm={setForm} />
          ) : details.kind === 'custom_outflow' ? (
            <CustomDetail row={details.row} editing={editing} form={form} setForm={setForm} onOpenManageRecurring={onOpenManageRecurring} />
          ) : details.kind === 'invoice' ? (
            <InvoiceDetail row={details.row} editing={editing} form={form} setForm={setForm} />
          ) : details.kind === 'loan_payment' ? (
            <LoanPaymentDetail row={details.row} onOpenAdjustLoan={() => onOpenAdjustLoan?.(event)} />
          ) : null}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 bg-white dark:bg-[#0d0d1f] p-4 border-t border-gray-100 dark:border-white/5 flex items-center justify-end gap-2">
          {details?.kind === 'loan_payment' ? (
            <button onClick={() => onOpenAdjustLoan?.(event)} className={CF.btnSave}>Adjust planned date</button>
          ) : editing ? (
            <>
              <button onClick={() => { setEditing(false); setError('') }} className={S.btnCancel}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} className={CF.btnSave}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <>
              {(details?.kind === 'inflow' || details?.kind === 'custom_outflow') && (
                <button onClick={softCancel} className="px-3 py-1.5 text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
                  Cancel event
                </button>
              )}
              {details && (details.kind !== 'loan_payment') && (
                <button onClick={startEdit} className={CF.btnSave}>Edit</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-detail views ───────────────────────────────────────────────────────

function InflowDetail({ row, editing, form, setForm }) {
  if (!row) return <p className="text-gray-500 text-sm">Not found.</p>
  if (editing) {
    return (
      <div className="space-y-3">
        <Field label="Date"><input type="date" className={S.input} value={form.expected_date} onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} /></Field>
        <Field label="Source"><input className={S.input} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} /></Field>
        <Field label="Amount ($)"><input type="number" step="0.01" className={S.input} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></Field>
        <Field label="Description"><textarea className={S.textarea} rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
      </div>
    )
  }
  return (
    <div className="space-y-2 text-sm">
      <Row label="Status" value={<StatusPill status={row.status} />} />
      <Row label="Source" value={row.source || '—'} />
      <Row label="Entity" value={row.entity?.name || '—'} />
      <Row label="Description" value={row.description || '—'} />
      {row.received_date && <Row label="Received" value={`${fmtDate(row.received_date)} · ${fmtMoney(row.received_amount)}`} />}
      <Row label="Source ref" value="expected_inflows" mono muted />
    </div>
  )
}

function CustomDetail({ row, editing, form, setForm, onOpenManageRecurring }) {
  if (!row) return <p className="text-gray-500 text-sm">Not found.</p>
  if (editing) {
    return (
      <div className="space-y-3">
        <Field label="Due date"><input type="date" className={S.input} value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></Field>
        <Field label="Planned pay date"><input type="date" className={S.input} value={form.planned_pay_date} onChange={e => setForm(f => ({ ...f, planned_pay_date: e.target.value }))} /></Field>
        <Field label="Description"><input className={S.input} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
        <Field label="Amount ($)"><input type="number" step="0.01" className={S.input} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></Field>
        <Field label="Category"><input className={S.input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></Field>
        <Field label="Notes"><textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></Field>
      </div>
    )
  }
  return (
    <div className="space-y-2 text-sm">
      <Row label="Status" value={<StatusPill status={row.status} />} />
      <Row label="Description" value={row.description || '—'} />
      <Row label="Category" value={row.category || '—'} />
      <Row label="Entity" value={row.entity?.name || '—'} />
      <Row label="Original due" value={fmtDate(row.due_date)} />
      <Row label="Planned pay" value={row.planned_pay_date ? fmtDate(row.planned_pay_date) : 'Same as due'} muted={!row.planned_pay_date} />
      <Row label="Notes" value={row.notes || '—'} />
      {row.template && (
        <div className="pt-3 mt-3 border-t border-gray-100 dark:border-white/5">
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">↻ Recurring instance from <span className="font-semibold text-gray-700 dark:text-slate-300">{row.template.name}</span> ({row.template.frequency})</p>
          <button onClick={onOpenManageRecurring} className={CF.link}>Manage recurring template →</button>
        </div>
      )}
    </div>
  )
}

function InvoiceDetail({ row, editing, form, setForm }) {
  if (!row) return <p className="text-gray-500 text-sm">Not found.</p>
  if (editing) {
    return (
      <div className="space-y-3">
        <Field label="Planned pay date"><input type="date" className={S.input} value={form.planned_pay_date} onChange={e => setForm(f => ({ ...f, planned_pay_date: e.target.value }))} /></Field>
        <Field label="Notes"><textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></Field>
        <p className="text-xs text-gray-500 dark:text-slate-400">Other fields are managed in the Invoice Inbox module.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2 text-sm">
      <Row label="Status" value={<StatusPill status={row.status} />} />
      <Row label="Invoice #" value={row.invoice_number || '—'} mono />
      <Row label="Vendor" value={row.vendor?.name || '—'} />
      <Row label="Original due" value={fmtDate(row.due_date)} />
      <Row label="Planned pay" value={row.planned_pay_date ? fmtDate(row.planned_pay_date) : 'Same as due'} muted={!row.planned_pay_date} />
      <Row label="Notes" value={row.notes || '—'} />
      <Link to="/invoices" className={`${CF.link} pt-2 inline-block`}>Open in Invoice Inbox →</Link>
    </div>
  )
}

function LoanPaymentDetail({ row, onOpenAdjustLoan }) {
  if (!row) return <p className="text-gray-500 text-sm">Not found.</p>
  return (
    <div className="space-y-2 text-sm">
      <Row label="Status" value={<StatusPill status={row.status} />} />
      <Row label="Lender" value={row.loan?.lender?.name || '—'} />
      <Row label="Loan ID" value={row.loan?.loan_id_external || '—'} mono />
      <Row label="Contract #" value={row.loan?.contract_number || '—'} mono />
      <Row label="Scheduled amount" value={fmtMoney(row.scheduled_amount)} mono bold />
      <Row label="Original due date" value={fmtDate(row.due_date)} />
      <Row label="Planned pay date" value={row.planned_pay_date ? fmtDate(row.planned_pay_date) : 'Same as due date'} muted={!row.planned_pay_date} />
      <div className="pt-2">
        <Link to={`/financial-controls/debt-schedule`} className={CF.link}>Open in Debt Schedule →</Link>
      </div>
    </div>
  )
}

function Row({ label, value, mono, bold, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : ''} ${muted ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-700 dark:text-slate-300'}`}>
        {value}
      </span>
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

function StatusPill({ status }) {
  const colors = {
    pending:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    received:  'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    missed:    'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
    cancelled: 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400',
    planned:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    paid:      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    skipped:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
    partial:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    Pending:   'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    Approved:  'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
    Disputed:  'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
    Paid:      'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  }
  const cls = colors[status] || 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{status || '—'}</span>
}
