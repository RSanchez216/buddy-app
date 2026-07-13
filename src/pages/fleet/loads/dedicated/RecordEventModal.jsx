import { useEffect, useMemo, useState } from 'react'
import Modal from '../../../../components/Modal'
import ComboBox from '../../../../components/ComboBox'
import { S } from '../../../../lib/styles'
import { useToast } from '../../../../contexts/ToastContext'
import { recordLaneEvent } from './dedicatedData'

// Record a yard event (swap-aware): a drop, a pickup, or both. Opened from the
// lane panel ("Record event") or a trailer's hook/depart action (prefills the
// picked-up trailer). At least one trailer required; future times blocked.

const FLD_ERR = 'text-[11px] text-red-600 dark:text-red-400 mt-1'

// Single leading '#': strip any existing hashes off the unit, then prepend one.
const oneHash = (u) => `#${String(u ?? '').replace(/^#+/, '')}`
const trailerLabel = (t) => `${oneHash(t.unit_number)}${t.trailer_type ? ` · ${t.trailer_type}` : ''}`

const pad = (n) => String(n).padStart(2, '0')
function nowParts() {
  const d = new Date()
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

export default function RecordEventModal({ open, onClose, onSaved, lane, trailers = [], drivers = [], defaults = {} }) {
  const toast = useToast()
  const facilities = useMemo(() => [lane?.origin, lane?.destination].filter(Boolean), [lane])
  const [dropped, setDropped] = useState('')
  const [picked, setPicked] = useState('')
  const [facilityId, setFacilityId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [isInitial, setIsInitial] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [showAllDrivers, setShowAllDrivers] = useState(false)

  useEffect(() => {
    if (!open) return
    const n = nowParts()
    setDropped(defaults.droppedTrailerId || '')
    setPicked(defaults.pickedTrailerId || '')
    setFacilityId(defaults.facilityId || lane?.origin?.id || '')
    setDriverId(''); setNotes(''); setAttempted(false); setShowAllDrivers(false)
    setDate(n.date); setTime(n.time)
    setIsInitial(!!defaults.isInitial)
  }, [open, lane, defaults])

  // Searchable option lists. Trailers show a single '#'; drivers show
  // "ID — Name" and match on either, defaulting to active-only.
  const trailerOptions = useMemo(() => trailers.map(t => ({
    id: t.id, name: trailerLabel(t), searchText: `${String(t.unit_number ?? '').replace(/^#+/, '')} ${t.trailer_type ?? ''}`,
  })), [trailers])
  const driverOptions = useMemo(() => drivers
    .filter(d => showAllDrivers || d.current_status === 'active')
    .map(d => ({
      id: d.id,
      name: d.internal_id ? `${d.internal_id} — ${d.full_name}` : d.full_name,
      searchText: [d.internal_id, d.full_name].filter(Boolean).join(' '),
    })), [drivers, showAllDrivers])

  const today = nowParts().date // for the date input max
  const occurredAt = useMemo(() => (date && time ? new Date(`${date}T${time}`) : null), [date, time])
  const noneSelected = !dropped && !picked
  const future = occurredAt ? occurredAt.getTime() > Date.now() : false
  const canSave = !noneSelected && !future && !!occurredAt

  async function save() {
    if (!canSave) { setAttempted(true); return }
    setSaving(true)
    try {
      const fac = facilities.find(f => f.id === facilityId)
      await recordLaneEvent({
        laneId: lane.lane_id,
        facilityId: facilityId || null,
        droppedTrailerId: dropped || null,
        pickedTrailerId: picked || null,
        driverId: driverId || null,
        isInitial,
        occurredAt: occurredAt.toISOString(),
        locationText: fac ? `${fac.city}, ${fac.state}` : null,
        notes,
      })
      toast.success('Yard event recorded.')
      onSaved?.()
    } catch (e) {
      console.error('[RecordEventModal] save failed', e)
      toast.error("Couldn't record event", e.message)
    } finally { setSaving(false) }
  }

  if (!lane) return null
  const optional = <span className="text-gray-400 font-normal">(optional)</span>

  return (
    <Modal open={open} onClose={onClose} title="Record yard event" size="md">
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={S.label}>Dropped trailer {optional}</label>
          <ComboBox options={trailerOptions} value={dropped} onChange={setDropped}
            placeholder="Select trailer…" searchPlaceholder="search unit #…" noResultsLabel="No trailer found" />
        </div>
        <div>
          <label className={S.label}>Picked-up trailer {optional}</label>
          <ComboBox options={trailerOptions} value={picked} onChange={setPicked}
            placeholder="Select trailer…" searchPlaceholder="search unit #…" noResultsLabel="No trailer found" />
        </div>
        {attempted && noneSelected && (
          <p className={`sm:col-span-2 ${FLD_ERR} !mt-0`}>Select at least a dropped or a picked-up trailer.</p>
        )}

        <div>
          <label className={S.label}>Facility</label>
          <select className={`w-full ${S.select}`} value={facilityId} onChange={e => setFacilityId(e.target.value)}>
            {facilities.map(f => <option key={f.id} value={f.id}>{f.name || `${f.city}, ${f.state}`} · {f.city}, {f.state}</option>)}
          </select>
        </div>
        <div>
          <label className={S.label}>Driver {optional}</label>
          <ComboBox options={driverOptions} value={driverId} onChange={setDriverId}
            placeholder="Select driver…" searchPlaceholder="search ID or name…" noResultsLabel="No driver found" />
          <label className="mt-1.5 flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={showAllDrivers} onChange={e => setShowAllDrivers(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-orange-500 focus:ring-orange-500/40" />
            <span className="text-[11px] text-gray-500 dark:text-slate-400">Show all drivers (incl. terminated/inactive)</span>
          </label>
        </div>

        <div>
          <label className={S.label}>Date</label>
          <input type="date" max={today} value={date} onChange={e => setDate(e.target.value)}
            className={`${S.input}${future ? ' border-red-400 dark:border-red-500/50' : ''}`} />
        </div>
        <div>
          <label className={S.label}>Time</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className={`${S.input}${future ? ' border-red-400 dark:border-red-500/50' : ''}`} />
        </div>
        {future && <p className={`sm:col-span-2 ${FLD_ERR} !mt-0`}>The event time can’t be in the future.</p>}

        <label className="sm:col-span-2 flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={isInitial} onChange={e => setIsInitial(e.target.checked)}
            className="w-4 h-4 rounded accent-orange-500 focus:ring-orange-500/40" />
          <span className="text-sm text-gray-700 dark:text-slate-300">This is the trailer’s starting location <span className="text-gray-400">(onboarding drop)</span></span>
        </label>

        <div className="sm:col-span-2">
          <label className={S.label}>Notes {optional}</label>
          <textarea className={S.textarea} rows={2} placeholder="e.g. dropped loaded, seal 4471" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-white/5">
        <button onClick={onClose} className={S.btnCancel} disabled={saving}>Cancel</button>
        <button onClick={save} disabled={saving || !canSave}
          className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? 'Recording…' : 'Record event'}
        </button>
      </div>
    </Modal>
  )
}
