import { useEffect, useState } from 'react'
import { S } from '../../../lib/styles'
import {
  saveLoadCheckpoints, toChicagoLocalInput, chicagoLocalToISO, fmtDuration,
} from './shiftBoardData'
import { computeAmount, minutesBetween } from './accessorialData'
import DateTimePicker from './DateTimePicker'

// The checkpoint times, inline in the row panel — there is no modal.
//
// Laid out as two STOP blocks (pickup, delivery), each with IN and OUT side by
// side and its own duration underneath. The duration belongs to the stop it was
// measured at; floating it at the foot of the panel made you work out which one
// it referred to. The panel's own width is unchanged — only its internals.
//
// Only fields the associate actually touches are sent, so opening this on a load
// still sitting at the shipper never stamps a delivery time.

const STOPS = [
  {
    key: 'pickup', label: 'Pickup', at: 'shipper',
    inKey: 'pickupIn', outKey: 'pickupOut',
    inCol: 'cp_pickup_in', outCol: 'cp_pickup_out',
    cityCol: 'origin_city', stateCol: 'origin_state',
  },
  {
    key: 'delivery', label: 'Delivery', at: 'receiver',
    inKey: 'deliveryIn', outKey: 'deliveryOut',
    inCol: 'cp_delivery_in', outCol: 'cp_delivery_out',
    cityCol: 'destination_city', stateCol: 'destination_state',
  },
]
const ALL = STOPS.flatMap(s => [
  { key: s.inKey, col: s.inCol }, { key: s.outKey, col: s.outCol },
])

export default function CheckpointFields({ row, shiftId, freeMinutes, onSaved, onTimesSaved, toast }) {
  const loadId = row.load_id || null

  const build = () => {
    const f = {}
    // Empty stays EMPTY — it reads "Not recorded" rather than pre-filling now,
    // which used to make it easy to stamp a time nobody reported.
    for (const { key, col } of ALL) f[key] = { value: row[col] ? toChicagoLocalInput(row[col]) : '', touched: false }
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

  const setValue = (key, value) => setFields(f => ({ ...f, [key]: { value, touched: true } }))
  const setNow = (key) => setValue(key, toChicagoLocalInput(new Date()))

  const dirty = ALL.some(({ key }) => fields[key].touched)

  // Durations recompute from what's on screen, so they move as a time is typed
  // rather than waiting for the save to come back.
  const isoOf = (key) => {
    const f = fields[key]
    if (f.touched) return f.value ? chicagoLocalToISO(f.value) : null
    return row[ALL.find(x => x.key === key).col] || null
  }

  async function save() {
    if (!loadId) return
    setBusy(true); setErr('')
    try {
      const payload = { loadId, shiftId }
      for (const { key } of ALL) {
        const f = fields[key]
        payload[key] = f.touched && f.value ? chicagoLocalToISO(f.value) : null // only changed fields
      }
      await saveLoadCheckpoints(payload)

      // Hand the saved instants back so the shared board row updates. Panel ②
      // reads its detained minutes from that row — without this it kept saying
      // "No time recorded at this stop yet" until a page reload.
      const patch = {}
      for (const { key, col } of ALL) if (payload[key]) patch[col] = payload[key]
      if (Object.keys(patch).length) onTimesSaved?.(loadId, patch)

      toast?.success('Checkpoint times saved')
      await onSaved?.()
    } catch (e) {
      setErr(e.message); toast?.error(e.message) // surface the RPC reason verbatim
    } finally { setBusy(false) }
  }

  return (
    <div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-2.5">
        Times are Central (Chicago). Use <span className="font-medium">Now</span> to stamp the current time, or type it.
      </p>

      <div className="space-y-3">
        {STOPS.map(stop => (
          <StopBlock key={stop.key} stop={stop} row={row} fields={fields} isoOf={isoOf}
            freeMinutes={freeMinutes} loadId={loadId} setValue={setValue} setNow={setNow} />
        ))}
      </div>

      {err && <div className={`${S.errorBox} mt-2`}>{err}</div>}

      <button type="button" onClick={save} disabled={busy || !dirty || !loadId}
        className="mt-3 w-full px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-lg transition-colors">
        {busy ? 'Saving…' : dirty ? 'Save times' : 'No changes'}
      </button>
      {!loadId && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">No load on the board — nothing to time.</p>}
    </div>
  )
}

function StopBlock({ stop, row, fields, isoOf, freeMinutes, loadId, setValue, setNow }) {
  // Parsed server-side rules, applied once at fetch — never re-parsed here.
  const city = row[stop.cityCol]
  const st = row[stop.stateCol]
  const inIso = isoOf(stop.inKey)
  const outIso = isoOf(stop.outKey)
  const mins = minutesBetween(inIso, outIso)
  const stillThere = !!inIso && !outIso
  const { hours } = computeAmount(mins, freeMinutes, null)

  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 dark:bg-white/[0.04] border-b border-gray-200 dark:border-white/10">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-slate-400">{stop.label}</span>
        {/* A malformed TMS record parses to null — show a dash, never the date
            fragment that used to leak through as a "city". */}
        <span className="text-[11px] text-gray-600 dark:text-slate-300 truncate">
          {city ? `${city}${st ? `, ${st}` : ''}` : '—'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 p-2">
        {[['IN', stop.inKey], ['OUT', stop.outKey]].map(([label, key]) => {
          const has = !!fields[key].value
          return (
            <div key={key}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</span>
                {has ? (
                  <span className="text-[8px] font-bold px-1 py-px rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">SAVED</span>
                ) : (
                  <span className="text-[9px] text-gray-400 dark:text-slate-500 italic">Not recorded</span>
                )}
              </div>
              <DateTimePicker value={fields[key].value} disabled={!loadId} tone={has ? 'saved' : 'plain'}
                onChange={v => setValue(key, v)} />
              <button type="button" onClick={() => setNow(key)} disabled={!loadId}
                className="mt-1 w-full px-2 py-0.5 rounded-lg text-[10px] font-medium border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">
                Now
              </button>
            </div>
          )
        })}
      </div>

      {/* The duration for THIS stop, under it. */}
      <div className="flex items-center gap-2 px-2 py-1 border-t border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.02]">
        <span className="text-[11px] text-gray-700 dark:text-slate-300">
          {mins != null
            ? <>Detained <span className="font-bold tabular-nums">{fmtDuration(mins)}</span>{stillThere && <span className="text-amber-600 dark:text-amber-400"> · still there</span>}</>
            : <span className="text-gray-400 dark:text-slate-500">Not at {stop.at} yet</span>}
        </span>
        <span className="flex-1 border-b border-dotted border-gray-300 dark:border-white/10" />
        <span className="text-[11px] font-semibold tabular-nums text-gray-700 dark:text-slate-300 shrink-0">
          {mins != null && hours > 0 ? `${hours} billable hr${hours === 1 ? '' : 's'}` : '—'}
        </span>
      </div>
    </div>
  )
}
