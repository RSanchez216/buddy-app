import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../lib/styles'
import { copyText, fmtClock, fmtDuration, money } from './shiftBoardData'
import CheckpointFields from './CheckpointFields'
import {
  DOC_TYPES, RESPONSES, typeLabel, docTypeLabel, statusMeta,
  computeAmount, minutesBetween, fetchLoadAccessorials, fetchAccessorialDocs,
  fetchAccessorialTypes, addAccessorialType,
  raiseAccessorial, recordBrokerResponse, uploadAccessorialDoc, signedDocUrl, buildRequestCopy,
  fetchBrokerRules, policyForType,
} from './accessorialData'

// The panel that opens under a driver row on the Shift Board. Three columns:
// the checkpoint times (entered here, inline — there is no modal), the
// accessorial request being raised, and the evidence behind it. Then everything
// already requested on this load and this driver.
//
// A request always belongs to a load. Without row.load_id nothing can be
// submitted, because raise_accessorial refuses and so should the UI.

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
// Money held as a raw string while typing so a trailing '.' survives; ',' and
// '.' both work as the decimal separator.
const normalizeMoney = (s) => String(s).replace(',', '.').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
const normalizeInt = (s) => String(s).replace(/[^0-9]/g, '')

const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500'

export default function AccessorialPanel({
  row, exception, meId, toast, onChanged, onTimesSaved, shiftId,
  accessorialsOn = true, trackCheckpoints = true, canAddTypes,
  activities, onRemoveActivity,
}) {
  const loadId = row.load_id || null

  // ── Broker rules from the rate confirmation (session-cached per load) ──────
  const [brokerRules, setBrokerRules] = useState(null)
  const [brokerLoading, setBrokerLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    if (!loadId) { setBrokerRules(null); setBrokerLoading(false); return }
    setBrokerLoading(true)
    fetchBrokerRules(loadId)
      .then(r => { if (!cancelled) setBrokerRules(r) })
      .catch(() => { if (!cancelled) setBrokerRules(null) })
      .finally(() => { if (!cancelled) setBrokerLoading(false) })
    return () => { cancelled = true }
  }, [loadId])

  // ── Types — from the lookup, never hardcoded ──────────────────────────────
  const [types, setTypes] = useState([])
  const [typesError, setTypesError] = useState('')
  const [type, setType] = useState(null)
  const [addingType, setAddingType] = useState(false)

  const loadTypes = useCallback(async () => {
    try {
      const t = await fetchAccessorialTypes()
      setTypes(t)
      setType(cur => cur && t.some(x => x.code === cur) ? cur : (t[0]?.code ?? null))
    } catch (e) {
      setTypesError(e?.message || 'Could not load the accessorial types.')
    }
  }, [])
  useEffect(() => { if (accessorialsOn) loadTypes() }, [accessorialsOn, loadTypes])

  const typeDef = types.find(t => t.code === type) || null
  const flat = (typeDef?.basis || 'flat') === 'flat'

  // ── Requests already on record ────────────────────────────────────────────
  const [requests, setRequests] = useState([])
  const [requestsLoading, setRequestsLoading] = useState(true)
  const [requestsError, setRequestsError] = useState('')

  const reloadRequests = useCallback(async () => {
    if (!loadId || !accessorialsOn) { setRequests([]); setRequestsLoading(false); return }
    setRequestsLoading(true); setRequestsError('')
    try {
      setRequests(await fetchLoadAccessorials(loadId, row.driver_id))
    } catch (e) {
      setRequestsError(e?.message || 'Could not load the requests on this driver.')
    } finally { setRequestsLoading(false) }
  }, [loadId, row.driver_id, accessorialsOn])

  useEffect(() => { reloadRequests() }, [reloadRequests])

  // ── The request being raised ──────────────────────────────────────────────
  const [stop, setStop] = useState(() => (row.cp_delivery_in && !row.cp_pickup_in ? 'receiver' : 'shipper'))
  const [freeMin, setFreeMin] = useState('')
  const [rate, setRate] = useState('')
  const [amount, setAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [note, setNote] = useState('')
  const [staged, setStaged] = useState([]) // [{ file, docType, note }] — uploaded once the request has an id
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Free time and rate come from the type's defaults when it has them.
  useEffect(() => {
    if (!typeDef) return
    setFreeMin(typeDef.default_free_minutes != null ? String(typeDef.default_free_minutes) : '')
    setRate(typeDef.default_rate != null ? String(typeDef.default_rate) : '')
    setAmount(''); setAmountTouched(false); setErr('')
  }, [typeDef])

  const shipperMinutes = minutesBetween(row.cp_pickup_in, row.cp_pickup_out)
  const receiverMinutes = minutesBetween(row.cp_delivery_in, row.cp_delivery_out)
  const detainedMinutes = stop === 'shipper' ? shipperMinutes : receiverMinutes
  // `location` is constrained to 'shipper' | 'receiver' — the stop, not the city.
  const stopCityLabel = stop === 'shipper' ? row.origin_city : row.destination_city

  const calc = useMemo(
    () => computeAmount(detainedMinutes, freeMin, rate),
    [detainedMinutes, freeMin, rate],
  )

  // The amount auto-fills from time × rate and stays editable at all times.
  // Typing over it flips the label to "entered manually" and stops the maths
  // from stomping what was typed.
  useEffect(() => {
    if (amountTouched || flat) return
    setAmount(calc.amount > 0 ? calc.amount.toFixed(2) : '')
  }, [calc.amount, amountTouched, flat])

  const canCalculate = !flat && detainedMinutes != null && num(rate) > 0
  const amountSource = amountTouched ? 'entered manually' : canCalculate ? 'calculated' : null

  function addStaged(file) {
    if (!file) return
    setStaged(s => [...s, { file, docType: 'broker_email', note: '' }])
  }
  const setStagedField = (i, patch) => setStaged(s => s.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const removeStaged = (i) => setStaged(s => s.filter((_, j) => j !== i))

  async function submit() {
    setErr('')
    if (!loadId) { setErr('This driver has no load on the board — an accessorial request must be tied to a load.'); return }
    if (!type) { setErr('Pick a type.'); return }

    setSaving(true)
    try {
      // Send a null amount when nothing was typed and the maths can run — the
      // RPC calculates and reports amount_source. Otherwise send what was typed.
      const typed = num(amount)
      const useCalculated = !amountTouched && !flat && canCalculate
      const res = await raiseAccessorial({
        loadId,
        type,
        amount: useCalculated ? null : typed,
        location: flat ? null : stop,
        detainedMinutes: flat ? null : detainedMinutes,
        freeMinutes: flat ? null : num(freeMin),
        ratePerHour: flat ? null : num(rate),
        note: note.trim() || null,
      })

      // Documents can only be attached once the request has an id.
      let failed = 0
      for (const d of staged) {
        try { await uploadAccessorialDoc(res.id, d.docType, d.file, d.note, meId) }
        catch { failed += 1 }
      }

      const label = res.type_label || typeLabel(type)
      toast?.success(
        `${label} request raised · ${money(res.amount, 2)}${res.filed_same_day ? ' · filed same day' : ''}`
      )
      if (failed > 0) toast?.error(`${failed} document${failed === 1 ? '' : 's'} did not upload — add them from the request below.`)

      setStaged([]); setNote(''); setAmount(''); setAmountTouched(false)
      await reloadRequests()
      await onChanged?.()
    } catch (e) {
      setErr(e?.message || 'Could not raise the request.') // RPC reason, verbatim
      toast?.error(e?.message || 'Could not raise the request.')
    } finally { setSaving(false) }
  }

  const onThisLoad = requests.filter(r => r.same_load)
  const otherLoads = requests.filter(r => !r.same_load)
  const cols = accessorialsOn && trackCheckpoints ? 3 : accessorialsOn ? 2 : 1
  // Unequal columns so panel ①'s two datetime inputs keep ~285px (equal columns
  // leave it ~299px, which clips the moment the sidebar expands); ④ is the narrow
  // key/value column. Below xl, ④ spans the full row as a band — exactly today's
  // layout — and only becomes its own column at xl.
  const GRID_CLASS = {
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.15fr_1fr_1fr_0.85fr]',
    2: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_0.85fr]',
    1: 'grid-cols-1 xl:grid-cols-[1.2fr_0.85fr]',
  }
  const BROKER_SPAN = { 3: 'lg:col-span-3 xl:col-span-1', 2: 'md:col-span-2 xl:col-span-1', 1: 'xl:col-span-1' }

  return (
    <div className="border-t border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.02] px-4 py-4 space-y-4">
      {/* Header line — which load this request will belong to */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{row.driver_name || 'Driver'}</span>
        {row.load_number
          ? <span className="text-xs text-gray-500 dark:text-slate-400">Load <span className="font-mono text-gray-700 dark:text-slate-300">{row.load_number}</span></span>
          : <span className="text-xs text-amber-600 dark:text-amber-400">No load on the board — nothing can be requested</span>}
        {row.carrier_name && <span className="text-xs text-gray-400 dark:text-slate-500">· {row.carrier_name}</span>}
        {exception?.over_free_time && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30">
            Detention likely · {fmtDuration(exception.minutes_waiting)} at the {exception.stop}
          </span>
        )}
      </div>

      <div className={`grid gap-4 ${GRID_CLASS[cols] || GRID_CLASS[3]}`}>
        {/* ① Checkpoint times — inline, no modal */}
        {trackCheckpoints && (
          <Column n={1} title="Checkpoint times">
            <CheckpointFields row={row} shiftId={shiftId} toast={toast}
              freeMinutes={flat ? null : num(freeMin)}
              onSaved={onChanged} onTimesSaved={onTimesSaved} />
          </Column>
        )}

        {accessorialsOn && (
          <>
            {/* ② Raise the request */}
            <Column n={trackCheckpoints ? 2 : 1} title="Raise the request">
              {typesError ? (
                <div className={S.errorBox}>{typesError}</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {types.map(t => (
                    <button key={t.code} type="button" onClick={() => setType(t.code)}
                      title={t.basis === 'hourly' ? 'Billed by the hour' : 'Flat amount'}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        type === t.code
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-white dark:hover:bg-white/5'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                  {canAddTypes && (
                    <button type="button" onClick={() => setAddingType(true)} title="Add an accessorial type"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-dashed border-gray-300 dark:border-slate-600 text-gray-400 hover:text-orange-500 hover:border-orange-400">
                      +
                    </button>
                  )}
                </div>
              )}

              {/* Hourly types bill a clock; flat types have none to show. */}
              {!flat && (
                <>
                  <div className="mt-3 flex items-center gap-1.5">
                    {[['shipper', 'At shipper'], ['receiver', 'At receiver']].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => { setStop(v); setAmountTouched(false) }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                          stop === v
                            ? 'bg-gray-900 dark:bg-white/10 text-white dark:text-slate-100 border-gray-900 dark:border-white/20'
                            : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-white dark:hover:bg-white/5'
                        }`}>
                        {l}
                      </button>
                    ))}
                    {stopCityLabel && <span className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{stopCityLabel}</span>}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div>
                      <label className={S.label}>Free time (min)</label>
                      <input type="text" inputMode="numeric" className={S.input} value={freeMin}
                        onChange={e => { setFreeMin(normalizeInt(e.target.value)); setAmountTouched(false) }} placeholder="120" />
                    </div>
                    <div>
                      <label className={S.label}>Rate per hour</label>
                      <input type="text" inputMode="decimal" className={S.input} value={rate}
                        onChange={e => { setRate(normalizeMoney(e.target.value)); setAmountTouched(false) }} placeholder="75.00" />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">From the rate confirmation for this load — brokers differ, so these are not settings.</p>

                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2 tabular-nums">
                    {detainedMinutes == null
                      ? 'No time recorded at this stop yet — enter it on the left, or type an amount.'
                      : `${fmtDuration(detainedMinutes)} detained − ${fmtDuration(num(freeMin) || 0)} free = ${calc.hours} billable hour${calc.hours === 1 ? '' : 's'} (rounded up)`}
                  </p>
                </>
              )}

              <div className="mt-3">
                <label className={S.label}>
                  Request amount
                  {amountSource && <span className="font-normal normal-case text-gray-400 dark:text-slate-500"> · {amountSource}</span>}
                </label>
                <input type="text" inputMode="decimal" className={`${S.input} font-mono tabular-nums font-semibold`} value={amount}
                  onChange={e => { setAmount(normalizeMoney(e.target.value)); setAmountTouched(true) }}
                  onBlur={() => { const n = parseFloat(amount); setAmount(Number.isFinite(n) ? n.toFixed(2) : '') }}
                  placeholder="0.00" />
                {amountTouched && canCalculate && Math.abs((num(amount) || 0) - calc.amount) > 0.005 && (
                  <button type="button" onClick={() => { setAmountTouched(false); setAmount(calc.amount.toFixed(2)) }}
                    className="mt-1 text-[11px] text-gray-500 dark:text-slate-400 hover:underline">
                    Calculated was {money(calc.amount, 2)} — use it
                  </button>
                )}
              </div>

              {/* Policy from the rate con, following the selected type. Warns —
                  never blocks: the parse can be wrong and the associate may know
                  more than it does. */}
              <AccessorialPolicyCallout rules={brokerRules} typeCode={type} typeLabel={typeDef?.label} />

              {err && <div className={`${S.errorBox} mt-3`}>{err}</div>}

              <button type="button" onClick={submit} disabled={saving || !loadId || !type}
                className="mt-3 w-full px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all">
                {saving ? 'Raising…' : `Raise ${(typeDef?.label || 'accessorial').toLowerCase()} request${policyForType(brokerRules, type)?.policy === 'not_paid' ? ' anyway' : ''}`}
              </button>
              {!loadId && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">An accessorial request belongs to a load. Book or link one first.</p>}
            </Column>

            {/* ③ Evidence and notes */}
            <Column n={trackCheckpoints ? 3 : 2} title="Evidence and notes" fill>
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/[0.06] p-2.5">
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Checkpoint log — attached automatically</p>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/70 mt-0.5 tabular-nums">
                  {(row.cp_pickup_in || row.cp_pickup_out || row.cp_delivery_in || row.cp_delivery_out)
                    ? `PU ${fmtClock(row.cp_pickup_in) || '—'}/${fmtClock(row.cp_pickup_out) || '—'} · DL ${fmtClock(row.cp_delivery_in) || '—'}/${fmtClock(row.cp_delivery_out) || '—'}`
                    : 'No times recorded yet'}
                </p>
              </div>

              {/* Where the POD is sent, straight off the rate con. */}
              <PaperworkRouting rules={brokerRules} />

              <div className="mt-3">
                <label className={S.label}>Documents <span className="font-normal normal-case text-gray-400 dark:text-slate-500">· any number, any type</span></label>
                <div className="space-y-2">
                  {staged.map((d, i) => (
                    <div key={i} className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-700 dark:text-slate-300 truncate" title={d.file.name}>{d.file.name}</span>
                        <button type="button" onClick={() => removeStaged(i)} aria-label="Remove" className="ml-auto text-gray-400 hover:text-red-500 shrink-0">✕</button>
                      </div>
                      <select className={`${S.input} !py-1 text-xs`} value={d.docType} onChange={e => setStagedField(i, { docType: e.target.value })}>
                        {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input className={`${S.input} !py-1 text-xs`} value={d.note} onChange={e => setStagedField(i, { note: e.target.value })} placeholder="What this proves (optional)" />
                    </div>
                  ))}
                  <label className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-gray-300 dark:border-slate-600 text-xs text-gray-400 dark:text-slate-500 cursor-pointer hover:text-orange-500 hover:border-orange-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                    Add a document
                    <input type="file" className="hidden" onChange={e => { addStaged(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">Attached when the request is raised. If a broker refuses to pay in six weeks, this is what you fight it with.</p>
              </div>

              {/* min-h-0 is load-bearing: without it the flex child refuses to
                  shrink below its content height and the CARD grows instead of
                  the textarea filling. rows={3} stays as the small-screen floor —
                  below lg the grid is one column, there is no sibling to stretch
                  against, and flex-1 has nothing to expand into. */}
              <div className="mt-3 flex-1 flex flex-col min-h-0">
                <label className={S.label}>Note</label>
                <textarea rows={3} className={`${S.textarea} flex-1 min-h-[70px]`} value={note} onChange={e => setNote(e.target.value)}
                  placeholder="What happened — who was called, what the shipper said…" />
              </div>
            </Column>
          </>
        )}

        {/* ④ Broker rules — the narrow column. A full-width band below xl, its
            own column at xl. self-start so it sizes to its (often sparse) content
            instead of stretching to panel ①; do NOT give it panel ③'s fill. */}
        <div className={`${BROKER_SPAN[cols] || BROKER_SPAN[3]} self-start`}>
          <BrokerRulesPanel rules={brokerRules} loading={brokerLoading} />
        </div>
      </div>

      {/* Logged this shift — the delayed-undo surface. Each entry removes with a
          confirm (delete_shift_activity is a hard delete). */}
      <ActivityLog activities={activities} onRemove={onRemoveActivity} />

      {/* Already requested — this load and other loads, never merged */}
      {accessorialsOn && (
        <div className="border-t border-gray-200 dark:border-white/10 pt-3">
          {requestsError ? (
            <div className={S.errorBox}>{requestsError}</div>
          ) : requestsLoading ? (
            <div className="h-12 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse" />
          ) : requests.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-slate-500 italic">Nothing requested on this load or this driver yet.</p>
          ) : (
            <div className="space-y-3">
              <RequestGroup title={`On this load (${onThisLoad.length})`} requests={onThisLoad} meId={meId} toast={toast} onChanged={async () => { await reloadRequests(); await onChanged?.() }} />
              <RequestGroup title={`Other loads (${otherLoads.length})`} requests={otherLoads} meId={meId} toast={toast} onChanged={async () => { await reloadRequests(); await onChanged?.() }} showLoad />
            </div>
          )}
        </div>
      )}

      {addingType && (
        <AddTypeModal
          onClose={() => setAddingType(false)}
          onAdded={async (code) => {
            await loadTypes()
            setType(code)
            setAddingType(false)
            toast?.success('Accessorial type added')
          }}
        />
      )}
    </div>
  )
}

// Adding a type is a manager action; the RPC re-checks, so a refusal shows here
// verbatim rather than the form pretending it worked.
//
// A centred modal rather than an inline block: expanded inside the row it pushed
// the whole panel down and landed below the fold.
function AddTypeModal({ onClose, onAdded }) {
  const [label, setLabel] = useState('')
  const [basis, setBasis] = useState('flat')
  const [freeMin, setFreeMin] = useState('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function submit() {
    setErr('')
    if (!label.trim()) { setErr('A label is required.'); return }
    setBusy(true)
    try {
      const res = await addAccessorialType({
        label: label.trim(),
        basis,
        defaultFreeMinutes: basis === 'hourly' ? num(freeMin) : null,
        defaultRate: basis === 'hourly' ? num(rate) : null,
      })
      await onAdded?.(res.code)
    } catch (e) {
      setErr(e?.message || 'Could not add the type.') // RPC reason, verbatim
    } finally { setBusy(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="add-type-title"
        className="relative w-full max-w-sm rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <h3 id="add-type-title" className="text-base font-bold text-gray-900 dark:text-white">Add accessorial type</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={S.label}>Label</label>
            <input autoFocus className={S.input} value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="Driver Assist" />
          </div>

          <div>
            <label className={S.label}>How is it charged?</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['flat', 'Flat amount', 'One agreed figure'],
                ['hourly', 'Hourly', 'Billed by the hour'],
              ].map(([v, l, hint]) => (
                <button key={v} type="button" onClick={() => setBasis(v)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    basis === v
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}>
                  <span className="block text-sm font-semibold">{l}</span>
                  <span className={`block text-[10px] ${basis === v ? 'text-white/80' : 'text-gray-400 dark:text-slate-500'}`}>{hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Only meaningful for an hourly type — there is no clock on a flat one. */}
          <div className={basis === 'hourly' ? '' : 'opacity-40 pointer-events-none'}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={S.label}>Default free minutes</label>
                <input type="text" inputMode="numeric" className={S.input} value={freeMin}
                  disabled={basis !== 'hourly'}
                  onChange={e => setFreeMin(normalizeInt(e.target.value))} placeholder="120" />
              </div>
              <div>
                <label className={S.label}>Default rate /h</label>
                <input type="text" inputMode="decimal" className={S.input} value={rate}
                  disabled={basis !== 'hourly'}
                  onChange={e => setRate(normalizeMoney(e.target.value))} placeholder="75.00" />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">Optional — prefilled on the request, and still editable per load.</p>
          </div>

          <p className="text-[11px] text-gray-500 dark:text-slate-400 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 p-2.5">
            This is a shared list — a type added here appears for everyone raising an accessorial request.
          </p>

          {err && <div className={S.errorBox}>{err}</div>}
        </div>

        <div className="border-t border-gray-100 dark:border-white/5 p-4 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={S.btnCancel}>Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">
            {busy ? 'Adding…' : 'Add type'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// `fill` makes the card a flex column so a child marked flex-1 can absorb the
// height the grid row forces on it — panel ③ is stretched to panel ①'s height,
// which otherwise left ~85px of dead space under the note box.
function Column({ n, title, children, fill, tag }) {
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-3.5${fill ? ' flex flex-col' : ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 inline-flex items-center justify-center text-[10px] font-bold">{n}</span>
        <h4 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">{title}</h4>
        {tag && <span className="ml-auto text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border border-gray-200 dark:border-white/10 text-gray-400 dark:text-slate-500">{tag}</span>}
      </div>
      {children}
    </div>
  )
}

// Inline copy — puts the BARE text on the clipboard with a brief "Copied", no
// toast (a blocking dialog would freeze the page and the browser automation).
function CopyPill({ text, label = 'Copy', className = '' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(String(text)); setDone(true); setTimeout(() => setDone(false), 1400) }
    catch { /* clipboard blocked — no-op, never alert */ }
  }
  return (
    <button type="button" onClick={copy} title="Copy"
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 ${className}`}>
      {done ? '✓ Copied' : `📋 ${label}`}
    </button>
  )
}

// ── Panel ② callout — accessorial policy for the selected type ────────────────
const POLICY_CALLOUT = {
  not_paid:    { cls: 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/25 text-rose-800 dark:text-rose-300', lead: (t) => `⚠ ${t} is not paid by this broker.` },
  conditional: { cls: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/25 text-amber-800 dark:text-amber-300', lead: (t) => `${t} is payable with conditions.` },
  stated:      { cls: 'bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/10 text-gray-700 dark:text-slate-300', lead: () => 'Terms are stated on the rate con.' },
}
function AccessorialPolicyCallout({ rules, typeCode, typeLabel: label }) {
  if (!rules || !rules.has_instructions) return null
  const t = label || 'This accessorial'
  const match = policyForType(rules, typeCode)
  // Custom types (no matching policy field) and an explicit not_stated both read
  // the same way — check the document before filing.
  const policy = match?.policy || 'not_stated'
  if (policy === 'not_stated') {
    return <div className="mt-3 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400">{t} terms are not stated on this rate con. Check the document before filing.</div>
  }
  const meta = POLICY_CALLOUT[policy]
  if (!meta) return null
  return (
    <div className={`mt-3 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${meta.cls}`}>
      <span className="font-semibold">{meta.lead(t)}</span>
      {match.sentence && <span className="block mt-0.5 opacity-90">{match.sentence}</span>}
    </div>
  )
}

// ── Panel ③ — where the POD goes ──────────────────────────────────────────────
function PaperworkRouting({ rules }) {
  const [showExtras, setShowExtras] = useState(false)
  if (!rules || !rules.has_instructions) return null
  const pod = rules.rules?.pod_email || null
  const all = Array.isArray(rules.rules?.all_emails) ? rules.rules.all_emails : []
  const extras = all.filter(e => e && e !== pod)
  if (!pod && all.length === 0) return null

  return (
    <div className="mt-3 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.02] p-2.5">
      {pod ? (
        <>
          <p className="text-[11px] font-semibold text-gray-700 dark:text-slate-200">Where this paperwork goes</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-xs text-gray-900 dark:text-slate-100 truncate">{pod}</span>
            <CopyPill text={pod} className="shrink-0" />
          </div>
          {rules.rules?.pod_sentence && <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 leading-snug">{rules.rules.pod_sentence}</p>}
          {extras.length > 0 && (
            <div className="mt-1.5">
              <button type="button" onClick={() => setShowExtras(s => !s)} className="text-[10px] font-medium text-gray-500 dark:text-slate-400 hover:underline">
                {showExtras ? 'Hide' : `+${extras.length} more`} ▾
              </button>
              {showExtras && (
                <div className="mt-1 space-y-1">
                  {extras.map(e => (
                    <div key={e} className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-gray-700 dark:text-slate-300 truncate">{e}</span>
                      <CopyPill text={e} className="shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[11px] font-semibold text-gray-600 dark:text-slate-300">Emails on this rate con</p>
          <div className="mt-1 space-y-1">
            {all.map(e => (
              <div key={e} className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-gray-700 dark:text-slate-300 truncate">{e}</span>
                <CopyPill text={e} className="shrink-0" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Panel ④ — broker rules ────────────────────────────────────────────────────
// Window from deadline_minutes: under an hour shows minutes, otherwise hours.
// Never hardcode 24/48.
function deadlineWindow(mins) {
  const m = Number(mins)
  if (!Number.isFinite(m) || m <= 0) return ''
  if (m < 60) return `within ${Math.round(m)} min`
  return `within ${Math.round(m / 60)}h`
}
const BANNER = {
  urgent:  'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300 font-semibold',
  soon:    'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/25 text-amber-800 dark:text-amber-300 font-medium',
  relaxed: 'bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/10 text-gray-700 dark:text-slate-300',
  unknown: 'bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400',
}
function DeadlineBanner({ rules }) {
  const sev = rules.deadline_severity || 'unknown'
  const r = rules.rules || {}
  const win = deadlineWindow(r.deadline_minutes)
  // "unknown" must read as NOT STATED — never as "no deadline / no rush".
  const text = sev === 'unknown' || !win ? 'No submission deadline stated' : `POD due ${win} of delivery`
  // When there's a Money-at-risk block below, it owns the penalty — don't echo
  // it up here too.
  const showPenalty = sev === 'urgent' && !rules.money_at_risk && (r.penalty_sentence || r.penalty)
  return (
    <div title={r.deadline_sentence || ''} className={`rounded-lg border px-2.5 py-2 text-xs leading-relaxed ${BANNER[sev] || BANNER.unknown}`}>
      {/* The window wraps naturally at 254px rather than shrinking; the penalty
          sits on its own line below. */}
      <span className="block">{sev === 'urgent' && <span aria-hidden>⚠ </span>}{text}</span>
      {showPenalty && (
        <span className="block mt-0.5 font-normal opacity-90">{r.penalty_sentence || r.penalty}</span>
      )}
    </div>
  )
}

// Tier 1 — money at risk. The loudest thing in panel ④: a stated dollar figure
// is more concrete than a deadline we may already be inside. Placed below the
// banner but styled to dominate it.
const TRIGGER_LABELS = {
  paperwork: 'Late paperwork', tracking: 'Tracking not accepted', appointment: 'Missed appointment',
  seal: 'Seal broken', check_in: 'Missed check-in', lumper: 'Lumper', accessorial: 'Accessorial',
}
function MoneyAtRisk({ penalties }) {
  // Highest amount first; percentage penalties (amount_value null) fall to the
  // bottom but keep their amount_text.
  const list = [...(penalties || [])].sort((a, b) => {
    if (a.amount_value == null && b.amount_value == null) return 0
    if (a.amount_value == null) return 1
    if (b.amount_value == null) return -1
    return b.amount_value - a.amount_value
  })
  if (!list.length) return null
  return (
    <div className="rounded-lg border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 p-2.5 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">Money at risk{list.length > 1 ? ` (${list.length})` : ''}</p>
      <div className="space-y-2">
        {list.map((p, i) => (
          <div key={i}>
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-rose-800 dark:text-rose-200 whitespace-nowrap">{p.amount_text || '—'}</span>
              {TRIGGER_LABELS[p.trigger] && <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">{TRIGGER_LABELS[p.trigger]}</span>}
            </div>
            {p.sentence && <p className="mt-0.5 text-[11px] text-gray-600 dark:text-slate-400 leading-snug">{p.sentence}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Tier 2 — requirements. Deliberately plain: no border, colour or icon. If
// everything is flagged, nothing is. First three, then a disclosure.
const REQ_LABELS = {
  tracking_app: 'Tracking app', detention_preapproval: 'Detention pre-approval', lumper_receipt: 'Lumper receipt',
  seal: 'Seal', reefer: 'Temperature', appointment: 'Appointment', check_in: 'Check-in',
  photos: 'Photos', unloading: 'Unloading', weight: 'Weight',
}
function AlsoRequired({ requirements }) {
  const [expanded, setExpanded] = useState(false)
  const list = requirements || []
  if (!list.length) return null
  const shown = expanded ? list : list.slice(0, 3)
  const extra = list.length - shown.length
  return (
    <div className="space-y-1">
      <p className={EYEBROW}>Also required</p>
      <dl className="space-y-1">
        {shown.map((q, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <dt className="w-24 shrink-0 font-medium text-gray-500 dark:text-slate-400">{REQ_LABELS[q.kind] || q.kind}</dt>
            <dd className="flex-1 min-w-0 text-gray-600 dark:text-slate-400 leading-snug">{q.sentence}</dd>
          </div>
        ))}
      </dl>
      {!expanded && extra > 0 && (
        <button type="button" onClick={() => setExpanded(true)} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:underline">+{extra} more ▾</button>
      )}
    </div>
  )
}
function RuleRow({ label, children, title }) {
  return (
    <div className="flex items-start gap-2 text-[11px]" title={title || undefined}>
      <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</span>
      <span className="flex-1 min-w-0 text-gray-700 dark:text-slate-300">{children}</span>
    </div>
  )
}
function BrokerRulesPanel({ rules, loading }) {
  const [showRaw, setShowRaw] = useState(false)
  return (
      <Column n={4} title="Broker rules" tag="RATE CON">
        {loading ? (
          <div className="h-16 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
        ) : !rules || !rules.has_instructions ? (
          <p className="text-xs text-gray-400 dark:text-slate-500 italic">No rate confirmation notes on this load.</p>
        ) : (() => {
          const r = rules.rules || {}
          // The Money-at-risk block owns penalties when it's shown, so the muted
          // Penalty row only appears when there is no money block.
          const showPenaltyRow = (r.penalty_sentence || r.penalty) && rules.deadline_severity !== 'urgent' && !rules.money_at_risk
          return (
            <div className="space-y-2.5">
              <DeadlineBanner rules={rules} />
              {rules.money_at_risk && <MoneyAtRisk penalties={r.penalties} />}
              {rules.requirement_count > 0 && <AlsoRequired requirements={r.requirements} />}
              {(r.after_hours_phone || r.tracking_sentence || showPenaltyRow) && (
                <div className="space-y-1.5">
                  {r.after_hours_phone && (
                    <RuleRow label="After hrs" title={r.after_hours_sentence || ''}>
                      {/* Number never wraps mid-digit; the copy button drops to
                          the next line if the pair won't fit. */}
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono whitespace-nowrap">{r.after_hours_phone}</span>
                        <CopyPill text={r.after_hours_phone} />
                      </span>
                    </RuleRow>
                  )}
                  {r.tracking_sentence && (
                    <RuleRow label="Tracking" title={r.tracking_sentence}>
                      <span className="block line-clamp-2">{r.tracking_sentence}</span>
                    </RuleRow>
                  )}
                  {showPenaltyRow && (
                    <RuleRow label="Penalty" title={r.penalty_sentence || ''}>
                      <span className="block truncate">{r.penalty_sentence || r.penalty}</span>
                    </RuleRow>
                  )}
                </div>
              )}
              {rules.raw_instructions && (
                <div>
                  <button type="button" onClick={() => setShowRaw(s => !s)} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:underline">
                    {showRaw ? 'Hide instructions' : 'Full instructions'} ▾
                  </button>
                  {showRaw && (
                    <p className="mt-1.5 text-[11px] whitespace-pre-wrap text-gray-600 dark:text-slate-400 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 p-2 max-h-48 overflow-auto">{rules.raw_instructions}</p>
                  )}
                </div>
              )}
              <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-snug border-t border-gray-100 dark:border-white/5 pt-2">
                Machine-summarised from the broker&apos;s re-confirmation. Reference only — confirm against the rate con before relying on it.
              </p>
            </div>
          )
        })()}
      </Column>
  )
}

// Delayed undo — this driver's logged shift activities, each removable with a
// confirm (the immediate 10s Undo lives on the collapsed row).
const ACTIVITY_LABELS = { load_booked: 'Booked', pod_collected: 'POD collected', bol_collected: 'BOL collected', note: 'Note', escalated: 'Escalated' }
function ActivityLog({ activities, onRemove }) {
  // Not filtered by shift — shift_id is nullable by design and off-shift work is
  // still logged (and still removable), so the heading is "Logged activity", not
  // "this shift". The strip always renders, empty state included: it's the only
  // home for the delayed undo, so hiding it when empty loses the path the moment
  // it's needed.
  const acts = activities || []
  return (
    <div className="border-t border-gray-200 dark:border-white/10 pt-3">
      <p className={`${EYEBROW} mb-1.5`}>Logged activity{acts.length ? ` (${acts.length})` : ''}</p>
      {acts.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">No activity logged for this driver yet.</p>
      ) : (
        <div className="space-y-1">
          {acts.map(a => <ActivityRow key={a.id} a={a} onRemove={onRemove} />)}
        </div>
      )}
    </div>
  )
}
function ActivityRow({ a, onRemove }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  // Pass the whole activity up: the page needs its type + load_number to un-collect
  // the matching Paperwork chip when a bol/pod entry is removed.
  const remove = async () => { setBusy(true); try { await onRemove?.(a) } finally { setBusy(false) } }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="font-medium text-gray-700 dark:text-slate-300 shrink-0">{ACTIVITY_LABELS[a.type] || a.type}</span>
      {a.load_number && <span className="font-mono text-gray-500 dark:text-slate-400 shrink-0">#{a.load_number}</span>}
      {a.note && <span className="text-gray-400 dark:text-slate-500 truncate" title={a.note}>{a.note}</span>}
      {a.at && <span className="text-gray-400 dark:text-slate-500 shrink-0 tabular-nums">{fmtClock(a.at)}</span>}
      <div className="ml-auto shrink-0">
        {confirming ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-gray-500 dark:text-slate-400">Remove?</span>
            <button type="button" onClick={remove} disabled={busy} className="font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">{busy ? 'Removing…' : 'Yes'}</button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="text-gray-500 dark:text-slate-400 hover:underline">No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} title="Remove this entry" className="text-gray-400 dark:text-slate-500 hover:text-red-500">✕</button>
        )}
      </div>
    </div>
  )
}

function RequestGroup({ title, requests, meId, toast, onChanged, showLoad }) {
  if (requests.length === 0) return null
  return (
    <div>
      <p className={`${EYEBROW} mb-1.5`}>{title}</p>
      <div className="space-y-2">
        {requests.map(c => <RequestCard key={c.id} c={c} meId={meId} toast={toast} onChanged={onChanged} showLoad={showLoad} />)}
      </div>
    </div>
  )
}

// One accessorial request on record. It can record what the broker SAID — never
// that money arrived. confirm_accessorial_collected is Accounting's and is not
// offered here.
function RequestCard({ c, meId, toast, onChanged, showLoad }) {
  const [showDocs, setShowDocs] = useState(false)
  const [docs, setDocs] = useState(null)
  const [newDocType, setNewDocType] = useState('broker_email')
  const [replying, setReplying] = useState(false)
  const [response, setResponse] = useState('approved')
  const [approved, setApproved] = useState('')
  const [respNote, setRespNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const meta = statusMeta(c.status)
  const collected = c.status === 'collected'
  const needsAmount = !!RESPONSES.find(r => r.value === response)?.needsAmount

  const loadDocs = useCallback(async () => {
    try { setDocs(await fetchAccessorialDocs(c.id)) }
    catch (e) { toast?.error("Couldn't load the documents", e) }
  }, [c.id, toast])

  function toggleDocs() {
    const next = !showDocs
    setShowDocs(next)
    if (next && docs == null) loadDocs()
  }

  async function openDoc(path) {
    try {
      const url = await signedDocUrl(path)
      if (url) window.open(url, '_blank', 'noopener')
    } catch (e) { toast?.error("Couldn't open the document", e) }
  }

  async function addDoc(file, docType) {
    if (!file) return
    setBusy(true)
    try {
      await uploadAccessorialDoc(c.id, docType, file, null, meId)
      await loadDocs()
      await onChanged?.()
      toast?.success('Document attached')
    } catch (e) { toast?.error("Couldn't attach the document", e) } finally { setBusy(false) }
  }

  async function submitResponse() {
    setErr('')
    const amt = num(approved)
    if (needsAmount && !(amt > 0)) { setErr('An approved amount is required.'); return }
    setBusy(true)
    try {
      await recordBrokerResponse(c.id, response, needsAmount ? amt : null, respNote.trim() || null)
      toast?.success("Broker's answer recorded")
      setReplying(false); setRespNote(''); setApproved('')
      await onChanged?.()
    } catch (e) {
      setErr(e?.message || "Couldn't record the answer.") // RPC reason, verbatim
    } finally { setBusy(false) }
  }

  async function copy() {
    try { await copyText(buildRequestCopy(c, money)); toast?.success('Request copied') }
    catch (e) { toast?.error("Couldn't copy", e) }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-xs font-semibold text-gray-900 dark:text-white">{typeLabel(c.accessorial_type)}</span>
        <span className="text-sm font-bold font-mono tabular-nums text-gray-900 dark:text-white">{money(c.claimed_amount, 2)}</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${meta.cls}`}>{meta.label}</span>
        {showLoad && c.load_number && <span className="text-[11px] text-gray-500 dark:text-slate-400 font-mono">#{c.load_number}</span>}
        {c.event_date && <span className="text-[11px] text-gray-400 dark:text-slate-500">{c.event_date}</span>}
        {c.approved_amount != null && <span className="text-[11px] text-gray-500 dark:text-slate-400">broker: {money(c.approved_amount, 2)}</span>}
        {c.collected_amount != null && <span className="text-[11px] text-cyan-600 dark:text-cyan-400">collected: {money(c.collected_amount, 2)}</span>}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button type="button" onClick={toggleDocs} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">
            📎 {c.doc_count ?? 0} doc{(c.doc_count ?? 0) === 1 ? '' : 's'}
          </button>
          <button type="button" onClick={copy} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">📋 Copy for Telegram</button>
          {!collected && (
            <button type="button" onClick={() => { setReplying(r => !r); setErr('') }}
              className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline">Broker replied</button>
          )}
        </div>
      </div>

      {c.broker_response_note && (
        <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">Broker said: {c.broker_response_note}</p>
      )}
      {collected && (
        <p className="text-[11px] text-cyan-600 dark:text-cyan-400 mt-1">Accounting has closed this request.</p>
      )}

      {showDocs && (
        <div className="mt-2 border-t border-gray-100 dark:border-white/5 pt-2 space-y-1.5">
          {docs == null ? (
            <div className="h-6 rounded bg-gray-100 dark:bg-white/5 animate-pulse" />
          ) : docs.length === 0 ? (
            <p className="text-[11px] text-gray-400 dark:text-slate-500 italic">No documents attached.</p>
          ) : docs.map(d => (
            <div key={d.id} className="flex items-center gap-2 text-[11px]">
              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 shrink-0">{docTypeLabel(d.doc_type)}</span>
              <button type="button" onClick={() => openDoc(d.file_path)} className="text-orange-600 dark:text-orange-400 hover:underline truncate">{d.file_name || d.file_path}</button>
              {d.note && <span className="text-gray-400 dark:text-slate-500 truncate">· {d.note}</span>}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <select className={`${S.input} !py-1 !w-40 text-[11px]`} value={newDocType} onChange={e => setNewDocType(e.target.value)}>
              {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline cursor-pointer">
              {busy ? 'Uploading…' : 'Attach a document'}
              <input type="file" className="hidden" disabled={busy}
                onChange={e => { addDoc(e.target.files?.[0], newDocType); e.target.value = '' }} />
            </label>
          </div>
        </div>
      )}

      {replying && !collected && (
        <div className="mt-2 border-t border-gray-100 dark:border-white/5 pt-2 space-y-2">
          <p className="text-[11px] text-gray-500 dark:text-slate-400">What the broker said — this is not collection. Accounting confirms the money.</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {RESPONSES.map(r => (
              <button key={r.value} type="button" onClick={() => { setResponse(r.value); setErr('') }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                  response === r.value
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
                }`}>
                {r.label}
              </button>
            ))}
            <span className="text-[11px] text-gray-400 dark:text-slate-500">{RESPONSES.find(r => r.value === response)?.hint}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {needsAmount && (
              <input type="text" inputMode="decimal" className={`${S.input} !py-1 !w-32 text-xs font-mono tabular-nums`}
                value={approved} onChange={e => setApproved(normalizeMoney(e.target.value))} placeholder="Amount" />
            )}
            <input className={`${S.input} !py-1 flex-1 min-w-[160px] text-xs`} value={respNote}
              onChange={e => setRespNote(e.target.value)} placeholder="What they said (optional)" />
            <button type="button" onClick={submitResponse} disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-lg transition-colors">
              {busy ? 'Saving…' : 'Record it'}
            </button>
          </div>
          {err && <div className={S.errorBox}>{err}</div>}
        </div>
      )}
    </div>
  )
}
