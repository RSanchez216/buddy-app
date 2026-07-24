import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../../lib/styles'
import { fetchDeskDrivers, deskRead, readChips, deskKeyOf, money, perDriver, rpm, int, periodBounds, periodLabel, todayISO } from './dispatcherData'

// Centered modal for one desk — the content is wide-shaped (roster + departed
// side by side), so it gets width, not a narrow drawer column. Roster data
// (dispatcher_desk_drivers) is fetched on open so the leaderboard never waits.
// Below ~900px it collapses to a single column. Left border + pill + chips are
// colored by the desk's read severity.

const TONE = {
  red:   { border: 'border-l-red-500',     pill: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',           chip: 'text-red-600 dark:text-red-400' },
  amber: { border: 'border-l-amber-500',   pill: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20', chip: 'text-amber-600 dark:text-amber-400' },
  green: { border: 'border-l-emerald-500', pill: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20', chip: 'text-emerald-600 dark:text-emerald-400' },
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// 'YYYY-MM-DD' → "Mon D" (no year), no UTC shift.
function fmtMD(iso) {
  if (!iso) return ''
  const [, m, d] = String(iso).split('-').map(Number)
  return `${MON[m - 1]} ${d}`
}

// Whole days from aISO to bISO (b - a); null if either is unparseable.
function daysBetween(aISO, bISO) {
  const p = (s) => { const [y, m, d] = String(s || '').split('-').map(Number); return (y && m && d) ? Date.UTC(y, m - 1, d) : null }
  const a = p(aISO), b = p(bISO)
  return (a == null || b == null) ? null : Math.round((b - a) / 86400000)
}
// Human tenure: today · N days · N weeks · N months.
function humanDuration(fromISO, toISO) {
  const days = daysBetween(fromISO, toISO)
  if (days == null) return ''
  if (days <= 0) return 'today'
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 56) { const w = Math.round(days / 7); return `${w} week${w === 1 ? '' : 's'}` }
  const mo = Math.round(days / 30.44)
  return `${mo} month${mo === 1 ? '' : 's'}`
}
// Last calendar day of a period given its half-open end ('YYYY-MM-01' of the
// next window) — the day before it.
function lastDayISO(endExclusiveISO) {
  const [y, m, d] = String(endExclusiveISO).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d - 1))
  const p = (n) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

export default function DeskDrawer({ open, desk, floors, grain, anchor, inProgress = false, monthly = false, review, reviewerName, canEdit = false, monthLabel, onSaveReview, onClose }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open || !desk?.desk_id) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(''); setRows(null)
      try {
        const d = await fetchDeskDrivers(desk.desk_id, grain, anchor)
        if (!cancelled) setRows(d)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load roster')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, desk?.desk_id, grain, anchor])

  // On open: capture the originating element, move focus into the modal, and
  // listen for Escape. On close: return focus to where it came from (the row).
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement
    panelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const el = restoreFocusRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open])

  if (!open || !desk) return null

  const read = deskRead(desk, floors, { inProgress })
  const tone = TONE[read.tone] || TONE.green
  const chips = readChips(desk, floors)
  const active = (rows || []).filter(r => r.status === 'active').sort((a, b) => Number(b.gross) - Number(a.gross))
  // Biggest loss first — a $117k departure should read above a $45k one.
  const left = (rows || []).filter(r => r.status === 'left').sort((a, b) => Number(b.run_gross || 0) - Number(a.run_gross || 0))
  const hasLeft = left.length > 0
  const today = todayISO()
  const bounds = periodBounds(grain, anchor)
  // Quiet-flag reference: today for an in-progress period, else the period's last day.
  const quietRef = inProgress ? today : lastDayISO(bounds.end)

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6" onMouseDown={e => e.stopPropagation()}>
      {/* The backdrop is the topmost element at any click outside the panel, so it
          owns the close handler directly (bubbling to the overlay isn't reliable here). */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${desk.desk_name} — desk detail`}
        onClick={e => e.stopPropagation()}
        className={`relative flex flex-col w-[min(1140px,94vw)] max-h-[88vh] bg-white dark:bg-[#0d0d1f] border-l-4 ${tone.border} rounded-xl shadow-2xl focus:outline-none`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 dark:border-white/5 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">{desk.desk_name}</h3>
              <span className={`shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${tone.pill}`}>{read.label}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">Dispatch desk · booking + home-desk retention · {periodLabel(grain, anchor)}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — the only scroll region */}
        <div className="overflow-y-auto p-4 space-y-4">
          {/* Recap strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Recap label="Gross" value={money(desk.gross)} />
            <Recap label="$/drv·mo" value={perDriver(desk.per_driver_month)} />
            <Recap label="Departed" value={int(desk.turnover)} />
            <Recap label="RPM" value={rpm(desk.rpm)} />
          </div>

          {/* Why this read | Monthly review */}
          <div className={`grid grid-cols-1 gap-4 ${monthly ? 'min-[900px]:grid-cols-2' : ''}`}>
            <div className={`${S.card} border-l-4 ${tone.border} p-4 space-y-3`}>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-slate-500">Why this read</span>
              <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed">{read.analysis}</p>
              <div className="flex flex-wrap gap-2">
                {chips.map(c => (
                  <span key={c.label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-xs">
                    <span className="text-gray-500 dark:text-slate-400">{c.label}</span>
                    <span className={`font-semibold tabular-nums ${TONE[c.tone].chip}`}>{c.value}</span>
                  </span>
                ))}
              </div>
            </div>
            {monthly && (
              <MonthlyReviewPanel
                deskKey={deskKeyOf(desk)}
                review={review}
                reviewerName={reviewerName}
                canEdit={canEdit}
                monthLabel={monthLabel}
                onSave={onSaveReview}
              />
            )}
          </div>

          {error && <div className={S.errorBox}>{error}</div>}
          {loading && <div className="flex items-center justify-center h-24"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>}

          {!loading && rows && (
            <div className={`grid grid-cols-1 gap-4 ${hasLeft ? 'min-[900px]:grid-cols-5' : ''}`}>
              {/* On the desk now — ~60% */}
              <section className={hasLeft ? 'min-[900px]:col-span-3' : ''}>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">On the desk now ({active.length})</h4>
                {/* Explain the two most-misread numbers, permanently — not a hover. */}
                <p className="text-[11px] text-gray-500 dark:text-slate-500 leading-relaxed mb-2">
                  <strong className="font-semibold text-gray-600 dark:text-slate-400">Since</strong> = first load booked by this desk.{' '}
                  <strong className="font-semibold text-gray-600 dark:text-slate-400">Share</strong> = portion of this driver&apos;s freight that came through this desk over the last 56 days.
                </p>
                <div className={`${S.card} overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead className={S.tableHead}>
                      <tr>
                        <th className={S.th}>Driver</th>
                        <th className={S.th}>Since</th>
                        <th className={`${S.th} text-right`}>Loads</th>
                        <th className={`${S.th} text-right`}>Gross</th>
                        <th className={`${S.th} text-right`}>RPM</th>
                        <th className={`${S.th} text-right`}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400 dark:text-slate-600">No active drivers</td></tr>
                      ) : active.map(r => {
                        // New = first load on this desk lands inside the selected period.
                        const isNew = r.first_load_on_desk && r.first_load_on_desk >= bounds.start && r.first_load_on_desk < bounds.end
                        // Quiet = no load in >10 days before the period end (or today).
                        const quietDays = r.last_load_date ? daysBetween(r.last_load_date, quietRef) : null
                        const quiet = quietDays != null && quietDays > 10
                        return (
                          <tr key={r.driver_id} className={`${S.tableRow} align-top`}>
                            <td className={`${S.td} text-gray-900 dark:text-slate-200`}>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium">{r.driver_name}</span>
                                {isNew && (
                                  <span
                                    title={`First load ${fmtMD(r.first_load_on_desk)} — partial period, judge next period.`}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20"
                                  >new</span>
                                )}
                                {quiet && <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">⚠ no load in {quietDays} days</span>}
                              </div>
                              {r.previous_desk && (
                                <div className="text-[11px] text-cyan-600 dark:text-cyan-400 mt-0.5">↗ from {r.previous_desk}</div>
                              )}
                            </td>
                            <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>
                              {r.first_load_on_desk ? (
                                <>{fmtMD(r.first_load_on_desk)}<span className="text-[10px] text-gray-400 dark:text-slate-500"> · {humanDuration(r.first_load_on_desk, today)}</span></>
                              ) : '—'}
                            </td>
                            <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(r.loads)}</td>
                            <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-slate-200`}>{money(r.gross)}</td>
                            <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{rpm(r.rpm)}</td>
                            <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{r.home_share != null ? `${r.home_share}%` : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Departed this period — ~40%. The run (whole-stretch) figures are
                  what the desk lost; period figures are often 0 (final load elsewhere). */}
              {hasLeft && (
                <section className="min-[900px]:col-span-2">
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Departed this period ({left.length})</h4>
                  <div className="space-y-2">
                    {left.map(r => {
                      const iid = r.internal_id ?? r.driver_internal_id
                      // Losing an above-desk-average driver is a different story.
                      const aboveDesk = r.run_rpm != null && desk.rpm != null && Number(r.run_rpm) >= Number(desk.rpm)
                      const agoDays = daysBetween(r.terminated_at, today)
                      return (
                        <div key={r.driver_id} className={`${S.card} p-3`}>
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div className="min-w-0">
                              <span className="font-medium text-gray-900 dark:text-slate-200">{r.driver_name}</span>
                              {iid != null && <span className="ml-1.5 text-[11px] text-gray-400 dark:text-slate-500">· #{iid}</span>}
                            </div>
                            {r.terminated_at && (
                              <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20">
                                terminated {fmtMD(r.terminated_at)}{agoDays != null ? ` · ${agoDays}d ago` : ''}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            <RunFig label="Loads here" value={int(r.run_loads)} />
                            <RunFig label="Gross here" value={money(r.run_gross)} />
                            <RunFig label="RPM here" value={rpm(r.run_rpm)} tone={aboveDesk ? 'up' : 'muted'} />
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-2">
                            Ran this desk {fmtMD(r.first_load_on_desk)} – {fmtMD(r.last_load_date)}{r.previous_desk ? ` · came from ${r.previous_desk}` : ''}
                          </p>
                          {Number(r.loads) === 0 && (
                            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 italic">
                              Counted here because this desk booked most of their recent freight, even though their final load went elsewhere.
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Condensed explainer, next to the number it explains. */}
                  <p className="text-[11px] text-gray-500 dark:text-slate-500 leading-relaxed mt-3">
                    A <strong className="font-semibold text-gray-600 dark:text-slate-400">departure</strong> is a driver terminated during the period — read from their termination date, not inferred from load silence. A driver on vacation doesn&apos;t count.
                  </p>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// Human date for the "Reviewed · … · {date}" line (America/Chicago).
function fmtReviewedAt(ts) {
  if (!ts) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ts))
  } catch { return '' }
}

// Monthly review sign-off for this desk. Toggle + note write through onSave to
// the same dispatcher_reviews record the leaderboard reads, so a change here is
// reflected in the table (and vice-versa). Note saves on blur and on toggle.
function MonthlyReviewPanel({ deskKey, review, reviewerName, canEdit, monthLabel, onSave }) {
  const reviewed = !!review?.reviewed
  const [note, setNote] = useState(review?.note || '')
  const [saved, setSaved] = useState(false)
  // Re-sync when the underlying record changes (e.g. reconcile after save, or
  // switching desks reuses this mounted panel).
  useEffect(() => { setNote(review?.note || '') }, [review?.note, deskKey])
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1500) }

  async function toggle() {
    if (!canEdit) return
    if (await onSave(deskKey, { reviewed: !reviewed, note })) flash()
  }
  async function saveNote() {
    if (!canEdit) return
    const trimmed = note.trim()
    if ((review?.note || '') === trimmed) return // no-op — don't rewrite
    if (await onSave(deskKey, { note: trimmed })) flash()
  }

  return (
    <div className={`${S.card} p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">Monthly review · {monthLabel}</h4>
        {saved && <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
      <button
        onClick={toggle}
        disabled={!canEdit}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${reviewed ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}
      >
        <span className={`w-4 h-4 rounded-full border inline-flex items-center justify-center ${reviewed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-400 dark:border-slate-500 text-transparent'}`}>
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </span>
        {reviewed ? 'Reviewed' : 'Mark as reviewed'}
      </button>
      {reviewed && (
        <p className="text-[11px] text-gray-500 dark:text-slate-400">
          Reviewed{reviewerName ? ` · by ${reviewerName}` : ''}{review?.reviewed_at ? ` · ${fmtReviewedAt(review.reviewed_at)}` : ''}
        </p>
      )}
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={saveNote}
        disabled={!canEdit}
        rows={3}
        placeholder="Add a note on this desk's performance / flags…"
        className="w-full text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2.5 py-2 text-gray-700 dark:text-slate-200 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-y disabled:opacity-60"
      />
    </div>
  )
}

function Recap({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-500">{label}</div>
      <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums mt-0.5">{value}</div>
    </div>
  )
}

// One run-total figure in the departed card. tone 'up' = above the desk's RPM
// (a loss that stings), 'muted' = at/below (default neutral for loads/gross).
function RunFig({ label, value, tone }) {
  const valCls = tone === 'up'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'muted'
      ? 'text-gray-500 dark:text-slate-400'
      : 'text-gray-900 dark:text-slate-200'
  return (
    <div className="rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums mt-0.5 ${valCls}`}>{value}</div>
    </div>
  )
}
