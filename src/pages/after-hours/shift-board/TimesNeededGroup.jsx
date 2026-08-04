import { fmtDuration } from './shiftBoardData'

// The checkpoint exception queue (checkpoint_exceptions). Deliberately NOT a
// completion tracker — it lists only the loads whose times are in question right
// now. `missing` drives what each row asks for.
function rowRead(e) {
  if (e.missing === 'pickup_in') return { text: 'Picked up today — no times yet', tone: 'neutral' }
  const where = e.stop === 'receiver' ? 'At receiver' : 'At shipper'
  const dur = fmtDuration(e.minutes_waiting)
  return { text: `${where} ${dur || ''}`.trim(), tone: e.over_free_time ? 'red' : 'amber' }
}
const TONE_TEXT = {
  neutral: 'text-gray-600 dark:text-slate-300',
  amber: 'text-amber-700 dark:text-amber-400 font-medium',
  red: 'text-red-600 dark:text-red-400 font-semibold',
}

export default function TimesNeededGroup({ exceptions, expanded, onToggle, onOpen }) {
  const n = exceptions.length
  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/[0.06] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <button onClick={onToggle} className="flex items-center gap-2 min-w-0 text-left">
          <svg className={`w-3.5 h-3.5 shrink-0 text-amber-500 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          <span className="text-sm font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Times needed</span>
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">{n}</span>
          {!expanded && <span className="text-xs text-gray-400 dark:text-slate-500 truncate">· checkpoint times a detention request may need</span>}
        </button>
      </div>

      {/* Empty is the normal, healthy state — only loads actually sitting at a
          dock land here. Say so calmly; it's not an error or a loading gap. */}
      {n === 0 ? (
        <div className="border-t border-amber-100 dark:border-amber-500/10 px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
          No drivers waiting at a stop right now.
        </div>
      ) : expanded && (
        <div className="overflow-x-auto border-t border-amber-100 dark:border-amber-500/10">
          <table className="w-full text-xs">
            <thead className="bg-white/40 dark:bg-white/[0.02] text-gray-400 dark:text-slate-500">
              <tr>
                {['Driver', 'Disp', 'Broker', 'Load', 'Status', '', ''].map((h, i) => (
                  <th key={i} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exceptions.map(e => {
                const { text, tone } = rowRead(e)
                return (
                  <tr key={e.load_id} className="border-b border-amber-100/60 dark:border-white/[0.03]">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-slate-200">{e.driver_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">{e.dispatcher_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">{e.broker_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-500 dark:text-slate-400">{e.load_number || '—'}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${TONE_TEXT[tone]}`}>{text}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {e.over_free_time && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
                          Detention likely
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button type="button" onClick={() => onOpen(e)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                        Enter times
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
