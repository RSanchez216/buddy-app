import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { ErrorRetry, TableSkeleton } from '../../../components/Loading'

// Broker directory — the way to reach a profile without knowing its UUID.
//
// 2,054 customers, but only 1,056 have ever carried a load: the imports brought
// in every broker in the TMS, not just the ones we haul for. A flat alphabetical
// list of all of them is mostly noise, so the default is "has loads", busiest
// first. The rest stay one toggle away — when a broker rings at 2am the question
// is usually whether they're on a risk list, and that has to be answerable for a
// broker we've never hauled for.
//
// Filter and search live in the URL, so a view is shareable, survives a refresh,
// and is what the profile's back control returns you to.

// PostgREST answers with 1,000 rows unless told otherwise. That default silently
// truncated this page and, because the chips counted the fetched array, under-
// reported flagged brokers by a third. FETCH_MAX is explicit headroom over the
// 2,054 rows that exist, and the count check below makes a future overrun loud.
const FETCH_MAX = 5000
const PAGE = 100

const FILTERS = [
  { key: 'loads', label: 'With loads', match: r => r.loads_total > 0 },
  { key: 'all', label: 'All customers', match: () => true },
  { key: 'hold', label: 'Credit hold', match: r => !!r.credit_hold, tone: 'rose' },
  { key: 'risk', label: 'On a risk list', match: r => !!(r.id_theft || r.nonpayment || r.double_brokering), tone: 'violet' },
]
const filterFor = (key) => FILTERS.find(f => f.key === key) || FILTERS[0]

// The scroll offset for a given list view, so coming back from a profile lands
// where you left rather than at the top.
const scrollKey = (search) => `buddy:customers:scroll:${search || ''}`

export default function CustomersList() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(null)   // PostgREST's exact count
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // URL is the source of truth for the view.
  const filterKey = filterFor(params.get('filter')).key
  const q = params.get('q') || ''
  const [searchInput, setSearchInput] = useState(q)
  const [limit, setLimit] = useState(PAGE)
  const sentinelRef = useRef(null)
  const restoredRef = useRef(false)

  const setView = useCallback((next) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(next)) {
        if (v == null || v === '' || (k === 'filter' && v === 'loads')) p.delete(k)
        else p.set(k, v)
      }
      return p
    }, { replace: true })
    setLimit(PAGE)
  }, [setParams])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      // count:'exact' gives the authoritative total independent of how many rows
      // come back — which is what makes the truncation check below possible.
      const { data, count, error: e } = await supabase
        .rpc('customers_list', {}, { count: 'exact' })
        .range(0, FETCH_MAX - 1)
      if (e) throw e
      setRows(data || [])
      setTotal(count ?? (data || []).length)
    } catch {
      setError(true)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Debounce typing into the URL; ?q= is the single source of truth.
  useEffect(() => {
    if (searchInput === q) return
    const t = setTimeout(() => setView({ q: searchInput }), 250)
    return () => clearTimeout(t)
  }, [searchInput, q, setView])

  // Restore the scroll offset once, after the rows are on screen.
  useEffect(() => {
    if (loading || restoredRef.current || !rows.length) return
    restoredRef.current = true
    const saved = Number(sessionStorage.getItem(scrollKey(params.toString())) || 0)
    if (saved > 0) requestAnimationFrame(() => window.scrollTo(0, saved))
  }, [loading, rows.length, params])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = filterFor(filterKey).match
    return rows.filter(r => {
      if (!match(r)) return false
      if (!needle) return true
      // Name, MC and TMS code — an associate has one of the three off a rate con.
      return (r.name || '').toLowerCase().includes(needle)
        || (r.mc_number || '').toLowerCase().includes(needle)
        || (r.tms_code || '').toLowerCase().includes(needle)
    })
  }, [rows, filterKey, q])

  // Counts come from the COMPLETE fetched set, never the rendered window — that
  // conflation is what made the risk chip read 182 instead of 275.
  const counts = useMemo(() => {
    const out = {}
    for (const f of FILTERS) out[f.key] = rows.filter(f.match).length
    return out
  }, [rows])

  // If PostgREST ever reports more rows than it handed over, the counts on this
  // page are lies. Say so rather than quietly under-report again.
  const truncated = total != null && rows.length < total

  // Windowed rendering. 2,054 rows is far more DOM than anyone looks at, and the
  // window extends on scroll rather than recycling: rows here have an optional
  // second line and risk chips, so their heights vary and fixed-height
  // virtualisation would mis-position them.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || limit >= filtered.length) return
    const io = new IntersectionObserver(
      es => { if (es.some(e => e.isIntersecting)) setLimit(l => Math.min(l + PAGE, filtered.length)) },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [limit, filtered.length])

  const visible = filtered.slice(0, limit)
  const filtersOn = filterKey !== 'loads' || !!q.trim()

  const openProfile = (id) => {
    // Remember where we were, and carry the view on the URL so the profile's
    // back control can rebuild it even after a refresh.
    try { sessionStorage.setItem(scrollKey(params.toString()), String(window.scrollY)) } catch { /* private mode */ }
    const qs = params.toString()
    navigate(`/fleet/customers/${id}${qs ? `?${qs}` : ''}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Every broker BUDDY knows — volume, credit and risk. Search by name, MC or TMS code.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearchInput(''); setView({ q: '' }) } }}
            placeholder="Search name, MC or TMS code…"
            className={`${S.input} ${searchInput ? 'pr-7' : ''}`}
          />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setView({ q: '' }) }} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xs">✕</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <Chip key={f.key} on={filterKey === f.key} tone={f.tone}
            onClick={() => setView({ filter: f.key })}>
            {f.label} {loading ? '' : counts[f.key].toLocaleString()}
          </Chip>
        ))}
        {filtersOn && (
          <button onClick={() => { setSearchInput(''); setView({ filter: 'loads', q: '' }) }}
            className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">Clear</button>
        )}
        <span className="ml-auto text-[11px] text-gray-400 dark:text-slate-500 tabular-nums">
          {filtered.length.toLocaleString()} shown
        </span>
      </div>

      {truncated && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
          <svg className="w-4 h-4 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
          <span>
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()} customers — the counts above
            are for what loaded, not the whole table. Raise the fetch limit before trusting them.
          </span>
        </div>
      )}

      {error ? (
        <ErrorRetry message="Couldn't load customers." onRetry={load} />
      ) : loading ? (
        <TableSkeleton rows={10} />
      ) : (
        <div className={`${S.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={S.th}>Broker</th>
                  <th className={S.th}>MC</th>
                  <th className={S.th}>Location</th>
                  <th className={`${S.th} text-right`}>Loads 2026</th>
                  <th className={S.th}>Last load</th>
                  <th className={`${S.th} text-right`}>Credit limit</th>
                  <th className={S.th}>Risk</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-slate-500">
                    {filtersOn ? 'No customers match.' : 'No customers yet.'}
                  </td></tr>
                ) : visible.map(r => <Row key={r.id} r={r} onClick={() => openProfile(r.id)} />)}
                {limit < filtered.length && (
                  <tr ref={sentinelRef}>
                    <td colSpan={7} className="px-4 py-3 text-center text-[11px] text-gray-400 dark:text-slate-500">
                      Showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()} — scroll for more
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ r, onClick }) {
  return (
    <tr onClick={onClick} className={`${S.tableRow} cursor-pointer`}>
      <td className={`${S.td} min-w-[200px]`}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-slate-200">{r.name}</span>
          {r.credit_hold && (
            <span title="On credit hold in the TMS"
              className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/40">
              Credit hold
            </span>
          )}
        </div>
        {r.tms_code && <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{r.tms_code}</p>}
      </td>
      <td className={`${S.td} font-mono text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap`}>
        {r.mc_number || <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>
        {[r.city, r.state].filter(Boolean).join(', ') || <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className={`${S.td} text-right tabular-nums ${r.loads_ytd > 0 ? 'text-gray-900 dark:text-slate-200' : 'text-gray-300 dark:text-slate-600'}`}>
        {r.loads_ytd > 0 ? r.loads_ytd.toLocaleString() : '—'}
      </td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(r.last_load)}</td>
      {/* A zero limit is a real, deliberate value — 1,145 brokers sit at zero.
          It must not read the same as "we don't know". */}
      <td className={`${S.td} text-right tabular-nums whitespace-nowrap`}>
        {r.credit_limit == null
          ? <span className="text-gray-300 dark:text-slate-600" title="No credit limit on record">—</span>
          : <span className={Number(r.credit_limit) === 0 ? 'text-gray-500 dark:text-slate-400' : 'text-gray-900 dark:text-slate-200'}>
              ${Number(r.credit_limit).toLocaleString('en-US')}
            </span>}
      </td>
      <td className={S.td}><RiskChips r={r} /></td>
    </tr>
  )
}

// Same three flags, same colours as the broker profile — decoded server-side
// from broker_risk_list.flags so the two can't disagree.
function RiskChips({ r }) {
  const chips = [
    r.id_theft && ['ID theft', 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40'],
    r.nonpayment && ['Nonpayment', 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-500/40'],
    r.double_brokering && ['Double brokering', 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/40'],
  ].filter(Boolean)
  if (chips.length === 0) return <span className="text-gray-300 dark:text-slate-600">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(([label, cls]) => (
        <span key={label} className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>{label}</span>
      ))}
    </div>
  )
}

function Chip({ on, onClick, tone, children }) {
  const active = {
    rose: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/40',
    violet: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40',
  }[tone] || 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/40'
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors tabular-nums ${
        on ? active : 'border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
      }`}>
      {children}
    </button>
  )
}

// Built from the date parts so a date-only value can't shift a day via UTC.
function fmtDate(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return <span className="text-gray-300 dark:text-slate-600">—</span>
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
