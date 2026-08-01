import { useState } from 'react'
import { cityOf, fmtClock, todayChicago } from './shiftBoardData'

// Rendered as the body of the active tab — the tab bar already carries the
// heading, count and colour, so this is just a slim toolbar (context + copy)
// over the driver table.
export default function PriorityGroup({ group, rows, settings, shift, onOk, onAction, onFlag, onCheckpoints, onOpenRequest }) {
  const curYear = Number(todayChicago().slice(0, 4))
  const cols = ['Driver', 'Disp', 'Carrier', 'Truck', 'Trailer', 'Status', 'Load', 'Origin → Destination', 'Checkpoints', 'Paperwork', 'Note', 'Actions', 'OK']

  return (
    <div>
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
            {group.key === 'raised' ? 'Nothing raised by dispatch right now — all clear.' : 'No drivers in this group.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-white/[0.02] text-gray-400 dark:text-slate-500">
                <tr>
                  {cols.map(h => <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <BoardRow key={r.driver_id} r={r} curYear={curYear} settings={settings} shift={shift}
                    onOk={onOk} onAction={onAction} onFlag={onFlag} onCheckpoints={onCheckpoints} onOpenRequest={onOpenRequest} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

function BoardRow({ r, curYear, settings, shift, onOk, onAction, onFlag, onCheckpoints, onOpenRequest }) {
  const muted = r.in_scope === false
  const okChecked = r.checked_this_shift && r.check_is_ok === true
  const flagged = r.checked_this_shift && r.check_is_ok === false
  const o = cityOf(r.origin), d = cityOf(r.destination)
  const pu = fmtLoadDate(r.pickup_date, curYear), dl = fmtLoadDate(r.delivery_date, curYear)

  return (
    <tr className={`group/row border-b border-gray-100 dark:border-white/[0.03] ${muted ? 'opacity-50' : ''} ${flagged ? 'bg-red-50/40 dark:bg-red-500/[0.05]' : ''}`}>
      <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-slate-200">
        {r.driver_name || '—'}
        {r.team_name && (
          <span title={`Team ${r.team_name}`} className="ml-1.5 inline-flex items-center align-middle px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-white/10">
            Team · {r.team_name}
          </span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">{r.dispatcher_name || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">{r.carrier_name || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400 font-mono">{r.truck || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400 font-mono">{r.trailer || '—'}</td>
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
