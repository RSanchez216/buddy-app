import { useEffect, useState } from 'react'
import { S } from '../../../lib/styles'
import {
  saveLoadCheckpoints, toChicagoLocalInput, chicagoLocalToISO, fmtDuration,
} from './shiftBoardData'
import { minutesBetween } from './accessorialData'

// The four checkpoint times, inline in the row panel. This replaces the modal
// that used to sit on top of the board: an associate shouldn't open a window to
// type a time they already have in front of them.
//
// Only fields the associate actually touches are sent, so opening this on a load
// still sitting at the shipper never stamps a delivery time. save_load_checkpoints
// upserts one row per load and owns the GENERATED duration columns.

const FIELDS = [
  { key: 'pickupIn', label: 'Pickup in', col: 'cp_pickup_in' },
  { key: 'pickupOut', label: 'Pickup out', col: 'cp_pickup_out' },
  { key: 'deliveryIn', label: 'Delivery in', col: 'cp_delivery_in' },
  { key: 'deliveryOut', label: 'Delivery out', col: 'cp_delivery_out' },
]

export default function CheckpointFields({ row, shiftId, onSaved, toast }) {
  const loadId = row.load_id || null
  const nowLocal = toChicagoLocalInput(new Date())

  const build = () => {
    const f = {}
    for (const { key, col } of FIELDS) {
      const iso = row[col]
      f[key] = { value: iso ? toChicagoLocalInput(iso) : nowLocal, touched: false, saved: !!iso }
    }
    return f
  }
  const [fields, setFields] = useState(build)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Re-seed when the board refreshes with new timestamps (or a different row).
  useEffect(() => {
    setFields(build())
    setErr('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.load_id, row.cp_pickup_in, row.cp_pickup_out, row.cp_delivery_in, row.cp_delivery_out])

  const setValue = (key, value) => setFields(f => ({ ...f, [key]: { ...f[key], value, touched: true } }))
  const setNow = (key) => setValue(key, toChicagoLocalInput(new Date()))

  const dirty = FIELDS.some(({ key }) => fields[key].touched)

  // Durations recompute from what's on screen, so they move as soon as a time is
  // typed rather than waiting for the save to come back.
  const isoOf = (key) => {
    const f = fields[key]
    if (f.touched) return f.value ? chicagoLocalToISO(f.value) : null
    return row[FIELDS.find(x => x.key === key).col] || null
  }
  const shipper = minutesBetween(isoOf('pickupIn'), isoOf('pickupOut'))
  const receiver = minutesBetween(isoOf('deliveryIn'), isoOf('deliveryOut'))
  const stillAtShipper = !!isoOf('pickupIn') && !isoOf('pickupOut')
  const stillAtReceiver = !!isoOf('deliveryIn') && !isoOf('deliveryOut')

  async function save() {
    if (!loadId) return
    setBusy(true); setErr('')
    try {
      const payload = { loadId, shiftId }
      for (const { key } of FIELDS) {
        const f = fields[key]
        payload[key] = f.touched && f.value ? chicagoLocalToISO(f.value) : null // only changed fields
      }
      await saveLoadCheckpoints(payload)
      toast?.success('Checkpoint times saved')
      await onSaved?.()
    } catch (e) {
      setErr(e.message); toast?.error(e.message) // surface the RPC reason verbatim
    } finally { setBusy(false) }
  }

  return (
    <div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-2">
        Times are Central (Chicago). Empty fields default to now — adjust if the driver reported late.
      </p>

      <div className="space-y-2">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-0.5">
              {label}
              {fields[key].saved && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400 normal-case tracking-normal font-medium">saved</span>}
            </label>
            <div className="flex items-center gap-1.5">
              <input type="datetime-local" disabled={!loadId}
                className={`${S.input} !py-1 flex-1 text-xs ${fields[key].saved && !fields[key].touched ? 'border-emerald-300 dark:border-emerald-500/30' : ''}`}
                value={fields[key].value} onChange={e => setValue(key, e.target.value)} />
              <button type="button" onClick={() => setNow(key)} disabled={!loadId}
                className="px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">
                Now
              </button>
            </div>
          </div>
        ))}
      </div>

      {(shipper != null || receiver != null) && (
        <div className="mt-2.5 space-y-0.5">
          {shipper != null && (
            <p className="text-sm text-gray-800 dark:text-slate-200">
              Detained at shipper <span className="font-bold tabular-nums">{fmtDuration(shipper)}</span>
              {stillAtShipper && <span className="text-[11px] text-amber-600 dark:text-amber-400"> · still there</span>}
            </p>
          )}
          {receiver != null && (
            <p className="text-sm text-gray-800 dark:text-slate-200">
              Detained at receiver <span className="font-bold tabular-nums">{fmtDuration(receiver)}</span>
              {stillAtReceiver && <span className="text-[11px] text-amber-600 dark:text-amber-400"> · still there</span>}
            </p>
          )}
        </div>
      )}

      {err && <div className={`${S.errorBox} mt-2`}>{err}</div>}

      <button type="button" onClick={save} disabled={busy || !dirty || !loadId}
        className="mt-2.5 w-full px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-lg transition-colors">
        {busy ? 'Saving…' : dirty ? 'Save times' : 'No changes'}
      </button>
      {!loadId && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">No load on the board — nothing to time.</p>}
    </div>
  )
}
