import { useMemo, useState } from 'react'
import Modal from '../../../../components/Modal'
import { S } from '../../../../lib/styles'
import { useToast } from '../../../../contexts/ToastContext'
import { TRAILER_TYPES, TRAILER_TYPE_COLORS, UNATTACHED_POOL } from '../../../../data/dedicatedLanesMock'
import cityCoords from '../lanes/laneCityCoords.json'

// New Dedicated Lane — the lane *profile* form. UI-only this pass: fields
// capture the shape the Supabase insert will take, the map pin resolves from
// the same gazetteer the Lane Flow Map uses (stand-in for geo_norm() →
// geo_places), and Create just confirms via toast. No writes.

const FLD_HELP = 'text-[11px] text-gray-400 dark:text-slate-500 mt-1'

// "City, ST" lookup against the bundled gazetteer (case-insensitive).
function resolvePin(city, state) {
  const key = `${(city || '').trim()}, ${(state || '').trim().toUpperCase()}`
  if (key.length < 5) return null
  const hit = Object.entries(cityCoords.cities).find(([k]) => k.toLowerCase() === key.toLowerCase())
  return hit ? { key: hit[0], lat: hit[1][0], lng: hit[1][1] } : null
}

export default function NewLaneModal({ open, onClose }) {
  const toast = useToast()
  const [form, setForm] = useState({ name: '', customer: '', costPerDay: '', city: '', state: '', origin: '', destination: '' })
  const [types, setTypes] = useState(new Set(['Dry Van']))
  const [assigned, setAssigned] = useState([])
  const [unitQuery, setUnitQuery] = useState('')

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const pin = useMemo(() => resolvePin(form.city, form.state), [form.city, form.state])

  const suggestions = useMemo(() => {
    const q = unitQuery.trim().replace(/^#/, '')
    if (!q) return []
    return UNATTACHED_POOL.filter(u => !assigned.includes(u) && u.replace('#', '').startsWith(q)).slice(0, 6)
  }, [unitQuery, assigned])

  function toggleType(t) {
    setTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t); else next.add(t)
      return next
    })
  }

  function create() {
    if (!form.name.trim()) {
      toast.error('Give the lane a name first.')
      return
    }
    toast.success(`Lane profile “${form.name.trim()}” captured — saving lands with the Supabase wiring next pass.`)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New Dedicated Lane" size="lg">
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={S.label}>Lane name</label>
          <input className={S.input} placeholder="e.g. Laredo Produce" value={form.name} onChange={set('name')} autoFocus />
        </div>
        <div>
          <label className={S.label}>Customer / Contract</label>
          <input className={S.input} placeholder="optional — link later" value={form.customer} onChange={set('customer')} />
          <p className={FLD_HELP}>ties into the Contracts model</p>
        </div>
        <div>
          <label className={S.label}>Equip cost / day</label>
          <input className={S.input} placeholder="$35.00" inputMode="decimal" value={form.costPerDay} onChange={set('costPerDay')} />
          <p className={FLD_HELP}>drives idle cost</p>
        </div>
        <div>
          <label className={S.label}>Facility city</label>
          <input className={S.input} placeholder="Laredo" value={form.city} onChange={set('city')} />
        </div>
        <div>
          <label className={S.label}>State</label>
          <input className={S.input} placeholder="TX" maxLength={2} value={form.state} onChange={set('state')} />
        </div>
        <div className="sm:col-span-2">
          <label className={S.label}>Map pin</label>
          <div className={`px-3 py-2 rounded-xl border text-sm flex items-center gap-2 ${
            pin
              ? 'border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400'
              : 'border-gray-300 dark:border-slate-700/40 bg-gray-50 dark:bg-white/[0.03] text-gray-400 dark:text-slate-500'
          }`}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {pin
              ? <span className="tabular-nums">{pin.key} · {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}</span>
              : <span>auto-resolves from city + state</span>}
          </div>
          <p className={FLD_HELP}>resolves via geo_norm() → geo_places once wired</p>
        </div>
        <div>
          <label className={S.label}>Origin (optional)</label>
          <input className={S.input} placeholder="Laredo, TX" value={form.origin} onChange={set('origin')} />
        </div>
        <div>
          <label className={S.label}>Destination (optional)</label>
          <input className={S.input} placeholder="Dallas, TX" value={form.destination} onChange={set('destination')} />
        </div>
        <div className="sm:col-span-2">
          <label className={S.label}>Trailer types staged here</label>
          <div className="flex flex-wrap gap-2">
            {TRAILER_TYPES.map(t => {
              const on = types.has(t)
              return (
                <button key={t} type="button" onClick={() => toggleType(t)} aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
                    on
                      ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-400'
                      : 'border-gray-300 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: TRAILER_TYPE_COLORS[t] }} />
                  {t}
                </button>
              )
            })}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={S.label}>Assign trailers</label>
          {assigned.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {assigned.map(u => (
                <span key={u} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 text-xs font-bold tabular-nums">
                  {u}
                  <button type="button" onClick={() => setAssigned(a => a.filter(x => x !== u))}
                    className="hover:text-orange-900 dark:hover:text-orange-200" aria-label={`Remove ${u}`}>✕</button>
                </span>
              ))}
            </div>
          )}
          <input className={S.input} placeholder="search unit # — 5210, 4227 …" value={unitQuery} onChange={e => setUnitQuery(e.target.value)} />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestions.map(u => (
                <button key={u} type="button"
                  onClick={() => { setAssigned(a => [...a, u]); setUnitQuery('') }}
                  className="px-2 py-1 rounded-lg border border-gray-300 dark:border-slate-700 text-xs font-bold tabular-nums text-gray-600 dark:text-slate-300 hover:border-orange-300 dark:hover:border-orange-500/40 hover:text-orange-600 dark:hover:text-orange-400 transition-colors">
                  + {u}
                </button>
              ))}
            </div>
          )}
          <p className={FLD_HELP}>pulls from unattached / available trailers</p>
        </div>
      </div>
      <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-white/5">
        <button onClick={onClose} className={S.btnCancel}>Cancel</button>
        <button onClick={create}
          className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20">
          Create lane
        </button>
      </div>
    </Modal>
  )
}
