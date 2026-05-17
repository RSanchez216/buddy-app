import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { FC, LOAN_STATUSES, STATUS_LABELS, generatePaymentSchedule } from './loanUtils'
import { useToast } from '../../contexts/ToastContext'

const emptyEquipment = () => ({
  unit_number: '', vin: '', equipment_type: '', make: '', model: '', year: '',
  purchase_date: '', purchase_price: '', has_title: false, current_status: 'active', notes: '',
})

const emptyForm = {
  loan_id_external: '', task_name: '', contract_number: '',
  entity_id: '', lender_id: '', funding_account_id: '',
  loan_amount: '', current_balance: '', interest_rate: '', monthly_payment: '',
  due_day: '', autopay: false,
  start_date: '', first_payment_date: '', term_months: '', maturity_date: '',
  maturity_manual_override: false,
  status: 'active', description: '', cfo_flag: false,
}

// Maturity = first_payment_date + (term-1) months. Matches the regenerate
// function's i in 0..(term-1) loop, so last payment row = maturity_date.
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

export default function AddLoanModal({ open, onClose, onCreated }) {
  const { user } = useAuth()
  const toast = useToast()
  const [entities, setEntities] = useState([])
  const [lenders, setLenders] = useState([])
  const [accounts, setAccounts] = useState([])
  const [equipmentTypes, setEquipmentTypes] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [equipmentRows, setEquipmentRows] = useState([emptyEquipment()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(emptyForm); setEquipmentRows([emptyEquipment()]); setError('')
    Promise.all([
      supabase.from('loan_entities').select('id,name').eq('is_active', true).order('name'),
      supabase.from('loan_lenders').select('id,name').eq('is_active', true).order('name'),
      supabase.from('funding_accounts').select('id,name,bank_name,last_four').eq('is_active', true).order('name'),
      supabase.from('equipment_types').select('id, name, display_label, sort_order').eq('is_active', true).order('sort_order').order('display_label'),
    ]).then(([e, l, a, t]) => {
      setEntities(e.data || [])
      setLenders(l.data || [])
      setAccounts(a.data || [])
      setEquipmentTypes(t.data || [])
    })
  }, [open])

  function update(field, value) { setForm(f => ({ ...f, [field]: value })) }
  function updateFirstPaymentDate(value) {
    setForm(f => {
      const next = { ...f, first_payment_date: value }
      if (!f.maturity_manual_override) next.maturity_date = computeMaturity(value, f.term_months) || f.maturity_date
      return next
    })
  }
  function updateTermMonths(value) {
    setForm(f => {
      const next = { ...f, term_months: value }
      if (!f.maturity_manual_override) next.maturity_date = computeMaturity(f.first_payment_date, value) || f.maturity_date
      return next
    })
  }
  function updateMaturityDateManually(value) {
    setForm(f => ({ ...f, maturity_date: value, maturity_manual_override: true }))
  }

  function updateEquipment(i, field, value) {
    setEquipmentRows(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  function addEquipmentRow() { setEquipmentRows(rows => [...rows, emptyEquipment()]) }

  function removeEquipmentRow(i) {
    setEquipmentRows(rows => rows.length === 1 ? rows : rows.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    if (!form.loan_id_external.trim()) return setError('Loan ID is required')
    if (!form.entity_id) return setError('Entity is required')
    if (!form.lender_id) return setError('Lender is required')
    if (!form.funding_account_id) return setError('Funding account is required')

    setSaving(true); setError('')

    const loanPayload = {
      loan_id_external: form.loan_id_external.trim(),
      task_name: form.task_name.trim() || null,
      contract_number: form.contract_number.trim() || null,
      entity_id: form.entity_id,
      lender_id: form.lender_id,
      funding_account_id: form.funding_account_id || null,
      loan_amount: form.loan_amount === '' ? null : Number(form.loan_amount),
      current_balance: form.current_balance === '' ? null : Number(form.current_balance),
      interest_rate: form.interest_rate === '' ? null : Number(form.interest_rate),
      monthly_payment: form.monthly_payment === '' ? null : Number(form.monthly_payment),
      due_day: form.due_day === '' ? null : Number(form.due_day),
      autopay: !!form.autopay,
      start_date: form.start_date || null,
      first_payment_date: form.first_payment_date || null,
      term_months: form.term_months === '' ? null : Number(form.term_months),
      maturity_date: form.maturity_date || null,
      status: form.status,
      description: form.description.trim() || null,
      cfo_flag: !!form.cfo_flag,
      created_by: user?.id || null,
    }

    const loanRes = await supabase.from('loans').insert(loanPayload).select('id').single()
    if (loanRes.error) {
      setError(loanRes.error.message); setSaving(false)
      toast.error("Couldn't create loan", loanRes.error)
      return
    }
    const loanId = loanRes.data.id

    // Insert equipment rows (skip empty ones)
    const eqPayload = equipmentRows
      .filter(r => r.unit_number || r.vin || r.equipment_type || r.make || r.model)
      .map(r => ({
        loan_id: loanId,
        unit_number: r.unit_number.trim() || null,
        vin: r.vin.trim() || null,
        equipment_type: r.equipment_type.trim() || null,
        make: r.make.trim() || null,
        model: r.model.trim() || null,
        year: r.year === '' ? null : Number(r.year),
        purchase_date: r.purchase_date || null,
        purchase_price: r.purchase_price === '' ? null : Number(r.purchase_price),
        has_title: !!r.has_title,
        current_status: r.current_status,
        notes: r.notes.trim() || null,
      }))
    if (eqPayload.length) {
      const eqRes = await supabase.from('loan_equipment').insert(eqPayload)
      if (eqRes.error) {
        setError('Loan saved, but equipment failed: ' + eqRes.error.message); setSaving(false)
        toast.error('Loan saved, but equipment failed', eqRes.error)
        return
      }
    }

    // Auto-generate payment schedule. Prefer the term_months-driven SQL
    // function (idempotent, matches manual Regenerate); fall back to the
    // older client-side generator when term_months isn't set so loans
    // created without a term still get their original schedule shape.
    if (form.term_months !== '' && form.first_payment_date && form.monthly_payment !== '') {
      const { error: rpcErr } = await supabase.rpc('regenerate_loan_schedule', { p_loan_id: loanId })
      if (rpcErr) {
        setError('Loan saved, but schedule generation failed: ' + rpcErr.message); setSaving(false)
        toast.error('Loan saved, but schedule generation failed', rpcErr)
        return
      }
    } else {
      const schedule = generatePaymentSchedule({
        loan_id: loanId,
        first_payment_date: form.first_payment_date,
        maturity_date: form.maturity_date,
        due_day: form.due_day,
        monthly_payment: form.monthly_payment,
      })
      if (schedule.length) {
        const payRes = await supabase.from('loan_payments').insert(schedule)
        if (payRes.error) {
          setError('Loan saved, but payment schedule failed: ' + payRes.error.message); setSaving(false)
          toast.error('Loan saved, but payment schedule failed', payRes.error)
          return
        }
      }
    }

    setSaving(false)
    toast.success(`Loan created — ${loanPayload.loan_id_external}`)
    onCreated?.(loanId)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Loan" size="xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {/* Identity */}
        <Section title="Identity">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Loan ID *">
              <input className={S.input} value={form.loan_id_external} onChange={e => update('loan_id_external', e.target.value)} placeholder="e.g. L-2025-001" />
            </Field>
            <Field label="Task Name">
              <input className={S.input} value={form.task_name} onChange={e => update('task_name', e.target.value)} placeholder="Internal label" />
            </Field>
            <Field label="Contract Number">
              <input className={S.input} value={form.contract_number} onChange={e => update('contract_number', e.target.value)} />
            </Field>
            <Field label="Entity *">
              <Select value={form.entity_id} onChange={e => update('entity_id', e.target.value)}>
                <option value="">Select…</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Lender *">
              <Select value={form.lender_id} onChange={e => update('lender_id', e.target.value)}>
                <option value="">Select…</option>
                {lenders.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Funding account *">
              <Select value={form.funding_account_id} onChange={e => update('funding_account_id', e.target.value)}>
                <option value="">Select…</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.last_four ? ` — ${a.last_four}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        {/* Terms */}
        <Section title="Terms">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Loan Amount ($)">
              <input className={S.input} type="number" step="0.01" value={form.loan_amount} onChange={e => update('loan_amount', e.target.value)} />
            </Field>
            <Field label="Current Balance ($)">
              <input className={S.input} type="number" step="0.01" value={form.current_balance} onChange={e => update('current_balance', e.target.value)} />
            </Field>
            <Field label="Interest Rate (%)">
              <input className={S.input} type="number" step="0.001" value={form.interest_rate} onChange={e => update('interest_rate', e.target.value)} />
            </Field>
            <Field label="Monthly Payment ($)">
              <input className={S.input} type="number" step="0.01" value={form.monthly_payment} onChange={e => update('monthly_payment', e.target.value)} />
            </Field>
            <Field label="Due Day (1-31)">
              <input className={S.input} type="number" min="1" max="31" value={form.due_day} onChange={e => update('due_day', e.target.value)} />
            </Field>
            <Field label="Autopay">
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.autopay} onChange={e => update('autopay', e.target.checked)} className="rounded" />
                <span className="text-sm text-gray-600 dark:text-slate-400">Enabled</span>
              </label>
            </Field>
            <Field label="Start Date">
              <input className={S.input} type="date" value={form.start_date} onChange={e => update('start_date', e.target.value)} />
            </Field>
            <Field label="First Payment Date">
              <input className={S.input} type="date" value={form.first_payment_date} onChange={e => updateFirstPaymentDate(e.target.value)} />
            </Field>
            <Field label="Term (months)">
              <input
                className={S.input}
                type="number"
                min="1"
                max="600"
                value={form.term_months}
                onChange={e => updateTermMonths(e.target.value)}
                placeholder="e.g. 72"
              />
              <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">
                Schedule auto-generates on save.
              </p>
            </Field>
            <Field label="Maturity Date">
              <input
                className={S.input}
                type="date"
                value={form.maturity_date}
                onChange={e => updateMaturityDateManually(e.target.value)}
                title={form.maturity_manual_override
                  ? 'Manually edited — change term to recompute.'
                  : 'Derived from term — edit term to recompute, or type to override.'}
              />
            </Field>
          </div>
        </Section>

        {/* Initial equipment */}
        <Section title="Initial Equipment" subtitle="Optional — add 1+ equipment rows for this loan">
          <div className="space-y-3">
            {equipmentRows.map((r, i) => (
              <div key={i} className="border border-gray-200 dark:border-white/5 rounded-xl p-3 bg-gray-50 dark:bg-white/[0.02]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Equipment {i + 1}</span>
                  {equipmentRows.length > 1 && (
                    <button type="button" onClick={() => removeEquipmentRow(i)} className="text-xs text-red-500 hover:text-red-600">Remove</button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input className={S.input} placeholder="Unit #" value={r.unit_number} onChange={e => updateEquipment(i, 'unit_number', e.target.value)} />
                  <input className={S.input} placeholder="VIN" value={r.vin} onChange={e => updateEquipment(i, 'vin', e.target.value)} />
                  <Select value={r.equipment_type} onChange={e => updateEquipment(i, 'equipment_type', e.target.value)}>
                    <option value="">Type…</option>
                    {equipmentTypes.map(t => <option key={t.id} value={t.name}>{t.display_label || t.name}</option>)}
                  </Select>
                  <input className={S.input} placeholder="Make" value={r.make} onChange={e => updateEquipment(i, 'make', e.target.value)} />
                  <input className={S.input} placeholder="Model" value={r.model} onChange={e => updateEquipment(i, 'model', e.target.value)} />
                  <input className={S.input} type="number" placeholder="Year" value={r.year} onChange={e => updateEquipment(i, 'year', e.target.value)} />
                  <input className={S.input} type="date" placeholder="Purchase Date" value={r.purchase_date} onChange={e => updateEquipment(i, 'purchase_date', e.target.value)} />
                  <input className={S.input} type="number" step="0.01" placeholder="Purchase Price" value={r.purchase_price} onChange={e => updateEquipment(i, 'purchase_price', e.target.value)} />
                  <label className="flex items-center gap-2 px-3">
                    <input type="checkbox" checked={r.has_title} onChange={e => updateEquipment(i, 'has_title', e.target.checked)} className="rounded" />
                    <span className="text-sm text-gray-600 dark:text-slate-400">Has Title</span>
                  </label>
                </div>
                <input className={`${S.input} mt-2`} placeholder="Notes" value={r.notes} onChange={e => updateEquipment(i, 'notes', e.target.value)} />
              </div>
            ))}
            <button type="button" onClick={addEquipmentRow}
              className="w-full py-2 text-sm font-medium text-orange-600 dark:text-orange-400 border border-dashed border-orange-300 dark:border-orange-500/30 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-500/5 transition-colors">
              + Add another equipment row
            </button>
          </div>
        </Section>

        {/* Status */}
        <Section title="Status">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <Select value={form.status} onChange={e => update('status', e.target.value)}>
                {LOAN_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </Select>
            </Field>
            <Field label="CFO Flag">
              <label className="flex items-center gap-2 mt-2">
                <input type="checkbox" checked={form.cfo_flag} onChange={e => update('cfo_flag', e.target.checked)} className="rounded" />
                <span className="text-sm text-gray-600 dark:text-slate-400">Flag for CFO review</span>
              </label>
            </Field>
          </div>
          <Field label="Description / Notes">
            <textarea className={S.textarea} rows={3} value={form.description} onChange={e => update('description', e.target.value)} />
          </Field>
        </Section>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || !form.loan_id_external.trim() || !form.entity_id || !form.lender_id || !form.funding_account_id}
            className={FC.btnSave}
          >
            {saving ? 'Saving…' : 'Add Loan'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-200">{title}</h4>
        {subtitle && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
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
