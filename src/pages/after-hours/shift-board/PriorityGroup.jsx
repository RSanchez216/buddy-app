import { cityOf, fmtClock } from './shiftBoardData'

const TONE = {
  red:    { head: 'text-red-700 dark:text-red-400',       badge: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300',       ring: 'border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/[0.06]' },
  orange: { head: 'text-orange-700 dark:text-orange-400', badge: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300', ring: 'border-orange-200 dark:border-orange-500/30 bg-orange-50/50 dark:bg-orange-500/[0.06]' },
  amber:  { head: 'text-amber-700 dark:text-amber-400',   badge: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',   ring: 'border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/[0.06]' },
  muted:  { head: 'text-gray-500 dark:text-slate-400',    badge: 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400',          ring: 'border-gray-200 dark:border-white/10' },
  plain:  { head: 'text-gray-700 dark:text-slate-300',    badge: 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300',          ring: 'border-gray-200 dark:border-white/10' },
}

export default function PriorityGroup({ group, rows, expanded, onToggle, onCopy, settings, shift, onOk, onAction, onFlag, onCheckpoints, onOpenRequest }) {
  const t = TONE[group.tone] || TONE.plain
  const n = rows.length

  return (
    <div className={`rounded-2xl border ${t.ring} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button onClick={onToggle} className="flex items-center gap-2 min-w-0 text-left">
          <svg className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span className={`text-sm font-bold uppercase tracking-wide ${t.head}`}>{group.heading}</span>
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${t.badge}`}>{n}</span>
          {!expanded && <span className="text-xs text-gray-400 dark:text-slate-500 truncate">· {group.reason}</span>}
        </button>
        <button onClick={onCopy} title="Copy this group as plain text"
          className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">
          📋 Copy group
        </button>
      </div>

      {/* Rows */}
      {expanded && (
        <div className="overflow-x-auto border-t border-gray-100 dark:border-white/5">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-white/[0.02] text-gray-400 dark:text-slate-500">
              <tr>
                {['Driver', 'Disp', 'Carrier', 'Eq', 'Status', 'Origin → Destination', 'Checkpoints', 'Paperwork', 'Note', 'Actions', 'OK'].map(h => (
                  <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <BoardRow key={r.driver_id} r={r} settings={settings} shift={shift} onOk={onOk} onAction={onAction} onFlag={onFlag} onCheckpoints={onCheckpoints} onOpenRequest={onOpenRequest} />
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

function Chip({ label, on, muted, title }) {
  return (
    <span title={title || undefined} className={`inline-flex items-center justify-center min-w-[26px] h-5 px-1 rounded text-[9px] font-bold border ${
      muted ? 'text-gray-300 dark:text-slate-600 border-gray-200 dark:border-white/10'
        : on ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30'
          : 'text-gray-400 dark:text-slate-500 border-gray-200 dark:border-white/10'
    }`}>{label}</span>
  )
}

function ActBtn({ children, onClick, disabled, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed">
      {children}
    </button>
  )
}

function BoardRow({ r, settings, shift, onOk, onAction, onFlag, onCheckpoints, onOpenRequest }) {
  const muted = r.in_scope === false
  const okChecked = r.checked_this_shift && r.check_is_ok === true
  const flagged = r.checked_this_shift && r.check_is_ok === false
  const o = cityOf(r.origin), d = cityOf(r.destination)

  return (
    <tr className={`border-b border-gray-100 dark:border-white/[0.03] ${muted ? 'opacity-50' : ''} ${flagged ? 'bg-red-50/40 dark:bg-red-500/[0.05]' : ''}`}>
      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-slate-200">{r.driver_name || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">{r.dispatcher_name || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">{r.carrier_name || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400 font-mono">{r.trailer || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {r.team_name
          ? <span className="text-gray-500 dark:text-slate-400">covered — <span className="text-gray-700 dark:text-slate-300 font-medium">{r.team_name}</span></span>
          : <span className="text-gray-600 dark:text-slate-300">{r.load_status || '—'}</span>}
      </td>
      {/* Origin → Destination + honest load context. A teammate's or historic
          load is never shown as if it were the driver's current one. */}
      <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
        {r.load_number == null ? (
          <span className="italic text-gray-400 dark:text-slate-500 whitespace-nowrap">no load on record</span>
        ) : (
          <div>
            <div className="whitespace-nowrap">
              <span className="font-mono text-gray-500 dark:text-slate-400">{r.load_number}</span>
              {(o || d) && <> <span className="text-gray-300 dark:text-slate-600">·</span> {o || '—'} <span className="text-gray-300 dark:text-slate-600">→</span> {d || '—'}</>}
            </div>
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
      {/* Checkpoints — only when tracked; the chips open the times editor */}
      <td className="px-3 py-2 whitespace-nowrap">
        {settings?.track_checkpoints ? (
          <button type="button" onClick={() => r.load_id && r.in_scope !== false && onCheckpoints?.(r)} disabled={!r.load_id || r.in_scope === false}
            title={r.in_scope === false ? 'Picked up before go-live — not in scope' : r.load_id ? 'Enter checkpoint times' : 'No load'}
            className="flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-60">
            <Chip label="PU↑" on={!!r.cp_pickup_in} title={fmtClock(r.cp_pickup_in)} />
            <Chip label="PU↓" on={!!r.cp_pickup_out} title={fmtClock(r.cp_pickup_out)} />
            <Chip label="DL↑" on={!!r.cp_delivery_in} title={fmtClock(r.cp_delivery_in)} />
            <Chip label="DL↓" on={!!r.cp_delivery_out} title={fmtClock(r.cp_delivery_out)} />
          </button>
        ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      {/* Paperwork — each chip only when its flag is on */}
      <td className="px-3 py-2 whitespace-nowrap">
        {(settings?.track_bols || settings?.track_pods) ? (
          <div className="flex items-center gap-1">
            {settings?.track_bols && <Chip label="BOL" on={!!r.bol_done} />}
            {settings?.track_pods && <Chip label="POD" on={!!r.pod_done} />}
          </div>
        ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      {/* Note — a raised request opens its detail panel */}
      <td className="px-3 py-2 max-w-[220px]">
        {r.open_request_id ? (
          <button type="button" onClick={() => onOpenRequest?.(r.open_request_id)} className="text-left text-red-600 dark:text-red-400 hover:underline">
            <p className="truncate" title={r.open_request_note || ''}>{r.open_request_note || 'Raised'} <span aria-hidden>▸</span></p>
            {r.open_request_by && <p className="text-[10px] text-red-500/80 dark:text-red-400/70">raised by {r.open_request_by} {fmtClock(r.open_request_at)}</p>}
          </button>
        ) : r.check_note ? (
          <p className="truncate text-gray-500 dark:text-slate-400" title={r.check_note}>{r.check_note}</p>
        ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      {/* Actions — Book/POD/BOL/Esc record with or without an open shift. Flag is
          a driver review (shift-scoped). A raised request is booked from its panel. */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {r.open_request_id
            ? <ActBtn onClick={() => onOpenRequest?.(r.open_request_id)} title="Open the request to book it">Book</ActBtn>
            : <ActBtn onClick={() => onAction(r, 'load_booked')} disabled={!r.load_id} title="Log a booked load">Book</ActBtn>}
          {/* POD/BOL only exist once their phase is on — a dead-looking button
              teaches people the page is broken, so hide them until then. */}
          {settings?.track_pods && <ActBtn onClick={() => onAction(r, 'pod_collected')} disabled={!r.load_id} title="POD collected">POD</ActBtn>}
          {settings?.track_bols && <ActBtn onClick={() => onAction(r, 'bol_collected')} disabled={!r.load_id} title="BOL collected">BOL</ActBtn>}
          <ActBtn onClick={() => onAction(r, 'escalated')} title="Escalate">Esc</ActBtn>
          <ActBtn onClick={() => onFlag(r)} disabled={!shift} title={shift ? 'Flag an issue' : 'Start a shift to flag'}>Flag</ActBtn>
        </div>
      </td>
      {/* OK */}
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={okChecked} disabled={!shift}
          onChange={e => onOk(r, e.target.checked)}
          title={shift ? 'Mark reviewed' : 'Start a shift to review'}
          className="w-4 h-4 accent-emerald-600 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed" />
      </td>
    </tr>
  )
}
