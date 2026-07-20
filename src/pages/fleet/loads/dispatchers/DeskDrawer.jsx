import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../../lib/styles'
import { fetchDeskDrivers, deskRead, readChips, money, perDriver, rpm, int } from './dispatcherData'

// Slide-in drawer for one desk. Roster data (dispatcher_desk_drivers) is
// fetched on open so the leaderboard never waits on it. Left border + pill +
// chips are colored by the desk's read severity.

const TONE = {
  red:   { border: 'border-l-red-500',     pill: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',           chip: 'text-red-600 dark:text-red-400' },
  amber: { border: 'border-l-amber-500',   pill: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20', chip: 'text-amber-600 dark:text-amber-400' },
  green: { border: 'border-l-emerald-500', pill: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20', chip: 'text-emerald-600 dark:text-emerald-400' },
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtLeft(iso) {
  if (!iso) return ''
  const [, m, d] = String(iso).split('-').map(Number)
  return `${MON[m - 1]} ${d}`
}

export default function DeskDrawer({ open, desk, floors, grain, anchor, inProgress = false, onClose }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  if (!open || !desk) return null

  const read = deskRead(desk, floors, { inProgress })
  const tone = TONE[read.tone] || TONE.green
  const chips = readChips(desk, floors)
  const active = (rows || []).filter(r => r.status === 'active').sort((a, b) => Number(b.gross) - Number(a.gross))
  const left = (rows || []).filter(r => r.status === 'left')
    .sort((a, b) => String(a.last_load_date).localeCompare(String(b.last_load_date))) // oldest → newest

  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end" onMouseDown={e => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

      <div className={`relative w-full max-w-lg bg-white dark:bg-[#0d0d1f] border-l-4 ${tone.border} shadow-2xl overflow-y-auto`}>
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-100 dark:border-white/5">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">{desk.desk_name}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500">Dispatch desk · booking + home-desk retention</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Recap strip */}
          <div className="grid grid-cols-4 gap-2">
            <Recap label="Gross" value={money(desk.gross)} />
            <Recap label="$/drv·mo" value={perDriver(desk.per_driver_month)} />
            <Recap label="Turnover" value={int(desk.turnover)} />
            <Recap label="RPM" value={rpm(desk.rpm)} />
          </div>

          {/* Why this read */}
          <div className={`${S.card} border-l-4 ${tone.border} p-4 space-y-3`}>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${tone.pill}`}>{read.label}</span>
              <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 dark:text-slate-500">Why this read</span>
            </div>
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

          {error && <div className={S.errorBox}>{error}</div>}
          {loading && <div className="flex items-center justify-center h-24"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>}

          {!loading && rows && (
            <>
              {/* On the desk now */}
              <section>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">On the desk now ({active.length})</h4>
                <div className={`${S.card} overflow-hidden`}>
                  <table className="w-full text-sm">
                    <thead className={S.tableHead}>
                      <tr>
                        <th className={S.th}>Driver</th>
                        <th className={`${S.th} text-right`}>Loads</th>
                        <th className={`${S.th} text-right`}>Gross</th>
                        <th className={`${S.th} text-right`}>RPM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 dark:text-slate-600">No active drivers</td></tr>
                      ) : active.map(r => (
                        <tr key={r.driver_id} className={S.tableRow}>
                          <td className={`${S.td} text-gray-900 dark:text-slate-200`}>
                            {r.driver_name}
                            <span className="ml-2 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 align-middle">active</span>
                            {r.home_share != null && <span className="ml-2 text-[11px] text-gray-400 dark:text-slate-500">{r.home_share}% on desk</span>}
                          </td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(r.loads)}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-slate-200`}>{money(r.gross)}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{rpm(r.rpm)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Left this period */}
              {left.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Left this period — by last-load date ({left.length})</h4>
                  <div className={`${S.card} overflow-hidden`}>
                    <table className="w-full text-sm">
                      <thead className={S.tableHead}>
                        <tr>
                          <th className={S.th}>Driver</th>
                          <th className={`${S.th} text-right`}>Loads</th>
                          <th className={`${S.th} text-right`}>Gross while here</th>
                        </tr>
                      </thead>
                      <tbody>
                        {left.map(r => (
                          <tr key={r.driver_id} className={S.tableRow}>
                            <td className={`${S.td} text-gray-900 dark:text-slate-200`}>
                              {r.driver_name}
                              <span className="ml-2 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 align-middle">left · {fmtLeft(r.last_load_date)}</span>
                            </td>
                            <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(r.loads)}</td>
                            <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-slate-200`}>{money(r.gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
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
