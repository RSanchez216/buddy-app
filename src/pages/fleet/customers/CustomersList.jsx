import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

const PAGE = 100

export default function CustomersList() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [scope, setScope] = useState('with_loads') // 'with_loads' | 'all'
  const [holdOnly, setHoldOnly] = useState(false)
  const [riskOnly, setRiskOnly] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      // One RPC: the per-customer load aggregate and the risk join are done in
      // Postgres. Doing it here would mean pulling ~14,700 loads to count them.
      const { data, error: e } = await supabase.rpc('customers_list')
      if (e) throw e
      setRows(data || [])
    } catch {
      setError(true)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Debounced so typing doesn't re-filter 2,054 rows per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setLimit(PAGE) }, 200)
    return () => clearTimeout(t)
  }, [searchInput])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (scope === 'with_loads' && !(r.loads_total > 0)) return false
      if (holdOnly && !r.credit_hold) return false
      if (riskOnly && !(r.id_theft || r.nonpayment || r.double_brokering)) return false
      if (!q) return true
      // Name, MC and TMS code — an associate has one of the three off a rate con.
      return (r.name || '').toLowerCase().includes(q)
        || (r.mc_number || '').toLowerCase().includes(q)
        || (r.tms_code || '').toLowerCase().includes(q)
    })
  }, [rows, scope, holdOnly, riskOnly, search])

  const visible = filtered.slice(0, limit)
  const withLoads = rows.filter(r => r.loads_total > 0).length
  const flagged = rows.filter(r => r.id_theft || r.nonpayment || r.double_brokering).length
  const onHold = rows.filter(r => r.credit_hold).length
  const filtersOn = holdOnly || riskOnly || !!search.trim()

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
            onKeyDown={e => { if (e.key === 'Escape') setSearchInput('') }}
            placeholder="Search name, MC or TMS code…"
            className={`${S.input} ${searchInput ? 'pr-7' : ''}`}
          />
          {searchInput && (
            <button onClick={() => setSearchInput('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xs">✕</button>
          )}
        </div>
      </div>

      {/* Scope + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs">
          {[['with_loads', `With loads ${withLoads.toLocaleString()}`], ['all', `All customers ${rows.length.toLocaleString()}`]].map(([v, l]) => (
            <button key={v} onClick={() => { setScope(v); setLimit(PAGE) }}
              className={`px-3 py-1.5 font-medium transition-colors ${
                scope === v ? 'bg-cyan-500 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}>{l}</button>
          ))}
        </div>
        {onHold > 0 && (
          <Toggle on={holdOnly} onClick={() => { setHoldOnly(v => !v); setLimit(PAGE) }} tone="rose">
            Credit hold {onHold}
          </Toggle>
        )}
        <Toggle on={riskOnly} onClick={() => { setRiskOnly(v => !v); setLimit(PAGE) }} tone="violet">
          On a risk list {flagged.toLocaleString()}
        </Toggle>
        {filtersOn && (
          <button onClick={() => { setHoldOnly(false); setRiskOnly(false); setSearchInput('') }}
            className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">Clear</button>
        )}
        <span className="ml-auto text-[11px] text-gray-400 dark:text-slate-500 tabular-nums">
          {filtered.length.toLocaleString()} shown
        </span>
      </div>

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
                ) : visible.map(r => (
                  <Row key={r.id} r={r} onClick={() => navigate(`/fleet/customers/${r.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > visible.length && (
            <button onClick={() => setLimit(l => l + PAGE)}
              className="w-full py-2.5 text-xs font-medium text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 border-t border-gray-100 dark:border-white/5">
              Show {Math.min(PAGE, filtered.length - visible.length)} more · {visible.length.toLocaleString()} of {filtered.length.toLocaleString()}
            </button>
          )}
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

function Toggle({ on, onClick, tone, children }) {
  const active = {
    rose: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/40',
    violet: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-500/40',
  }[tone]
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
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
