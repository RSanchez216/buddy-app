import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import {
  openAskAfterHours, REQUESTS_CHANGED_EVENT, KINDS, URGENCIES,
  statusBadge, kindLabel, urgencyMeta, requestStatusMeta, canManageRequest,
  fetchMyRequests, fetchIncoming, fetchOpenShiftId,
  markRequestSeen, markRequestHandled, editHelpRequest, dismissHelpRequest, restoreHelpRequest,
  fmtClock, fmtChicagoTs, firstLastInitial, fmtAgo,
} from './requestsData'

export default function RequestsPage() {
  const { user, profile, canEdit } = useAuth() // canEdit = is_admin_or_manager
  const toast = useToast()
  const meId = user?.id || profile?.id || null
  const [tab, setTab] = useState('mine')
  const [mine, setMine] = useState([])
  const [incoming, setIncoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [m, inc] = await Promise.all([fetchMyRequests(meId), fetchIncoming()])
      setMine(m); setIncoming(inc)
    } catch (e) { setError(true); toast.error("Couldn't load requests", e) }
    finally { setLoading(false) }
  }, [meId, toast])

  // Quiet reload (no skeleton) — for the changed-event and after an action, so a
  // background refresh never flashes over live cards.
  const refresh = useCallback(async () => {
    try {
      const [m, inc] = await Promise.all([fetchMyRequests(meId), fetchIncoming()])
      setMine(m); setIncoming(inc); setError(false)
    } catch { /* keep the current cards on a transient failure */ }
  }, [meId])

  useEffect(() => { load() }, [load])

  // Reload in the background when anything raises/updates a request.
  useEffect(() => {
    const h = () => refresh()
    window.addEventListener(REQUESTS_CHANGED_EVENT, h)
    return () => window.removeEventListener(REQUESTS_CHANGED_EVENT, h)
  }, [refresh])

  const openCount = incoming.filter(r => r.status !== 'dismissed').length

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> After Hours
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Requests</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">What you asked After-Hours to handle, and what they still need to pick up.</p>
        </div>
        <button onClick={() => openAskAfterHours()} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20">
          <span aria-hidden>✉</span> Ask After-Hours
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100 dark:bg-white/5 w-fit">
        {[['mine', 'My requests'], ['incoming', 'Incoming']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab === k ? 'bg-white dark:bg-white/10 text-orange-600 dark:text-orange-400 shadow-sm' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'}`}>
            {label}{k === 'incoming' && openCount > 0 && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500 text-white">{openCount}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <ListSkeleton />
      ) : error ? (
        <div className={S.errorBox}>Couldn&apos;t load requests. <button onClick={load} className="underline font-medium">Retry</button></div>
      ) : tab === 'mine' ? (
        <MyRequests rows={mine} meId={meId} isManager={canEdit} onChanged={refresh} toast={toast} />
      ) : (
        <Incoming rows={incoming} meId={meId} isManager={canEdit} onChanged={refresh} toast={toast} />
      )}
    </div>
  )
}

// ── My requests ──────────────────────────────────────────────────────────────
function MyRequests({ rows, meId, isManager, onChanged, toast }) {
  if (rows.length === 0) return <Empty text="You haven't raised anything yet. Use “Ask After-Hours” to send the night team a driver." />
  const active = rows.filter(r => r.status !== 'dismissed')
  const dismissed = rows.filter(r => r.status === 'dismissed')
  return (
    <div className="space-y-3">
      {active.length === 0
        ? <p className="text-sm text-gray-400 dark:text-slate-500">No active requests.</p>
        : active.map(r => <MyCard key={r.id} r={r} meId={meId} isManager={isManager} onChanged={onChanged} toast={toast} />)}
      <DismissedSection rows={dismissed} meId={meId} isManager={isManager} onChanged={onChanged} toast={toast} />
    </div>
  )
}

function MyCard({ r, meId, isManager, onChanged, toast }) {
  const badge = statusBadge(r.driver_status_at_raise)
  const u = urgencyMeta(r.urgency)
  const handled = !!r.handled_at
  const seen = !!r.seen_at
  const [editing, setEditing] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const editable = (r.status === 'new' || r.status === 'seen') && canManageRequest(r, meId, isManager)

  return (
    <div className={`${S.card} p-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{r.driver_name || 'Driver'}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">· {kindLabel(r.kind)}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400"><span className="w-1.5 h-1.5 rounded-full" style={{ background: u.dot }} />{u.label}</span>
          </div>
          {r.note && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">{r.note}</p>}
          <EditedLine r={r} />
        </div>
        <RequestStatusChip status={r.status} />
      </div>

      {/* Track: Sent → Seen → Handled */}
      <div className="mt-3 flex items-center gap-1.5 text-[11px]">
        <Step done label="Sent" time={fmtClock(r.raised_at)} />
        <Rail on={seen} />
        <Step done={seen} label="Seen" time={seen ? fmtClock(r.seen_at) : null} />
        <Rail on={handled} />
        <Step done={handled} label="Handled" time={handled ? fmtClock(r.handled_at) : null} tone="green" />
      </div>

      {handled && (
        <div className="mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-3">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{r.resolution || 'Handled'}</p>
          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">{fmtChicagoTs(r.handled_at)}{r.handled_by_name ? ` · by ${firstLastInitial(r.handled_by_name)}` : ''}</p>
        </div>
      )}

      {editing ? (
        <EditForm r={r} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} toast={toast} />
      ) : editable ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={() => setEditing(true)} className={S.btnSecondary}>Edit</button>
          <button onClick={() => setDismissing(true)} className={DISMISS_BTN}>Dismiss</button>
        </div>
      ) : null}

      {dismissing && <DismissConfirm r={r} onClose={() => setDismissing(false)} onDone={() => { setDismissing(false); onChanged() }} toast={toast} />}
    </div>
  )
}

function Step({ done, label, time, tone }) {
  const dot = done ? (tone === 'green' ? 'bg-emerald-500' : 'bg-orange-500') : 'bg-gray-300 dark:bg-slate-600'
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className={done ? 'text-gray-700 dark:text-slate-200 font-medium' : 'text-gray-400 dark:text-slate-500'}>{label}</span>
      {time && <span className="text-gray-400 dark:text-slate-500 tabular-nums">{time}</span>}
    </div>
  )
}
function Rail({ on }) {
  return <span className={`h-px flex-1 min-w-[16px] ${on ? 'bg-orange-300 dark:bg-orange-500/40' : 'bg-gray-200 dark:bg-white/10'}`} />
}

// ── Incoming ─────────────────────────────────────────────────────────────────
function Incoming({ rows, meId, isManager, onChanged, toast }) {
  const active = rows.filter(r => r.status !== 'dismissed')
  const dismissed = rows.filter(r => r.status === 'dismissed')
  if (active.length === 0 && dismissed.length === 0) return <Empty text="Nothing open. Every raised request has been handled." />
  return (
    <div className="space-y-3">
      {active.length === 0
        ? <p className="text-sm text-gray-400 dark:text-slate-500">Nothing open right now.</p>
        : active.map(r => <IncomingCard key={r.id} r={r} meId={meId} isManager={isManager} onChanged={onChanged} toast={toast} />)}
      <DismissedSection rows={dismissed} meId={meId} isManager={isManager} onChanged={onChanged} toast={toast} />
    </div>
  )
}

function IncomingCard({ r, meId, isManager, onChanged, toast }) {
  const badge = statusBadge(r.driver_status_at_raise)
  const u = urgencyMeta(r.urgency)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')
  const [editing, setEditing] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const editable = (r.status === 'new' || r.status === 'seen') && canManageRequest(r, meId, isManager)

  async function seen() {
    setBusy(true)
    try { await markRequestSeen(r.id, meId); await onChanged() }
    catch (e) { toast.error("Couldn't mark seen", e) } finally { setBusy(false) }
  }
  async function handle() {
    setBusy(true)
    try {
      const shiftId = await fetchOpenShiftId()
      await markRequestHandled(r.id, meId, resolution, shiftId)
      toast.success('Request handled')
      await onChanged()
    } catch (e) { toast.error("Couldn't mark handled", e); setBusy(false) }
  }

  return (
    <div className={`${S.card} p-4 ${r.urgency === 'urgent' ? 'border-l-4 border-l-red-500' : ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">{r.driver_name || 'Driver'}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">· {kindLabel(r.kind)}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: u.dot }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: u.dot }} />{u.label}</span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Raised by {r.raised_by_name || 'someone'} · {fmtAgo(r.raised_at)} · {fmtChicagoTs(r.raised_at)}</p>
          {r.note && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1.5 whitespace-pre-wrap">{r.note}</p>}
          <EditedLine r={r} />
        </div>
        <RequestStatusChip status={r.status} />
      </div>

      {editing ? (
        <EditForm r={r} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged() }} toast={toast} />
      ) : resolving ? (
        <div className="mt-3 space-y-2">
          <textarea rows={2} autoFocus className={`${S.textarea} min-h-[56px]`} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="What happened — e.g. Load booked, Atlanta → Nashville" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setResolving(false)} disabled={busy} className={S.btnCancel}>Cancel</button>
            <button onClick={handle} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Saving…' : 'Mark handled'}</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2 flex-wrap">
          {editable && <button onClick={() => setEditing(true)} disabled={busy} className={S.btnSecondary}>Edit</button>}
          {editable && <button onClick={() => setDismissing(true)} disabled={busy} className={DISMISS_BTN}>Dismiss</button>}
          {!r.seen_at && <button onClick={seen} disabled={busy} className={S.btnSecondary}>Mark seen</button>}
          <button onClick={() => setResolving(true)} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">Mark handled</button>
        </div>
      )}

      {dismissing && <DismissConfirm r={r} onClose={() => setDismissing(false)} onDone={() => { setDismissing(false); onChanged() }} toast={toast} />}
    </div>
  )
}

// ── Edit / dismiss / restore ─────────────────────────────────────────────────
const DISMISS_BTN = 'px-3 py-2 text-sm font-medium border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors'

// Three fields only — kind, urgency, note. Driver is intentionally not editable:
// a wrong-driver request should be dismissed and re-raised so the timeline and
// driver_status_at_raise keep describing the same driver.
function EditForm({ r, onCancel, onSaved, toast }) {
  const [kind, setKind] = useState(r.kind)
  const [urgency, setUrgency] = useState(r.urgency)
  const [note, setNote] = useState(r.note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setBusy(true); setErr('')
    try {
      await editHelpRequest(r.id, { kind, urgency, note })
      toast.success('Request updated')
      onSaved()
    } catch (e) {
      setErr(e.message); toast.error(e.message) // surface the RPC reason verbatim
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gray-200 dark:border-white/10 p-3">
      {err && <div className={S.errorBox}>{err}</div>}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">What's needed</p>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map(k => (
            <button key={k.value} type="button" onClick={() => setKind(k.value)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${kind === k.value ? 'border-orange-400 bg-orange-50/60 dark:bg-orange-500/10 text-gray-900 dark:text-white' : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">Urgency</p>
        <div className="flex gap-2">
          {URGENCIES.map(x => (
            <button key={x.value} type="button" onClick={() => setUrgency(x.value)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${urgency === x.value ? 'border-orange-400 bg-orange-50/60 dark:bg-orange-500/10 text-gray-900 dark:text-white' : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: x.dot }} />{x.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">Note</p>
        <textarea rows={2} className={`${S.textarea} min-h-[56px]`} value={note} onChange={e => setNote(e.target.value)} placeholder="What does the night team need to know?" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className={S.btnCancel}>Cancel</button>
        <button onClick={save} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </div>
  )
}

// Reason is optional in the RPC but required here — a dismissal with no reason
// is indistinguishable from a request that was simply lost.
function DismissConfirm({ r, onClose, onDone, toast }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function confirm() {
    if (!reason.trim()) return
    setBusy(true); setErr('')
    try {
      await dismissHelpRequest(r.id, reason)
      toast.success('Request dismissed')
      onDone()
    } catch (e) {
      setErr(e.message); toast.error(e.message) // verbatim RPC reason (e.g. handled races)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl p-5 space-y-3">
        <h3 className="text-base font-bold text-gray-900 dark:text-white">Dismiss this request?</h3>
        <p className="text-sm text-gray-500 dark:text-slate-400">It stays on the record and stops showing on the Shift Board. The night team will no longer see it.</p>
        {err && <div className={S.errorBox}>{err}</div>}
        <div>
          <label className={S.label}>Why are you dismissing it?</label>
          <textarea rows={2} autoFocus className={`${S.textarea} min-h-[56px]`} value={reason} onChange={e => setReason(e.target.value)} placeholder="raised in error" />
          {!reason.trim() && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">A reason is required.</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className={S.btnCancel}>Cancel</button>
          <button onClick={confirm} disabled={busy || !reason.trim()} className="px-4 py-2 text-sm font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Dismissing…' : 'Dismiss request'}</button>
        </div>
      </div>
    </div>
  )
}

function DismissedSection({ rows, meId, isManager, onChanged, toast }) {
  const [open, setOpen] = useState(false)
  if (!rows.length) return null
  return (
    <div className="space-y-3 pt-1">
      <button onClick={() => setOpen(o => !o)} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200">
        {open ? 'Hide dismissed' : `Show dismissed (${rows.length})`}
      </button>
      {open && rows.map(r => <DismissedCard key={r.id} r={r} meId={meId} isManager={isManager} onChanged={onChanged} toast={toast} />)}
    </div>
  )
}

function DismissedCard({ r, meId, isManager, onChanged, toast }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const canManage = canManageRequest(r, meId, isManager)

  async function restore() {
    setBusy(true); setErr('')
    try { await restoreHelpRequest(r.id); toast.success('Request restored'); await onChanged() }
    catch (e) { setErr(e.message); toast.error(e.message); setBusy(false) }
  }

  return (
    <div className={`${S.card} p-4 opacity-90`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-500 dark:text-slate-400 line-through">{r.driver_name || 'Driver'}</span>
            <RequestStatusChip status="dismissed" />
            <span className="text-[11px] text-gray-400 dark:text-slate-500">· {kindLabel(r.kind)}</span>
          </div>
          {r.dismissal_reason && <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">Reason: {r.dismissal_reason}</p>}
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Dismissed {fmtClock(r.dismissed_at)} by {r.dismissed_by_name ? firstLastInitial(r.dismissed_by_name) : 'someone'}</p>
          {err && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{err}</p>}
        </div>
        {canManage && <button onClick={restore} disabled={busy} className={S.btnSecondary}>{busy ? 'Restoring…' : 'Restore'}</button>}
      </div>
    </div>
  )
}

function RequestStatusChip({ status }) {
  const m = requestStatusMeta(status)
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${m.cls}`}>{m.label}</span>
}

function EditedLine({ r }) {
  if (!r.last_edited_at) return null
  return (
    <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 italic">
      edited {fmtClock(r.last_edited_at)}{r.last_edited_by_name ? ` by ${firstLastInitial(r.last_edited_by_name)}` : ''}
    </p>
  )
}

// ── Shared ───────────────────────────────────────────────────────────────────
function ListSkeleton() {
  return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />)}</div>
}
function Empty({ text }) {
  return <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 p-10 text-center text-sm text-gray-400 dark:text-slate-500">{text}</div>
}
