import { useEffect, useRef, useState } from 'react'
import { cityOf, fmtClock, fmtDuration, todayChicago, lifecycleLabel } from './shiftBoardData'
import { statusBadge } from '../requests/requestsData'
import AccessorialPanel from './AccessorialPanel'
import { statusMeta } from './accessorialData'

// 'Edil Eraliev' → 'Edil E.' for compact recipient labels.
function shortName(full) {
  const parts = String(full || '').trim().split(/\s+/)
  if (!parts[0]) return ''
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0]
}

// Column set. Disp/Carrier stack under the driver name; Truck+Trailer collapse
// into Equipment. Checkpoints and Paperwork only appear while their phase flag
// is on — otherwise they'd be a column of dashes.
function columnsFor(settings) {
  const cols = ['Driver', 'Equipment', 'Load state', 'Status', 'Load', 'Origin → Destination']
  if (settings?.track_checkpoints) cols.push('Checkpoints')
  if (settings?.track_pods || settings?.track_bols) cols.push('Paperwork')
  if (settings?.accessorials_enabled) cols.push('Accessorial')
  cols.push('Note', 'Actions', 'OK')
  return cols
}

// The four logged-activity actions (Flag is a check, handled separately). POD/BOL
// only appear while their phase flag is on.
const ACTIVITY_ACTIONS = [
  { type: 'load_booked', label: 'Book' },
  { type: 'pod_collected', label: 'POD', flag: 'track_pods' },
  { type: 'bol_collected', label: 'BOL', flag: 'track_bols' },
  { type: 'escalated', label: 'Esc' },
]

// Rendered as the body of the active tab. The tab bar carries the heading/count;
// this is the driver table. It owns the vertical scroll (flex-1) with a sticky
// header so the bands and tabs above stay put while the list scrolls.
export default function PriorityGroup({ group, rows, settings, shift, rowActionsByDriver, recipientsById, meId, isManager, highlightDriver, stateSort, onToggleStateSort, onOk, onAct, onAcknowledge, onCopyEscalation, onOpenRequest, openDriverId, onToggleDriver, accByLoad, exByLoad, toast, onAccessorialChanged, shiftId, canAddTypes }) {
  const curYear = Number(todayChicago().slice(0, 4))
  const cols = columnsFor(settings)
  // The row panel carries whichever phases are on — checkpoints, accessorials or
  // both. Checkpoint times are entered in it, so it must open for either.
  const panelOn = !!settings?.accessorials_enabled || !!settings?.track_checkpoints

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
                  ) : (
                    <th key={h} className={thCls}>{h}</th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <BoardRow key={r.driver_id} r={r} curYear={curYear} settings={settings} shift={shift}
                  ra={rowActionsByDriver?.get(r.driver_id)} recipientsById={recipientsById} meId={meId} isManager={isManager}
                  highlighted={highlightDriver === r.driver_id}
                  onOk={onOk} onAct={onAct} onAcknowledge={onAcknowledge} onCopyEscalation={onCopyEscalation} onOpenRequest={onOpenRequest}
                  colSpan={cols.length} panelOpen={panelOn && openDriverId === r.driver_id} onToggleDriver={onToggleDriver}
                  acc={r.load_id ? accByLoad?.get(r.load_id) : null} exception={r.load_id ? exByLoad?.get(r.load_id) : null}
                  toast={toast} onAccessorialChanged={onAccessorialChanged} shiftId={shiftId} canAddTypes={canAddTypes} />
              ))}
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

function BoardRow({ r, curYear, settings, shift, ra, recipientsById, meId, isManager, highlighted, onOk, onAct, onAcknowledge, onCopyEscalation, onOpenRequest, colSpan, panelOpen, onToggleDriver, acc, exception, toast, onAccessorialChanged, shiftId, canAddTypes }) {
  const muted = r.in_scope === false
  const panelOn = !!settings?.accessorials_enabled || !!settings?.track_checkpoints

  // Clicking the row expands it too — but never when the click landed on one of
  // the row's own controls (checkbox, action button, the load-number copy).
  const onRowClick = (e) => {
    if (!panelOn) return
    if (e.target.closest('button, input, a, select, textarea, label')) return
    onToggleDriver?.(r.driver_id)
  }
  const o = cityOf(r.origin), d = cityOf(r.destination)
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
      {/* Load — its own column with paste-ready copy */}
      <td className="px-3 py-2 whitespace-nowrap">
        {r.load_number == null ? <span className="text-gray-300 dark:text-slate-600">—</span> : <LoadCell number={r.load_number} />}
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
      {/* Paperwork — only rendered while a POD/BOL phase is on */}
      {(settings?.track_bols || settings?.track_pods) && (
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-1">
            {settings?.track_bols && <Chip label="BOL" on={!!r.bol_done} />}
            {settings?.track_pods && <Chip label="POD" on={!!r.pod_done} />}
          </div>
        </td>
      )}
      {/* Accessorial — highest-priority state for this driver's current load */}
      {settings?.accessorials_enabled && (
        <td className="px-3 py-2 whitespace-nowrap"><AccessorialCell acc={acc} exception={exception} /></td>
      )}
      {/* Note — raised request, flag note, and/or escalation recipient + ack */}
      <td className="px-3 py-2 max-w-[240px] space-y-1">
        {r.open_request_id ? (
          <button type="button" onClick={() => onOpenRequest?.(r.open_request_id)} className="block text-left text-red-600 dark:text-red-400 hover:underline">
            <p className="truncate" title={r.open_request_note || ''}>{r.open_request_note || 'Raised'} <span aria-hidden>▸</span></p>
            {r.open_request_by && <p className="text-[10px] text-red-500/80 dark:text-red-400/70">raised by {r.open_request_by} {fmtClock(r.open_request_at)}</p>}
          </button>
        ) : issueNote ? (
          <p className="truncate text-gray-500 dark:text-slate-400" title={issueNote}>{issueNote}</p>
        ) : !escAct ? <span className="text-gray-300 dark:text-slate-600">—</span> : null}
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
          {ACTIVITY_ACTIONS.filter(a => !a.flag || settings?.[a.flag]).map(a => {
            const done = doneAct(a.type)
            if (a.type === 'load_booked' && r.open_request_id) {
              return <ActBtn key={a.type} onClick={() => onOpenRequest?.(r.open_request_id)} title="Open the request to book it">Book</ActBtn>
            }
            if (done) {
              return <DoneBtn key={a.type} onClick={() => onAct(r, a.type, done)} title="Edit or remove">✓ {a.label}</DoneBtn>
            }
            const needsLoad = a.type === 'pod_collected' || a.type === 'bol_collected'
            return <ActBtn key={a.type} onClick={() => onAct(r, a.type, null)} disabled={needsLoad && !r.load_id} title={a.label}>{a.label}</ActBtn>
          })}
          {flagged
            ? <DoneBtn tone="flag" onClick={() => onAct(r, 'flag', { note: issueNote })} title="Edit or clear the flag">⚑ Flag</DoneBtn>
            : <ActBtn onClick={() => onAct(r, 'flag', null)} disabled={!shift} title={shift ? 'Flag an issue' : 'Start a shift to flag'}>Flag</ActBtn>}
        </div>
      </td>
      {/* OK — ticking checks the driver; unticking clears the check row entirely */}
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={okChecked} disabled={!shift}
          onChange={e => onOk(r, e.target.checked)}
          title={shift ? 'Mark reviewed' : 'Start a shift to review'}
          className="w-4 h-4 accent-emerald-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" />
      </td>
    </tr>
    {panelOpen && (
      <tr className="border-b border-gray-100 dark:border-white/[0.03]">
        <td colSpan={colSpan} className="p-0">
          <AccessorialPanel row={r} exception={exception} meId={meId} toast={toast}
            onChanged={onAccessorialChanged} shiftId={shiftId}
            accessorialsOn={!!settings?.accessorials_enabled} trackCheckpoints={!!settings?.track_checkpoints}
            canAddTypes={canAddTypes} />
        </td>
      </tr>
    )}
    </>
  )
}
