import { S } from '../../../lib/styles'
import { shiftTypeLabel, fmtDay, fmtWeekday, fmtClock, fmtHours, money, pct } from './reportsData'
import ShiftDetail from './ShiftDetail'

// Every shift in the range, newest first, each expandable.
//
// Gap rows are spliced in from the same rule the coverage strip uses, so the two
// agree cell for cell. They carry no metrics and cannot be expanded.
//
// Ordering is computed once by sortHistory and never depends on which row is
// open — expanding must not move anything under the cursor.

const COLS = ['Date', 'Shift', 'Associate', 'Hours', 'Reviewed', 'Booked', 'Paperwork', 'Chkpt', 'Req', 'Esc', 'Accessorials', 'Lumpers', 'Handoff']

export default function ShiftHistory({ rows, openId, onToggle, details, onRetry }) {
  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/5">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Shift history</h2>
        <span className="text-[11px] text-gray-400 dark:text-slate-500">
          {rows.filter(r => !r.is_gap).length} shift{rows.filter(r => !r.is_gap).length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={S.tableHead}>
            <tr>
              {COLS.map(h => <th key={h} className={`${S.th} !py-2.5 whitespace-nowrap`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              r.is_gap
                ? <GapRow key={r.shift_id} r={r} />
                : (
                  <Row key={r.shift_id} r={r}
                    open={openId === r.shift_id}
                    onToggle={() => onToggle(r.shift_id)}
                    detail={details[r.shift_id]}
                    onRetry={() => onRetry(r.shift_id)} />
                )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ r, open, onToggle, detail, onRetry }) {
  const paperwork = (Number(r.pods) || 0) + (Number(r.bols) || 0)

  return (
    <>
      <tr onClick={onToggle}
        className={`border-b border-gray-100 dark:border-white/[0.03] cursor-pointer transition-colors ${
          open ? 'bg-orange-50/60 dark:bg-orange-500/[0.07]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.02]'
        }`}>
        <td className="px-4 py-2.5 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            <svg className={`w-3 h-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            <span className="text-gray-800 dark:text-slate-200 font-medium">{fmtDay(r.shift_date)}</span>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">{fmtWeekday(r.shift_date)}</span>
          </span>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300">
              {shiftTypeLabel(r.shift_type)}
            </span>
            {r.is_open && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300">Open</span>
            )}
          </span>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap text-gray-700 dark:text-slate-300">{r.associate || '—'}</td>
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600 dark:text-slate-400">
          {r.is_open ? '—' : fmtHours(r.hours)}
          <span className="block text-[10px] text-gray-400 dark:text-slate-500">{fmtClock(r.started_at)}</span>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
          <span className="text-gray-800 dark:text-slate-200 font-medium">{pct(r.reviewed_pct)}</span>
          <span className="block text-[10px] text-gray-400 dark:text-slate-500">
            {r.drivers_reviewed}/{r.active_drivers}{r.drivers_flagged > 0 ? ` · ${r.drivers_flagged} flagged` : ''}
          </span>
        </td>
        <Num v={r.loads_booked} />
        <Num v={paperwork} />
        <Num v={r.checkpoints} />
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600 dark:text-slate-400">
          {r.requests_raised || 0}<span className="text-gray-300 dark:text-slate-600"> / </span>{r.requests_handled || 0}
        </td>
        <Num v={r.escalations} tone={r.escalations > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''} />
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600 dark:text-slate-400">
          {r.accessorials_count ? (
            <>
              {money(r.accessorials_claimed, 2)}
              <span className="block text-[10px] text-gray-400 dark:text-slate-500">{r.accessorials_count} raised</span>
            </>
          ) : '—'}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-600 dark:text-slate-400">
          {r.lumpers_count ? (
            <>
              {money(r.lumpers_amount, 2)}
              <span className="block text-[10px] text-gray-400 dark:text-slate-500">{r.lumpers_count}</span>
            </>
          ) : '—'}
        </td>
        <td className="px-4 py-2.5 max-w-[220px]">
          {r.has_handoff ? (
            <span className="block truncate text-gray-500 dark:text-slate-400" title={r.handoff_excerpt || ''}>
              {r.handoff_excerpt || 'Sent'}
              {r.handed_to && <span className="text-gray-400 dark:text-slate-500"> → {r.handed_to}</span>}
            </span>
          ) : (
            <span className="text-gray-300 dark:text-slate-600">—</span>
          )}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={COLS.length} className="p-0">
            <ShiftDetail detail={detail?.data} loading={detail?.loading} error={detail?.error} onRetry={onRetry} />
          </td>
        </tr>
      )}
    </>
  )
}

function GapRow({ r }) {
  return (
    <tr className="border-b border-gray-100 dark:border-white/[0.03] bg-rose-50/30 dark:bg-rose-500/[0.04]">
      <td className="px-4 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 pl-[18px]">
          <span className="text-gray-500 dark:text-slate-400">{fmtDay(r.shift_date)}</span>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">{fmtWeekday(r.shift_date)}</span>
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400">
          {shiftTypeLabel(r.shift_type)}
        </span>
      </td>
      <td colSpan={COLS.length - 3} className="px-3 py-2 text-[11px] italic text-gray-400 dark:text-slate-500">
        — no shift logged
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">Gap</span>
      </td>
    </tr>
  )
}

function Num({ v, tone }) {
  const n = Number(v) || 0
  return (
    <td className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${tone || (n ? 'text-gray-700 dark:text-slate-300' : 'text-gray-300 dark:text-slate-600')}`}>
      {n || '—'}
    </td>
  )
}
