import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtClock, fmtChicagoTs, fmtDuration, todayChicago, lifecycleLabel, copyText } from './shiftBoardData'
import { buildBrokerCopyText } from './brokerRiskCopy'
import { statusBadge } from '../requests/requestsData'
import AccessorialPanel from './AccessorialPanel'
import { PauseGlyph } from './BrokerCredit'
import { creditGlyphTitle } from './brokerCreditData'
import { statusMeta } from './accessorialData'

// 'Greenville' + 'NC' → 'Greenville, NC'; '' when the record wouldn't parse, so a
// malformed TMS row shows a dash rather than a date fragment.
const cityLabel = (city, st) => (city ? (st ? `${city}, ${st}` : city) : '')

// 'Edil Eraliev' → 'Edil E.' for compact recipient labels.
function shortName(full) {
  const parts = String(full || '').trim().split(/\s+/)
  if (!parts[0]) return ''
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0]
}

// Column set. Disp/Carrier stack under the driver name; Truck+Trailer collapse
// into Equipment. Checkpoints and Paperwork only appear while their phase flag
// is on — otherwise they'd be a column of dashes.
function columnsFor(settings, browsing) {
  const cols = ['Driver', 'Idle', 'Equipment', 'Load state', 'Status', 'Load', 'Origin → Destination']
  if (settings?.track_checkpoints) cols.push('Checkpoints')
  if (settings?.track_pods || settings?.track_bols) cols.push('Paperwork')
  if (settings?.accessorials_enabled) cols.push('Accessorial')
  cols.push('Note', 'Actions')
  // OK is a review of tonight's shift — omit it entirely while browsing a past
  // week so no one ticks a box that means nothing.
  if (!browsing) cols.push('OK')
  return cols
}

// The four logged-activity actions (Flag is a check, handled separately). POD/BOL
// only appear while their phase flag is on.
const ACTIVITY_ACTIONS = [
  { type: 'load_booked', label: 'Book' },
  { type: 'note', label: 'Note' },
  { type: 'pod_collected', label: 'POD', flag: 'track_pods' },
  { type: 'bol_collected', label: 'BOL', flag: 'track_bols' },
  { type: 'escalated', label: 'Esc' },
]

// Plain-words label per activity type, for the notes popover.
const NOTE_ACTIVITY_LABELS = {
  load_booked: 'Booked', pod_collected: 'POD collected', bol_collected: 'BOL collected',
  broker_contacted: 'Broker contacted', driver_assisted: 'Driver assisted',
  rescan_requested: 'Rescan requested', note: 'Note', escalated: 'Escalated',
}

// Collapse whitespace and cut to n chars with an ellipsis — for the glyph title.
function truncate(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// Tooltip for the collapsed-row money marker — names the amount when the rate
// con stated one, otherwise just that a penalty exists.
function moneyTitle(b) {
  const amt = b?.penalty_max_usd
  return amt != null
    ? `Up to $${Number(amt).toLocaleString('en-US')} at risk on this load`
    : 'Penalty stated on this rate con'
}

// Tooltip for the collapsed-row risk shield, by flag combination.
//
// The wording is deliberately "reported" and "verify" — never blacklisted, bad
// broker or do not use. These are companies MANAS hauls for daily; the shield
// says check who you're talking to, not refuse the load.
function riskTitle(risk) {
  if (!risk) return ''
  const { id_theft, nonpayment, double_brokering } = risk
  if (double_brokering) return 'Double brokering reported for this broker'
  if (id_theft && nonpayment) return 'Identity theft and nonpayment reported for this broker'
  if (id_theft) return 'Identity theft reported for this broker — verify the rep and load number'
  if (nonpayment) return 'Nonpayment history reported for this broker'
  return 'This broker appears on a risk list'
}

// Rendered as the body of the active tab. The tab bar carries the heading/count;
// this is the driver table. It owns the vertical scroll (flex-1) with a sticky
// header so the bands and tabs above stay put while the list scrolls.
export default function PriorityGroup({ group, rows, settings, shift, rowActionsByDriver, recipientsById, meId, isManager, highlightDriver, stateSort, onToggleStateSort, onOk, onAct, onAcknowledge, onCopyEscalation, onOpenRequest, openDriverId, onToggleDriver, accByLoad, exByLoad, brokerByLoad, riskByLoad, brokerRiskByLoad, idleByDriver, undoInfo, onUndo, onRemoveActivity, toast, onAccessorialChanged, onTimesSaved, shiftId, canAddTypes, browsing }) {
  const curYear = Number(todayChicago().slice(0, 4))
  const cols = columnsFor(settings, browsing)
  // The row panel carries whichever phases are on — checkpoints, accessorials or
  // both. Checkpoint times are entered in it, so it must open for either.
  const panelOn = !!settings?.accessorials_enabled || !!settings?.track_checkpoints

  // Windowed rendering. 128 rows × ~12 columns is a lot of DOM to build before
  // the board is interactive on a slow link, and almost none of it is on screen.
  // Render a page at a time and extend when the sentinel scrolls into view —
  // scrolling stays native and row heights stay honest, unlike fixed-height
  // virtualisation, which the two-line driver cell and the expandable panel would
  // both break.
  const PAGE = 30
  const sentinelRef = useRef(null)
  // The window is keyed by tab + row count, so changing either restarts it
  // without an effect that would setState during render and cascade.
  const winKey = `${group.key}:${rows.length}`
  const [win, setWin] = useState({ key: winKey, limit: PAGE })
  const limit = win.key === winKey ? win.limit : PAGE

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || limit >= rows.length) return
    const io = new IntersectionObserver(
      entries => {
        // Extend before they reach the bottom, so scrolling never stalls.
        if (entries.some(e => e.isIntersecting)) {
          setWin({ key: winKey, limit: Math.min(limit + PAGE, rows.length) })
        }
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [limit, rows.length, winKey])

  // An expanded row must render even when it sits past the window — the
  // Times-needed jump and the ?driver= deep link both land on arbitrary rows.
  const openIdx = openDriverId ? rows.findIndex(r => r.driver_id === openDriverId) : -1
  const highlightIdx = highlightDriver ? rows.findIndex(r => r.driver_id === highlightDriver) : -1
  const effectiveLimit = Math.max(limit, openIdx + 1, highlightIdx + 1)
  const visible = rows.slice(0, effectiveLimit)

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-gray-200 dark:border-white/10 overflow-hidden">
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
          {group.key === 'raised' ? 'Nothing raised by dispatch right now — all clear.' : 'No drivers in this group.'}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs [&_td]:align-top">
            {/* Sticky is applied per-th (position:sticky on thead/tr is flaky
                across browsers). Opaque bg + bottom border so rows can't show
                through when scrolled under it. */}
            <thead className="text-gray-500 dark:text-slate-400">
              <tr>
                {cols.map(h => {
                  const thCls = 'sticky top-0 z-10 bg-gray-100 dark:bg-[#14142c] border-b border-gray-200 dark:border-white/10 text-left font-semibold px-3 py-2 whitespace-nowrap'
                  return h === 'Load state' ? (
                    <th key={h} className={thCls}>
                      <button type="button" onClick={onToggleStateSort} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-slate-200">
                        Load state{stateSort && <span aria-hidden>{stateSort === 'asc' ? '↑' : '↓'}</span>}
                      </button>
                    </th>
                  ) : h === 'Equipment' ? (
                    <th key={h} title="Truck / Trailer" className={`${thCls} cursor-default`}>{h}</th>
                  ) : h === 'Idle' ? (
                    // Reserve the width from first paint — it sits between Driver
                    // and Equipment, so any late-arriving glyph must not widen it
                    // and shift every column to its right.
                    <th key={h} title="Days since last delivery" className={`${thCls} !text-right cursor-default min-w-[3.25rem]`}>{h}</th>
                  ) : (
                    <th key={h} className={thCls}>{h}</th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <BoardRow key={r.driver_id} r={r} curYear={curYear} settings={settings} shift={shift}
                  ra={rowActionsByDriver?.get(r.driver_id)} recipientsById={recipientsById} meId={meId} isManager={isManager}
                  highlighted={highlightDriver === r.driver_id}
                  onOk={onOk} onAct={onAct} onAcknowledge={onAcknowledge} onCopyEscalation={onCopyEscalation} onOpenRequest={onOpenRequest}
                  colSpan={cols.length} panelOpen={panelOn && openDriverId === r.driver_id} onToggleDriver={onToggleDriver}
                  acc={r.load_id ? accByLoad?.get(r.load_id) : null} exception={r.load_id ? exByLoad?.get(r.load_id) : null}
                  broker={r.load_id ? brokerByLoad?.get(r.load_id) : null} idle={idleByDriver?.get(r.driver_id) || null}
                  risk={r.load_id ? riskByLoad?.get(r.load_id) || null : null}
                  brokerRisk={r.load_id ? brokerRiskByLoad?.get(r.load_id) || null : null}
                  undo={undoInfo?.driverId === r.driver_id ? undoInfo : null} onUndo={onUndo} onRemoveActivity={onRemoveActivity}
                  toast={toast} onAccessorialChanged={onAccessorialChanged} onTimesSaved={onTimesSaved} shiftId={shiftId} canAddTypes={canAddTypes} browsing={browsing} />
              ))}
              {effectiveLimit < rows.length && (
                <tr ref={sentinelRef}>
                  <td colSpan={cols.length} className="px-3 py-3 text-center text-[11px] text-gray-400 dark:text-slate-500">
                    Showing {effectiveLimit} of {rows.length} — scroll for more
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// days_since_delivery is negative when the load delivers in the future — never
// render "-4 days ago". Positive = past, negative = upcoming.
function deliveryAge(days) {
  if (days == null || days === '') return ''
  const n = Number(days)
  if (Number.isNaN(n)) return ''
  if (n < 0) { const a = Math.abs(n); return a === 1 ? 'delivers in 1 day' : `delivers in ${a} days` }
  if (n === 0) return 'delivered today'
  return n === 1 ? '1 day ago' : `${n} days ago`
}

// 'YYYY-MM-DD' → 'Jul 30', adding the year only when it isn't the current one.
function fmtLoadDate(v, curYear) {
  const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const opts = { month: 'short', day: 'numeric' }
  if (Number(m[1]) !== curYear) opts.year = 'numeric'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', opts)
}

// LOAD STATE pill styling per lifecycle (Option 2 — pill only, rows stay white).
const PILL = {
  upcoming:       { dot: 'bg-blue-500',    cls: 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30' },
  picks_up_today: { dot: 'bg-amber-500',   cls: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
  in_transit:     { dot: 'bg-emerald-500', cls: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' },
  delivers_today: { dot: 'bg-orange-500',  cls: 'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30' },
  delivered:      { dot: 'bg-red-500',     cls: 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30' },
  billing:        { dot: 'bg-purple-500',  cls: 'bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30' },
  closed:         { dot: 'bg-gray-400',    cls: 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-white/10' },
}
const inDaysPhrase = (n) => { const x = Number(n); if (Number.isNaN(x)) return ''; return x <= 0 ? 'today' : x === 1 ? 'in 1 day' : `in ${x} days` }
const agoDaysPhrase = (n) => { const x = Number(n); if (Number.isNaN(x)) return ''; return x <= 0 ? 'today' : x === 1 ? '1 day ago' : `${x} days ago` }

function lifecycleTooltip(r, curYear) {
  const puDate = fmtLoadDate(r.pickup_date, curYear)
  const dlDate = fmtLoadDate(r.delivery_date, curYear)
  switch (r.lifecycle) {
    case 'upcoming':       return `Picks up ${inDaysPhrase(r.days_to_pickup)}${puDate ? ` — ${puDate}` : ''}`.trim()
    case 'picks_up_today': return `Picks up today${puDate ? ` — ${puDate}` : ''}`
    case 'in_transit':     return dlDate ? `In transit — delivers ${dlDate}` : 'In transit'
    case 'delivers_today': return `Delivers today${dlDate ? ` — ${dlDate}` : ''}`
    case 'delivered':      return `Delivered ${agoDaysPhrase(r.days_since_delivery)}${dlDate ? ` — ${dlDate}` : ''}`.trim()
    case 'billing':        return `Delivered ${agoDaysPhrase(r.days_since_delivery)}, awaiting billing`
    case 'closed':         return dlDate ? `Closed — delivered ${dlDate}` : 'Closed'
    default:               return ''
  }
}

function LoadStatePill({ r, trackPods, curYear }) {
  if (!r.lifecycle) return <span className="text-gray-300 dark:text-slate-600">—</span>
  const p = PILL[r.lifecycle] || PILL.closed
  const label = (r.lifecycle === 'delivered' && trackPods && !r.pod_done)
    ? `${lifecycleLabel(r.lifecycle)} · POD due`
    : lifecycleLabel(r.lifecycle)
  return (
    <span title={lifecycleTooltip(r, curYear)} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap ${p.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />
      {label}
    </span>
  )
}

function Chip({ label, on, muted, title }) {
  return (
    <span title={title || undefined} className={`inline-flex items-center justify-center min-w-[26px] h-5 px-1 rounded text-[9px] font-bold border ${
      muted ? 'text-gray-300 dark:text-slate-600 border-gray-200 dark:border-white/10'
        : on ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30'
          : 'text-gray-400 dark:text-slate-500 border-gray-200 dark:border-white/10'
    }`}>{label}</span>
  )
}

// A Paperwork chip that is also the control — like the Checkpoints chips. Clicks
// open the collect modal (create, or edit when already logged); a collected chip
// stays clickable so a mis-entry is fixable. Disabled/muted with no load.
function PaperworkChip({ label, type, done, act, loadId, r, onAct }) {
  const when = act?.at ? fmtClock(act.at) : ''
  const title = !loadId ? 'No load'
    : done ? `${label} collected${when ? ` ${when}` : ''} — click to edit`
      : `Log ${label} collected`
  return (
    <button type="button" onClick={() => loadId && onAct(r, type, act || null)} disabled={!loadId} title={title}
      className="disabled:cursor-not-allowed disabled:opacity-60">
      <Chip label={label} on={done} muted={!loadId} />
    </button>
  )
}

// Neutral action button (nothing logged yet).
function ActBtn({ children, onClick, disabled, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed">
      {children}
    </button>
  )
}
// Completed action — green (or amber for a flag). Clicking reopens it to edit.
function DoneBtn({ children, onClick, tone = 'done', title }) {
  const cls = tone === 'flag'
    ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40'
    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/40'
  return (
    <button type="button" onClick={onClick} title={title}
      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${cls}`}>
      {children}
    </button>
  )
}

// Load number + a copy control that yields ONLY the number (paste-ready for
// Octopus). The icon stays quiet until the row is hovered.
function LoadCell({ number }) {
  const [copied, setCopied] = useState(false)
  const copy = async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(String(number))
      setCopied(true); setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard blocked — no-op, never alert */ }
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="font-mono text-gray-700 dark:text-slate-300">{number}</span>
      {copied ? (
        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Copied</span>
      ) : (
        <button type="button" onClick={copy} title="Copy load number"
          className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" />
          </svg>
        </button>
      )}
    </span>
  )
}

// The one-chip ACCESSORIAL state for a driver's current load: detention still
// running outranks a request already on record, which outranks nothing at all.
function AccessorialCell({ acc, exception }) {
  if (exception?.over_free_time) {
    return (
      <span title={`${fmtDuration(exception.minutes_waiting)} at the ${exception.stop}`}
        className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30">
        Detention likely
      </span>
    )
  }
  if (acc?.count) {
    const meta = statusMeta(acc.status)
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px] font-medium whitespace-nowrap ${meta.cls}`}>
        {meta.label}{acc.count > 1 ? ` ×${acc.count}` : ''}
      </span>
    )
  }
  return <span className="text-gray-300 dark:text-slate-600">—</span>
}

// Every note on a row, gathered from the three places they get written: the open
// help request, each logged activity's note (Book / POD / BOL / Esc / Note), and
// the flag's issue_note. One glyph summarises them (count when >1); clicking opens
// a popover with the full text. An escalation's note is listed here too, but its
// ack/copy controls stay on the dedicated line below (it can exist note-less).
function NoteCell({ r, acts, issueNote, onOpenRequest, showDash }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const btnRef = useRef(null)

  const notes = []
  if (r.open_request_id) {
    notes.push({
      key: 'req', kind: 'request',
      label: r.open_request_by ? `Request from ${r.open_request_by}` : 'Request raised',
      note: r.open_request_note || '', load_number: r.load_number,
      at: r.open_request_at || null, requestId: r.open_request_id,
    })
  }
  for (const a of (acts || [])) {
    if (!a.note || !a.note.trim()) continue
    notes.push({
      key: `act-${a.id}`, kind: 'activity',
      label: NOTE_ACTIVITY_LABELS[a.type] || 'Note',
      note: a.note, load_number: a.load_number ?? null, at: a.at || null,
    })
  }
  if (issueNote && issueNote.trim()) {
    notes.push({ key: 'flag', kind: 'flag', label: 'Flagged', note: issueNote, load_number: r.load_number, at: null })
  }
  // Newest first; a note without a timestamp (the flag) falls to the bottom.
  notes.sort((a, b) => (b.at ? new Date(b.at).getTime() : 0) - (a.at ? new Date(a.at).getTime() : 0))

  if (notes.length === 0) return showDash ? <span className="text-gray-300 dark:text-slate-600">—</span> : null

  const hasRequest = !!r.open_request_id
  const newest = notes[0]
  const tone = hasRequest
    ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
    : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/5'

  const toggle = () => {
    if (open) { setOpen(false); return }
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen(true)
  }

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-expanded={open}
        title={truncate(newest.note, 60) || newest.label}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm ${tone}`}>
        <span aria-hidden>🗒</span>
        {notes.length > 1 && <span className="text-xs font-semibold tabular-nums">{notes.length}</span>}
      </button>
      {open && rect && (
        <NotePopover notes={notes} rect={rect} onClose={() => setOpen(false)} onOpenRequest={onOpenRequest} />
      )}
    </>
  )
}

// Portaled to <body> — this board nests overflow-auto ancestors that clip any
// in-flow dropdown, so the popover is positioned by the anchor's viewport rect and
// closes on scroll/resize (when that rect would go stale).
function NotePopover({ notes, rect, onClose, onOpenRequest }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const WIDTH = 320
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8))
  const spaceBelow = window.innerHeight - rect.bottom
  const openUp = spaceBelow < 240 && rect.top > spaceBelow
  const pos = openUp
    ? { bottom: window.innerHeight - rect.top + 6 }
    : { top: rect.bottom + 6 }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[125]" onClick={onClose} />
      <div style={{ position: 'fixed', left, width: WIDTH, ...pos }}
        className="z-[130] rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl max-h-[70vh] overflow-y-auto">
        <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
          {notes.length === 1 ? 'Note' : `Notes · ${notes.length}`}
        </div>
        <ul className="divide-y divide-gray-100 dark:divide-white/5">
          {notes.map(n => (
            <li key={n.key} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] font-semibold ${n.kind === 'request' ? 'text-red-600 dark:text-red-400' : n.kind === 'flag' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-slate-400'}`}>{n.label}</span>
                {n.at && <span className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-nowrap">{fmtChicagoTs(n.at)}</span>}
              </div>
              {n.note && <p className="mt-1 text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap break-words">{n.note}</p>}
              {(n.load_number != null || n.kind === 'request') && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-gray-400 dark:text-slate-500">{n.load_number != null ? `#${n.load_number}` : ''}</span>
                  {n.kind === 'request' && (
                    <button type="button" onClick={() => { onClose(); onOpenRequest?.(n.requestId) }}
                      className="text-[11px] font-semibold text-red-600 dark:text-red-400 hover:underline whitespace-nowrap">See / Handle ▸</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>,
    document.body,
  )
}

// 'Jul 26' from a date or timestamp string (leading YYYY-MM-DD), built from parts
// so a date-only value doesn't shift a day across the UTC boundary.
function fmtShortDate(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}
// Days-since-delivery colour bands, anchored to after_hours_settings.idle_after_days
// (4) so the column and the "Idle 4+ days" tab agree — below it is noticed, at/past
// it is flagged. Text colour only; no fills. Only reached for shown values (>= 2).
function idleTone(days, threshold) {
  const t = Number(threshold) || 4 // idle_after_days
  if (days < t) return 'text-gray-500 dark:text-slate-400'          // 2..t-1 — below the idle threshold
  if (days <= 14) return 'text-amber-600 dark:text-amber-400 font-medium' // in the Idle group
  return 'text-rose-600 dark:text-rose-400 font-medium'             // well past it
}

// Idle cell — the day count (days_since_delivery, from the board), plus a neutral
// note glyph when the driver has an idle reason on record. 0d/1d and null/future
// carry no signal, so the cell stays EMPTY there (not a dash — a column of dashes
// still draws the eye). The reason glyph rides the day count: when a driver isn't
// idle any more (count hidden) the reason is stale — left over from a past idle
// stint — so it's hidden too. days_since_delivery (this column) and days_on_reason
// (the popover) are different numbers and are never shown in place of each other.
function IdleCell({ days, idle, threshold }) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const btnRef = useRef(null)
  const n = Number(days)
  const showDays = days != null && Number.isFinite(n) && n >= 2
  const has = showDays && !!(idle && idle.reason)
  const title = has ? (idle.note ? truncate(`${idle.reason} — ${idle.note}`, 80) : idle.reason) : undefined

  const toggle = () => {
    if (open) { setOpen(false); return }
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen(true)
  }
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {showDays && <span className={`tabular-nums ${idleTone(n, threshold)}`}>{n}d</span>}
      {has && (
        <button ref={btnRef} type="button" onClick={toggle} aria-expanded={open} title={title}
          className="shrink-0 leading-none text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200">
          <span aria-hidden className="text-sm">🗒</span>
        </button>
      )}
      {open && rect && <IdlePopover idle={idle} rect={rect} onClose={() => setOpen(false)} />}
    </span>
  )
}
// Portaled to <body> — this board's overflow-auto ancestors clip any in-flow
// dropdown, so it's positioned off the anchor's viewport rect and closes on
// scroll/resize (when that rect goes stale). Read-only; editing lives elsewhere.
function IdlePopover({ idle, rect, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const WIDTH = 300
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8))
  const spaceBelow = window.innerHeight - rect.bottom
  const openUp = spaceBelow < 200 && rect.top > spaceBelow
  const pos = openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }
  const dor = Number(idle.days_on_reason)
  const CHIP = 'inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400'

  return createPortal(
    <>
      <div className="fixed inset-0 z-[125]" onClick={onClose} />
      <div style={{ position: 'fixed', left, width: WIDTH, ...pos }}
        className="z-[130] rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl p-3 max-h-[70vh] overflow-y-auto text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{idle.reason}</span>
          <span className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-nowrap tabular-nums">
            {idle.started_on ? `set ${fmtShortDate(idle.started_on)}` : ''}{Number.isFinite(dor) ? `${idle.started_on ? ' · ' : ''}${dor} day${dor === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        {idle.note && <p className="mt-1 text-[11px] leading-snug text-gray-600 dark:text-slate-300 whitespace-pre-wrap break-words">{idle.note}</p>}
        {(idle.at_yard || idle.under_review) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {idle.at_yard && <span className={CHIP}>At yard</span>}
            {idle.under_review && <span className={CHIP}>Under review</span>}
          </div>
        )}
        {idle.reviewed_by && (
          <p className="mt-2 pt-1.5 border-t border-gray-100 dark:border-white/5 text-[10px] text-gray-400 dark:text-slate-500">
            Reviewed by {idle.reviewed_by}{idle.reviewed_at ? ` · ${fmtShortDate(idle.reviewed_at)}` : ''}
          </p>
        )}
      </div>
    </>,
    document.body,
  )
}

// Copy the broker, the load and every flag as plain text for Telegram.
//
// ALWAYS VISIBLE, never hover-only. The row's other affordances use
// `opacity-0 group-hover/row:opacity-100`, which is unreachable on a touch
// device — and the person who needs this most is the associate on a phone at
// 2am. It sits at low opacity instead and comes to full on hover or focus, so
// it reads as quiet on a desktop without ever being untappable.
//
// stopPropagation because the whole row is the expand toggle: copying a broker
// must not also open the panel underneath it.
function CopyBrokerButton({ row, risk, brokerName }) {
  const [done, setDone] = useState(false)
  const copy = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    try {
      await copyText(buildBrokerCopyText({ row, risk, brokerName }))
      setDone(true)
      setTimeout(() => setDone(false), 1400)
    } catch { /* clipboard blocked — stay silent, never alert() */ }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${brokerName} + load ${row?.load_number ?? ''} + flags`}
      aria-label={`Copy broker and load details for ${brokerName}`}
      className="shrink-0 inline-flex items-center justify-center min-w-[22px] h-[18px] px-1 rounded
                 text-[10px] leading-none text-gray-400 dark:text-slate-500
                 opacity-60 hover:opacity-100 focus:opacity-100
                 hover:bg-gray-100 dark:hover:bg-white/10
                 focus:outline-none focus:ring-1 focus:ring-orange-500/50 transition-opacity"
    >
      {done ? <span className="text-emerald-600 dark:text-emerald-400">✓</span> : '⧉'}
    </button>
  )
}

function BoardRow({ r, curYear, settings, shift, ra, recipientsById, meId, isManager, highlighted, onOk, onAct, onAcknowledge, onCopyEscalation, onOpenRequest, colSpan, panelOpen, onToggleDriver, acc, exception, broker, idle, risk, brokerRisk, undo, onUndo, onRemoveActivity, toast, onAccessorialChanged, onTimesSaved, shiftId, canAddTypes, browsing }) {
  const muted = r.in_scope === false
  const panelOn = !!settings?.accessorials_enabled || !!settings?.track_checkpoints

  // Clicking the row expands it too — but never when the click landed on one of
  // the row's own controls (checkbox, action button, the load-number copy).
  const onRowClick = (e) => {
    if (!panelOn) return
    if (e.target.closest('button, input, a, select, textarea, label')) return
    onToggleDriver?.(r.driver_id)
  }
  // Parsed once in fetchBoard — never re-parsed per render.
  const o = cityLabel(r.origin_city, r.origin_state), d = cityLabel(r.destination_city, r.destination_state)
  const pu = fmtLoadDate(r.pickup_date, curYear), dl = fmtLoadDate(r.delivery_date, curYear)

  // Per-driver action state — prefer the shift_row_actions payload, fall back to
  // the board row's own check fields before it loads.
  const acts = ra?.activities || []
  const doneAct = (type) => acts.find(a => a.type === type) || null
  const isOk = ra && ra.check_id != null ? ra.is_ok : (r.checked_this_shift ? r.check_is_ok : null)
  const okChecked = isOk === true
  const flagged = isOk === false
  const issueNote = ra?.issue_note ?? r.check_note

  const escAct = doneAct('escalated')
  const escName = escAct ? (recipientsById?.get(escAct.escalated_to) || escAct.escalated_to_name || '') : ''
  const ackName = escAct?.acknowledged_at ? (recipientsById?.get(escAct.acknowledged_by) || escAct.acknowledged_by_name || 'someone') : ''
  const canAck = !!escAct && !escAct.acknowledged_at && (meId === escAct.escalated_to || isManager)

  // Deep-link target: scroll into view and hold a highlight ring briefly.
  const rowRef = useRef(null)
  useEffect(() => {
    if (highlighted && rowRef.current) rowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  return (
    <>
    <tr ref={rowRef} onClick={onRowClick}
      className={`group/row border-b border-gray-100 dark:border-white/[0.03] ${muted ? 'opacity-50' : ''} ${flagged ? 'bg-amber-50/60 dark:bg-amber-500/[0.07]' : ''} ${highlighted ? 'ring-2 ring-inset ring-orange-400 dark:ring-orange-500/60 bg-orange-50/60 dark:bg-orange-500/[0.08]' : ''} ${panelOn ? 'cursor-pointer' : ''} ${panelOpen ? 'bg-orange-50/60 dark:bg-orange-500/[0.07]' : ''}`}>
      {/* Driver — name (+ status/team chips) with dispatcher · carrier under it.
          A caret opens the times and accessorial panel beneath. */}
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1.5 whitespace-nowrap font-medium text-gray-900 dark:text-slate-200">
          {panelOn ? (
            <button type="button" onClick={() => onToggleDriver?.(r.driver_id)} aria-expanded={panelOpen}
              title={panelOpen ? 'Collapse' : 'Open times and accessorials'}
              className="inline-flex items-center gap-1.5 hover:text-orange-600 dark:hover:text-orange-400">
              <svg className={`w-3 h-3 shrink-0 text-gray-400 transition-transform ${panelOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              {r.driver_name || '—'}
            </button>
          ) : <span>{r.driver_name || '—'}</span>}
          {r.driver_status && r.driver_status !== 'active' && (() => {
            const b = statusBadge(r.driver_status)
            return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
          })()}
          {r.team_name && (
            <span title={`Team ${r.team_name}`} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-white/10">
              Team · {r.team_name}
            </span>
          )}
        </div>
        {(r.dispatcher_name || r.carrier_name) && (
          <div className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-nowrap">
            {[r.dispatcher_name, r.carrier_name].filter(Boolean).join(' · ')}
          </div>
        )}
      </td>
      {/* Idle — days since last delivery (from the board), plus a neutral note
          glyph when the driver has an idle reason on record (from idle meta). */}
      <td className="px-3 py-2 align-top text-right whitespace-nowrap min-w-[3.25rem]">
        <IdleCell days={r.days_since_delivery} idle={idle} threshold={settings?.idle_after_days} />
      </td>
      {/* Equipment — truck / trailer, display only */}
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400 font-mono">{r.truck || '—'} / {r.trailer || '—'}</td>
      {/* Load state — transit lifecycle from the RPC, pill only (row stays white) */}
      <td className="px-3 py-2 whitespace-nowrap">
        <LoadStatePill r={r} trackPods={!!settings?.track_pods} curYear={curYear} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {r.team_name
          ? <span className="text-gray-500 dark:text-slate-400">covered — <span className="text-gray-700 dark:text-slate-300 font-medium">{r.team_name}</span></span>
          : <span className="text-gray-600 dark:text-slate-300">{r.load_status || '—'}</span>}
      </td>
      {/* Load — a fixed-width marker gutter, then the number + paste-ready copy on
          line one, broker (if any) on line two. The gutter is ALWAYS rendered
          (even empty) and right-aligned, so every load number starts at the same
          x and the markers form a straight column instead of zig-zagging behind
          numbers of different widths.
          Line two reuses an empty gutter so the broker lines up with the number.

          WIDTH: five glyphs are reachable — one deadline marker (urgent and soon
          are mutually exclusive) + money + credit + risk + detention. Credit is
          independent of the risk shield: a broker can have a credit event with no
          risk-list entry at all. Five at 14px with four 2px gaps is 78px, so the
          gutter is w-20 (80px). Widening moves every load number by the same
          amount, so the column stays a straight edge — which is the property that
          matters. */}
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1">
          <span className="shrink-0 w-20 flex items-center justify-end gap-0.5">
            {/* Deadline marker, then money, then risk, then the detention dot.
                Triangle for urgent, dot for soon: told apart in greyscale, not
                colour alone. The soon dot is smaller so it doesn't out-weigh the
                urgent triangle. Glyphs only, no row tint. */}
            {broker?.deadline_severity === 'urgent' && (
              <svg aria-hidden viewBox="0 0 12 12" className="shrink-0 w-3.5 h-3.5 text-rose-500 fill-current"><title>POD due within 24h of delivery</title><path d="M6 1l5 9H1z" /></svg>
            )}
            {broker?.deadline_severity === 'soon' && (
              <span title="POD due within 48h of delivery" className="shrink-0 w-2 h-2 rounded-full bg-amber-500" />
            )}
            {broker?.money_at_risk && (
              <span title={moneyTitle(broker)} className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 font-bold text-[11px] leading-none text-rose-600 dark:text-rose-400">$</span>
            )}
            {/* Credit event — a pause, not a warning. Rose when Apex won't fund
                the broker at all, amber when the line was merely cut. A STALE
                event gets no glyph: it's been open past 90 days without a lift,
                so it can't earn a place in the gutter every night — it stays in
                the panel instead. */}
            {risk?.credit && !risk.credit.is_stale && (
              <PauseGlyph
                title={creditGlyphTitle(risk.credit)}
                className={`shrink-0 w-3.5 h-3.5 ${risk.credit.event_type === 'no_credit'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-amber-600 dark:text-amber-400'}`}
              />
            )}
            {/* Broker risk — violet, matching the Broker risk block in the
                expanded panel and deliberately outside the rose/amber set so it
                doesn't read as another deadline or money alert.
                Keyed on an ACTUAL standing flag, not on the meta entry existing:
                since credit events landed, the RPC also returns brokers that have
                only a credit event and no risk-list entry (Uber Freight, Raven
                Cargo, Yellow Diamond), and jsonb_strip_nulls drops the flag keys
                for them. Testing `risk` alone would put a shield on all three. */}
            {(risk?.id_theft || risk?.nonpayment || risk?.double_brokering) && (
              <svg aria-hidden={false} role="img" viewBox="0 0 20 20"
                className="shrink-0 w-3.5 h-3.5 text-violet-600 dark:text-violet-400 fill-current">
                <title>{riskTitle(risk)}</title>
                <path d="M10 1l7 3v5c0 4.4-3 8.3-7 9.4C6 17.3 3 13.4 3 9V4l7-3z" />
              </svg>
            )}
            {broker?.detention_policy === 'not_paid' && (
              <span title="This broker does not pay detention." className="shrink-0 w-3.5 h-3.5 rounded-full bg-rose-500" />
            )}
          </span>
          {r.load_number == null
            ? <span className="text-gray-300 dark:text-slate-600">—</span>
            : <LoadCell number={r.load_number} />}
        </div>
        {broker?.broker && (
          <div className="mt-0.5 flex items-center gap-1">
            <span className="shrink-0 w-20" aria-hidden />
            <span className="text-[10px] text-gray-400 dark:text-slate-500 truncate max-w-[6rem]" title={broker.broker}>{broker.broker}</span>
            {/* Broker + load + every flag, as plain text for Telegram. The glyphs
                above say THAT something is wrong; this is the only way to share
                what. Built from data already on the row — no per-row query. */}
            <CopyBrokerButton row={r} risk={brokerRisk} brokerName={broker.broker} />
          </div>
        )}
      </td>
      {/* Origin → Destination, with pickup/delivery dates and honest load context */}
      <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
        {r.load_number == null ? (
          <span className="italic text-gray-400 dark:text-slate-500 whitespace-nowrap">no load on record</span>
        ) : (
          <div>
            <div className="whitespace-nowrap">
              {o || d ? <>{o || '—'} <span className="text-gray-300 dark:text-slate-600">→</span> {d || '—'}</> : '—'}
            </div>
            {(pu || dl) && <div className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-nowrap">{pu || '—'} → {dl || '—'}</div>}
            {r.load_is_historic ? (
              <div className="text-[10px] italic text-gray-400 dark:text-slate-500 whitespace-nowrap">last load — {deliveryAge(r.days_since_delivery)}</div>
            ) : r.load_is_teammates ? (
              <div className="text-[10px] text-gray-400 dark:text-slate-500 whitespace-nowrap">
                driven by <span className="text-gray-500 dark:text-slate-400">{r.driven_by || '—'}</span>{r.team_name ? <> · team {r.team_name}</> : null}
              </div>
            ) : null}
          </div>
        )}
      </td>
      {/* Checkpoints — only rendered while the phase is on */}
      {settings?.track_checkpoints && (
        <td className="px-3 py-2 whitespace-nowrap">
          {/* The chips expand the row — the times are typed in the panel now,
              not in a window on top of the board. */}
          <button type="button" onClick={() => r.load_id && r.in_scope !== false && onToggleDriver?.(r.driver_id)} disabled={!r.load_id || r.in_scope === false}
            title={r.in_scope === false ? 'Picked up before go-live — not in scope' : r.load_id ? 'Enter checkpoint times' : 'No load'}
            className="flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60">
            <Chip label="PU↑" on={!!r.cp_pickup_in} title={fmtClock(r.cp_pickup_in)} />
            <Chip label="PU↓" on={!!r.cp_pickup_out} title={fmtClock(r.cp_pickup_out)} />
            <Chip label="DL↑" on={!!r.cp_delivery_in} title={fmtClock(r.cp_delivery_in)} />
            <Chip label="DL↓" on={!!r.cp_delivery_out} title={fmtClock(r.cp_delivery_out)} />
          </button>
        </td>
      )}
      {/* Paperwork — the chips are the control now (like Checkpoints): each opens
          the collect modal, so POD/BOL live here once, not also in Actions. */}
      {(settings?.track_bols || settings?.track_pods) && (
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-1">
            {settings?.track_bols && <PaperworkChip label="BOL" type="bol_collected" done={!!doneAct('bol_collected') || !!r.bol_done} act={doneAct('bol_collected')} loadId={r.load_id} r={r} onAct={onAct} />}
            {settings?.track_pods && <PaperworkChip label="POD" type="pod_collected" done={!!doneAct('pod_collected') || !!r.pod_done} act={doneAct('pod_collected')} loadId={r.load_id} r={r} onAct={onAct} />}
          </div>
        </td>
      )}
      {/* Accessorial — highest-priority state for this driver's current load */}
      {settings?.accessorials_enabled && (
        <td className="px-3 py-2 whitespace-nowrap"><AccessorialCell acc={acc} exception={exception} /></td>
      )}
      {/* Note — one indicator over every note on the row (request, activity notes,
          flag note), click to read them all. Escalation keeps its own status +
          controls line below, since a note-less escalation still needs them. */}
      <td className="px-3 py-2 max-w-[240px] space-y-1">
        <NoteCell r={r} acts={acts} issueNote={issueNote} onOpenRequest={onOpenRequest} showDash={!escAct} />
        {escAct && (
          <div className="text-[10px] leading-tight space-y-0.5">
            <span className="block text-amber-600 dark:text-amber-400 font-medium" title={escAct.note || ''}>⚠ Escalated to {shortName(escName) || '—'}</span>
            {escAct.acknowledged_at ? (
              <span className="block text-emerald-600 dark:text-emerald-400">✓ Acknowledged by {shortName(ackName) || ackName}{escAct.acknowledged_at ? ` · ${fmtClock(escAct.acknowledged_at)}` : ''}</span>
            ) : canAck ? (
              <button type="button" onClick={() => onAcknowledge?.(escAct.id)} className="px-1.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 font-semibold">Acknowledge</button>
            ) : null}
            <button type="button" onClick={() => onCopyEscalation?.(escAct.id)} className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200">📋 Copy for Telegram</button>
          </div>
        )}
      </td>
      {/* Actions — each opens a popover to capture what happened. A logged action
          renders done (green); a flag renders amber. Clicking a done one reopens
          it to edit / remove. A raised request is still booked from its panel. */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {/* POD/BOL live in the Paperwork column now — Actions is Book · Note · Esc · Flag. */}
          {ACTIVITY_ACTIONS.filter(a => a.type === 'load_booked' || a.type === 'note' || a.type === 'escalated').map(a => {
            // A note isn't a one-per-row state — always an add button, so a row can
            // carry several. It never renders "done".
            if (a.type === 'note') {
              return <ActBtn key="note" onClick={() => onAct(r, 'note', null)} title="Add a note">Note</ActBtn>
            }
            const done = doneAct(a.type)
            if (a.type === 'load_booked' && r.open_request_id) {
              return <ActBtn key={a.type} onClick={() => onOpenRequest?.(r.open_request_id)} title="Open the request to book it">Book</ActBtn>
            }
            if (done) {
              return <DoneBtn key={a.type} onClick={() => onAct(r, a.type, done)} title="Edit or remove">✓ {a.label}</DoneBtn>
            }
            return <ActBtn key={a.type} onClick={() => onAct(r, a.type, null)} title={a.label}>{a.label}</ActBtn>
          })}
          {flagged
            ? <DoneBtn tone="flag" onClick={() => onAct(r, 'flag', { note: issueNote })} title="Edit or clear the flag">⚑ Flag</DoneBtn>
            : <ActBtn onClick={() => onAct(r, 'flag', null)} disabled={!shift} title={shift ? 'Flag an issue' : 'Start a shift to flag'}>Flag</ActBtn>}
          {/* Inline undo for ~10s after a save — no confirm needed, intent is
              unambiguous. */}
          {undo && (
            <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-gray-500 dark:text-slate-400 whitespace-nowrap">
              <span className="text-emerald-600 dark:text-emerald-400">{undo.label}</span>·
              <button type="button" onClick={() => onUndo?.()} className="font-semibold text-orange-600 dark:text-orange-400 hover:underline">Undo</button>
            </span>
          )}
        </div>
      </td>
      {/* OK — ticking checks the driver; unticking clears the check row entirely.
          The column is omitted entirely while browsing (review is tonight's). */}
      {!browsing && (
        <td className="px-3 py-2 text-center">
          <input type="checkbox" checked={okChecked} disabled={!shift}
            onChange={e => onOk(r, e.target.checked)}
            title={shift ? 'Mark reviewed' : 'Start a shift to review'}
            className="w-4 h-4 accent-emerald-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" />
        </td>
      )}
    </tr>
    {panelOpen && (
      <tr className="border-b border-gray-100 dark:border-white/[0.03]">
        <td colSpan={colSpan} className="p-0">
          <AccessorialPanel row={r} exception={exception} meId={meId} toast={toast}
            onChanged={onAccessorialChanged} onTimesSaved={onTimesSaved} shiftId={shiftId}
            accessorialsOn={!!settings?.accessorials_enabled} trackCheckpoints={!!settings?.track_checkpoints}
            canAddTypes={canAddTypes} activities={ra?.activities} onRemoveActivity={onRemoveActivity}
            brokerRisk={brokerRisk} brokerName={broker?.broker || null} />
        </td>
      </tr>
    )}
    </>
  )
}
