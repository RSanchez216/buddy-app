import { S } from '../../../lib/styles'
import { shiftTypeLabel, fmtWeekday, fmtDay, fmtHours } from './reportsData'

// Who covered what, by shift type × day.
//
// The gap rule is INFERRED — there is no roster table — so the subtitle says so.
// A red cell means "this slot ran on other days this week but not here", which is
// a prompt to look, not a policy violation.

const CELL = {
  covered: 'border-emerald-200 dark:border-emerald-400/25 bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300',
  open: 'border-orange-200 dark:border-orange-400/30 bg-orange-50 dark:bg-orange-400/10 text-orange-800 dark:text-orange-300',
  gap: 'border-rose-200 dark:border-rose-400/30 bg-rose-50 dark:bg-rose-400/10 text-rose-700 dark:text-rose-300 border-dashed',
  unused: 'border-slate-200 dark:border-white/10 bg-transparent text-slate-300 dark:text-slate-600 border-dashed',
}

const LEGEND = [
  ['covered', 'Covered'],
  ['open', 'Open now'],
  ['gap', 'No shift — slot ran on another day'],
  ['unused', 'Slot not in use this week'],
]

export default function CoverageStrip({ coverage, orphanCount }) {
  const { days, rows } = coverage

  return (
    <div className={`${S.card} p-4`}>
      <div className="mb-3">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Coverage</h2>
        <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">
          Gaps are inferred, not scheduled — there is no roster. A slot is only flagged on a day it
          was missed if it ran on another day this week.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500 py-6 text-center">No shifts logged this week.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-28" />
                {days.map(d => (
                  <th key={d} className="text-center">
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{fmtWeekday(d)}</span>
                    <span className="block text-[10px] text-gray-400 dark:text-slate-500">{fmtDay(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.type}>
                  <td className="pr-2 text-[11px] font-semibold text-gray-600 dark:text-slate-300 whitespace-nowrap align-middle">
                    {shiftTypeLabel(row.type)}
                  </td>
                  {row.cells.map(cell => <Cell key={cell.day} cell={cell} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
        {LEGEND.map(([state, label]) => (
          <span key={state} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-slate-400">
            <span className={`w-3 h-3 rounded border ${CELL[state]}`} />
            {label}
          </span>
        ))}
      </div>

      {/* shift_id is nullable by design — off-shift work is still recorded. */}
      {orphanCount > 0 && (
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
          <svg className="w-4 h-4 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
          <span>
            {orphanCount} activit{orphanCount === 1 ? 'y was' : 'ies were'} logged outside any shift this week.
            That&apos;s allowed — work done off-shift is still recorded — but it isn&apos;t counted in any row below.
          </span>
        </div>
      )}
    </div>
  )
}

function Cell({ cell }) {
  const s = cell.shifts[0]
  const hours = cell.shifts.reduce((a, x) => a + (Number(x.hours) || 0), 0)
  const title = cell.state === 'gap'
    ? `No ${cell.type} shift logged on ${fmtDay(cell.day)}`
    : cell.state === 'unused'
      ? 'This slot was not run at all this week'
      : cell.shifts.map(x => `${x.associate}${x.is_open ? ' · open' : ` · ${fmtHours(x.hours)}`}`).join('\n')

  return (
    <td className="align-middle">
      <div title={title}
        className={`h-11 rounded-lg border flex flex-col items-center justify-center px-1 ${CELL[cell.state]}`}>
        {cell.state === 'covered' && (
          <>
            <span className="text-[11px] font-bold leading-none">
              {s.initials}{cell.shifts.length > 1 ? ` +${cell.shifts.length - 1}` : ''}
            </span>
            <span className="text-[10px] leading-none mt-0.5 tabular-nums opacity-80">{fmtHours(hours)}</span>
          </>
        )}
        {cell.state === 'open' && (
          <>
            <span className="text-[11px] font-bold leading-none">{s.initials}</span>
            <span className="text-[10px] leading-none mt-0.5 opacity-80">open</span>
          </>
        )}
        {cell.state === 'gap' && <span className="text-sm font-bold leading-none">—</span>}
        {cell.state === 'unused' && <span className="text-lg leading-none">·</span>}
      </div>
    </td>
  )
}
