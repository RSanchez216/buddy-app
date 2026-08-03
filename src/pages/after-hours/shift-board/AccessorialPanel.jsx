import { useCallback, useEffect, useMemo, useState } from 'react'
import { S } from '../../../lib/styles'
import { cityOf, copyText, fmtClock, fmtDuration, money } from './shiftBoardData'
import {
  TYPES, DOC_TYPES, RESPONSES, typeLabel, isFlatType, docTypeLabel, statusMeta,
  computeClaim, minutesBetween, fetchLoadAccessorials, fetchAccessorialDocs,
  raiseAccessorial, recordBrokerResponse, uploadAccessorialDoc, signedDocUrl, buildClaimCopy,
} from './accessorialData'

// The panel that opens under a driver row on the Shift Board. Three columns:
// what the checkpoints say, the claim being raised, and the evidence behind it —
// then everything already claimed on this load and this driver.
//
// A claim always belongs to a load. Without row.load_id nothing can be
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

export default function AccessorialPanel({ row, exception, meId, toast, onCheckpoints, onChanged }) {
  const loadId = row.load_id || null

  // ── Claims already on record ──────────────────────────────────────────────
  const [claims, setClaims] = useState([])
  const [claimsLoading, setClaimsLoading] = useState(true)
  const [claimsError, setClaimsError] = useState('')

  const reloadClaims = useCallback(async () => {
    if (!loadId) { setClaims([]); setClaimsLoading(false); return }
    setClaimsLoading(true); setClaimsError('')
    try {
      setClaims(await fetchLoadAccessorials(loadId, row.driver_id))
    } catch (e) {
      setClaimsError(e?.message || 'Could not load the claims on this driver.')
    } finally { setClaimsLoading(false) }
  }, [loadId, row.driver_id])

  useEffect(() => { reloadClaims() }, [reloadClaims])

  // ── Checkpoint times (read-only — the claim is calculated from these) ──────
  const shipperMinutes = minutesBetween(row.cp_pickup_in, row.cp_pickup_out)
  const receiverMinutes = minutesBetween(row.cp_delivery_in, row.cp_delivery_out)
  const stillAtShipper = !!row.cp_pickup_in && !row.cp_pickup_out
  const stillAtReceiver = !!row.cp_delivery_in && !row.cp_delivery_out
  const hasAnyTimes = !!(row.cp_pickup_in || row.cp_pickup_out || row.cp_delivery_in || row.cp_delivery_out)

  // ── The claim being raised ────────────────────────────────────────────────
  const [type, setType] = useState('detention')
  const [stop, setStop] = useState(() => (row.cp_delivery_in && !row.cp_pickup_in ? 'receiver' : 'shipper'))
  const [freeMin, setFreeMin] = useState('120')
  const [rate, setRate] = useState('50')
  const [amount, setAmount] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [note, setNote] = useState('')
  const [staged, setStaged] = useState([]) // [{ file, docType, note }] — uploaded once the claim has an id
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const flat = isFlatType(type)
  const detainedMinutes = stop === 'shipper' ? shipperMinutes : receiverMinutes
  // `location` is constrained to 'shipper' | 'receiver' — the stop, not the city.
  // The city is shown beside the toggle purely so the associate can see which.
  const stopCity = stop === 'shipper' ? cityOf(row.origin) : cityOf(row.destination)
  const calc = useMemo(
    () => computeClaim(detainedMinutes, freeMin, rate),
    [detainedMinutes, freeMin, rate],
  )

  // The amount follows the maths until the associate overrides it. Layover and
  // TONU are flat, so there is nothing to compute — they type the agreed figure.
  useEffect(() => {
    if (amountTouched || flat) return
    setAmount(calc.amount > 0 ? calc.amount.toFixed(2) : '')
  }, [calc.amount, amountTouched, flat])

  function pickType(t) {
    setType(t)
    setAmountTouched(false)
    setAmount('')
    setErr('')
  }

  function addStaged(file) {
    if (!file) return
    setStaged(s => [...s, { file, docType: 'broker_email', note: '' }])
  }
  const setStagedField = (i, patch) => setStaged(s => s.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const removeStaged = (i) => setStaged(s => s.filter((_, j) => j !== i))

  async function submit() {
    setErr('')
    if (!loadId) { setErr('This driver has no load on the board — a claim must be tied to a load.'); return }
    const amt = num(amount)
    if (!(amt > 0)) { setErr('Enter a claim amount greater than zero.'); return }

    setSaving(true)
    try {
      const res = await raiseAccessorial({
        loadId,
        type,
        amount: amt,
        location: flat ? null : stop,
        detainedMinutes: flat ? null : detainedMinutes,
        freeMinutes: flat ? null : num(freeMin),
        ratePerHour: flat ? null : num(rate),
        note: note.trim() || null,
      })

      // Documents can only be attached once the claim has an id.
      let failed = 0
      for (const d of staged) {
        try { await uploadAccessorialDoc(res.id, d.docType, d.file, d.note, meId) }
        catch { failed += 1 }
      }

      toast?.success(res.filed_same_day ? 'Claim raised · filed same day' : 'Claim raised')
      if (failed > 0) toast?.error(`${failed} document${failed === 1 ? '' : 's'} did not upload — add them from the claim below.`)

      setStaged([]); setNote(''); setAmount(''); setAmountTouched(false)
      await reloadClaims()
      await onChanged?.()
    } catch (e) {
      setErr(e?.message || 'Could not raise the claim.') // RPC reason, verbatim
      toast?.error(e?.message || 'Could not raise the claim.')
    } finally { setSaving(false) }
  }

  const onThisLoad = claims.filter(c => c.same_load)
  const otherLoads = claims.filter(c => !c.same_load)

  return (
    <div className="border-t border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.02] px-4 py-4 space-y-4">
      {/* Header line — which load this claim will belong to */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{row.driver_name || 'Driver'}</span>
        {row.load_number
          ? <span className="text-xs text-gray-500 dark:text-slate-400">Load <span className="font-mono text-gray-700 dark:text-slate-300">{row.load_number}</span></span>
          : <span className="text-xs text-amber-600 dark:text-amber-400">No load on the board — nothing can be claimed</span>}
        {row.carrier_name && <span className="text-xs text-gray-400 dark:text-slate-500">· {row.carrier_name}</span>}
        {exception?.over_free_time && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30">
            Detention likely · {fmtDuration(exception.minutes_waiting)} at the {exception.stop}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ① Checkpoint times — read only */}
        <Column n={1} title="Checkpoint times">
          {hasAnyTimes ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <TimeCell label="Pickup in" ts={row.cp_pickup_in} />
                <TimeCell label="Pickup out" ts={row.cp_pickup_out} />
                <TimeCell label="Delivery in" ts={row.cp_delivery_in} />
                <TimeCell label="Delivery out" ts={row.cp_delivery_out} />
              </div>
              <div className="mt-3 space-y-1">
                {shipperMinutes != null && (
                  <p className="text-sm text-gray-800 dark:text-slate-200">
                    Detained at shipper <span className="font-bold tabular-nums">{fmtDuration(shipperMinutes)}</span>
                    {stillAtShipper && <span className="text-[11px] text-amber-600 dark:text-amber-400"> · still there</span>}
                  </p>
                )}
                {receiverMinutes != null && (
                  <p className="text-sm text-gray-800 dark:text-slate-200">
                    Detained at receiver <span className="font-bold tabular-nums">{fmtDuration(receiverMinutes)}</span>
                    {stillAtReceiver && <span className="text-[11px] text-amber-600 dark:text-amber-400"> · still there</span>}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => onCheckpoints?.(row)} disabled={!loadId}
                className="mt-2 text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline disabled:opacity-40 disabled:no-underline">
                Edit the times
              </button>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/[0.06] p-3">
              <p className="text-xs text-amber-800 dark:text-amber-300">No checkpoint times recorded. The claim is calculated from these — enter them first.</p>
              <button type="button" onClick={() => onCheckpoints?.(row)} disabled={!loadId}
                className="mt-2 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline disabled:opacity-40 disabled:no-underline">
                Enter checkpoint times →
              </button>
            </div>
          )}
        </Column>

        {/* ② Raise the claim */}
        <Column n={2} title="Raise the claim">
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map(t => (
              <button key={t.value} type="button" onClick={() => pickType(t.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  type === t.value
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-white dark:hover:bg-white/5'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

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
                {stopCity && <span className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{stopCity}</span>}
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
                    onChange={e => { setRate(normalizeMoney(e.target.value)); setAmountTouched(false) }} placeholder="50.00" />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">From the rate confirmation for this load — brokers differ, so these are not settings.</p>

              <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-2 tabular-nums">
                {detainedMinutes == null
                  ? 'No time recorded at this stop yet.'
                  : `${fmtDuration(detainedMinutes)} detained − ${fmtDuration(num(freeMin) || 0)} free = ${calc.hours} billable hour${calc.hours === 1 ? '' : 's'} (rounded up)`}
              </p>
            </>
          )}

          <div className="mt-3">
            <label className={S.label}>
              Claim amount
              <span className="font-normal normal-case text-gray-400 dark:text-slate-500"> · {flat ? 'flat amount' : amountTouched ? 'overridden' : 'calculated'}</span>
            </label>
            <input type="text" inputMode="decimal" className={`${S.input} font-mono tabular-nums font-semibold`} value={amount}
              onChange={e => { setAmount(normalizeMoney(e.target.value)); setAmountTouched(true) }}
              onBlur={() => { const n = parseFloat(amount); setAmount(Number.isFinite(n) ? n.toFixed(2) : '') }}
              placeholder="0.00" />
            {!flat && amountTouched && calc.amount > 0 && Math.abs((num(amount) || 0) - calc.amount) > 0.005 && (
              <button type="button" onClick={() => { setAmountTouched(false); setAmount(calc.amount.toFixed(2)) }}
                className="mt-1 text-[11px] text-gray-500 dark:text-slate-400 hover:underline">
                Calculated was {money(calc.amount, 2)} — use it
              </button>
            )}
          </div>

          {err && <div className={`${S.errorBox} mt-3`}>{err}</div>}

          <button type="button" onClick={submit} disabled={saving || !loadId}
            className="mt-3 w-full px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all">
            {saving ? 'Raising…' : `Raise ${typeLabel(type).toLowerCase()} claim`}
          </button>
          {!loadId && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">A claim belongs to a load. Book or link one first.</p>}
        </Column>

        {/* ③ Evidence and notes */}
        <Column n={3} title="Evidence and notes">
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/[0.06] p-2.5">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Checkpoint log — attached automatically</p>
            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/70 mt-0.5 tabular-nums">
              {hasAnyTimes
                ? `PU ${fmtClock(row.cp_pickup_in) || '—'}/${fmtClock(row.cp_pickup_out) || '—'} · DL ${fmtClock(row.cp_delivery_in) || '—'}/${fmtClock(row.cp_delivery_out) || '—'}`
                : 'No times recorded yet'}
            </p>
          </div>

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
            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">Attached when the claim is raised. If a broker refuses to pay in six weeks, this is what you fight it with.</p>
          </div>

          <div className="mt-3">
            <label className={S.label}>Note</label>
            <textarea rows={3} className={`${S.textarea} min-h-[70px]`} value={note} onChange={e => setNote(e.target.value)}
              placeholder="What happened — who was called, what the shipper said…" />
          </div>
        </Column>
      </div>

      {/* ④ Already claimed — this load and other loads, never merged */}
      <div className="border-t border-gray-200 dark:border-white/10 pt-3">
        {claimsError ? (
          <div className={S.errorBox}>{claimsError}</div>
        ) : claimsLoading ? (
          <div className="h-12 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse" />
        ) : claims.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-500 italic">Nothing claimed on this load or this driver yet.</p>
        ) : (
          <div className="space-y-3">
            <ClaimGroup title={`On this load (${onThisLoad.length})`} claims={onThisLoad} meId={meId} toast={toast} onChanged={async () => { await reloadClaims(); await onChanged?.() }} />
            <ClaimGroup title={`Other loads (${otherLoads.length})`} claims={otherLoads} meId={meId} toast={toast} onChanged={async () => { await reloadClaims(); await onChanged?.() }} showLoad />
          </div>
        )}
      </div>
    </div>
  )
}

function Column({ n, title, children }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 inline-flex items-center justify-center text-[10px] font-bold">{n}</span>
        <h4 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">{title}</h4>
      </div>
      {children}
    </div>
  )
}

function TimeCell({ label, ts }) {
  const on = !!ts
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${on
      ? 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10'
      : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02]'}`}>
      <p className={`${EYEBROW} ${on ? 'text-emerald-700/70 dark:text-emerald-400/70' : ''}`}>{label}</p>
      <p className={`text-sm font-medium tabular-nums ${on ? 'text-emerald-800 dark:text-emerald-300' : 'text-gray-300 dark:text-slate-600'}`}>{on ? fmtClock(ts) : '—'}</p>
    </div>
  )
}

function ClaimGroup({ title, claims, meId, toast, onChanged, showLoad }) {
  if (claims.length === 0) return null
  return (
    <div>
      <p className={`${EYEBROW} mb-1.5`}>{title}</p>
      <div className="space-y-2">
        {claims.map(c => <ClaimCard key={c.id} c={c} meId={meId} toast={toast} onChanged={onChanged} showLoad={showLoad} />)}
      </div>
    </div>
  )
}

// One claim on record. It can record what the broker SAID — never that money
// arrived. confirm_accessorial_collected is Accounting's and is not offered here.
function ClaimCard({ c, meId, toast, onChanged, showLoad }) {
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
    try { await copyText(buildClaimCopy(c, money)); toast?.success('Claim copied') }
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
        <p className="text-[11px] text-cyan-600 dark:text-cyan-400 mt-1">Accounting has closed this claim.</p>
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
