import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { OWNERSHIP_STAGES, TRAILER_TYPES } from './fleetUtils'
import { useToast } from '../../contexts/ToastContext'

// Shared add/edit modal for trucks AND trailers. `kind` selects the table
// + extra trailer-only fields. On a fresh insert with ownership_stage set
// to anything other than 'unclassified', writes an equipment_ownership_history
// row tagged 'Initial classification'.
//
// VIN uniqueness is enforced by a DB UNIQUE constraint; we surface a
// friendly message if Supabase returns the duplicate error.

const CARRIERS = ['TMS Transport Solutions Inc', 'PJ Twins Inc', 'USKG Trans Inc', 'Other']

const emptyTruck = {
  unit_number: '', vin: '', year: '', make: '', model: '',
  license_plate: '', license_state: '', transponder: '',
  carrier: '', equipment_owner_raw: '', driver_id: '',
  ownership_stage: 'unclassified', status: '', lessee: '', notes: '',
}
const emptyTrailer = {
  ...emptyTruck,
  trailer_type: '',
  annual_inspection_expiration_date: '',
}

export default function TruckTrailerFormModal({ kind, open, editItem, onClose, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const table = kind === 'trailer' ? 'trailers' : 'trucks'
  const isTrailer = kind === 'trailer'

  const [form, setForm] = useState(isTrailer ? emptyTrailer : emptyTruck)
  const [drivers, setDrivers] = useState([])
  const [ownerSuggestions, setOwnerSuggestions] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (editItem) {
      const e = editItem
      setForm({
        unit_number: e.unit_number || '',
        vin: e.vin || '',
        year: e.year ?? '',
        make: e.make || '',
        model: e.model || '',
        license_plate: e.license_plate || '',
        license_state: e.license_state || '',
        transponder: e.transponder || '',
        carrier: e.carrier || '',
        equipment_owner_raw: e.equipment_owner_raw || '',
        driver_id: e.driver_id || '',
        ownership_stage: e.ownership_stage || 'unclassified',
        status: e.status || '',
        lessee: e.lessee || '',
        notes: e.notes || '',
        ...(isTrailer ? {
          trailer_type: e.trailer_type || '',
          annual_inspection_expiration_date: e.annual_inspection_expiration_date || '',
        } : {}),
      })
    } else {
      setForm(isTrailer ? emptyTrailer : emptyTruck)
    }

    // Drivers + equipment-owner auto-suggest list. Drivers has no active flag,
    // so we just sort alphabetically.
    Promise.all([
      supabase.from('drivers').select('id, full_name').order('full_name'),
      supabase.from(table).select('equipment_owner_raw').not('equipment_owner_raw', 'is', null),
    ]).then(([dRes, oRes]) => {
      setDrivers(dRes.data || [])
      const uniq = Array.from(new Set((oRes.data || []).map(r => r.equipment_owner_raw).filter(Boolean))).sort()
      setOwnerSuggestions(uniq)
    })
  }, [open, editItem, isTrailer, table])

  function validate() {
    if (!form.unit_number.trim()) return 'Unit # is required.'
    if (!form.vin.trim()) return 'VIN is required.'
    if (form.year !== '' && form.year !== null) {
      const y = Number(form.year)
      const max = new Date().getFullYear() + 2
      if (Number.isNaN(y) || y < 1990 || y > max) return `Year must be between 1990 and ${max}.`
    }
    return ''
  }

  async function save() {
    const v = validate()
    if (v) { setError(v); return }
    setSaving(true); setError('')
    const payload = {
      unit_number: form.unit_number.trim(),
      vin: form.vin.trim(),
      year: form.year === '' ? null : Number(form.year),
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      license_plate: form.license_plate.trim() || null,
      license_state: form.license_state.trim() || null,
      transponder: form.transponder.trim() || null,
      carrier: form.carrier || null,
      equipment_owner_raw: form.equipment_owner_raw.trim() || null,
      driver_id: form.driver_id || null,
      ownership_stage: form.ownership_stage || 'unclassified',
      status: form.status.trim() || null,
      lessee: form.lessee.trim() || null,
      notes: form.notes.trim() || null,
      updated_by: user?.id || null,
      ...(isTrailer ? {
        trailer_type: form.trailer_type || null,
        annual_inspection_expiration_date: form.annual_inspection_expiration_date || null,
      } : {}),
    }
    if (!editItem) payload.created_by = user?.id || null

    let res
    if (editItem) {
      res = await supabase.from(table).update(payload).eq('id', editItem.id).select('id').single()
    } else {
      res = await supabase.from(table).insert(payload).select('id').single()
    }
    if (res.error || !res.data) {
      setSaving(false)
      // Friendly message for the UNIQUE(vin) constraint violation
      const msg = res.error?.message?.match(/duplicate.*vin|unique.*vin/i)
        ? `A ${kind} with VIN "${form.vin}" already exists.`
        : (res.error?.message || 'Save failed')
      setError(msg)
      toast.error(editItem ? `Couldn't update ${kind}` : `Couldn't create ${kind}`, msg)
      return
    }

    // Initial-classification history entry — only on insert when stage is
    // explicitly set (anything other than 'unclassified').
    if (!editItem && payload.ownership_stage && payload.ownership_stage !== 'unclassified') {
      await supabase.from('equipment_ownership_history').insert({
        equipment_type: kind,
        truck_id: kind === 'truck' ? res.data.id : null,
        trailer_id: kind === 'trailer' ? res.data.id : null,
        from_stage: null,
        to_stage: payload.ownership_stage,
        driver_id: payload.driver_id,
        reason: 'Initial classification',
        created_by: user?.id || null,
      })
    }

    setSaving(false)
    const noun = kind === 'trailer' ? 'Trailer' : 'Truck'
    toast.success(editItem ? `${noun} updated — ${payload.unit_number || payload.vin}` : `${noun} added — ${payload.unit_number || payload.vin}`)
    onSaved?.(res.data.id)
    onClose?.()
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title={editItem ? `Edit ${kind === 'trailer' ? 'Trailer' : 'Truck'}` : `Add ${kind === 'trailer' ? 'Trailer' : 'Truck'}`} size="lg">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Unit # *">
            <input className={S.input} value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value }))} />
          </Field>
          <Field label="VIN *">
            <input className={`${S.input} font-mono`} value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value.toUpperCase() }))} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Year">
            <input className={S.input} type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
          </Field>
          <Field label="Make">
            <input className={S.input} value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} />
          </Field>
          <Field label="Model">
            <input className={S.input} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="License Plate">
            <input className={S.input} value={form.license_plate} onChange={e => setForm(f => ({ ...f, license_plate: e.target.value }))} />
          </Field>
          <Field label="License State">
            <input className={S.input} maxLength={2} value={form.license_state} onChange={e => setForm(f => ({ ...f, license_state: e.target.value.toUpperCase() }))} placeholder="TX" />
          </Field>
          <Field label="Transponder">
            <input className={S.input} value={form.transponder} onChange={e => setForm(f => ({ ...f, transponder: e.target.value }))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Carrier">
            <Select value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))}>
              <option value="">— Select —</option>
              {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
              {form.carrier && !CARRIERS.includes(form.carrier) && (
                <option value={form.carrier}>{form.carrier} (legacy)</option>
              )}
            </Select>
          </Field>
          <Field label="Equipment Owner">
            <input
              className={S.input}
              list={`owner-suggestions-${kind}`}
              value={form.equipment_owner_raw}
              onChange={e => setForm(f => ({ ...f, equipment_owner_raw: e.target.value }))}
              placeholder="Free text — type or pick"
            />
            <datalist id={`owner-suggestions-${kind}`}>
              {ownerSuggestions.map(o => <option key={o} value={o} />)}
            </datalist>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Driver">
            <Select value={form.driver_id} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Ownership Stage">
            <Select value={form.ownership_stage} onChange={e => setForm(f => ({ ...f, ownership_stage: e.target.value }))}>
              {OWNERSHIP_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
        </div>

        {isTrailer && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Trailer Type">
              <Select value={form.trailer_type} onChange={e => setForm(f => ({ ...f, trailer_type: e.target.value }))}>
                <option value="">— Select —</option>
                {TRAILER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Annual Inspection Expiration">
              <input type="date" className={S.input} value={form.annual_inspection_expiration_date} onChange={e => setForm(f => ({ ...f, annual_inspection_expiration_date: e.target.value }))} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Status (TMS)">
            <input className={S.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} placeholder="Active, Inactive, …" />
          </Field>
          <Field label="Lessee">
            <input className={S.input} value={form.lessee} onChange={e => setForm(f => ({ ...f, lessee: e.target.value }))} />
          </Field>
        </div>

        <Field label="Notes">
          <textarea className={S.textarea} rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
