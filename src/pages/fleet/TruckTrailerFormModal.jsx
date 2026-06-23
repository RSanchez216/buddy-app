import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import ComboBox from '../../components/ComboBox'
import SuggestInput from '../../components/SuggestInput'
import { OWNERSHIP_STAGES, TRAILER_TYPES } from './fleetUtils'
import { useToast } from '../../contexts/ToastContext'

// Shared add/edit modal for trucks AND trailers. `kind` selects the table
// + extra trailer-only fields. On a fresh insert with ownership_stage set
// to anything other than 'unclassified', writes an equipment_ownership_history
// row tagged 'Initial classification'.
//
// VIN uniqueness is enforced by a DB UNIQUE constraint; we surface a
// friendly message if Supabase returns the duplicate error.
//
// Carriers come from the public.carriers reference table — managed in
// Settings -> Carriers. Active rows feed the dropdown; if the unit
// already carries an inactive or legacy value we pin it at the top
// of the picker so the user can keep it without re-typing.

const emptyTruck = {
  unit_number: '', vin: '', year: '', make: '', model: '',
  license_plate: '', license_state: '', transponder: '',
  carrier: '', equipment_owner_raw: '', driver_id: '',
  ownership_stage: 'unclassified',
  operational_status: 'active',
  owned_outright: false,
  is_total_loss: false,
  lease_charge_active: true,
  status: '', notes: '',
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
  const [carriers, setCarriers] = useState([])
  const [ownerSuggestions, setOwnerSuggestions] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Effective date for a manual driver change (defaults to today, Chicago).
  // Lets a manager backdate a reassignment when the TMS import was late.
  const [effectiveDate, setEffectiveDate] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setEffectiveDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()))
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
        operational_status: e.operational_status || 'active',
        owned_outright: !!e.owned_outright,
        is_total_loss: !!e.is_total_loss,
        // Default ON when the column is null/undefined (legacy rows) so a
        // unit isn't silently treated as "no longer charged".
        lease_charge_active: e.lease_charge_active == null ? true : !!e.lease_charge_active,
        status: e.status || '',
        notes: e.notes || '',
        ...(isTrailer ? {
          trailer_type: e.trailer_type || '',
          annual_inspection_expiration_date: e.annual_inspection_expiration_date || '',
        } : {}),
      })
    } else {
      setForm(isTrailer ? emptyTrailer : emptyTruck)
    }

    // Drivers + carriers + equipment-owner auto-suggest list. Drivers are
    // restricted to current_status='active' (reassign targets); the unit's
    // existing driver is pinned into the picker below even if inactive so the
    // pre-selected value never disappears. Carriers comes from the reference
    // table in Settings -> Carriers (active rows only).
    Promise.all([
      supabase.from('drivers').select('id, full_name, internal_id').eq('current_status', 'active').order('full_name'),
      supabase.from('carriers').select('id, name, is_active').eq('is_active', true).order('name'),
      supabase.from(table).select('equipment_owner_raw').not('equipment_owner_raw', 'is', null),
      // Active Vendor Master vendors — merged into the Equipment Owner
      // suggestion list so a brand-new vendor is pickable immediately
      // (without waiting for a unit to already reference it). Combined
      // with the auto-link trigger this is the flow: create vendor →
      // pick as owner → lessor auto-links.
      supabase.from('vendors').select('name').eq('is_active', true),
    ]).then(([dRes, cRes, oRes, vRes]) => {
      setDrivers(dRes.data || [])
      setCarriers(cRes.data || [])
      // Merge raw owner values + active vendor names, dedupe
      // case/space-insensitively (keep the first spelling we see so a
      // vendor's "official" name wins when both sources have it).
      const seen = new Map()
      const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const pushAll = list => {
        for (const v of (list || [])) {
          const name = (v?.equipment_owner_raw ?? v?.name ?? '').toString().trim()
          if (!name) continue
          const k = norm(name)
          if (!seen.has(k)) seen.set(k, name)
        }
      }
      pushAll(oRes.data || [])
      pushAll(vRes.data || [])
      setOwnerSuggestions(Array.from(seen.values()).sort((a, b) => a.localeCompare(b)))
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
    // driver_id is intentionally NOT in the payload. equipment_assignments
    // is the source of truth, so any driver change is routed through the
    // set_unit_current_driver RPC below which opens/closes assignment
    // rows + re-derives trucks/trailers.driver_id from the open row.
    // carrier IS in the payload — the resolver re-syncs carrier from the
    // current driver whenever one is assigned, but for units with no
    // current driver the user's pick stands.
    const prevDriverId = editItem?.driver_id || null
    const nextDriverId = form.driver_id || null
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
      ownership_stage: form.ownership_stage || 'unclassified',
      operational_status: form.operational_status || 'active',
      // Only carries meaning for company-owned units; we don't bother
      // gating the column write because the view's precedence handles
      // it (loan beats flag; flag means nothing on lease / driver_owned).
      owned_outright: !!form.owned_outright,
      // Independent total-loss dimensions: is_total_loss = written off;
      // lease_charge_active = still being billed (gates the leased-cost
      // path in fleet_equipment_cost). Both set manually by Rebeca.
      is_total_loss: !!form.is_total_loss,
      lease_charge_active: !!form.lease_charge_active,
      status: form.status.trim() || null,
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
    const unitId = editItem?.id || res.data.id

    // Sync the assignment timeline. RPC short-circuits if the desired
    // driver already equals the open-row driver. We always call it on
    // insert too, in case the user picked a driver on a brand-new unit.
    if (nextDriverId !== prevDriverId || !editItem) {
      const rpcParams = {
        p_equipment_type: kind,
        p_unit_id: unitId,
        p_new_driver_id: nextDriverId,
        p_source: 'manual',
      }
      // Pass the effective date so a reassignment can be backdated; omit when
      // blank so the RPC keeps its default (today, America/Chicago).
      if (effectiveDate) rpcParams.p_effective = effectiveDate
      const { error: rpcErr } = await supabase.rpc('set_unit_current_driver', rpcParams)
      if (rpcErr) {
        // Soft-fail: the unit itself saved, but the assignment didn't
        // write. Surface a toast so Rebeca can re-trigger; don't roll
        // back the unit edit.
        console.error('[TruckTrailerFormModal] set_unit_current_driver failed', rpcErr)
        toast.error("Saved unit, but couldn't sync Assignment History — try editing the Driver again.")
      }
      // Resolver inside the RPC only fires when there IS an open driver,
      // so on unassign the unit's driver_id stays stale unless we clear
      // it explicitly. (No-op when prev was already null.)
      if (nextDriverId === null && prevDriverId !== null) {
        await supabase.from(table)
          .update({ driver_id: null, updated_at: new Date().toISOString() })
          .eq('id', unitId)
      }
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
        driver_id: nextDriverId,
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
            <ComboBox
              options={[
                ...carriers.map(c => ({ id: c.name, name: c.name })),
                // If the unit's current carrier text isn't in the active
                // list (legacy import, deactivated row, manually edited),
                // pin it at the top with a "(legacy)" tag so the user
                // doesn't accidentally lose the value just by reopening
                // the form.
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
          <Field label="Equipment Owner">
            {/* SuggestInput is the same typeahead pattern Carrier and
                Driver use — themed light, type-to-filter, but free
                text remains the saved value (it writes
                equipment_owner_raw verbatim). Replaces the native
                <datalist> which rendered with OS-dark chrome on some
                browsers. */}
            <SuggestInput
              value={form.equipment_owner_raw}
              onChange={v => setForm(f => ({ ...f, equipment_owner_raw: v }))}
              suggestions={ownerSuggestions}
              placeholder="Type to search or enter free text"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Driver">
            <ComboBox
              options={[
                ...drivers.map(d => ({
                  id: d.id,
                  // Inline "ID · Name" with the ID muted and leading. Falls
                  // back to just the name when internal_id is missing so a row
                  // with no TMS id doesn't show a stray "·".
                  name: d.internal_id
                    ? (
                      <span>
                        <span className="text-gray-400 dark:text-slate-500">{d.internal_id} · </span>
                        {d.full_name}
                      </span>
                    )
                    : d.full_name,
                  // Plain-string target for the type-to-filter — name AND id
                  // both substring-match so typing "1650" or "mimou" both
                  // surface Abderrahim Mimouni.
                  searchText: d.internal_id
                    ? `${d.internal_id} ${d.full_name} #${d.internal_id}`
                    : d.full_name,
                })),
                // The picker lists ACTIVE drivers; if the unit's current
                // driver is inactive they'd vanish, losing the pre-selected
                // value. Pin them at the top with an "(inactive)" tag so the
                // assignment shows correctly and the user can keep it.
                ...(form.driver_id && !drivers.some(d => d.id === form.driver_id)
                  ? [{
                      id: form.driver_id,
                      name: (
                        <span>
                          {editItem?.driver?.full_name || 'Current driver'}
                          <span className="text-gray-400 dark:text-slate-500"> (inactive)</span>
                        </span>
                      ),
                      searchText: editItem?.driver?.full_name || '',
                    }]
                  : []),
              ]}
              value={form.driver_id}
              onChange={id => setForm(f => ({ ...f, driver_id: id }))}
              placeholder="— Unassigned —"
              searchPlaceholder="Search drivers by name or ID…"
              noResultsLabel="No driver matches"
            />
            <input
              type="date"
              className={`${S.input} mt-2 text-xs`}
              value={effectiveDate}
              onChange={e => setEffectiveDate(e.target.value)}
              title="Effective date of this driver assignment — defaults to today; backdate a late reassignment if needed."
            />
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 leading-tight">
              Effective date — only applies when you change the driver.
            </p>
          </Field>
          <Field label="Ownership Stage">
            <ComboBox
              options={OWNERSHIP_STAGES.map(s => ({
                id: s.value,
                name: s.icon ? `${s.icon} ${s.label}` : s.label,
              }))}
              value={form.ownership_stage}
              onChange={id => setForm(f => ({ ...f, ownership_stage: id || 'unclassified' }))}
              placeholder="— Select stage —"
              searchPlaceholder="Search stages…"
              noResultsLabel="No stage matches"
              clearable={false}
            />
            {/* Owned-outright toggle is only meaningful for company-owned
                units. Hidden for the other stages so it can't be
                mis-set; on the DB side the view's precedence ignores
                the flag for non-owned stages anyway. An ACTIVE linked
                loan in the Debt Schedule still wins — flag only
                zeroes-out units that have no active loan. */}
            {form.ownership_stage === 'company_owned' && (
              <label
                className="mt-2 flex items-start gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer select-none"
                title="Mark as paid-off / cash-owned. The unit shows as Owned outright ($0) on Fleet Cost and drops out of Needs Cost. If you later link an active loan in the Debt Schedule, the live loan payment takes precedence."
              >
                <input
                  type="checkbox"
                  checked={!!form.owned_outright}
                  onChange={e => setForm(f => ({ ...f, owned_outright: e.target.checked }))}
                  className="mt-0.5 rounded"
                />
                <span>
                  Owned outright — no monthly payment ($0)
                  <span className="block text-[10px] text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                    Use when paid off or cash-owned with no loan record.
                  </span>
                </span>
              </label>
            )}
          </Field>
        </div>

        {/* Total-loss tracking — two independent flags. "Total loss" marks
            a unit written off (accident/insurance). "Lessor still charging"
            (default on) gates whether we keep counting a lease /
            lease-purchase cost while the settlement plays out; turn it off
            when the lessor stops billing or the unit is paid off and the
            cost drops out of Fleet Cost. Kept independent so the two
            states combine freely. */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Total loss">
            <label
              className="flex items-start gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer select-none"
              title="Mark when the unit is written off in an accident / total loss. Independent of whether the lessor is still charging — set that separately."
            >
              <input
                type="checkbox"
                checked={!!form.is_total_loss}
                onChange={e => setForm(f => ({ ...f, is_total_loss: e.target.checked }))}
                className="mt-0.5 rounded"
              />
              <span>
                Written off (total loss)
                <span className="block text-[10px] text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                  Accident / insurance — still tracked while settlement is pending.
                </span>
              </span>
            </label>
          </Field>
          <Field label="Lessor still charging">
            <label
              className="flex items-start gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer select-none"
              title="Leave on while you're still being billed a lease / lease-purchase amount. Turn off when the lessor stops billing or the unit is paid off — the cost stops counting in Fleet Cost."
            >
              <input
                type="checkbox"
                checked={!!form.lease_charge_active}
                onChange={e => setForm(f => ({ ...f, lease_charge_active: e.target.checked }))}
                className="mt-0.5 rounded"
              />
              <span>
                Still being charged a lease cost
                <span className="block text-[10px] text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                  Turn off when the lessor stops billing or the unit is paid off — cost stops counting.
                </span>
              </span>
            </label>
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
          <Field label="Status">
            <Select value={form.operational_status} onChange={e => setForm(f => ({ ...f, operational_status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </Select>
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 leading-tight">
              Operational state — survives weekly TMS uploads.
            </p>
          </Field>
          <Field label="TMS Status (imported)">
            <input
              className={`${S.input} bg-gray-50 dark:bg-white/[0.02] text-gray-500 dark:text-slate-500 cursor-not-allowed`}
              value={form.status}
              readOnly
              tabIndex={-1}
              title="Set by the weekly TMS upload — read-only here."
              placeholder="—"
            />
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
