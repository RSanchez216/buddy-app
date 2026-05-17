import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { FC } from '../loanUtils'
import LoanBalanceEditModal from '../components/LoanBalanceEditModal'
import { useToast } from '../../../contexts/ToastContext'

export default function OverviewTab({ loan, canEdit, onChange }) {
  const { user } = useAuth()
  const toast = useToast()
  const [entities, setEntities] = useState([])
  const [lenders, setLenders] = useState([])
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [pendingEvent, setPendingEvent] = useState(null) // { type, oldVal, newVal }
  const [eventDescription, setEventDescription] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const [showBalanceEdit, setShowBalanceEdit] = useState(false)

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
      interest_rate: loan.interest_rate ?? '',
      monthly_payment: loan.monthly_payment ?? '',
      due_day: loan.due_day ?? '',
      autopay: !!loan.autopay,
      start_date: loan.start_date || '',
      first_payment_date: loan.first_payment_date || '',
      term_months: loan.term_months ?? '',
      maturity_date: loan.maturity_date || '',
      maturity_manual_override: false,
      status: loan.status || 'active',
      cfo_flag: !!loan.cfo_flag,
    })
  }, [loan])

  // Maturity derivation: when first_payment_date AND term_months are set and
  // the user hasn't manually overridden the date, recompute as
  // first_payment_date + (term-1) months. Matches the regenerate function's
  // i in 0..(term-1) loop convention.
  function computeMaturity(firstPaymentDate, termMonths) {
    if (!firstPaymentDate || !termMonths) return ''
    const n = Number(termMonths)
    if (!Number.isFinite(n) || n <= 0) return ''
    const d = new Date(`${firstPaymentDate}T00:00:00`)
    if (Number.isNaN(d.getTime())) return ''
    d.setMonth(d.getMonth() + (n - 1))
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  if (!form) return null

  function update(field, value) { setForm(f => ({ ...f, [field]: value })) }

  // When first_payment_date or term_months changes, recompute maturity_date
  // unless the user has manually edited the maturity field this session.
  function updateFirstPaymentDate(value) {
    setForm(f => {
      const next = { ...f, first_payment_date: value }
      if (!f.maturity_manual_override) {
        next.maturity_date = computeMaturity(value, f.term_months) || f.maturity_date
      }
      return next
    })
  }
  function updateTermMonths(value) {
    setForm(f => {
      const next = { ...f, term_months: value }
      if (!f.maturity_manual_override) {
        next.maturity_date = computeMaturity(f.first_payment_date, value) || f.maturity_date
      }
      return next
    })
  }
  function updateMaturityDateManually(value) {
    setForm(f => ({ ...f, maturity_date: value, maturity_manual_override: true }))
  }

  async function handleSave() {
    // Block save when funding_account_id is empty. Spec rule: UI
    // enforcement only (DB stays nullable for webhook intake paths).
    // The asterisk on the label is silent until the user actually
    // tries to save — avoids accusing the user the moment they open
    // an edit form on a legacy NULL row.
    if (!form.funding_account_id) {
      setError('Funding account is required')
      return
    }
    setSaving(true); setError('')

    const payload = {
      loan_id_external: form.loan_id_external.trim() || null,
      task_name: form.task_name.trim() || null,
      contract_number: form.contract_number.trim() || null,
      entity_id: form.entity_id || null,
      lender_id: form.lender_id || null,
      funding_account_id: form.funding_account_id || null,
      loan_amount: form.loan_amount === '' ? null : Number(form.loan_amount),
      interest_rate: form.interest_rate === '' ? null : Number(form.interest_rate),
      monthly_payment: form.monthly_payment === '' ? null : Number(form.monthly_payment),
      due_day: form.due_day === '' ? null : Number(form.due_day),
      autopay: !!form.autopay,
      start_date: form.start_date || null,
      first_payment_date: form.first_payment_date || null,
      term_months: form.term_months === '' ? null : Number(form.term_months),
      maturity_date: form.maturity_date || null,
      status: form.status,
      cfo_flag: !!form.cfo_flag,
      updated_at: new Date().toISOString(),
    }

    // Balance changes flow through the dedicated Edit Balance modal (with
    // anchor date + audit log). Save Changes here only logs an event for
    // interest-rate changes.
    const rateChanged = Number(loan.interest_rate ?? 0) !== Number(payload.interest_rate ?? 0) && payload.interest_rate !== null

    const { error: updErr } = await supabase.from('loans').update(payload).eq('id', loan.id)
    if (updErr) {
      setError(updErr.message); setSaving(false)
      toast.error("Couldn't update loan", updErr)
      return
    }
    setSaving(false)
    toast.success(`Loan updated — ${payload.loan_id_external || loan.loan_id_external || 'changes saved'}`)

    if (rateChanged) {
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
    if (evErr) { toast.error('Loan saved, but event log failed', evErr); return }
    toast.success('Event logged')
    setShowSuccess(true); setTimeout(() => setShowSuccess(false), 2000)
  }

  function dismissEvent() { setPendingEvent(null); setEventDescription('') }

  async function markPaidOff() {
    const { error: err } = await supabase.from('loans').update({
      status: 'paid_off',
      updated_at: new Date().toISOString(),
    }).eq('id', loan.id)
    if (err) { toast.error("Couldn't mark loan paid off", err); return }
    toast.success('Loan marked paid off')
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
          <Field label="Funding account *">
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
          <div className="md:col-span-2">
            <LoanBalanceBlock loan={loan} canEdit={canEdit} onEdit={() => setShowBalanceEdit(true)} />
          </div>
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
            <div className="mt-2 space-y-1.5">
              <label className="flex items-center gap-2">
                <input type="checkbox" disabled={!canEdit} checked={form.autopay} onChange={e => update('autopay', e.target.checked)} className="rounded" />
                <span className="text-sm text-gray-600 dark:text-slate-400">Enabled</span>
              </label>
              <label className="flex items-center gap-2" title="Flag this loan for CFO review">
                <input type="checkbox" disabled={!canEdit} checked={form.cfo_flag} onChange={e => update('cfo_flag', e.target.checked)} className="rounded" />
                <span className="text-sm text-gray-600 dark:text-slate-400">CFO Flag</span>
              </label>
            </div>
          </Field>
          <Field label="Start Date">
            <input className={S.input} type="date" disabled={!canEdit} value={form.start_date} onChange={e => update('start_date', e.target.value)} />
          </Field>
          <Field label="First Payment Date">
            <input className={S.input} type="date" disabled={!canEdit} value={form.first_payment_date} onChange={e => updateFirstPaymentDate(e.target.value)} />
          </Field>
          <Field label="Term (months)">
            <input
              className={S.input}
              type="number"
              min="1"
              max="600"
              disabled={!canEdit}
              value={form.term_months}
              onChange={e => updateTermMonths(e.target.value)}
              placeholder="e.g. 72"
            />
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">
              Total number of monthly payments. Maturity date calculated automatically.
            </p>
          </Field>
          <Field label="Maturity Date">
            <input
              className={S.input}
              type="date"
              disabled={!canEdit}
              value={form.maturity_date}
              onChange={e => updateMaturityDateManually(e.target.value)}
              title={form.maturity_manual_override
                ? 'Manually edited — change term to recompute.'
                : 'Derived from term — edit term to recompute, or type to override.'}
            />
          </Field>
        </Grid>
      </Section>

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={handleSave} disabled={saving || !form.funding_account_id} className={FC.btnSave}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}

      <LoanBalanceEditModal
        open={showBalanceEdit}
        loan={loan}
        onClose={() => setShowBalanceEdit(false)}
        onSaved={() => { setShowBalanceEdit(false); onChange?.() }}
      />

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

// ── Balance helpers ─────────────────────────────────────────────────────
function fmtMoney(n) {
  if (n == null || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function chicagoTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function daysSince(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  const today = new Date(`${chicagoTodayISO()}T00:00:00`)
  return Math.max(0, Math.floor((today - d) / 86_400_000))
}

// Full months elapsed since the anchor (America/Chicago today). 1 if the
// anchor was exactly one calendar month ago today. Used for the estimated
// balance and the "N payments elapsed" subtitle.
function monthsElapsed(iso) {
  if (!iso) return 0
  const anchor = new Date(`${iso}T00:00:00`)
  const today = new Date(`${chicagoTodayISO()}T00:00:00`)
  if (today < anchor) return 0
  let m = (today.getFullYear() - anchor.getFullYear()) * 12 + (today.getMonth() - anchor.getMonth())
  if (today.getDate() < anchor.getDate()) m -= 1
  return Math.max(0, m)
}

// Loan-specific staleness tiers (slower cadence than funding accounts):
//   0d → green, 1-7 neutral, 8-30 amber, 31+ red.
function loanBalanceTone(days) {
  if (days == null)    return { dot: 'bg-gray-300 dark:bg-slate-600', text: 'text-gray-500 dark:text-slate-500', label: 'No anchor — set balance' }
  if (days === 0)      return { dot: 'bg-emerald-500',                text: 'text-emerald-700 dark:text-emerald-400', label: '0d old' }
  if (days <= 7)       return { dot: 'bg-slate-400 dark:bg-slate-500', text: 'text-slate-500 dark:text-slate-400',    label: `${days}d old` }
  if (days <= 30)      return { dot: 'bg-amber-500',                  text: 'text-amber-700 dark:text-amber-400',    label: `${days}d old` }
  return                  { dot: 'bg-rose-500',                       text: 'text-rose-700 dark:text-rose-400',      label: `${days}d old` }
}

function fmtAnchorDate(iso) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function LoanBalanceBlock({ loan, canEdit, onEdit }) {
  const anchor = loan?.current_balance != null ? Number(loan.current_balance) : null
  const asOf = loan?.current_balance_as_of_date || null
  const monthly = loan?.monthly_payment != null ? Number(loan.monthly_payment) : null

  const days = daysSince(asOf)
  const tone = loanBalanceTone(days)
  const months = monthsElapsed(asOf)
  const estimated = anchor != null && monthly != null
    ? Math.max(0, anchor - monthly * months)
    : anchor

  const delta = estimated != null && anchor != null ? estimated - anchor : 0

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Last confirmed */}
      <div>
        <div className="flex items-baseline justify-between">
          <label className={S.label}>Last Confirmed</label>
          {canEdit && (
            <button onClick={onEdit} className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline">
              {anchor != null ? 'Edit' : 'Set balance'}
            </button>
          )}
        </div>
        <p className="text-base font-mono font-bold text-gray-900 dark:text-slate-200">
          {anchor != null ? fmtMoney(anchor) : <span className="text-gray-400 dark:text-slate-600">—</span>}
        </p>
        <div className={`text-[11px] mt-0.5 inline-flex items-center gap-1.5 ${tone.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
          {asOf
            ? <>as of {fmtAnchorDate(asOf)} · {tone.label}</>
            : tone.label}
        </div>
      </div>

      {/* Estimated today */}
      <div>
        <label className={S.label}>Estimated Today</label>
        {anchor == null ? (
          <p className="text-base font-mono font-bold text-gray-400 dark:text-slate-600">—</p>
        ) : monthly == null ? (
          <>
            <p className="text-base font-mono font-bold text-gray-900 dark:text-slate-200">{fmtMoney(anchor)}</p>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-0.5 italic">monthly payment not set</p>
          </>
        ) : (
          <>
            <p className="text-base font-mono font-bold text-gray-900 dark:text-slate-200">{fmtMoney(estimated)}</p>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-0.5">
              {months === 0
                ? 'matches confirmed (anchor is today’s month)'
                : <>{months} payment{months === 1 ? '' : 's'} elapsed · {delta < 0 ? '−' : ''}{fmtMoney(Math.abs(delta))} from confirmed</>}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
