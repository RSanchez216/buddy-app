import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import DriverPicker from './DriverPicker'
import VinMatch from './VinMatch'
import { logEvent, diffFields } from '../utils/events'

const PURCHASE_TYPES = [
  { v: 'cash',              l: 'Cash' },
  { v: 'driver_bank_loan',  l: 'Driver Bank Loan' },
]
const FREQUENCIES = [
  { v: 'weekly',   l: 'Weekly' },
  { v: 'biweekly', l: 'Biweekly' },
  { v: 'monthly',  l: 'Monthly' },
]

const TRACKED = [
  'driver_id','entity_id','truck_number','vin','equipment_type','equipment_id','underlying_loan_id',
  'purchase_type','status_id','total_value','downpayment','sale_price','current_balance',
  'payment_amount','payment_frequency','purchase_date','contract_signed_date','fully_paid_date',
  'title_transferred','notes',
]

function emptyForm(defaultStatusId) {
  return {
    driver_id: null, driver: null,
    entity_id: '',
    truck_number: '', vin: '', equipment_type: '',
    equipment_id: null, underlying_loan_id: null, linkedLabel: '',
    purchase_type: 'cash',
    status_id: defaultStatusId || '',
    total_value: '', downpayment: '0', sale_price: '', current_balance: '',
    payment_amount: '', payment_frequency: 'weekly',
    purchase_date: new Date().toISOString().slice(0, 10),
    contract_signed_date: '', fully_paid_date: '',
    title_transferred: false,
    notes: '',
  }
}

// Used for both New and Edit. Pass `purchase` (full row from
// driver_purchases) for edit mode; omit for new.
export default function PurchaseFormModal({ open, onClose, purchase, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!purchase

  const [statuses, setStatuses] = useState([])
  const [entities, setEntities] = useState([])
  const [form, setForm] = useState(() => emptyForm())
  const [originalForm, setOriginalForm] = useState(null)
  const [saving, setSaving] = useState(false)
  // Tracks which derived fields were just autofilled from the linked
  // loan/equipment AND haven't been edited by the user since. Drives
  // the "Auto-filled from linked …" inline hint. Reset on user edit
  // and on unlink (values themselves are preserved in both cases).
  const [autoFilled, setAutoFilled] = useState({ entity_id: false, equipment_type: false })
  const [error, setError] = useState('')

  const defaultStatusId = useMemo(
    () => statuses.find(s => s.name === 'Pending Start')?.id || statuses[0]?.id || '',
    [statuses]
  )

  // Load lookups + populate form on open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function init() {
      const [stRes, enRes] = await Promise.all([
        supabase.from('driver_purchase_statuses').select('id, name, color_hex').order('sort_order'),
        supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name'),
      ])
      if (cancelled) return
      const sts = stRes.data || []
      const ents = enRes.data || []
      setStatuses(sts)
      setEntities(ents)
      const fallbackStatus = sts.find(s => s.name === 'Pending Start')?.id || sts[0]?.id || ''

      if (isEdit && purchase) {
        // Hydrate driver row for the picker display
        const { data: drv } = await supabase
          .from('drivers')
          .select('id, full_name, internal_id, phone')
          .eq('id', purchase.driver_id)
          .maybeSingle()
        const next = {
          driver_id: purchase.driver_id, driver: drv || null,
          entity_id: purchase.entity_id || '',
          truck_number: purchase.truck_number || '',
          vin: purchase.vin || '',
          equipment_type: purchase.equipment_type || '',
          equipment_id: purchase.equipment_id,
          underlying_loan_id: purchase.underlying_loan_id,
          linkedLabel: purchase.equipment_id ? buildLinkedLabel(purchase) : '',
          purchase_type: purchase.purchase_type || 'cash',
          status_id: purchase.status_id || fallbackStatus,
          total_value: purchase.total_value ?? '',
          downpayment: purchase.downpayment ?? '',
          sale_price: purchase.sale_price ?? '',
          current_balance: purchase.current_balance ?? '',
          payment_amount: purchase.payment_amount ?? '',
          payment_frequency: purchase.payment_frequency || 'weekly',
          purchase_date: purchase.purchase_date || '',
          contract_signed_date: purchase.contract_signed_date || '',
          fully_paid_date: purchase.fully_paid_date || '',
          title_transferred: !!purchase.title_transferred,
          notes: purchase.notes || '',
        }

        // Mount-time autofill: if the contract is already linked but a
        // derived field is still empty, fetch the source row(s) and fill.
        // Covers the case where Phase-1 imports established links but
        // never populated entity_id / equipment_type.
        const wantEntity = !next.entity_id && purchase.underlying_loan_id
        const wantEquipType = !next.equipment_type.trim() && purchase.equipment_id
        const flags = { entity_id: false, equipment_type: false }
        if (wantEntity || wantEquipType) {
          const [loanRes, eqRes] = await Promise.all([
            wantEntity
              ? supabase.from('loans').select('entity_id').eq('id', purchase.underlying_loan_id).maybeSingle()
              : Promise.resolve({ data: null }),
            wantEquipType
              ? supabase.from('loan_equipment').select('equipment_type').eq('id', purchase.equipment_id).maybeSingle()
              : Promise.resolve({ data: null }),
          ])
          if (cancelled) return
          if (wantEntity && loanRes?.data?.entity_id) {
            next.entity_id = loanRes.data.entity_id
            flags.entity_id = true
          }
          if (wantEquipType && eqRes?.data?.equipment_type) {
            next.equipment_type = eqRes.data.equipment_type
            flags.equipment_type = true
          }
        }
        setForm(next)
        setOriginalForm(next)
        setAutoFilled(flags)
      } else {
        setForm(emptyForm(fallbackStatus))
        setOriginalForm(null)
        setAutoFilled({ entity_id: false, equipment_type: false })
      }
      setError('')
    }
    init()
    return () => { cancelled = true }
  }, [open, isEdit, purchase])

  // Auto-derive sale_price = total_value - downpayment when user hasn't
  // explicitly set sale_price. We only apply for new mode; in edit we
  // respect whatever's there already.
  useEffect(() => {
    if (isEdit) return
    const tv = parseFloat(form.total_value)
    const dp = parseFloat(form.downpayment)
    if (Number.isFinite(tv)) {
      const sp = (Number.isFinite(dp) ? tv - dp : tv).toFixed(2)
      setForm(f => {
        if (f.sale_price === '' || Number(f.sale_price) === Number(f._lastDerivedSale)) {
          return { ...f, sale_price: sp, _lastDerivedSale: sp, current_balance: f.current_balance === '' ? sp : f.current_balance }
        }
        return f
      })
    }
  }, [form.total_value, form.downpayment, isEdit])

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    // Any manual edit to a derived field hands ownership to the user
    // and removes the autofilled hint.
    if (key === 'entity_id' || key === 'equipment_type') {
      setAutoFilled(a => a[key] ? { ...a, [key]: false } : a)
    }
  }

  function pickDriver(id, drv) { setForm(f => ({ ...f, driver_id: id, driver: drv })) }

  // Establishes the link AND fills derived fields (entity_id,
  // equipment_type) from the linked loan/equipment when the
  // corresponding form field is still empty. Never overwrites a
  // non-empty value — user input always wins.
  function applyLink({ equipmentId, loanId, label, entityId, equipmentType }) {
    setForm(f => {
      const next = { ...f, equipment_id: equipmentId, underlying_loan_id: loanId, linkedLabel: label }
      const filled = {}
      if (entityId && !f.entity_id) { next.entity_id = entityId; filled.entity_id = true }
      if (equipmentType && !(f.equipment_type || '').trim()) {
        next.equipment_type = equipmentType
        filled.equipment_type = true
      }
      if (Object.keys(filled).length) {
        setAutoFilled(a => ({ ...a, ...filled }))
      }
      return next
    })
  }
  // Unlink keeps the values (entity_id / equipment_type) — once filled
  // they belong to the contract. Only the link + hints are cleared.
  function clearLink() {
    setForm(f => ({ ...f, equipment_id: null, underlying_loan_id: null, linkedLabel: '' }))
    setAutoFilled({ entity_id: false, equipment_type: false })
  }

  async function save() {
    if (!form.driver_id) return setError('Driver is required')
    if (!form.purchase_type) return setError('Purchase type is required')
    if (!form.status_id) return setError('Status is required')
    setSaving(true); setError('')

    const payload = {
      driver_id: form.driver_id,
      entity_id: form.entity_id || null,
      truck_number: form.truck_number.trim() || null,
      vin: form.vin.trim() || null,
      equipment_type: form.equipment_type.trim() || null,
      equipment_id: form.equipment_id || null,
      underlying_loan_id: form.underlying_loan_id || null,
      purchase_type: form.purchase_type,
      status_id: form.status_id,
      total_value: numOrNull(form.total_value),
      downpayment: numOrNull(form.downpayment) ?? 0,
      sale_price: numOrNull(form.sale_price),
      current_balance: numOrNull(form.current_balance) ?? 0,
      payment_amount: numOrNull(form.payment_amount),
      payment_frequency: form.payment_frequency || null,
      purchase_date: form.purchase_date || null,
      contract_signed_date: form.contract_signed_date || null,
      fully_paid_date: form.fully_paid_date || null,
      title_transferred: !!form.title_transferred,
      notes: form.notes.trim() || null,
      updated_by: user?.id || null,
    }

    if (isEdit) {
      const { error: e } = await supabase.from('driver_purchases').update(payload).eq('id', purchase.id)
      setSaving(false)
      if (e) { setError(e.message); return }

      // Recording side-effects after update
      const changes = diffFields(originalForm || {}, form, TRACKED)
      const changedKeys = Object.keys(changes).filter(k => k !== 'driver' && k !== 'linkedLabel')
      if (changedKeys.length) {
        // Special-case events
        if (changes.status_id) {
          const oldName = statuses.find(s => s.id === changes.status_id.old)?.name || 'Unknown'
          const newName = statuses.find(s => s.id === changes.status_id.new)?.name || 'Unknown'
          await logEvent(purchase.id, 'status_changed', `Status changed from ${oldName} to ${newName}`,
            { old: oldName, new: newName }, user?.id)
        }
        if (changes.title_transferred && form.title_transferred) {
          await logEvent(purchase.id, 'title_released', 'Title transferred to driver', {}, user?.id)
        }
        if (changes.equipment_id) {
          if (form.equipment_id) {
            await logEvent(purchase.id, 'equipment_linked', `Linked to ${form.linkedLabel || 'equipment'}`,
              { equipment_id: form.equipment_id, loan_id: form.underlying_loan_id }, user?.id)
          } else {
            await logEvent(purchase.id, 'equipment_unlinked', 'Unlinked equipment', {}, user?.id)
          }
        }
        // Generic update event covering remaining changes
        const remaining = changedKeys.filter(k =>
          k !== 'status_id' && k !== 'title_transferred' && k !== 'equipment_id' && k !== 'underlying_loan_id'
        )
        if (remaining.length) {
          await logEvent(purchase.id, 'updated',
            `Updated ${remaining.map(k => prettifyField(k)).join(', ')}`,
            { fields: remaining.reduce((m, k) => ((m[k] = changes[k]), m), {}) },
            user?.id)
        }
      }
      onSaved?.(purchase.id)
      return
    }

    // New
    const { data, error: e } = await supabase
      .from('driver_purchases')
      .insert(payload)
      .select('id')
      .single()
    setSaving(false)
    if (e) { setError(e.message); return }
    await logEvent(data.id, 'created', 'Contract created', {
      driver_id: payload.driver_id,
      purchase_type: payload.purchase_type,
    }, user?.id)
    if (form.equipment_id) {
      await logEvent(data.id, 'equipment_linked', `Linked to ${form.linkedLabel || 'equipment'}`,
        { equipment_id: form.equipment_id, loan_id: form.underlying_loan_id }, user?.id)
    }
    onSaved?.(data.id)
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit driver purchase' : 'New driver purchase'} size="xl">
      <div className={`${S.modalBody} space-y-5`}>
        {error && <div className={S.errorBox}>{error}</div>}

        <Section title="Driver">
          <DriverPicker
            value={form.driver_id}
            driver={form.driver}
            onChange={pickDriver}
          />
        </Section>

        <Section title="Equipment">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Unit number">
              <input className={S.input} value={form.truck_number} onChange={e => set('truck_number', e.target.value)} />
            </Field>
            <Field label="Equipment type">
              <input className={S.input} value={form.equipment_type} onChange={e => set('equipment_type', e.target.value)} placeholder="Truck, Trailer, etc." />
              {autoFilled.equipment_type && (
                <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">Auto-filled from linked equipment</p>
              )}
            </Field>
            <Field label="VIN" wide={false}>
              <input className={S.input} value={form.vin} onChange={e => set('vin', e.target.value)} />
              <VinMatch
                vin={form.vin}
                linked={form.equipment_id ? { label: form.linkedLabel || 'Equipment' } : null}
                onLink={applyLink}
                onUnlink={clearLink}
              />
            </Field>
          </div>
        </Section>

        <Section title="Contract">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Entity">
              <Select value={form.entity_id} onChange={e => set('entity_id', e.target.value)}>
                <option value="">—</option>
                {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
              </Select>
              {autoFilled.entity_id && (
                <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">Auto-filled from linked loan</p>
              )}
            </Field>
            <Field label="Status *">
              <Select value={form.status_id} onChange={e => set('status_id', e.target.value)}>
                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Purchase type *" wide>
              <div className="flex gap-2">
                {PURCHASE_TYPES.map(p => (
                  <label
                    key={p.v}
                    className={`flex-1 px-3 py-2 rounded-xl border cursor-pointer text-sm font-medium text-center transition-colors ${
                      form.purchase_type === p.v
                        ? 'bg-cyan-50 dark:bg-cyan-500/10 border-cyan-300 dark:border-cyan-500/30 text-cyan-700 dark:text-cyan-400'
                        : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <input type="radio" name="ptype" className="hidden" checked={form.purchase_type === p.v}
                      onChange={() => set('purchase_type', p.v)} />
                    {p.l}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Total value">
              <input className={S.input} type="number" step="0.01" value={form.total_value}
                onChange={e => set('total_value', e.target.value)} />
            </Field>
            <Field label="Downpayment">
              <input className={S.input} type="number" step="0.01" value={form.downpayment}
                onChange={e => set('downpayment', e.target.value)} />
            </Field>
            <Field label="Sale price">
              <input className={S.input} type="number" step="0.01" value={form.sale_price}
                onChange={e => set('sale_price', e.target.value)} />
            </Field>
            <Field label="Current balance">
              <input className={S.input} type="number" step="0.01" value={form.current_balance}
                onChange={e => set('current_balance', e.target.value)} />
            </Field>

            <Field label="Payment amount">
              <input className={S.input} type="number" step="0.01" value={form.payment_amount}
                onChange={e => set('payment_amount', e.target.value)} />
            </Field>
            <Field label="Payment frequency">
              <div className="flex gap-2">
                {FREQUENCIES.map(p => (
                  <label
                    key={p.v}
                    className={`flex-1 px-3 py-2 rounded-xl border cursor-pointer text-sm font-medium text-center transition-colors ${
                      form.payment_frequency === p.v
                        ? 'bg-cyan-50 dark:bg-cyan-500/10 border-cyan-300 dark:border-cyan-500/30 text-cyan-700 dark:text-cyan-400'
                        : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    <input type="radio" name="freq" className="hidden" checked={form.payment_frequency === p.v}
                      onChange={() => set('payment_frequency', p.v)} />
                    {p.l}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Purchase date">
              <input className={S.input} type="date" value={form.purchase_date}
                onChange={e => set('purchase_date', e.target.value)} />
            </Field>
            <Field label="Contract signed date">
              <input className={S.input} type="date" value={form.contract_signed_date}
                onChange={e => set('contract_signed_date', e.target.value)} />
            </Field>
            <Field label="Fully paid date">
              <input className={S.input} type="date" value={form.fully_paid_date}
                onChange={e => set('fully_paid_date', e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Optional">
          <Field label="Notes">
            <textarea className={S.textarea} rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
          <div className="flex gap-6 mt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.title_transferred} onChange={e => set('title_transferred', e.target.checked)} className="rounded" />
              <span className="text-sm text-gray-700 dark:text-slate-300">Title transferred</span>
            </label>
          </div>
        </Section>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create purchase'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 border-b border-gray-100 dark:border-white/5 pb-1">
        {title}
      </p>
      {children}
    </div>
  )
}

function Field({ label, children, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}

function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function prettifyField(k) {
  return k.replace(/_/g, ' ')
}

function buildLinkedLabel(p) {
  // best-effort during hydration — full label resolves once VinMatch fetches
  return p.equipment_type || p.truck_number || 'Equipment'
}
