import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../../components/Modal'
import { S } from '../../../../lib/styles'
import { useToast } from '../../../../contexts/ToastContext'
import { facilityGeo, fetchUnassignedTrailers, createFacility, createDedicatedLane, assignTrailersToLane } from './dedicatedData'

// New Dedicated Lane — creates two facilities (origin + destination), the lane,
// and assigns trailers. Pins resolve via facility_geo(city,state) with a manual
// lat/lng override. Manager/admin only (RLS enforces regardless).

const FLD_HELP = 'text-[11px] text-gray-400 dark:text-slate-500 mt-1'
const FLD_ERR = 'text-[11px] text-red-600 dark:text-red-400 mt-1'
const emptyFacility = () => ({ name: '', address: '', city: '', state: '', zip: '', lat: '', lng: '' })

// Required to save: name, address, city, state. Lat/lng stay optional (resolved or manual).
function facilityErrors(f) {
  return {
    name: !f.name.trim() ? 'Facility name is required.' : '',
    address: !f.address.trim() ? 'Street address is required.' : '',
    city: !f.city.trim() ? 'City is required.' : '',
    state: !f.state.trim() ? 'State is required.' : '',
  }
}

// Apply an inline-error ring to a required input when its error should show.
const errInput = (show) => `${S.input}${show ? ' border-red-400 dark:border-red-500/50 focus:ring-red-500/40 focus:border-red-500/40' : ''}`

function FacilityFields({ label, f, onChange, onResolve, resolving, errors, showErr, onBlur }) {
  const hasPin = f.lat !== '' && f.lng !== ''
  return (
    <div className="sm:col-span-2 rounded-xl border border-gray-200 dark:border-white/10 p-3.5 space-y-3">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={S.label}>Facility name</label>
          <input className={errInput(showErr('name'))} placeholder="e.g. Del Campo DC" value={f.name} onChange={e => onChange({ ...f, name: e.target.value })} onBlur={() => onBlur('name')} />
          {showErr('name') && <p className={FLD_ERR}>{errors.name}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={S.label}>Street address</label>
          <input className={errInput(showErr('address'))} placeholder="e.g. 400 Aberdeen Loop" value={f.address} onChange={e => onChange({ ...f, address: e.target.value })} onBlur={() => onBlur('address')} />
          {showErr('address') && <p className={FLD_ERR}>{errors.address}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={S.label}>City</label>
          <input className={errInput(showErr('city'))} placeholder="e.g. Panama City" value={f.city} onChange={e => onChange({ ...f, city: e.target.value })} onBlur={() => onBlur('city')} />
          {showErr('city') && <p className={FLD_ERR}>{errors.city}</p>}
        </div>
        <div>
          <label className={S.label}>State</label>
          <input className={errInput(showErr('state'))} placeholder="TX" maxLength={2} value={f.state} onChange={e => onChange({ ...f, state: e.target.value.toUpperCase() })} onBlur={() => onBlur('state')} />
          {showErr('state') && <p className={FLD_ERR}>{errors.state}</p>}
        </div>
        <div>
          <label className={S.label}>ZIP <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className={S.input} placeholder="e.g. 32405" inputMode="numeric" maxLength={10} value={f.zip} onChange={e => onChange({ ...f, zip: e.target.value })} />
        </div>
        <div>
          <label className={S.label}>Latitude <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className={S.input} placeholder="27.5306" inputMode="decimal" value={f.lat} onChange={e => onChange({ ...f, lat: e.target.value })} />
        </div>
        <div>
          <label className={S.label}>Longitude <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className={S.input} placeholder="-99.4803" inputMode="decimal" value={f.lng} onChange={e => onChange({ ...f, lng: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onResolve} disabled={resolving || !f.city || !f.state}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">
          {resolving ? 'Resolving…' : 'Resolve pin from city + state'}
        </button>
        <span className={`text-[11px] ${hasPin ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-slate-500'}`}>
          {hasPin ? `📍 ${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}` : 'no pin yet — resolve or enter manually'}
        </span>
      </div>
    </div>
  )
}

export default function NewLaneModal({ open, onClose, onCreated }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [customer, setCustomer] = useState('')
  const [rate, setRate] = useState('')
  const [threshold, setThreshold] = useState('0')
  const [origin, setOrigin] = useState(emptyFacility)
  const [destination, setDestination] = useState(emptyFacility)
  const [resolving, setResolving] = useState(null) // 'origin' | 'destination'
  const [unassigned, setUnassigned] = useState([])
  const [assigned, setAssigned] = useState([]) // trailer ids
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(() => new Set()) // 'origin.city', 'name', …
  const [attempted, setAttempted] = useState(false)        // reveal all errors once Create is pressed

  useEffect(() => {
    if (!open) return
    // reset + load the unassigned pool
    setName(''); setCustomer(''); setRate(''); setThreshold('0'); setOrigin(emptyFacility()); setDestination(emptyFacility())
    setAssigned([]); setQuery(''); setTouched(new Set()); setAttempted(false)
    fetchUnassignedTrailers().then(setUnassigned).catch(e => { console.error(e); setUnassigned([]) })
  }, [open])

  const touch = (key) => setTouched(prev => new Set(prev).add(key))
  const originErrors = facilityErrors(origin)
  const destErrors = facilityErrors(destination)
  const nameError = !name.trim() ? 'Lane name is required.' : ''
  // A required field's error shows once its input is blurred or Create is attempted.
  const showFor = (prefix, errs) => (field) => (attempted || touched.has(`${prefix}.${field}`)) && !!errs[field]
  const canSave = !nameError &&
    !Object.values(originErrors).some(Boolean) &&
    !Object.values(destErrors).some(Boolean)

  const byId = useMemo(() => new Map(unassigned.map(t => [t.id, t])), [unassigned])
  const suggestions = useMemo(() => {
    const q = query.trim().replace(/^#/, '').toLowerCase()
    return unassigned.filter(t => !assigned.includes(t.id) && (!q || String(t.unit_number).toLowerCase().includes(q))).slice(0, 8)
  }, [unassigned, assigned, query])

  async function resolve(which) {
    const f = which === 'origin' ? origin : destination
    setResolving(which)
    try {
      const pin = await facilityGeo(f.city, f.state)
      if (!pin) { toast.error(`No pin found for ${f.city}, ${f.state} — enter lat/lng manually.`); return }
      const upd = { ...f, lat: String(pin.lat), lng: String(pin.lng) }
      which === 'origin' ? setOrigin(upd) : setDestination(upd)
    } catch (e) { toast.error("Couldn't resolve pin", e.message) } finally { setResolving(null) }
  }

  // Lat/lng optional: pass a finite number when present, else null (never 0 from a blank box).
  const pinOrNull = (v) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

  async function create() {
    if (!canSave) { setAttempted(true); return } // reveal inline errors, no blocking dialog
    setSaving(true)
    try {
      const originId = await createFacility({ name: origin.name, address: origin.address, city: origin.city, state: origin.state, zip: origin.zip, lat: pinOrNull(origin.lat), lng: pinOrNull(origin.lng) })
      const destId = await createFacility({ name: destination.name, address: destination.address, city: destination.city, state: destination.state, zip: destination.zip, lat: pinOrNull(destination.lat), lng: pinOrNull(destination.lng) })
      const laneId = await createDedicatedLane({ name: name.trim(), customer, originFacilityId: originId, destinationFacilityId: destId, underwaterThreshold: threshold, rate })
      await assignTrailersToLane(laneId, assigned)
      toast.success(`Dedicated lane “${name.trim()}” created${assigned.length ? ` · ${assigned.length} trailer${assigned.length === 1 ? '' : 's'} assigned` : ''}.`)
      onCreated?.()
    } catch (e) {
      console.error('[NewLaneModal] create failed', e)
      toast.error("Couldn't create lane", e.message)
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Dedicated Lane" size="lg">
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={S.label}>Lane name</label>
          <input className={errInput((attempted || touched.has('name')) && !!nameError)} placeholder="e.g. Laredo Produce" value={name} onChange={e => setName(e.target.value)} onBlur={() => touch('name')} autoFocus />
          {(attempted || touched.has('name')) && nameError && <p className={FLD_ERR}>{nameError}</p>}
        </div>
        <div>
          <label className={S.label}>Customer / Contract <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className={S.input} placeholder="e.g. Del Campo Produce" value={customer} onChange={e => setCustomer(e.target.value)} />
        </div>
        <div>
          <label className={S.label}>Rate (per load) <span className="text-gray-400 font-normal">(optional)</span></label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 text-sm pointer-events-none">$</span>
            <input className={`${S.input} pl-6`} placeholder="e.g. 950" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
          </div>
          <p className={FLD_HELP}>optional · a fixed rate this lane pays per load; used for profit calc when it applies. Not required, and never the sole rule.</p>
        </div>
        <div>
          <label className={S.label}>Underwater threshold</label>
          <input className={S.input} placeholder="0" inputMode="decimal" value={threshold} onChange={e => setThreshold(e.target.value)} />
          <p className={FLD_HELP}>net · MTD below this flags the lane red (default 0)</p>
        </div>

        <FacilityFields label="Origin facility" f={origin} onChange={setOrigin} onResolve={() => resolve('origin')} resolving={resolving === 'origin'}
          errors={originErrors} showErr={showFor('origin', originErrors)} onBlur={(field) => touch(`origin.${field}`)} />
        <FacilityFields label="Destination facility" f={destination} onChange={setDestination} onResolve={() => resolve('destination')} resolving={resolving === 'destination'}
          errors={destErrors} showErr={showFor('destination', destErrors)} onBlur={(field) => touch(`destination.${field}`)} />

        <div className="sm:col-span-2">
          <label className={S.label}>Assign trailers <span className="text-gray-400 font-normal">(from unassigned)</span></label>
          {assigned.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {assigned.map(id => (
                <span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 text-xs font-bold tabular-nums">
                  {byId.get(id)?.unit_number || `#${id.slice(0, 6)}`}
                  <button type="button" onClick={() => setAssigned(a => a.filter(x => x !== id))} className="hover:text-orange-900 dark:hover:text-orange-200" aria-label="Remove">✕</button>
                </span>
              ))}
            </div>
          )}
          <input className={S.input} placeholder={unassigned.length ? 'search unit #…' : 'no unassigned trailers'} value={query} onChange={e => setQuery(e.target.value)} disabled={!unassigned.length} />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestions.map(t => (
                <button key={t.id} type="button" onClick={() => { setAssigned(a => [...a, t.id]); setQuery('') }}
                  className="px-2 py-1 rounded-lg border border-gray-300 dark:border-slate-700 text-xs font-bold tabular-nums text-gray-600 dark:text-slate-300 hover:border-orange-300 dark:hover:border-orange-500/40 hover:text-orange-600 dark:hover:text-orange-400 transition-colors">
                  + {t.unit_number}{t.trailer_type ? ` · ${t.trailer_type}` : ''}
                </button>
              ))}
            </div>
          )}
          <p className={FLD_HELP}>{unassigned.length} trailer{unassigned.length === 1 ? '' : 's'} available to assign</p>
        </div>
      </div>
      <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-white/5">
        <button onClick={onClose} className={S.btnCancel} disabled={saving}>Cancel</button>
        <button onClick={create} disabled={saving || !canSave}
          className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? 'Creating…' : 'Create lane'}
        </button>
      </div>
    </Modal>
  )
}
