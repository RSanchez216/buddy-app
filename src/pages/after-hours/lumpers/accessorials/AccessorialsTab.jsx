import { useCallback, useEffect, useMemo, useState } from 'react'
import { S } from '../../../../lib/styles'
import { useAuth } from '../../../../contexts/AuthContext'
import { useToast } from '../../../../contexts/ToastContext'
import UsageRangeControl from '../../../settings/users/UsageRangeControl'
import { money, fmtDate, rangeForDays } from '../lumperData'
import { copyText } from '../../shift-board/shiftBoardData'
import SummaryBand from './SummaryBand'
import SoftMatchStrip, { ConfirmCollectedModal } from './SoftMatchStrip'
import ClaimDetail from './ClaimDetail'
import {
  STATUSES, TYPES, statusMeta, typeLabel,
  fetchAccessorialsSummary, fetchAccessorialsList, fetchSoftMatches,
  fetchPayrollText, confirmCollected, dismissSoftMatch,
  basisText, filingMeta, awaitingMeta,
} from './accountingData'

const RANGE_PRESETS = [
  ['30', '30d', 30],
  ['90', '90d', 90],
  ['182', '6mo', 182],
  ['365', '1yr', 365],
  ['custom', 'Custom'],
]

const COLS = ['Date', 'Driver', 'Load', 'Broker', 'Type', 'Basis', 'Claimed', 'Approved', 'Collected', 'Status', 'Docs', 'Raised by', 'Filed']
const COLSPAN = COLS.length
const RIGHT = new Set(['Claimed', 'Approved', 'Collected'])

export default function AccessorialsTab({ onCount }) {
  const { profile: me } = useAuth()
  const toast = useToast()

  const [range, setRange] = useState(null)
  const [summary, setSummary] = useState(null)
  const [rows, setRows] = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Filters. Status and type are multi-select; empty means no filter, which is
  // what the RPC expects (it treats an empty array as "all").
  const [statuses, setStatuses] = useState(() => new Set())
  const [types, setTypes] = useState(() => new Set())
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [detail, setDetail] = useState(null)     // { row, focusDocs }
  const [matchBusy, setMatchBusy] = useState(null)
  const [matchConfirm, setMatchConfirm] = useState(null) // soft match being confirmed

  // Presets recompute in CHICAGO (today − N, inclusive) rather than trusting the
  // control's browser-local window — the summary's aging buckets are measured
  // against `(now() at time zone 'America/Chicago')::date` server-side, so a
  // browser-local window would disagree with them near midnight and would drop
  // the boundary day. Custom uses the literal picked endpoints. Same treatment
  // the Lumpers tab gives its range.
  const handleRange = useCallback(({ mode, start, end }) => {
    setRange(mode === 'custom' ? { start, end } : rangeForDays(Number(mode)))
  }, [])

  // Debounce the search box so typing doesn't hit the RPC per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(t)
  }, [searchInput])

  const reload = useCallback(async () => {
    if (!range?.start || !range?.end) return
    setLoading(true); setError(false)
    try {
      const [sum, list, sm] = await Promise.all([
        fetchAccessorialsSummary(range.start, range.end),
        fetchAccessorialsList({
          from: range.start, to: range.end,
          statuses: [...statuses], types: [...types], query: search,
        }),
        fetchSoftMatches().catch(() => []), // the strip is a bonus, never fatal
      ])
      setSummary(sum); setRows(list); setMatches(sm)
    } catch (e) {
      setError(true)
      toast.error("Couldn't load accessorials", e)
    } finally { setLoading(false) }
  }, [range?.start, range?.end, statuses, types, search, toast])

  useEffect(() => { reload() }, [reload])

  // The tab chip counts what's in the range, not what survives the filters.
  useEffect(() => { onCount?.(summary?.claimed_count ?? null) }, [summary, onCount])

  const toggle = (set, setter, key) => setter(prev => {
    const n = new Set(prev)
    n.has(key) ? n.delete(key) : n.add(key)
    return n
  })

  const filtersActive = statuses.size > 0 || types.size > 0 || !!search.trim()
  const clearFilters = () => { setStatuses(new Set()); setTypes(new Set()); setSearchInput('') }

  async function copyPayroll() {
    if (!range?.start || !range?.end) return
    try {
      const text = await fetchPayrollText(range.start, range.end)
      await copyText(text)
      toast.success('Payroll block copied')
    } catch (e) { toast.error("Couldn't build the payroll text", e) }
  }

  async function onDismissMatch(m) {
    setMatchBusy(m.accessorial_id)
    try {
      await dismissSoftMatch({
        accessorialId: m.accessorial_id, detectedAt: m.detected_at,
        matchKind: m.match_kind, delta: m.delta, userId: me?.id,
      })
      toast.success('Match dismissed')
      setMatches(list => list.filter(x => !(x.accessorial_id === m.accessorial_id && x.detected_at === m.detected_at)))
    } catch (e) { toast.error("Couldn't dismiss the match", e) } finally { setMatchBusy(null) }
  }

  const totals = useMemo(() => rows.reduce((acc, r) => {
    acc.claimed += Number(r.claimed_amount) || 0
    acc.approved += Number(r.approved_amount) || 0
    acc.collected += Number(r.collected_amount) || 0
    return acc
  }, { claimed: 0, approved: 0, collected: 0 }), [rows])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-500 dark:text-slate-500">
          Detention, layover and TONU raised by the night team — what the broker owes, what they answered, and what came back.
        </p>
        <button onClick={copyPayroll} className={S.btnSecondary}>📋 Copy for payroll</button>
      </div>

      <UsageRangeControl presets={RANGE_PRESETS} defaultMode="90" onChange={handleRange} />

      <SummaryBand summary={summary} loading={loading && !summary} />

      <SoftMatchStrip matches={matches} busyId={matchBusy}
        onConfirm={setMatchConfirm} onDismiss={onDismissMatch} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips options={STATUSES} selected={statuses} onToggle={k => toggle(statuses, setStatuses, k)} />
        <span className="w-px h-5 bg-gray-200 dark:bg-white/10" />
        <FilterChips options={TYPES.map(t => [t.value, t.label])} selected={types} onToggle={k => toggle(types, setTypes, k)} />
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <input
            value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setSearchInput('') }}
            placeholder="Search driver, load #, broker…"
            className={`${S.input} ${searchInput ? 'pr-7' : ''}`}
          />
          {searchInput && (
            <button onClick={() => setSearchInput('')} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xs">✕</button>
          )}
        </div>
        {filtersActive && (
          <button onClick={clearFilters} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">Clear filters</button>
        )}
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={`${S.tableHead} sticky top-0 z-10`}>
              <tr>
                {COLS.map(h => (
                  <th key={h} className={`${S.th} !py-2.5 whitespace-nowrap ${RIGHT.has(h) ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500 mx-auto" /></td></tr>
              ) : error ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center text-sm text-red-600 dark:text-red-400">Couldn&apos;t load accessorials for this range.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-slate-500">
                  {filtersActive ? 'No claims match the current filters.' : 'No claims raised in this range yet.'}
                </td></tr>
              ) : (
                <>
                  {rows.map(r => (
                    <ClaimRow key={r.id} r={r}
                      onOpen={() => setDetail({ row: r, focusDocs: false })}
                      onDocs={() => setDetail({ row: r, focusDocs: true })} />
                  ))}
                  <tr className="bg-gray-50 dark:bg-white/[0.03] border-t border-gray-200 dark:border-white/10 font-semibold">
                    <td colSpan={6} className="px-4 py-2.5 text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      {rows.length} claim{rows.length === 1 ? '' : 's'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-900 dark:text-white">{money(totals.claimed)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-blue-700 dark:text-blue-300">{money(totals.approved)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{money(totals.collected)}</td>
                    <td colSpan={4} />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <ClaimDetail row={detail.row} focusDocs={detail.focusDocs} toast={toast}
          onClose={() => setDetail(null)} onChanged={reload} />
      )}

      {matchConfirm && (
        <ConfirmCollectedModal
          target={{ label: `${matchConfirm.driver_name || '—'} · ${matchConfirm.load_number || '—'}`, amount: matchConfirm.delta }}
          onClose={() => setMatchConfirm(null)}
          onSubmit={async (amount, on) => {
            await confirmCollected(matchConfirm.accessorial_id, amount, on)
            toast.success('Collection confirmed')
            setMatchConfirm(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function FilterChips({ options, selected, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map(([value, label]) => {
        const on = selected.has(value)
        return (
          <button key={value} type="button" onClick={() => onToggle(value)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              on ? 'bg-orange-500 text-white border-orange-500'
                : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

function ClaimRow({ r, onOpen, onDocs }) {
  const meta = statusMeta(r.status)
  const basis = basisText(r)
  const filing = filingMeta(r.filing_lag_days)
  const open = r.status === 'awaiting' || r.status === 'approved'
  const awaiting = open ? awaitingMeta(r.days_awaiting) : null
  const overdue = open && (r.days_awaiting ?? 0) > 21

  return (
    <tr onClick={onOpen}
      className={`border-b border-gray-100 dark:border-white/[0.03] cursor-pointer transition-colors ${
        overdue ? 'bg-red-50/50 dark:bg-red-500/[0.06] hover:bg-red-50 dark:hover:bg-red-500/[0.1]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.02]'
      }`}>
      {/* Date is the DELIVERY date — aging is argued from that, not from filing */}
      <td className="px-4 py-2.5 whitespace-nowrap align-top">
        <p className="text-gray-600 dark:text-slate-400">{fmtDate(r.event_date)}</p>
        {awaiting && <p className={`text-[10px] leading-tight ${awaiting.cls}`}>{awaiting.label}</p>}
      </td>
      <td className="px-3 py-2.5 align-top min-w-[120px]">
        <p className="font-medium text-gray-900 dark:text-slate-200 leading-tight">{r.driver_name || '—'}</p>
        {r.dispatcher_name && <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{r.dispatcher_name}</p>}
      </td>
      <td className="px-3 py-2.5 align-top">
        <p className="font-mono text-gray-900 dark:text-slate-200 leading-tight">{r.load_number || '—'}</p>
        {r.carrier_name && <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight truncate max-w-[140px]" title={r.carrier_name}>{r.carrier_name}</p>}
      </td>
      <td className="px-3 py-2.5 align-top text-gray-600 dark:text-slate-400">
        <span className="block truncate max-w-[150px]" title={r.broker_name || ''}>{r.broker_name || '—'}</span>
      </td>
      <td className="px-3 py-2.5 align-top whitespace-nowrap text-gray-700 dark:text-slate-300">{typeLabel(r.accessorial_type)}</td>
      <td className="px-3 py-2.5 align-top text-gray-500 dark:text-slate-400">
        <span className="block truncate max-w-[190px]" title={basis || ''}>{basis || '—'}</span>
      </td>
      <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-slate-200">{money(r.claimed_amount)}</td>
      <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums text-blue-700 dark:text-blue-300">{r.approved_amount == null ? <span className="text-gray-300 dark:text-slate-600">—</span> : money(r.approved_amount)}</td>
      <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{r.collected_amount == null ? <span className="text-gray-300 dark:text-slate-600">—</span> : money(r.collected_amount)}</td>
      <td className="px-3 py-2.5 align-top whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.cls}`}>{meta.label.toUpperCase()}</span>
        {r.broker_response && (
          <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 leading-tight">
            {r.broker_response}{r.response_by ? ` · ${r.response_by}` : ''}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        <button type="button" onClick={e => { e.stopPropagation(); onDocs() }}
          title={`${r.doc_count ?? 0} document${(r.doc_count ?? 0) === 1 ? '' : 's'} — open the list`}
          className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded text-[9px] font-bold border transition-colors ${
            (r.doc_count ?? 0) > 0
              ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-200 dark:hover:bg-emerald-500/25'
              : 'text-gray-300 dark:text-slate-600 border-gray-200 dark:border-white/10 hover:border-gray-300'
          }`}>
          📎 {r.doc_count ?? 0}
        </button>
      </td>
      <td className="px-3 py-2.5 align-top text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.requested_by_name || '—'}</td>
      <td className="px-4 py-2.5 align-top whitespace-nowrap">
        {filing ? <span className={`text-[11px] ${filing.cls}`}>{filing.label}</span> : <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
    </tr>
  )
}
