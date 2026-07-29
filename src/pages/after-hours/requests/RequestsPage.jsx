import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import {
  openAskAfterHours, REQUESTS_CHANGED_EVENT, statusBadge, kindLabel, urgencyMeta,
  fetchMyRequests, fetchIncoming, fetchOpenShiftId, markRequestSeen, markRequestHandled,
  fmtClock, fmtChicagoTs, firstLastInitial, fmtAgo,
} from './requestsData'

export default function RequestsPage() {
  const { user, profile } = useAuth()
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

  const openCount = incoming?.length || 0

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
        <MyRequests rows={mine} />
      ) : (
        <Incoming rows={incoming} meId={meId} onChanged={refresh} toast={toast} />
      )}
    </div>
  )
}

// ── My requests ──────────────────────────────────────────────────────────────
function MyRequests({ rows }) {
  if (rows == null) return <ListSkeleton />
  if (rows.length === 0) return <Empty text="You haven't raised anything yet. Use “Ask After-Hours” to send the night team a driver." />
  return (
    <div className="space-y-3">
      {rows.map(r => <MyCard key={r.id} r={r} />)}
    </div>
  )
}

function MyCard({ r }) {
  const badge = statusBadge(r.driver_status_at_raise)
  const u = urgencyMeta(r.urgency)
  const handled = !!r.handled_at
  const seen = !!r.seen_at
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
        </div>
        <StatusChip handled={handled} seen={seen} />
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
    </div>
  )
}

function StatusChip({ handled, seen }) {
  const [label, cls] = handled
    ? ['Handled', 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/25']
    : seen
      ? ['Seen', 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/25']
      : ['Sent', 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600/40']
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>{label}</span>
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
function Incoming({ rows, meId, onChanged, toast }) {
  if (rows == null) return <ListSkeleton />
  if (rows.length === 0) return <Empty text="Nothing open. Every raised request has been handled." />
  return (
    <div className="space-y-3">
      {rows.map(r => <IncomingCard key={r.id} r={r} meId={meId} onChanged={onChanged} toast={toast} />)}
    </div>
  )
}

function IncomingCard({ r, meId, onChanged, toast }) {
  const badge = statusBadge(r.driver_status_at_raise)
  const u = urgencyMeta(r.urgency)
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')

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
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${r.seen_at ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/25' : 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600/40'}`}>
          {r.seen_at ? 'Seen' : 'New'}
        </span>
      </div>

      {resolving ? (
        <div className="mt-3 space-y-2">
          <textarea rows={2} autoFocus className={`${S.textarea} min-h-[56px]`} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="What happened — e.g. Load booked, Atlanta → Nashville" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setResolving(false)} disabled={busy} className={S.btnCancel}>Cancel</button>
            <button onClick={handle} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Saving…' : 'Mark handled'}</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2">
          {!r.seen_at && <button onClick={seen} disabled={busy} className={S.btnSecondary}>Mark seen</button>}
          <button onClick={() => setResolving(true)} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">Mark handled</button>
        </div>
      )}
    </div>
  )
}

// ── Shared ───────────────────────────────────────────────────────────────────
function ListSkeleton() {
  return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />)}</div>
}
function Empty({ text }) {
  return <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 p-10 text-center text-sm text-gray-400 dark:text-slate-500">{text}</div>
}
