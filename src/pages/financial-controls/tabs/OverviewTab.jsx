import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { FC, LOAN_STATUSES, STATUS_LABELS } from '../loanUtils'

export default function OverviewTab({ loan, canEdit, onChange }) {
  const { user } = useAuth()
  const [entities, setEntities] = useState([])
  const [lenders, setLenders] = useState([])
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingEvent, setPendingEvent] = useState(null) // { type, oldVal, newVal }
  const [eventDescription, setEventDescription] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name'),
      supabase.from('loan_lenders').select('id, name').eq('is_active', true).order('name'),
      supabase.from('funding_accounts').select('id, name, last_four').eq('is_active', true).order('name'),
    ]).then(([e, l, a]) => {
      setEntities(e.data || [])
      setLenders(l.data || [])
      setAccounts(a.data || [])
    })
  }, [])

  useEffect(() => {
    setForm({
      loan_id_external: loan.loan_id_external || '',
      task_name: loan.task_name || '',
      contract_number: loan.contract_number || '',
      entity_id: loan.entity_id || '',
      lender_id: loan.lender_id || '',
      funding_account_id: loan.funding_account_id || '',
      loan_amount: loan.loan_amount ?? '',
      current_balance: loan.current_balance ?? '',
      interest_rate: loan.interest_rate ?? '',
      monthly_payment: loan.monthly_payment ?? '',
      due_day: loan.due_day ?? '',
      autopay: !!loan.autopay,
      start_date: loan.start_date || '',
      first_payment_date: loan.first_payment_date || '',
      maturity_date: loan.maturity_date || '',
      status: loan.status || 'active',
      payment_status_notes: loan.payment_status_notes || '',
      cfo_flag: !!loan.cfo_flag,
    })
  }, [loan])

  if (!form) return null

  function update(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSave() {
    setSaving(true); setError('')

    const payload = {
      loan_id_external: form.loan_id_external.trim() || null,
      task_name: form.task_name.trim() || null,
      contract_number: form.contract_number.trim() || null,
      entity_id: form.entity_id || null,
      lender_id: form.lender_id || null,
      funding_account_id: form.funding_account_id || null,
      loan_amount: form.loan_amount === '' ? null : Number(form.loan_amount),
      current_balance: form.current_balance === '' ? null : Number(form.current_balance),
      interest_rate: form.interest_rate === '' ? null : Number(form.interest_rate),
      monthly_payment: form.monthly_payment === '' ? null : Number(form.monthly_payment),
      due_day: form.due_day === '' ? null : Number(form.due_day),
      autopay: !!form.autopay,
      start_date: form.start_date || null,
      first_payment_date: form.first_payment_date || null,
      maturity_date: form.maturity_date || null,
      status: form.status,
      payment_status_notes: form.payment_status_notes.trim() || null,
      cfo_flag: !!form.cfo_flag,
      updated_at: new Date().toISOString(),
    }

    // Detect changes that warrant a logged event
    const balanceChanged = Number(loan.current_balance ?? 0) !== Number(payload.current_balance ?? 0) && payload.current_balance !== null
    const rateChanged = Number(loan.interest_rate ?? 0) !== Number(payload.interest_rate ?? 0) && payload.interest_rate !== null

    const { error: updErr } = await supabase.from('loans').update(payload).eq('id', loan.id)
    if (updErr) { setError(updErr.message); setSaving(false); return }
    setSaving(false)

    if (balanceChanged) {
      setPendingEvent({ type: 'balance_correction', oldVal: loan.current_balance, newVal: payload.current_balance })
      setEventDescription(`Balance changed from ${loan.current_balance ?? '—'} to ${payload.current_balance}`)
    } else if (rateChanged) {
      setPendingEvent({ type: 'rate_change', oldVal: loan.interest_rate, newVal: payload.interest_rate })
      setEventDescription(`Rate changed from ${loan.interest_rate ?? '—'}% to ${payload.interest_rate}%`)
    } else {
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 2000)
    }
    onChange?.()
  }

  async function confirmEvent() {
    if (!pendingEvent) return
    const today = new Date().toISOString().slice(0, 10)
    const { error: evErr } = await supabase.from('loan_events').insert({
      loan_id: loan.id,
      event_date: today,
      event_type: pendingEvent.type,
      amount: pendingEvent.newVal,
      description: eventDescription,
      created_by: user?.id || null,
    })
    setPendingEvent(null); setEventDescription('')
    if (evErr) { alert('Loan saved, but event log failed: ' + evErr.message); return }
    setShowSuccess(true); setTimeout(() => setShowSuccess(false), 2000)
  }

  function dismissEvent() { setPendingEvent(null); setEventDescription('') }

  async function markPaidOff() {
    const { error: err } = await supabase.from('loans').update({
      status: 'paid_off',
      updated_at: new Date().toISOString(),
    }).eq('id', loan.id)
    if (err) { alert('Failed: ' + err.message); return }
    onChange?.()
  }

  const showPaidOffBanner = Number(loan.current_balance) === 0 && loan.status !== 'paid_off'

  return (
    <div className="space-y-5">
      {showSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl text-emerald-700 dark:text-emerald-400 text-sm">
          Loan saved successfully.
        </div>
      )}

      {showPaidOffBanner && (
        <div className="p-4 bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 rounded-xl flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-cyan-700 dark:text-cyan-400">Balance is $0.00</p>
            <p className="text-xs text-cyan-600/80 dark:text-cyan-400/70 mt-0.5">This loan looks paid off — mark its status?</p>
          </div>
          {canEdit && (
            <button onClick={markPaidOff} className="px-3 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg transition-colors">
              Mark as Paid Off
            </button>
          )}
        </div>
      )}

      {error && <div className={S.errorBox}>{error}</div>}

      <Section title="Identity">
        <Grid>
          <Field label="Loan ID">
            <input className={S.input} disabled={!canEdit} value={form.loan_id_external} onChange={e => update('loan_id_external', e.target.value)} />
          </Field>
          <Field label="Task Name">
            <input className={S.input} disabled={!canEdit} value={form.task_name} onChange={e => update('task_name', e.target.value)} />
          </Field>
          <Field label="Contract Number">
            <input className={S.input} disabled={!canEdit} value={form.contract_number} onChange={e => update('contract_number', e.target.value)} />
          </Field>
          <Field label="Entity">
            <Select value={form.entity_id} onChange={e => update('entity_id', e.target.value)} disabled={!canEdit}>
              <option value="">Select…</option>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <Field label="Lender">
            <Select value={form.lender_id} onChange={e => update('lender_id', e.target.value)} disabled={!canEdit}>
              <option value="">Select…</option>
              {lenders.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Funding Account">
            <Select value={form.funding_account_id} onChange={e => update('funding_account_id', e.target.value)} disabled={!canEdit}>
              <option value="">Select…</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}{a.last_four ? ` — ${a.last_four}` : ''}</option>
              ))}
            </Select>
          </Field>
        </Grid>
      </Section>

      <Section title="Terms">
        <Grid>
          <Field label="Loan Amount ($)">
            <input className={S.input} type="number" step="0.01" disabled={!canEdit} value={form.loan_amount} onChange={e => update('loan_amount', e.target.value)} />
          </Field>
          <Field label="Current Balance ($)">
            <input className={S.input} type="number" step="0.01" disabled={!canEdit} value={form.current_balance} onChange={e => update('current_balance', e.target.value)} />
          </Field>
          <Field label="Interest Rate (%)">
            <input className={S.input} type="number" step="0.001" disabled={!canEdit} value={form.interest_rate} onChange={e => update('interest_rate', e.target.value)} />
          </Field>
          <Field label="Monthly Payment ($)">
            <input className={S.input} type="number" step="0.01" disabled={!canEdit} value={form.monthly_payment} onChange={e => update('monthly_payment', e.target.value)} />
          </Field>
          <Field label="Due Day (1-31)">
            <input className={S.input} type="number" min="1" max="31" disabled={!canEdit} value={form.due_day} onChange={e => update('due_day', e.target.value)} />
          </Field>
          <Field label="Autopay">
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" disabled={!canEdit} checked={form.autopay} onChange={e => update('autopay', e.target.checked)} className="rounded" />
              <span className="text-sm text-gray-600 dark:text-slate-400">Enabled</span>
            </label>
          </Field>
          <Field label="Start Date">
            <input className={S.input} type="date" disabled={!canEdit} value={form.start_date} onChange={e => update('start_date', e.target.value)} />
          </Field>
          <Field label="First Payment Date">
            <input className={S.input} type="date" disabled={!canEdit} value={form.first_payment_date} onChange={e => update('first_payment_date', e.target.value)} />
          </Field>
          <Field label="Maturity Date">
            <input className={S.input} type="date" disabled={!canEdit} value={form.maturity_date} onChange={e => update('maturity_date', e.target.value)} />
          </Field>
        </Grid>
      </Section>

      <Section title="Status">
        <Grid>
          <Field label="Status">
            <Select value={form.status} onChange={e => update('status', e.target.value)} disabled={!canEdit}>
              {LOAN_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label="CFO Flag">
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" disabled={!canEdit} checked={form.cfo_flag} onChange={e => update('cfo_flag', e.target.checked)} className="rounded" />
              <span className="text-sm text-gray-600 dark:text-slate-400">Flag for CFO review</span>
            </label>
          </Field>
        </Grid>
        <Field label="Payment Status Notes">
          <input className={S.input} disabled={!canEdit} value={form.payment_status_notes} onChange={e => update('payment_status_notes', e.target.value)} />
        </Field>
      </Section>

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving} className={FC.btnSave}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Confirm event modal */}
      <Modal open={!!pendingEvent} onClose={dismissEvent} title="Log this change as an event?" size="sm">
        <div className={S.modalBody}>
          <p className="text-sm text-gray-600 dark:text-slate-400">
            We can record this as a {pendingEvent?.type === 'balance_correction' ? 'balance correction' : 'rate change'} event in the loan's audit trail.
          </p>
          <div>
            <label className={S.label}>Description</label>
            <textarea className={S.textarea} rows={3} value={eventDescription} onChange={e => setEventDescription(e.target.value)} />
          </div>
          <div className={S.modalFooter}>
            <button onClick={dismissEvent} className={S.btnCancel}>Skip</button>
            <button onClick={confirmEvent} className={FC.btnSave}>Log Event</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className={`${S.card} p-5 space-y-4`}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-200 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  )
}

function Grid({ children }) {
  return <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{children}</div>
}

function Field({ label, children }) {
  return (
    <div>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}
