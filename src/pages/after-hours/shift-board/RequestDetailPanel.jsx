import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../lib/styles'
import { cityOf, fmtClock } from './shiftBoardData'
import {
  fetchHelpRequestDetail, seeHelpRequest, handleHelpRequest,
  kindLabel, urgencyMeta, statusBadge, STATUS_LABEL, firstLastInitial, fmtChicagoTs,
} from '../requests/requestsData'

// Detail + actions for a raised request, opened from a board row. All writes go
// through the RPCs (see/handle) — handle_help_request marks seen, records the
// resolution, attaches the shift AND logs the activity in one call.
export default function RequestDetailPanel({ open, requestId, onClose, onChanged, toast }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open || !requestId) return
    let stale = false
    setLoading(true); setErr(''); setResolution('')
    fetchHelpRequestDetail(requestId)
      .then(d => { if (!stale) setDetail(d) })
      .catch(e => { if (!stale) setErr(e?.message || 'Could not load the request.') })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [open, requestId])

  if (!open) return null

  async function markSeen() {
    setBusy(true); setErr('')
    try { await seeHelpRequest(requestId); await onChanged?.(); onClose?.() }
    catch (e) { setErr(e.message); toast?.error(e.message) } finally { setBusy(false) }
  }
  async function handle(activityType, loadId) {
    if (!resolution.trim()) { setErr('Add a resolution before handling this.'); return }
    setBusy(true); setErr('')
    try {
      await handleHelpRequest(requestId, resolution, activityType, loadId)
      toast?.success('Request handled')
      await onChanged?.(); onClose?.()
    } catch (e) { setErr(e.message); toast?.error(e.message) } finally { setBusy(false) }
  }

  const d = detail
  const load = d?.load
  const badge = d ? statusBadge(d.driver?.status_now) : null
  const u = d ? urgencyMeta(d.urgency) : null
  const handled = !!d?.handled
  const seen = !!d?.seen
  const canAct = d && !handled && !d.dismissed

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-lg max-h-[92vh] flex flex-col rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 shrink-0">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Request</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {err && <div className={S.errorBox}>{err}</div>}
          {loading || !d ? (
            <div className="h-32 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
          ) : (
            <>
              {/* Driver + kind + urgency */}
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{d.driver?.name || 'Driver'}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                  <span className="text-[11px] text-gray-500 dark:text-slate-400">· {kindLabel(d.kind)}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: u.dot }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: u.dot }} />{u.label}</span>
                </div>
                {d.driver?.status_changed_since && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    was {STATUS_LABEL[d.driver.status_at_raise] || d.driver.status_at_raise} when raised, now {STATUS_LABEL[d.driver.status_now] || d.driver.status_now}
                  </p>
                )}
                {d.other_open_requests > 0 && (
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{d.other_open_requests} other open request{d.other_open_requests === 1 ? '' : 's'} for this driver</p>
                )}
              </div>

              {/* Full note — untruncated */}
              <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 p-3">
                <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{d.note || 'No note.'}</p>
                {d.edited && <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1.5 italic">edited {fmtClock(d.edited.at)} by {firstLastInitial(d.edited.name)}</p>}
              </div>

              {/* Timeline */}
              <div className="flex items-center gap-1.5 text-[11px]">
                <Step done label="Sent" time={fmtClock(d.raised_by?.at)} />
                <Rail on={seen || handled} />
                <Step done={seen || handled} label="Seen" time={seen ? fmtClock(d.seen.at) : null} />
                <Rail on={handled} />
                <Step done={handled} label="Handled" time={handled ? fmtClock(d.handled.at) : null} tone="green" />
              </div>

              {handled && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-3">
                  <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">{fmtChicagoTs(d.handled.at)}{d.handled.name ? ` · by ${firstLastInitial(d.handled.name)}` : ''}</p>
                </div>
              )}
              {d.dismissed && (
                <div className="rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 p-3">
                  <p className="text-xs text-gray-500 dark:text-slate-400">Dismissed{d.dismissed.reason ? ` — ${d.dismissed.reason}` : ''} · {fmtClock(d.dismissed.at)} by {firstLastInitial(d.dismissed.name)}</p>
                </div>
              )}

              {/* Load block */}
              {load ? (
                <div className="rounded-lg border border-gray-200 dark:border-white/10 p-3 space-y-1.5">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    Load {load.load_number}
                    {d.team?.load_is_teammates && (
                      <span className="font-normal text-gray-500 dark:text-slate-400"> — driven by <span className="font-medium text-gray-700 dark:text-slate-300">{load.driven_by}</span> <span className="text-[11px]">(team: {d.team.name})</span></span>
                    )}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-slate-400">{cityOf(load.origin) || '—'} <span className="text-gray-300 dark:text-slate-600">→</span> {cityOf(load.destination) || '—'}</p>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-slate-400">
                    <Fact label="Carrier" value={load.carrier} />
                    <Fact label="Dispatcher" value={load.dispatcher} />
                    <Fact label="Broker" value={load.broker} />
                  </div>
                  {load.checkpoints?.collected > 0 && (
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 pt-1 border-t border-gray-100 dark:border-white/5">
                      Checkpoints: PU {fmtClock(load.checkpoints.pickup_in) || '—'}/{fmtClock(load.checkpoints.pickup_out) || '—'} · DL {fmtClock(load.checkpoints.delivery_in) || '—'}/{fmtClock(load.checkpoints.delivery_out) || '—'}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 dark:text-slate-500 italic">No load linked to this request.</p>
              )}

              {/* Actions */}
              {canAct && (
                <div className="space-y-2 border-t border-gray-100 dark:border-white/5 pt-3">
                  <label className={S.label}>Resolution <span className="font-normal normal-case text-gray-400">· required to handle</span></label>
                  <textarea rows={2} className={`${S.textarea} min-h-[56px]`} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="What happened — e.g. Booked Houston → Pittsburg, notified driver" />
                  <div className="flex flex-wrap justify-end gap-2">
                    {!seen && <button onClick={markSeen} disabled={busy} className={S.btnSecondary}>Mark seen</button>}
                    <button onClick={() => handle('escalated', load?.id ?? null)} disabled={busy} className={S.btnSecondary}>Escalate</button>
                    <button onClick={() => handle('broker_contacted', load?.id ?? null)} disabled={busy} className={S.btnSecondary}>Contacted broker</button>
                    <button onClick={() => handle(null, null)} disabled={busy} className={S.btnSecondary}>Handled</button>
                    <button onClick={() => handle('load_booked', load?.id ?? null)} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Saving…' : 'Book load'}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function Fact({ label, value }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</span>
      <span className="block truncate text-gray-700 dark:text-slate-300">{value || '—'}</span>
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
