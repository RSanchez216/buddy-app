import { useCallback, useEffect, useMemo, useState } from 'react'
import { S } from '../../../lib/styles'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import {
  TERM_TYPES, TERM_LOCATIONS, termTypeLabel, termLocationLabel, isHourly,
  fetchBrokerTerms, createBrokerTerms, endBrokerTerms, termsSummary,
  hoursToMinutes, FREE_TIME_FLOOR_MIN,
} from './brokerTermsData'

// A broker's standing accessorial terms.
//
// These are a FALLBACK. The rate confirmation on a given load always wins; these
// fill in only where the document is silent, which for C.H. Robinson is every
// one of the 11 cons read.
//
// Ending terms sets effective_to and moves them to history. Nothing is edited in
// place: a claim filed in July has to reconcile against the terms that were true
// in July, and an in-place edit destroys the only evidence of what those were.

const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500'
const META = 'text-gray-400 dark:text-slate-500'

const fmtDate = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const todayChicago = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

export default function AccessorialTermsPanel({ customerId, brokerName }) {
  const { profile } = useAuth()
  const toast = useToast()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [terms, setTerms] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    if (!customerId) { setTerms([]); setLoading(false); return }
    setLoading(true)
    try { setTerms(await fetchBrokerTerms(customerId)) }
    catch (e) { toast.error("Couldn't load accessorial terms", e) }
    finally { setLoading(false) }
  }, [customerId, toast])

  useEffect(() => { load() }, [customerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const { active, ended } = useMemo(() => ({
    active: terms.filter(t => !t.effective_to),
    ended: terms.filter(t => t.effective_to),
  }), [terms])

  return (
    <div className={`${S.card} p-4`}>
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Accessorial terms</h3>
        {canEdit && customerId && (
          <button onClick={() => setAdding(a => !a)} className={`ml-auto ${S.btnSecondary}`}>
            {adding ? 'Cancel' : 'Add terms'}
          </button>
        )}
      </div>
      <p className={`mt-1 text-[11px] ${META}`}>
        Used only where a load&apos;s rate confirmation is silent. The rate con always wins.
      </p>

      {adding && (
        <TermsForm customerId={customerId} onDone={async () => { setAdding(false); await load() }}
          onCancel={() => setAdding(false)} />
      )}

      {loading ? (
        <div className="mt-3 h-16 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
      ) : (
        <>
          <div className="mt-3 space-y-1.5">
            {active.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 italic">
                No recorded terms for {brokerName || 'this broker'}. The request form has nothing to fall back on.
              </p>
            ) : active.map(t => (
              <TermsRow key={t.id} t={t} canEdit={canEdit} onChanged={load} />
            ))}
          </div>

          {ended.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
              <button onClick={() => setShowHistory(h => !h)} className={`${EYEBROW} hover:underline`}>
                {showHistory ? '▾' : '▸'} Earlier terms — {ended.length}
              </button>
              {showHistory && (
                <div className="mt-1.5 space-y-1.5">
                  {ended.map(t => <TermsRow key={t.id} t={t} history />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TermsRow({ t, canEdit, history, onChanged }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const end = async () => {
    setBusy(true)
    try { await endBrokerTerms(t.id); toast.success('Terms ended'); await onChanged?.() }
    catch (e) { toast.error("Couldn't end these terms", e) }
    finally { setBusy(false); setConfirming(false) }
  }

  return (
    <div className={`rounded-lg border p-2.5 ${
      history ? 'bg-gray-50 dark:bg-white/[0.02] border-gray-200 dark:border-white/10'
        : 'bg-white dark:bg-white/[0.02] border-gray-200 dark:border-white/10'}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[12px] font-semibold text-gray-900 dark:text-white">{termTypeLabel(t.accessorial_type)}</span>
        {t.location !== 'any' && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400">
            {termLocationLabel(t.location)}
          </span>
        )}
        <span className="text-[11px] font-mono tabular-nums text-gray-700 dark:text-slate-300">{termsSummary(t)}</span>
      </div>
      {t.note && <p className={`mt-1 text-[11px] italic ${META}`}>{t.note}</p>}
      <p className={`mt-1 text-[10px] ${META}`}>
        {t.source} · from {fmtDate(t.effective_from)}
        {t.effective_to && ` → ended ${fmtDate(t.effective_to)}`}
      </p>

      {!history && canEdit && (
        <div className="mt-2 flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[11px] text-gray-500 dark:text-slate-400">End these terms?</span>
              <button onClick={end} disabled={busy}
                className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50">
                {busy ? 'Saving…' : 'Yes'}
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy}
                className="text-[11px] text-gray-500 dark:text-slate-400 hover:underline">No</button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)}
              className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">
              End these terms
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Exported so the Raise-the-request shortcut opens the SAME form rather than a
// second one that could drift from it.
export function TermsForm({ customerId, onDone, onCancel, prefill }) {
  const { profile } = useAuth()
  const toast = useToast()
  const [type, setType] = useState('detention')
  const [location, setLocation] = useState('any')
  const [freeHours, setFreeHours] = useState(prefill?.freeHours ?? '')
  const [rate, setRate] = useState(prefill?.rate ?? '')
  const [blockHours, setBlockHours] = useState('1')
  const [cap, setCap] = useState('')
  const [flat, setFlat] = useState('')
  const [notice, setNotice] = useState('')
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [from, setFrom] = useState(todayChicago())
  const [busy, setBusy] = useState(false)

  const hourly = isHourly(type)
  const freeMinutes = hoursToMinutes(freeHours)
  const suspect = hourly && freeMinutes != null && Number(rate) > 0 && freeMinutes < FREE_TIME_FLOOR_MIN

  const save = async () => {
    setBusy(true)
    try {
      await createBrokerTerms({
        customerId, accessorialType: type, location,
        freeHours, ratePerHour: rate,
        blockMinutes: hoursToMinutes(blockHours) ?? 60,
        maxAmount: cap, flatAmount: flat, noticeHours: notice,
        source, note, effectiveFrom: from, userId: profile?.id,
      })
      toast.success('Terms recorded')
      await onDone()
    } catch (e) { toast.error("Couldn't record the terms", e) }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={S.label}>Type</label>
          <select className={S.input} value={type} onChange={e => setType(e.target.value)}>
            {TERM_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={S.label}>Applies at</label>
          <select className={S.input} value={location} onChange={e => setLocation(e.target.value)}>
            {TERM_LOCATIONS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {hourly ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            {/* HOURS, with the unit on the field. Never minutes. */}
            <label className={S.label}>Free time</label>
            <UnitInput value={freeHours} onChange={setFreeHours} unit="hours" placeholder="2" />
          </div>
          <div>
            <label className={S.label}>Rate per hour</label>
            <input className={S.input} value={rate} onChange={e => setRate(e.target.value)} placeholder="35" />
          </div>
          <div>
            <label className={S.label}>Block size</label>
            <UnitInput value={blockHours} onChange={setBlockHours} unit="hours" placeholder="1" />
          </div>
          <div>
            <label className={S.label}>Cap <span className="font-normal normal-case text-gray-400">(optional)</span></label>
            <input className={S.input} value={cap} onChange={e => setCap(e.target.value)} placeholder="500" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={S.label}>Flat amount</label>
            <input className={S.input} value={flat} onChange={e => setFlat(e.target.value)} placeholder="150" />
          </div>
          <div>
            <label className={S.label}>Cap <span className="font-normal normal-case text-gray-400">(optional)</span></label>
            <input className={S.input} value={cap} onChange={e => setCap(e.target.value)} placeholder="500" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={S.label}>Notice window <span className="font-normal normal-case text-gray-400">(optional)</span></label>
          <UnitInput value={notice} onChange={setNotice} unit="hours" placeholder="24" />
        </div>
        <div>
          <label className={S.label}>Effective from</label>
          <input type="date" className={S.input} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={S.label}>Where these terms come from</label>
        <input className={S.input} value={source} onChange={e => setSource(e.target.value)}
          placeholder="Broker packet, Aug 2026 · email from their AP desk · carrier agreement" />
      </div>
      <div>
        <label className={S.label}>Note <span className="font-normal normal-case text-gray-400">(optional)</span></label>
        <input className={S.input} value={note} onChange={e => setNote(e.target.value)} />
      </div>

      {suspect && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400">
          {freeHours} hours is {freeMinutes} minutes of free time. That looks like hours typed into a minutes box.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className={S.btnCancel}>Cancel</button>
        <button onClick={save} disabled={busy || suspect || !source.trim()}
          className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 text-white rounded-lg transition-all">
          {busy ? 'Saving…' : 'Record terms'}
        </button>
      </div>
    </div>
  )
}

// An input that wears its unit, so the number and the unit can't be read apart.
function UnitInput({ value, onChange, unit, placeholder }) {
  return (
    <div className="relative">
      <input type="text" inputMode="decimal" className={`${S.input} pr-14`} value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={placeholder} />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 pointer-events-none">
        {unit}
      </span>
    </div>
  )
}
