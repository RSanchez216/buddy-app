import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import ComboBox from '../../components/ComboBox'
import { DRIVER_TYPES, DRIVER_STATUSES, terminationFields } from './fleetUtils'
import { useToast } from '../../contexts/ToastContext'
import PhotoUploadField from './PhotoUploadField'

// Add / edit modal for a single driver. UNIQUE(internal_id) is enforced by
// the DB partial index; we surface a friendly error on the conflict.
//
// Carrier options come from public.carriers (managed in Settings ->
// Carriers). The hardcoded list was removed; an existing value not in
// the active list is pinned at the top of the picker as "(legacy)" so
// re-saving the form doesn't blank the field.

const COMPENSATION_TYPES = [
  { value: '',                   label: '— None —' },
  { value: 'service_charge_pct', label: 'Service Charge %' },
  { value: 'rate_pct',           label: 'Rate %' },
  { value: 'rate_per_mile',      label: '$ / mile' },
]

const empty = {
  internal_id: '', full_name: '', phone: '', email: '',
  driver_type: '', carrier: '',
  truck_assignment_raw: '', trailer_assignment_raw: '',
  compensation_raw: '', compensation_type: '', compensation_value: '',
  referred_by: '', temporary_license: false, missing_op: '',
  onboarded_at: '', current_status: 'active', terminated_at: '', termination_reason: '', notes: '',
}

export default function DriverFormModal({ open, editItem, onClose, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState(empty)
  const [carriers, setCarriers] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    // Active carriers from the reference table. Fire-and-forget — the
    // ComboBox falls back to a "(legacy)" pin for the current value if
    // this hasn't returned yet by the time the user opens it.
    supabase.from('carriers').select('id, name, is_active').eq('is_active', true).order('name')
      .then(({ data }) => setCarriers(data || []))
    if (editItem) {
      setForm({
        internal_id: editItem.internal_id || '',
        full_name: editItem.full_name || '',
        phone: editItem.phone || '',
        email: editItem.email || '',
        driver_type: editItem.driver_type || '',
        carrier: editItem.carrier || '',
        truck_assignment_raw: editItem.truck_assignment_raw || '',
        trailer_assignment_raw: editItem.trailer_assignment_raw || '',
        compensation_raw: editItem.compensation_raw || '',
        compensation_type: editItem.compensation_type || '',
        compensation_value: editItem.compensation_value ?? '',
        referred_by: editItem.referred_by || '',
        temporary_license: !!editItem.temporary_license,
        missing_op: editItem.missing_op || '',
        onboarded_at: editItem.onboarded_at || '',
        current_status: editItem.current_status || 'active',
        terminated_at: editItem.terminated_at || '',
        termination_reason: editItem.termination_reason || '',
        notes: editItem.notes || '',
      })
    } else {
      setForm(empty)
    }
  }, [open, editItem])

  async function save() {
    if (!form.full_name.trim()) { setError('Full name is required.'); return }
    setSaving(true); setError('')
    const payload = {
      internal_id: form.internal_id.trim() || null,
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      driver_type: form.driver_type || null,
      carrier: form.carrier || null,
      truck_assignment_raw: form.truck_assignment_raw.trim() || null,
      trailer_assignment_raw: form.trailer_assignment_raw.trim() || null,
      compensation_raw: form.compensation_raw.trim() || null,
      compensation_type: form.compensation_type || null,
      compensation_value: form.compensation_value === '' ? null : Number(form.compensation_value),
      referred_by: form.referred_by.trim() || null,
      temporary_license: !!form.temporary_license,
      missing_op: form.missing_op.trim() || null,
      onboarded_at: form.onboarded_at || null,
      current_status: form.current_status || 'active',
      ...terminationFields(form.current_status, form.terminated_at, form.termination_reason),
      notes: form.notes.trim() || null,
      updated_by: user?.id || null,
    }
    if (!editItem) payload.created_by = user?.id || null
    // Stamp the status change time so terminated_at / status_changed_at stay in
    // step (there's no DB trigger for this).
    if (editItem && editItem.current_status !== payload.current_status) {
      payload.status_changed_at = new Date().toISOString()
    }

    let res
    if (editItem) {
      res = await supabase.from('drivers').update(payload).eq('id', editItem.id).select('id').single()
    } else {
      res = await supabase.from('drivers').insert(payload).select('id').single()
    }
    if (res.error || !res.data) {
      setSaving(false)
      const msg = res.error?.message?.match(/duplicate.*internal_id|unique.*internal_id/i)
        ? `A driver with internal_id "${form.internal_id}" already exists.`
        : (res.error?.message || 'Save failed')
      setError(msg)
      toast.error(editItem ? "Couldn't update driver" : "Couldn't create driver", msg)
      return
    }

    // Initial status-history row on insert when explicit non-active status.
    if (!editItem && payload.current_status && payload.current_status !== 'active') {
      await supabase.from('driver_status_history').insert({
        driver_id: res.data.id,
        from_status: null,
        to_status: payload.current_status,
        reason: 'Initial classification',
        created_by: user?.id || null,
      })
    }
    // On edit: if status changed, log it.
    if (editItem && editItem.current_status !== payload.current_status) {
      await supabase.from('driver_status_history').insert({
        driver_id: editItem.id,
        from_status: editItem.current_status,
        to_status: payload.current_status,
        reason: 'Manual status change via Edit',
        created_by: user?.id || null,
      })
    }

    // Carrier cascade: a unit's carrier must always equal its current
    // driver's carrier. If the driver's carrier changed (or this is a
    // fresh insert with a carrier set), re-run the resolver so every
    // truck/trailer currently assigned to this driver picks up the new
    // carrier. No-op when nothing changed.
    const carrierChanged = !editItem || editItem.carrier !== payload.carrier
    if (carrierChanged && payload.carrier) {
      const { error: rpcErr } = await supabase.rpc('resolve_current_equipment_drivers')
      if (rpcErr) {
        console.warn('[DriverFormModal] carrier cascade failed', rpcErr)
      }
    }

    setSaving(false)
    toast.success(editItem ? `Driver updated — ${payload.full_name}` : `Driver added — ${payload.full_name}`)
    onSaved?.(res.data.id)
    onClose?.()
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title={editItem ? 'Edit Driver' : 'Add Driver'} size="lg">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Internal ID">
            <input className={`${S.input} font-mono`} value={form.internal_id} onChange={e => setForm(f => ({ ...f, internal_id: e.target.value.trim() }))} placeholder="e.g. 2066" />
          </Field>
          <Field label="Full Name *">
            <input className={S.input} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone">
            <input className={S.input} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Email">
            <input className={S.input} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Driver Type">
            <Select value={form.driver_type} onChange={e => setForm(f => ({ ...f, driver_type: e.target.value }))}>
              <option value="">— Select —</option>
              {DRIVER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Carrier">
            <ComboBox
              options={[
                ...carriers.map(c => ({ id: c.name, name: c.name })),
                ...(form.carrier && !carriers.some(c => c.name === form.carrier)
                  ? [{ id: form.carrier, name: `${form.carrier} (legacy)` }]
                  : []),
              ]}
              value={form.carrier}
              onChange={id => setForm(f => ({ ...f, carrier: id }))}
              placeholder="— Select carrier —"
              searchPlaceholder="Search carriers…"
              noResultsLabel="No carrier matches (add one in Settings → Carriers)"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Truck Assignment (unit #)">
            <input className={S.input} value={form.truck_assignment_raw} onChange={e => setForm(f => ({ ...f, truck_assignment_raw: e.target.value }))} placeholder="e.g. 17034" />
          </Field>
          <Field label="Trailer Assignment (unit #)">
            <input className={S.input} value={form.trailer_assignment_raw} onChange={e => setForm(f => ({ ...f, trailer_assignment_raw: e.target.value }))} placeholder="e.g. 5589" />
          </Field>
        </div>

        <Field label="Compensation (raw)">
          <input className={S.input} value={form.compensation_raw} onChange={e => setForm(f => ({ ...f, compensation_raw: e.target.value }))} placeholder='e.g. "12% SERVICE CHARGE" or "$0.65 RATE"' />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Compensation Type (parsed)">
            <Select value={form.compensation_type} onChange={e => setForm(f => ({ ...f, compensation_type: e.target.value }))}>
              {COMPENSATION_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Compensation Value (parsed)">
            <input type="number" step="0.0001" className={S.input} value={form.compensation_value} onChange={e => setForm(f => ({ ...f, compensation_value: e.target.value }))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Onboarded">
            <input type="date" className={S.input} value={form.onboarded_at} onChange={e => setForm(f => ({ ...f, onboarded_at: e.target.value }))} />
          </Field>
          <Field label="Status">
            <Select value={form.current_status} onChange={e => setForm(f => ({ ...f, current_status: e.target.value }))}>
              {DRIVER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
        </div>

        {form.current_status === 'terminated' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Termination Date">
              <input type="date" className={S.input} value={form.terminated_at} onChange={e => setForm(f => ({ ...f, terminated_at: e.target.value }))} />
            </Field>
            <Field label="Termination Reason">
              <input className={S.input} value={form.termination_reason} onChange={e => setForm(f => ({ ...f, termination_reason: e.target.value }))} placeholder="e.g. Voluntary resignation" />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Referred By">
            <input className={S.input} value={form.referred_by} onChange={e => setForm(f => ({ ...f, referred_by: e.target.value }))} />
          </Field>
          <Field label="Missing OP">
            <input className={S.input} value={form.missing_op} onChange={e => setForm(f => ({ ...f, missing_op: e.target.value }))} placeholder="Missing operating paperwork details" />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400">
          <input type="checkbox" checked={!!form.temporary_license} onChange={e => setForm(f => ({ ...f, temporary_license: e.target.checked }))} className="rounded" />
          Temporary license
        </label>

        {editItem && <PhotoUploadField driverId={editItem.id} currentPhotoPath={editItem.photo_path} onPhotoUpdated={() => {}} />}

        <Field label="Notes">
          <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel} disabled={saving}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>
            {saving ? 'Saving…' : editItem ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
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
