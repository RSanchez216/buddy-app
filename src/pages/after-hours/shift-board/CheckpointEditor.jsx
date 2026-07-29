import { useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../lib/styles'
import { saveLoadCheckpoints, toChicagoLocalInput, chicagoLocalToISO, fmtDuration } from './shiftBoardData'

const FIELDS = [
  { key: 'pickupIn', label: 'Pickup in' },
  { key: 'pickupOut', label: 'Pickup out' },
  { key: 'deliveryIn', label: 'Delivery in' },
  { key: 'deliveryOut', label: 'Delivery out' },
]

// Compact editor for a load's four checkpoint times. Prefills from the board's
// cp_* values; empty fields default to now (the associate is usually recording a
// message that just arrived). Only fields the associate actually sets (typed or
// via "Now") are sent — so opening this on a load waiting at the shipper never
// stamps a delivery time. save_load_checkpoints upserts one row per load.
export default function CheckpointEditor({ target, shiftId, onClose, onSaved, toast }) {
  const nowLocal = toChicagoLocalInput(new Date())
  const [fields, setFields] = useState(() => {
    const f = {}
    for (const { key } of FIELDS) {
      const iso = target[key]
      f[key] = { value: iso ? toChicagoLocalInput(iso) : nowLocal, touched: false }
    }
    return f
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null) // { pickup_minutes, delivery_minutes } after save

  const setValue = (key, value) => setFields(f => ({ ...f, [key]: { value, touched: true } }))
  const setNow = (key) => setValue(key, toChicagoLocalInput(new Date()))

  async function save() {
    setBusy(true); setErr('')
    try {
      const payload = { loadId: target.loadId, shiftId }
      for (const { key } of FIELDS) {
        const f = fields[key]
        payload[key] = f.touched && f.value ? chicagoLocalToISO(f.value) : null // only changed fields
      }
      const data = await saveLoadCheckpoints(payload)
      setResult({ pickup_minutes: data.pickup_minutes, delivery_minutes: data.delivery_minutes })
      toast.success('Checkpoint times saved')
      onSaved?.()
    } catch (e) {
      setErr(e.message); toast.error(e.message) // surface the RPC reason verbatim
    } finally { setBusy(false) }
  }

  const pu = fmtDuration(result?.pickup_minutes)
  const dl = fmtDuration(result?.delivery_minutes)

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Checkpoint times</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500 truncate">{target.driverName || 'Driver'}{target.loadNumber ? ` · ${target.loadNumber}` : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-3">
          {err && <div className={S.errorBox}>{err}</div>}
          <p className="text-[11px] text-gray-400 dark:text-slate-500">Times are Central (Chicago). Empty fields default to now — adjust if the driver reported late.</p>

          {FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className={S.label}>{label}</label>
              <div className="flex items-center gap-2">
                <input type="datetime-local" className={`${S.input} flex-1`} value={fields[key].value}
                  onChange={e => setValue(key, e.target.value)} />
                <button type="button" onClick={() => setNow(key)} className={S.btnSecondary}>Now</button>
              </div>
            </div>
          ))}

          {result && (pu || dl) && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-3 space-y-0.5">
              {pu && <p className="text-sm text-emerald-800 dark:text-emerald-300">Time at shipper: <span className="font-bold">{pu}</span></p>}
              {dl && <p className="text-sm text-emerald-800 dark:text-emerald-300">Time at receiver: <span className="font-bold">{dl}</span></p>}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 dark:border-white/5 p-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={S.btnCancel}>{result ? 'Done' : 'Cancel'}</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Saving…' : 'Save times'}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
