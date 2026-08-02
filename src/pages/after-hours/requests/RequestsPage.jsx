import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import {
  openEditRequest, REQUESTS_CHANGED_EVENT,
  statusBadge, kindLabel, urgencyMeta, requestStatusMeta, canManageRequest,
  fetchHelpRequestsList, fetchHelpRequestsStatusCounts,
  seeHelpRequest, handleHelpRequest, dismissHelpRequest, restoreHelpRequest,
  fmtClock, fmtChicagoTs, firstLastInitial,
} from './requestsData'

// ── Chicago date helpers (date-only bounds for p_from / p_to) ────────────────
const CT = 'America/Chicago'
const ymdCT = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: CT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n); const p = x => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}
function weekStartCT() { const t = ymdCT(); const [y, m, d] = t.split('-').map(Number); const dow = new Date(y, m - 1, d).getDay(); return addDays(t, -(dow === 0 ? 6 : dow - 1)) }
function monthStartCT() { return ymdCT().slice(0, 8) + '01' }

const SCOPES = [['mine', 'Raised by me'], ['to_work', 'To work'], ['all', 'All']]
const DATE_PRESETS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom']]
const STATUS_CHIPS = [
  { key: 'new', label: 'New', on: 'bg-orange-500 border-orange-500 text-white', off: 'border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-400' },
  { key: 'seen', label: 'Seen', on: 'bg-amber-500 border-amber-500 text-white', off: 'border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400' },
  { key: 'handled', label: 'Handled', on: 'bg-emerald-500 border-emerald-500 text-white', off: 'border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' },
  { key: 'dismissed', label: 'Dismissed', on: 'bg-gray-500 border-gray-500 text-white', off: 'border-gray-200 dark:border-slate-600/40 text-gray-500 dark:text-slate-400' },
]

export default function RequestsPage() {
  const { user, profile, canEdit } = useAuth()
  const toast = useToast()
  const toastRef = useRef(toast); toastRef.current = toast
  const meId = user?.id || profile?.id || null

  const [scope, setScope] = useState('mine')
  const [statuses, setStatuses] = useState(['new'])       // default: New only
  const [datePreset, setDatePreset] = useState('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({ new: 0, seen: 0, handled: 0, dismissed: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [detail, setDetail] = useState(null)              // row open in the modal
  const [detailMode, setDetailMode] = useState(null)      // 'handle' | 'dismiss' initial form
  const [reloadKey, setReloadKey] = useState(0)
  const closeDetail = () => { setDetail(null); setDetailMode(null) }
  const openDismiss = (r) => { setDetailMode('dismiss'); setDetail(r) }
  const openHandle = (r) => { setDetailMode('handle'); setDetail(r) }

  const { from, to } = useMemo(() => {
    if (datePreset === 'week') return { from: weekStartCT(), to: null }
    if (datePreset === 'month') return { from: monthStartCT(), to: null }
    if (datePreset === 'custom') return { from: customFrom || null, to: customTo || null }
    return { from: null, to: null }
  }, [datePreset, customFrom, customTo])

  // Debounce the search box (~200ms).
  useEffect(() => { const id = setTimeout(() => setQuery(searchInput), 200); return () => clearTimeout(id) }, [searchInput])

  const statusesKey = statuses.slice().sort().join(',')
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchHelpRequestsList(scope, statuses, from, to, query),
      fetchHelpRequestsStatusCounts(scope, from, to),
    ]).then(([list, c]) => { if (!cancelled) { setRows(list); setCounts(c); setError(false) } })
      .catch((e) => { if (!cancelled) { setError(true); toastRef.current.error("Couldn't load requests", e) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, statusesKey, from, to, query, reloadKey])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  useEffect(() => {
    const h = () => reload()
    window.addEventListener(REQUESTS_CHANGED_EVENT, h)
    return () => window.removeEventListener(REQUESTS_CHANGED_EVENT, h)
  }, [reload])

  const toggleStatus = (key) => setStatuses(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
  const onChanged = () => { closeDetail(); reload() }

  return (
    <div className="space-y-4">
      {/* Header — page-level Ask button removed (the header one is always visible) */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> After Hours
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Requests</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">What you asked After-Hours to handle, and what's waiting for you to pick up.</p>
      </div>

      {/* Scope tabs */}
      <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100 dark:bg-white/5 w-fit">
        {SCOPES.filter(([k]) => k !== 'all' || canEdit).map(([k, label]) => (
          <button key={k} onClick={() => setScope(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${scope === k ? 'bg-white dark:bg-white/10 text-orange-600 dark:text-orange-400 shadow-sm' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Date pills */}
      <div className="flex flex-wrap items-center gap-2">
        {DATE_PRESETS.map(([k, label]) => (
          <button key={k} onClick={() => setDatePreset(k)}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${datePreset === k ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400' : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
            {label}
          </button>
        ))}
        {datePreset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={customFrom} max={customTo || undefined} onChange={e => setCustomFrom(e.target.value)} className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-gray-700 dark:text-slate-200" />
            <span className="text-gray-400 text-xs">→</span>
            <input type="date" value={customTo} min={customFrom || undefined} onChange={e => setCustomTo(e.target.value)} className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-gray-700 dark:text-slate-200" />
          </div>
        )}
      </div>

      {/* Status chips + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_CHIPS.map(c => {
            const active = statuses.includes(c.key)
            return (
              <button key={c.key} onClick={() => toggleStatus(c.key)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${active ? c.on : `bg-transparent ${c.off} hover:bg-gray-50 dark:hover:bg-white/5`}`}>
                {c.label} <span className="tabular-nums opacity-80">{counts[c.key] ?? 0}</span>
              </button>
            )
          })}
          <span className="text-xs text-gray-400 dark:text-slate-500">total {counts.total ?? 0}{statuses.length === 0 ? ' · showing all' : ''}</span>
        </div>
        <div className="relative">
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setSearchInput('') }}
            placeholder="Search driver, note, load…"
            className="w-56 pl-2.5 pr-6 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-800/60 text-gray-700 dark:text-slate-200 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          {searchInput && <button onClick={() => setSearchInput('')} title="Clear" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xs">✕</button>}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="h-40 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
      ) : error ? (
        <div className={S.errorBox}>Couldn&apos;t load requests. <button onClick={reload} className="underline font-medium">Retry</button></div>
      ) : (
        <RequestsTable rows={rows} meId={meId} isManager={canEdit} onOpen={setDetail} onHandle={openHandle} onSeen={async (r) => { try { await seeHelpRequest(r.id); reload() } catch (e) { toast.error(e.message || "Couldn't mark seen") } }} onRestore={async (r) => { try { await restoreHelpRequest(r.id); toast.success('Restored'); reload() } catch (e) { toast.error(e.message || "Couldn't restore") } }} onEdit={openEditRequest} onDismiss={openDismiss} />
      )}

      {detail && <RequestDetailModal row={detail} initialMode={detailMode} meId={meId} isManager={canEdit} onClose={closeDetail} onChanged={onChanged} toast={toast} />}
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────────────────
const COLS = ['Driver', 'Kind', 'Urgency', 'Note', 'Raised', 'Progress', 'Status', 'Actions']

function RequestsTable({ rows, meId, isManager, onOpen, onHandle, onSeen, onRestore, onEdit, onDismiss }) {
  if (!rows.length) {
    return <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 p-10 text-center text-sm text-gray-400 dark:text-slate-500">No requests match this filter.</div>
  }
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs [&_td]:align-top">
          <thead className="bg-gray-50 dark:bg-white/[0.02] text-gray-400 dark:text-slate-500">
            <tr>
              {COLS.map(h => (
                <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">
                  {h === 'Progress' ? (
                    <span className="inline-flex items-center gap-1">Progress
                      <span className="text-[9px] font-normal normal-case text-gray-400 dark:text-slate-500" title="Sent → Seen → Handled — filled = done, amber = current step">Sent · Seen · Handled</span>
                    </span>
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <RequestRow key={r.id} r={r} meId={meId} isManager={isManager} onOpen={onOpen} onHandle={onHandle} onSeen={onSeen} onRestore={onRestore} onEdit={onEdit} onDismiss={onDismiss} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const DOT_CLS = { green: 'bg-emerald-500', amber: 'bg-amber-500', grey: 'bg-gray-300 dark:bg-slate-600' }
function dotStates(r) {
  if (r.status === 'dismissed') return ['grey', 'grey', 'grey']
  return [
    'green',
    r.seen_at || r.handled_at ? 'green' : 'amber',
    r.handled_at ? 'green' : (r.seen_at ? 'amber' : 'grey'),
  ]
}
function ProgressDots({ r }) {
  const [a, b, c] = dotStates(r)
  const cell = (state, label, ts) => (
    <span title={`${label}${ts ? ' ' + fmtClock(ts) : (state === 'grey' ? ' — not yet' : '')}`} className={`w-2 h-2 rounded-full ${DOT_CLS[state]}`} />
  )
  return <div className="flex items-center gap-1.5">{cell(a, 'Sent', r.raised_at)}{cell(b, 'Seen', r.seen_at)}{cell(c, 'Handled', r.handled_at)}</div>
}

// 'Jul 30, 2:55 PM' (no CT suffix, no year — the raised column is compact).
function fmtRaised(ts) {
  if (!ts) return '—'
  try { return new Intl.DateTimeFormat('en-US', { timeZone: CT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) } catch { return '—' }
}
function agePhrase(h) {
  const n = Number(h)
  if (Number.isNaN(n)) return ''
  if (n < 1) return 'under an hour ago'
  if (n < 24) return `${Math.round(n)}h ago`
  return `${Math.round(n / 24)}d ago`
}

function RequestRow({ r, meId, isManager, onOpen, onHandle, onSeen, onRestore, onEdit, onDismiss }) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menu) return
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false) }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [menu])

  const u = urgencyMeta(r.urgency)
  const dismissed = r.status === 'dismissed'
  const isOpen = r.status === 'new' || r.status === 'seen'
  const canManage = canManageRequest(r, meId, isManager)
  const dbadge = r.driver_status && r.driver_status !== 'active' ? statusBadge(r.driver_status) : null
  const stop = (e) => e.stopPropagation()

  return (
    <tr onClick={() => onOpen(r)} tabIndex={0} role="button"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r) } }}
      className={`border-b border-gray-100 dark:border-white/[0.03] cursor-pointer hover:bg-gray-50/70 dark:hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-inset ${dismissed ? 'opacity-60' : ''}`}>
      {/* Driver + status badge */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className={`font-medium ${dismissed ? 'line-through text-gray-500 dark:text-slate-500' : 'text-gray-900 dark:text-slate-200'}`}>{r.driver_name || 'Driver'}</div>
        {dbadge && <span className={`mt-0.5 inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${dbadge.cls}`}>{dbadge.label}</span>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-slate-400">{kindLabel(r.kind)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: u.dot }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: u.dot }} />{u.label}</span>
      </td>
      <td className="px-3 py-2 max-w-[280px]">
        <p className="truncate text-gray-700 dark:text-slate-300" title={r.note || ''}>{r.note || '—'}</p>
        {r.status === 'handled' && r.resolution && <p className="truncate text-[11px] text-gray-400 dark:text-slate-500" title={r.resolution}>→ {r.resolution}</p>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400 tabular-nums" title={agePhrase(r.age_hours)}>{fmtRaised(r.raised_at)}</td>
      <td className="px-3 py-2 whitespace-nowrap"><ProgressDots r={r} /></td>
      <td className="px-3 py-2 whitespace-nowrap"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${requestStatusMeta(r.status).cls}`}>{requestStatusMeta(r.status).label}</span></td>
      {/* Actions — stop row-click on the controls themselves */}
      <td className="px-3 py-2 whitespace-nowrap" onClick={stop}>
        <div className="flex items-center gap-1">
          {isOpen ? (
            <>
              <button onClick={() => onHandle(r)} className="px-2 py-0.5 rounded text-[11px] font-semibold bg-orange-500 hover:bg-orange-400 text-white">Handle</button>
              {!r.seen_at && <button onClick={() => onSeen(r)} className="px-2 py-0.5 rounded text-[11px] font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">Seen</button>}
              {canManage && (
                <div className="relative" ref={menuRef}>
                  <button onClick={() => setMenu(m => !m)} className="px-1.5 py-0.5 rounded text-[11px] font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">⋯</button>
                  {menu && (
                    <div className="absolute right-0 top-full mt-1 z-20 w-28 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-xl py-1">
                      <button onClick={() => { setMenu(false); onEdit(r) }} className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">Edit</button>
                      <button onClick={() => { setMenu(false); onDismiss(r) }} className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">Dismiss</button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <button onClick={() => onOpen(r)} className="px-2 py-0.5 rounded text-[11px] font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">View</button>
              {dismissed && canManage && <button onClick={() => onRestore(r)} className="px-2 py-0.5 rounded text-[11px] font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">Restore</button>}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Detail modal (opens for every status) ────────────────────────────────────
function RequestDetailModal({ row: r, initialMode = null, meId, isManager, onClose, onChanged, toast }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(initialMode)      // 'handle' | 'dismiss'
  const [resolution, setResolution] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  const dismissed = r.status === 'dismissed'
  const handled = r.status === 'handled'
  const isOpen = r.status === 'new' || r.status === 'seen'
  const canManage = canManageRequest(r, meId, isManager)
  const u = urgencyMeta(r.urgency)
  const dbadge = r.driver_status && r.driver_status !== 'active' ? statusBadge(r.driver_status) : null

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); onChanged() } catch (e) { setErr(e.message || 'Something went wrong'); toast.error(e.message || 'Error'); setBusy(false) } }
  const doSeen = () => run(() => seeHelpRequest(r.id))
  const doHandle = () => { if (!resolution.trim()) return; run(() => handleHelpRequest(r.id, resolution.trim(), null, null)) }
  const doDismiss = () => { if (!reason.trim()) return; run(() => dismissHelpRequest(r.id, reason.trim())) }
  const doRestore = () => run(() => restoreHelpRequest(r.id))
  const doEdit = () => { onClose(); openEditRequest(r) }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-md max-h-[88vh] overflow-y-auto rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-base font-bold ${dismissed ? 'line-through text-gray-500 dark:text-slate-500' : 'text-gray-900 dark:text-white'}`}>{r.driver_name || 'Driver'}</span>
              {dbadge && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${dbadge.cls}`}>{dbadge.label}</span>}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-slate-400">
              <span>{kindLabel(r.kind)}</span>
              <span className="inline-flex items-center gap-1 font-medium" style={{ color: u.dot }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: u.dot }} />{u.label}</span>
            </div>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${requestStatusMeta(r.status).cls}`}>{requestStatusMeta(r.status).label}</span>
        </div>

        {/* Note */}
        {r.note && <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{r.note}</p>}
        {r.last_edited_at && <p className="text-[11px] italic text-gray-400 dark:text-slate-500">edited {fmtClock(r.last_edited_at)}{r.last_edited_by_name ? ` by ${firstLastInitial(r.last_edited_by_name)}` : ''}</p>}

        {/* Timeline */}
        <div className="rounded-lg border border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.02] p-3 space-y-1.5">
          <TimelineStep done label="Sent" ts={r.raised_at} who={r.raised_by_name} />
          <TimelineStep done={!!r.seen_at} label="Seen" ts={r.seen_at} who={r.seen_by_name} pending={!r.seen_at && isOpen} />
          <TimelineStep done={!!r.handled_at} label="Handled" ts={r.handled_at} who={r.handled_by_name} pending={!r.handled_at && isOpen} tone="green" />
        </div>

        {/* Resolution / dismissal */}
        {handled && r.resolution && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-3">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">→ {r.resolution}</p>
          </div>
        )}
        {dismissed && (
          <div className="rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 p-3">
            <p className="text-sm text-gray-600 dark:text-slate-300">Dismissed{r.dismissal_reason ? `: ${r.dismissal_reason}` : ''}</p>
            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{fmtChicagoTs(r.dismissed_at)}{r.dismissed_by_name ? ` · by ${firstLastInitial(r.dismissed_by_name)}` : ''}</p>
          </div>
        )}

        {err && <div className={S.errorBox}>{err}</div>}

        {/* Inline handle / dismiss forms */}
        {mode === 'handle' && (
          <div className="space-y-2">
            <textarea rows={2} autoFocus className={`${S.textarea} min-h-[56px]`} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="What happened — e.g. Load booked, Atlanta → Nashville" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setMode(null)} disabled={busy} className={S.btnCancel}>Cancel</button>
              <button onClick={doHandle} disabled={busy || !resolution.trim()} className="px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Saving…' : 'Mark handled'}</button>
            </div>
          </div>
        )}
        {mode === 'dismiss' && (
          <div className="space-y-2">
            <textarea rows={2} autoFocus className={`${S.textarea} min-h-[56px]`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you dismissing it? e.g. raised in error" />
            {!reason.trim() && <p className="text-[11px] text-amber-600 dark:text-amber-400">A reason is required.</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setMode(null)} disabled={busy} className={S.btnCancel}>Cancel</button>
              <button onClick={doDismiss} disabled={busy || !reason.trim()} className="px-4 py-2 text-sm font-semibold bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Dismissing…' : 'Dismiss request'}</button>
            </div>
          </div>
        )}

        {/* Footer actions */}
        {!mode && (
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {isOpen && !r.seen_at && <button onClick={doSeen} disabled={busy} className={S.btnSecondary}>Mark seen</button>}
            {isOpen && canManage && <button onClick={doEdit} disabled={busy} className={S.btnSecondary}>Edit</button>}
            {isOpen && canManage && <button onClick={() => setMode('dismiss')} disabled={busy} className={S.btnSecondary}>Dismiss</button>}
            {isOpen && <button onClick={() => setMode('handle')} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">Mark handled</button>}
            {dismissed && canManage && <button onClick={doRestore} disabled={busy} className={S.btnSecondary}>{busy ? 'Restoring…' : 'Restore'}</button>}
            {!isOpen && <button onClick={onClose} className={S.btnCancel}>Close</button>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function TimelineStep({ done, label, ts, who, pending, tone }) {
  const dot = done ? (tone === 'green' ? 'bg-emerald-500' : 'bg-orange-500') : pending ? 'bg-amber-400' : 'bg-gray-300 dark:bg-slate-600'
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className={done ? 'font-medium text-gray-700 dark:text-slate-200' : 'text-gray-400 dark:text-slate-500'}>{label}</span>
      {ts && <span className="text-gray-500 dark:text-slate-400 tabular-nums">{fmtChicagoTs(ts)}</span>}
      {done && who && <span className="text-gray-400 dark:text-slate-500">· {firstLastInitial(who)}</span>}
      {!done && pending && <span className="text-amber-500 dark:text-amber-400">· waiting</span>}
    </div>
  )
}
