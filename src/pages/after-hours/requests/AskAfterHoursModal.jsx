import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import {
  KINDS, URGENCIES, statusBadge, STATUS_LABEL,
  searchHelpDrivers, fetchDriverBrief, fetchStatusSince, fetchOnShift, createHelpRequest, editHelpRequest,
  fetchLoadIdByNumber, daysAgoPhrase, fmtAgo, fmtDateCT,
} from './requestsData'

const SCOPES = [
  { value: 'mine', label: 'My drivers' },
  { value: 'active', label: 'All active' },
  { value: 'all', label: 'Include inactive & returning' },
]

// The "Ask After-Hours" form — one component, two modes. Create (raise a new
// request) or edit (prefill.edit carries the request row). In edit mode the
// driver is only changeable while status is 'new'; the RPC enforces this too.
export default function AskAfterHoursModal({ open, prefill, onClose }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const raisedBy = user?.id || profile?.id || null
  const editRow = prefill?.edit || null
  const isEdit = !!editRow
  const lockDriver = isEdit && editRow.status !== 'new' // seen → driver read-only

  const [kind, setKind] = useState('uncovered')
  const [urgency, setUrgency] = useState('normal')
  const [note, setNote] = useState('')

  const [scope, setScope] = useState('mine')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null) // a picker row (or brief)
  const [since, setSince] = useState(null)        // effective date for a non-active driver

  const [onShift, setOnShift] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const debounceRef = useRef(null)
  const modalRef = useRef(null)
  const searchRef = useRef(null)
  const prefillDone = useRef(false)
  const previouslyFocused = useRef(null)

  // Reset + seed on open. Edit mode prefills every field from the request row;
  // create mode optionally jumps to a prefilled driver.
  useEffect(() => {
    if (!open) return
    setSince(null); setError(''); setSubmitting(false); setResults([])
    fetchOnShift().then(setOnShift).catch(() => setOnShift([]))
    if (editRow) {
      setKind(editRow.kind || 'uncovered')
      setUrgency(editRow.urgency || 'normal')
      setNote(editRow.note || '')
      const sel = { driver_id: editRow.driver_id, full_name: editRow.driver_name, current_status: editRow.driver_status_at_raise || 'active', load_id: editRow.load_id }
      setSelected(sel)
      setScope('all'); setQuery('')
      prefillDone.current = true // never auto-select from search in edit mode
      if (sel.current_status && sel.current_status !== 'active') fetchStatusSince(sel.driver_id).then(setSince).catch(() => {})
    } else {
      setKind('uncovered'); setUrgency('normal'); setNote('')
      setSelected(null); prefillDone.current = false
      if (prefill?.driverId) { setScope('all'); setQuery(prefill.driverName || '') }
      else { setScope('mine'); setQuery('') }
    }
  }, [open, prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced driver search on scope/query.
  useEffect(() => {
    if (!open) return
    setSearching(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchHelpDrivers(query, scope, 40)
        setResults(rows)
        // Auto-select a pre-filled driver once its row appears (create mode only).
        if (!editRow && prefill?.driverId && !prefillDone.current) {
          const match = rows.find(r => r.driver_id === prefill.driverId)
          if (match) { prefillDone.current = true; pickDriver(match) }
          else {
            const brief = await fetchDriverBrief(prefill.driverId).catch(() => null)
            if (brief) { prefillDone.current = true; pickDriver(brief) }
          }
        }
      } catch (e) {
        setError(e?.message || 'Driver search failed.')
      } finally { setSearching(false) }
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, scope])

  // Focus trap + scroll lock.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => searchRef.current?.focus(), 40)
    return () => { document.body.style.overflow = prev; clearTimeout(t); if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus() }
  }, [open])

  function pickDriver(row) {
    if (row.selectable === false) return
    setSelected(row)
    setSince(null)
    if (row.current_status && row.current_status !== 'active') {
      fetchStatusSince(row.driver_id).then(setSince).catch(() => {})
    }
    // The picker carries only the load number — resolve its id so the request
    // links to the driver's current load.
    if (!row.load_id && row.last_load_number) {
      fetchLoadIdByNumber(row.last_load_number)
        .then(id => { if (id) setSelected(s => (s && s.driver_id === row.driver_id ? { ...s, load_id: id } : s)) })
        .catch(() => {})
    }
  }

  async function submit() {
    setError('')
    if (!selected) { setError('Pick a driver first.'); return }

    // Edit mode — send only what changed (nulls leave values untouched). The
    // driver only goes up when it actually changed; the RPC refuses a driver
    // change after 'seen' and returns its reason, which we surface verbatim.
    if (isEdit) {
      const payload = {}
      if (kind !== editRow.kind) payload.kind = kind
      if (urgency !== editRow.urgency) payload.urgency = urgency
      if ((note || '') !== (editRow.note || '')) payload.note = note || ''
      if (selected.driver_id !== editRow.driver_id) { payload.driverId = selected.driver_id; payload.loadId = selected.load_id ?? null }
      if (Object.keys(payload).length === 0) { onClose?.(); return } // nothing changed
      setSubmitting(true)
      try {
        await editHelpRequest(editRow.id, payload)
        toast.success('Request updated')
        onClose?.()
      } catch (e) {
        setError(e?.message || 'Could not save the changes.')
        toast.error(e?.message || "Couldn't save the changes")
      } finally { setSubmitting(false) }
      return
    }

    if (!raisedBy) { setError('Your session expired — sign in again.'); return }
    setSubmitting(true)
    try {
      await createHelpRequest({
        driverId: selected.driver_id,
        driverName: selected.full_name,
        loadId: selected.load_id || null,
        kind, urgency, note,
        raisedBy,
        driverStatusAtRaise: selected.current_status || null,
      })
      toast.success('Request sent to After-Hours')
      onClose?.()
    } catch (e) {
      setError(e?.message || 'Could not raise the request.')
      toast.error("Couldn't raise the request", e)
    } finally { setSubmitting(false) }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
  }

  const nonActive = selected && selected.current_status && selected.current_status !== 'active'
  const dup = selected && selected.open_request_id

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="ask-ah-title"
        className="relative bg-white dark:bg-[#0B1120] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 shrink-0">
          <div>
            <h3 id="ask-ah-title" className="text-base font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit request' : 'Ask After-Hours'}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500">{isEdit ? 'Update this request for the night team.' : 'Raise a driver for the night team to cover or help with.'}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {error && <div className={S.errorBox}>{error}</div>}

          {/* Kind */}
          <div>
            <label className={S.label}>What's needed</label>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map(k => (
                <button key={k.value} type="button" onClick={() => setKind(k.value)}
                  className={`text-left rounded-xl border px-3 py-2 transition-colors ${kind === k.value ? 'border-orange-400 bg-orange-50/60 dark:bg-orange-500/10' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{k.label}</p>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-snug mt-0.5">{k.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Driver picker */}
          <div>
            <label className={S.label}>Driver</label>
            {lockDriver ? (
              <>
                <SelectedDriver row={selected} since={since} nonActive={nonActive} dup={false} />
                <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1.5">
                  After-Hours has already seen this request, so the driver is locked. To change it, dismiss this one and raise a new request.
                </p>
              </>
            ) : selected ? (
              <SelectedDriver row={selected} since={since} nonActive={nonActive} dup={dup} onClear={() => { setSelected(null); setSince(null); prefillDone.current = true; setTimeout(() => searchRef.current?.focus(), 20) }} />
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {SCOPES.map(s => (
                    <button key={s.value} type="button" onClick={() => setScope(s.value)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${scope === s.value ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <input ref={searchRef} className={S.input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a driver by name…" />
                <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/5">
                  {searching ? (
                    <div className="p-3 text-xs text-gray-400 dark:text-slate-500">Searching…</div>
                  ) : results.length === 0 ? (
                    <div className="p-3 text-xs text-gray-400 dark:text-slate-500">{scope === 'mine' ? 'No drivers assigned to you yet — try All active.' : 'No drivers found.'}</div>
                  ) : results.map(r => <DriverRow key={r.driver_id} row={r} onPick={() => pickDriver(r)} />)}
                </div>
              </>
            )}
          </div>

          {/* Urgency */}
          <div>
            <label className={S.label}>Urgency</label>
            <div className="flex gap-2">
              {URGENCIES.map(u => (
                <button key={u.value} type="button" onClick={() => setUrgency(u.value)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${urgency === u.value ? 'border-orange-400 bg-orange-50/60 dark:bg-orange-500/10 text-gray-900 dark:text-white' : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                  <span className="w-2 h-2 rounded-full" style={{ background: u.dot }} />{u.label}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className={S.label}>Note <span className="font-normal normal-case text-gray-400">(optional)</span></label>
            <textarea rows={6} className={`${S.textarea} min-h-[150px]`} value={note} onChange={e => setNote(e.target.value)} placeholder="What does the night team need to know? (e.g. will need a lumper once arrived to the receiver at 11 pm)" />
          </div>

          {/* Who's on tonight */}
          <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-white/[0.03] p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">Who's on tonight</p>
            {onShift.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-slate-400">Nobody has started an After-Hours shift yet. Your request will be waiting when they clock in.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {onShift.map(s => (
                  <span key={s.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{s.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-white/5 p-4 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} disabled={submitting} className={S.btnCancel}>Cancel</button>
          <button onClick={submit} disabled={submitting || !selected}
            className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all">
            {isEdit ? (submitting ? 'Saving…' : 'Save changes') : (submitting ? 'Sending…' : 'Send to After-Hours')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// One driver row in the picker list.
function DriverRow({ row, onPick }) {
  const badge = statusBadge(row.current_status)
  const locked = row.selectable === false
  const dispatcher = row.last_dispatcher
  const ago = daysAgoPhrase(row.days_since_delivery)
  const muted = dispatcher ? `last load booked by ${dispatcher}${ago ? `, ${ago}` : ''}` : 'no load in the last 90 days'
  return (
    <button type="button" onClick={onPick} disabled={locked}
      className={`w-full text-left px-3 py-2 flex items-start gap-2 ${locked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {locked && <span aria-hidden>🔒</span>}
          <span className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{row.full_name}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
          {row.is_mine && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/25">MY DRIVER</span>}
        </div>
        <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 truncate">{locked ? (row.lock_reason || 'Locked') : muted}</p>
      </div>
    </button>
  )
}

// The chosen driver + the two warnings.
function SelectedDriver({ row, since, nonActive, dup, onClear }) {
  const badge = statusBadge(row.current_status)
  const statusWord = STATUS_LABEL[row.current_status] || row.current_status
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{row.full_name}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
            {row.is_mine && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/25">MY DRIVER</span>}
          </div>
          {row.last_dispatcher && (
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 truncate">last load booked by {row.last_dispatcher}{daysAgoPhrase(row.days_since_delivery) ? `, ${daysAgoPhrase(row.days_since_delivery)}` : ''}</p>
          )}
        </div>
        {onClear && <button type="button" onClick={onClear} className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline shrink-0">Change</button>}
      </div>

      {/* Non-active — permissive, not blocking */}
      {nonActive && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 p-3">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            ⚠ {row.full_name} is {statusWord}{since ? ` (since ${fmtDateCT(since)})` : ''}
          </p>
          <p className="text-[11px] text-amber-700/90 dark:text-amber-400/90 leading-snug mt-1">
            You can still raise this — After-Hours can book them a load. Fleet will be notified to review their status, and it'll appear on tonight's shift report.
          </p>
        </div>
      )}

      {/* Duplicate — warn, don't block */}
      {dup && (
        <div className="rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/10 p-3">
          <p className="text-xs font-semibold text-red-800 dark:text-red-300">
            ⚠ {row.open_request_by || 'Someone'} raised this driver {fmtAgo(row.open_request_at)} — still open.
          </p>
          <p className="text-[11px] text-red-700/90 dark:text-red-400/90 leading-snug mt-1">
            Check with {row.open_request_by || 'them'} before sending a second request.
          </p>
        </div>
      )}
    </div>
  )
}
