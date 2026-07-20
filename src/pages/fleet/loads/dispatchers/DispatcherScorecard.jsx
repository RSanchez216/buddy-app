import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { S } from '../../../../lib/styles'
import DeskDrawer from './DeskDrawer'
import {
  fetchScorecard, fetchAmazonBookers, computeFloors, deskRead, surfaceFocus, bookerTier,
  periodLabel, stepAnchor, isCurrentPeriod, anchorForRpc, todayISO,
  money, perDriver, rpm, int, pct,
} from './dispatcherData'

const GRAINS = [['month', 'Monthly'], ['quarter', 'Quarterly'], ['half', 'Six-month'], ['year', 'Yearly']]
const VALID_GRAINS = new Set(GRAINS.map(g => g[0]))

const PILL = {
  red:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  green: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
}
const TAG = {
  red:   'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
}

export default function DispatcherScorecard() {
  const [params, setParams] = useSearchParams()
  const grain = VALID_GRAINS.has(params.get('grain')) ? params.get('grain') : 'half'
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('anchor') || '') ? params.get('anchor') : todayISO()

  const [rows, setRows] = useState(null)
  const [bookers, setBookers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDesk, setSelectedDesk] = useState(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'gross', dir: 'desc' })

  const setGrain = (g) => setParams(p => { p.set('grain', g); p.set('anchor', anchorForRpc(g, anchor)); return p }, { replace: true })
  const step = (dir) => setParams(p => { p.set('grain', grain); p.set('anchor', stepAnchor(grain, anchor, dir)); return p }, { replace: true })
  const goCurrent = () => setParams(p => { p.set('grain', grain); p.set('anchor', anchorForRpc(grain, todayISO())); return p }, { replace: true })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(''); setSelectedDesk(null)
      try {
        const [sc, bk] = await Promise.all([fetchScorecard(grain, anchor), fetchAmazonBookers(grain, anchor)])
        if (!cancelled) { setRows(sc); setBookers(bk) }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load scorecard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [grain, anchor])

  const desks = useMemo(() => (rows || []).filter(r => !r.is_amazon_team), [rows])
  const amazon = useMemo(() => (rows || []).find(r => r.is_amazon_team) || null, [rows])
  const floors = useMemo(() => computeFloors(desks), [desks])
  const focus = useMemo(() => (desks.length ? surfaceFocus(desks, floors) : []), [desks, floors])

  // Company strip.
  const company = useMemo(() => {
    if (!rows?.length) return null
    const totalGross = rows.reduce((s, r) => s + Number(r.gross || 0), 0)
    const totalMiles = desks.reduce((s, r) => s + Number(r.miles || 0), 0)
    const totalTurn = rows.reduce((s, r) => s + Number(r.turnover || 0), 0)
    const allDeltas = rows.every(r => r.gross_delta_pct != null)
    const prevGross = allDeltas ? rows.reduce((s, r) => s + Number(r.prev_gross || 0), 0) : null
    const grossDelta = prevGross ? ((totalGross - prevGross) / prevGross) * 100 : null
    return {
      totalGross, activeDesks: desks.length,
      blendedRpm: totalMiles > 0 ? totalGross / totalMiles : 0, // company-wide gross ÷ desk miles
      floorRpm: floors.floorRpm, totalTurn, grossDelta,
    }
  }, [rows, desks, floors])

  // Search + sort the leaderboard.
  const shownDesks = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q ? desks.filter(d => d.desk_name.toLowerCase().includes(q)) : [...desks]
    const key = sort.key
    const get = (d) => key === 'desk' ? d.desk_name.toLowerCase()
      : key === 'per_driver_month' ? Number(d.per_driver_month || 0)
      : Number(d[key] || 0)
    list.sort((a, b) => {
      const av = get(a), bv = get(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [desks, search, sort])

  const toggleSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'desk' ? 'asc' : 'desc' })
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet · People
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dispatcher Scorecard</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5 max-w-3xl">
          Gross is billed freight credited to the booking desk — roughly 56% is owner-op pass-through Manas doesn&apos;t keep, so read it as booking <span className="font-medium">volume</span>, not profit.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 text-sm">
          {GRAINS.map(([k, lbl]) => (
            <button key={k} onClick={() => setGrain(k)}
              className={`px-3 py-1.5 whitespace-nowrap ${grain === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => step(-1)} className={S.btnSecondary} aria-label="Previous period">◀</button>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold text-gray-900 dark:text-white">{periodLabel(grain, anchor)}</span>
          <button onClick={() => step(1)} disabled={isCurrentPeriod(grain, anchor)} className={`${S.btnSecondary} disabled:opacity-40`} aria-label="Next period">▶</button>
          {!isCurrentPeriod(grain, anchor) && <button onClick={goCurrent} className={S.btnSecondary}>Current</button>}
        </div>
      </div>

      {error && <div className={S.errorBox}>{error}</div>}
      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
      ) : !rows?.length ? (
        <div className={`${S.card} p-10 text-center text-gray-400 dark:text-slate-600`}>No dispatcher activity in {periodLabel(grain, anchor)}.</div>
      ) : (
        <>
          {/* Company strip */}
          {company && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Kpi label="Total gross" value={money(company.totalGross)} delta={company.grossDelta} />
              <Kpi label="Active desks" value={int(company.activeDesks)} />
              <Kpi label="Blended RPM" value={rpm(company.blendedRpm)} sub={`floor ${rpm(company.floorRpm)}`} />
              <Kpi label="Total turnover" value={int(company.totalTurn)} sub="drivers left" />
            </div>
          )}

          {/* Desks to focus on */}
          {focus.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Desks to focus on</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {focus.map(c => (
                  <button key={c.desk.desk_id} onClick={() => setSelectedDesk(c.desk)}
                    className={`${S.card} p-4 text-left hover:border-orange-300 dark:hover:border-orange-500/40 transition-colors`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-gray-900 dark:text-white truncate">{c.desk.desk_name}</span>
                      <span className={`shrink-0 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${TAG[c.tone]}`}>{c.tag}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-snug mb-3 min-h-[2.5rem]">{c.reason}</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <Metric label="Gross" value={money(c.desk.gross)} />
                      <Metric label="$/drv·mo" value={perDriver(c.desk.per_driver_month)} />
                      <Metric label="RPM" value={rpm(c.desk.rpm)} />
                      <Metric label="Turnover" value={int(c.desk.turnover)} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* All active desks */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">All active desks ({desks.length})</h2>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search desks…"
                className="px-3 py-1.5 text-sm rounded-xl bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 w-56"
              />
            </div>
            <div className={`${S.card} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={S.tableHead}>
                    <tr>
                      <Th onClick={() => toggleSort('desk')} arrow={arrow('desk')}>Desk</Th>
                      <Th onClick={() => toggleSort('gross')} arrow={arrow('gross')} right>Gross</Th>
                      <Th onClick={() => toggleSort('per_driver_month')} arrow={arrow('per_driver_month')} right>$/driver·mo</Th>
                      <Th onClick={() => toggleSort('turnover')} arrow={arrow('turnover')} right>Turnover</Th>
                      <Th onClick={() => toggleSort('rpm')} arrow={arrow('rpm')} right>RPM</Th>
                      <th className={S.th}>Read</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDesks.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-slate-600">No desks match “{search}”.</td></tr>
                    ) : shownDesks.map(d => {
                      const read = deskRead(d, floors)
                      return (
                        <tr key={d.desk_id} onClick={() => setSelectedDesk(d)} className={`${S.tableRow} cursor-pointer`}>
                          <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{d.desk_name}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-slate-200`}>
                            {money(d.gross)}
                            {d.gross_delta_pct != null && (
                              <span className={`ml-2 text-[11px] ${Number(d.gross_delta_pct) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pct(d.gross_delta_pct)}</span>
                            )}
                          </td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{perDriver(d.per_driver_month)}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(d.turnover)}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{rpm(d.rpm)}</td>
                          <td className={S.td}>
                            <span className={`inline-block text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${PILL[read.tone]}`}>{read.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Amazon Team card */}
          {amazon && <AmazonCard amazon={amazon} bookers={bookers} />}

          {/* How turnover is counted */}
          <section className={`${S.card} p-5`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">How turnover is counted</h3>
            <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed max-w-3xl">
              Every driver is matched to one home desk — the desk that runs most of their loads. A departure is charged to that
              home desk on a last-load basis: when a driver&apos;s final load in the period was with a desk and they don&apos;t come back,
              it counts against that desk. A day-or-two fill-in on another desk doesn&apos;t count — only the home desk wears the
              turnover.
            </p>
          </section>

          {/* What's baked in */}
          <section className={`${S.card} p-5`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">What&apos;s baked in</h3>
            <ul className="text-sm text-gray-600 dark:text-slate-400 space-y-1.5 list-disc pl-5 max-w-3xl">
              <li>Monthly base: rosters and gross are built per month, then rolled up to the selected window.</li>
              <li>One desk per driver — the home desk — so retention isn&apos;t double-counted across desks.</li>
              <li>The Amazon team is judged as a single desk because bookings rotate among its members.</li>
              <li>Excluded/placeholder desks and desks with no drivers are hidden.</li>
              <li>Gross = billed freight credited to the booking desk (per-load), not company profit.</li>
              <li>TONU and canceled loads are excluded from gross, loads, and miles.</li>
            </ul>
          </section>
        </>
      )}

      <DeskDrawer open={!!selectedDesk} desk={selectedDesk} floors={floors} grain={grain} anchor={anchor} onClose={() => setSelectedDesk(null)} />
    </div>
  )
}

// ── Amazon Team card ──────────────────────────────────────────────────────────
function AmazonCard({ amazon, bookers }) {
  const teamRpm = Number(amazon.rpm || 0)
  const TIER = {
    strong: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
    mid:    'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-white/10',
    weak:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  }
  return (
    <section className={`${S.card} p-5`}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Amazon Team</h2>
        <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20">One desk</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-4 max-w-3xl">
        Judged as one desk because bookings rotate among the team — no single member owns a load, so gross and retention are pooled.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <Kpi label="Team gross" value={money(amazon.gross)} delta={amazon.gross_delta_pct} />
        <Kpi label="RPM" value={rpm(amazon.rpm)} />
        <Kpi label="Loads" value={int(amazon.loads)} />
        <Kpi label="Turnover" value={int(amazon.turnover)} sub="drivers left" />
      </div>
      <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Who books well</h4>
      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Booker</th>
              <th className={`${S.th} text-right`}>Gross</th>
              <th className={`${S.th} text-right`}>Loads</th>
              <th className={`${S.th} text-right`}>RPM</th>
              <th className={`${S.th} text-right`}>Drivers</th>
            </tr>
          </thead>
          <tbody>
            {bookers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 dark:text-slate-600">No bookings this period</td></tr>
            ) : bookers.map(b => {
              const tier = bookerTier(b, teamRpm)
              return (
                <tr key={b.dispatcher_id} className={S.tableRow}>
                  <td className={`${S.td} text-gray-900 dark:text-slate-200`}>
                    {b.dispatcher_name}
                    <span className={`ml-2 text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full border ${TIER[tier]}`}>{tier}</span>
                  </td>
                  <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-slate-200`}>{money(b.gross)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(b.loads)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{rpm(b.rpm)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(b.drivers)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400 mt-3">
        Retention: {int(amazon.turnover)} driver{Number(amazon.turnover) === 1 ? '' : 's'} left the team this period.
      </p>
    </section>
  )
}

// ── small presentational bits ─────────────────────────────────────────────────
function Kpi({ label, value, sub, delta }) {
  const showDelta = delta != null && Number.isFinite(Number(delta))
  return (
    <div className={`${S.card} p-4`}>
      <div className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{value}</div>
      <div className="flex items-center gap-2 mt-1 min-h-[1rem]">
        {sub && <span className="text-[11px] text-gray-400 dark:text-slate-500 tabular-nums">{sub}</span>}
        {showDelta && <span className={`text-[11px] font-medium tabular-nums ${Number(delta) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pct(delta)}</span>}
      </div>
    </div>
  )
}
function Metric({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 dark:text-slate-500">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-slate-200 tabular-nums">{value}</span>
    </div>
  )
}
function Th({ children, onClick, arrow, right }) {
  return (
    <th className={`${S.th} ${right ? 'text-right' : ''} cursor-pointer select-none hover:text-gray-900 dark:hover:text-slate-200`} onClick={onClick}>
      {children}{arrow && <span className="ml-1">{arrow}</span>}
    </th>
  )
}
