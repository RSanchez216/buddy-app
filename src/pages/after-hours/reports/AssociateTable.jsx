import { S } from '../../../lib/styles'
import { fmtHours, money, pct } from './reportsData'

// Per-associate rollup for the range. Straight from after_hours_associate_rollup
// — deliberately not re-derived from the shift list, because handling time is
// attributed by who handled the request, not by whose shift it landed in.

const SLOW_HANDLE_HOURS = 3

export default function AssociateTable({ rows }) {
  if (!rows.length) return null

  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">By associate</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className={S.tableHead}>
            <tr>
              {['Associate', 'Shifts', 'Hours', 'Avg reviewed', 'Booked', 'Paperwork', 'Chkpt', 'Req handled', 'Avg to handle', 'Esc', 'Acc claimed', 'Acc collected', 'Lumpers']
                .map(h => <th key={h} className={`${S.th} !py-2.5 whitespace-nowrap`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const slow = Number(r.avg_hours_to_handle) > SLOW_HANDLE_HOURS
              return (
                <tr key={r.associate_id} className="border-b border-gray-100 dark:border-white/[0.03]">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 inline-flex items-center justify-center text-[10px] font-bold shrink-0">
                        {r.initials}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-slate-200">{r.associate}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">
                    {r.shifts}
                    {r.shifts_open > 0 && <span className="text-[10px] text-orange-600 dark:text-orange-400"> · {r.shifts_open} open</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">{fmtHours(r.hours)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">{pct(r.avg_reviewed_pct)}</td>
                  <Num v={r.booked} />
                  <Num v={r.paperwork} />
                  <Num v={r.checkpoints} />
                  <Num v={r.requests_handled} />
                  <td className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${slow ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}
                    title={slow ? `Over ${SLOW_HANDLE_HOURS}h average to handle a request` : undefined}>
                    {r.avg_hours_to_handle == null ? '—' : `${Number(r.avg_hours_to_handle).toFixed(1)}h`}
                  </td>
                  <Num v={r.escalations} tone={r.escalations > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''} />
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">{money(r.accessorials_claimed, 2)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-emerald-600 dark:text-emerald-400">{money(r.accessorials_collected, 2)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-700 dark:text-slate-300">{money(r.lumpers_amount, 2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 border-t border-gray-100 dark:border-white/5 text-[11px] text-gray-400 dark:text-slate-500">
        Averages exclude open shifts. Handling time is attributed to whoever handled the request, not
        to whose shift it fell in, and excludes negative lag.
      </p>
    </div>
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
