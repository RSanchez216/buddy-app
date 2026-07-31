import { useCallback, useEffect, useMemo, useState } from 'react'
import { S } from '../../../lib/styles'
import Select from '../../../components/Select'
import { useToast } from '../../../contexts/ToastContext'
import UsageRangeControl from '../../settings/users/UsageRangeControl'
import StatsBand from './StatsBand'
import LumperDrawer from './LumperDrawer'
import {
  fetchLumperEvents, fetchSummary, fetchCategories, fetchRefLists, rangeForDays,
  money, fmtDate, fmtMonth, ageDays, statusMeta, recorderLabel, dispatcherDisplay,
  CHARGE_TO, RC_STATUS, LUMPER_STATUS_LABEL,
} from './lumperData'

const LUMPER_PRESETS = [
  ['30', '30d', 30],
  ['90', '90d', 90],
  ['182', '6mo', 182],
  ['365', '1yr', 365],
  ['custom', 'Custom'],
]

const ORANGE_BTN = 'flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20'
const COLSPAN = 14

export default function LumpersPage() {
  const toast = useToast()
  const [range, setRange] = useState(null)
  const [events, setEvents] = useState([])
  const [summary, setSummary] = useState(null)
  const [categories, setCategories] = useState([])
  const [refLists, setRefLists] = useState({ carriers: [], dispatchers: [], drivers: [], users: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Filters (client-side over the fetched range). Default to Open so the list
  // leads with what's still owed (the point of the page).
  const [status, setStatus] = useState('open')
  const [carrierId, setCarrierId] = useState('all')
  const [categoryId, setCategoryId] = useState('all')
  const [chargeTo, setChargeTo] = useState('all')
  const [dispatcherKey, setDispatcherKey] = useState('all')
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('month')

  const [drawer, setDrawer] = useState({ open: false, mode: 'create', row: null })

  const usersById = useMemo(() => new Map((refLists.users || []).map(u => [u.id, u])), [refLists.users])

  // Presets recompute in Chicago (today − N, inclusive of the boundary day) so
  // the client window matches the server / lumper_summary exactly; Custom uses
  // the literal picked endpoints (already inclusive via gte/lte).
  const handleRange = useCallback(({ mode, start, end }) => {
    setRange(mode === 'custom' ? { start, end } : rangeForDays(Number(mode)))
  }, [])

  // Reference data — fetched once.
  useEffect(() => {
    let stale = false
    Promise.all([fetchCategories(), fetchRefLists()])
      .then(([cats, refs]) => { if (!stale) { setCategories(cats); setRefLists(refs) } })
      .catch(() => { /* non-fatal: pickers degrade gracefully */ })
    return () => { stale = true }
  }, [])

  // Events + summary — refetch only on date-range change.
  const reload = useCallback(async () => {
    if (!range?.start || !range?.end) return
    setLoading(true); setError(false)
    try {
      const [ev, sum] = await Promise.all([
        fetchLumperEvents({ start: range.start, end: range.end }),
        fetchSummary(range.start, range.end),
      ])
      setEvents(ev); setSummary(sum)
    } catch (e) {
      setError(true)
      toast.error("Couldn't load lumpers", e)
    } finally {
      setLoading(false)
    }
  }, [range?.start, range?.end, toast])

  useEffect(() => { reload() }, [reload])

  // Dispatcher filter options — distinct present in the data (id, else nickname).
  const dispatcherOptions = useMemo(() => {
    const seen = new Map()
    for (const e of events) {
      const d = dispatcherDisplay(e)
      const key = e.dispatcher_id || (e.dispatcher_name ? `name:${e.dispatcher_name}` : null)
      if (key && !seen.has(key)) seen.set(key, d.name)
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [events])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return events.filter(e => {
      if (status !== 'all' && e.status !== status) return false
      if (carrierId !== 'all' && e.carrier_id !== carrierId) return false
      if (categoryId !== 'all' && e.category_id !== categoryId) return false
      if (chargeTo !== 'all' && e.charge_to !== chargeTo) return false
      if (dispatcherKey !== 'all') {
        const key = e.dispatcher_id || (e.dispatcher_name ? `name:${e.dispatcher_name}` : null)
        if (key !== dispatcherKey) return false
      }
      if (q) {
        const hay = [e.driver?.full_name, e.driver_name, e.load_number, e.efs_code, e.invoice_number]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, status, carrierId, categoryId, chargeTo, dispatcherKey, search])

  // by_month lookup for the group dividers.
  const byMonth = useMemo(() => {
    const m = new Map()
    for (const r of summary?.by_month || []) m.set(r.month, r)
    return m
  }, [summary])

  // Rows grouped by month (desc), or a single flat group.
  const groups = useMemo(() => {
    if (groupBy !== 'month') return [{ key: null, rows: filtered }]
    const g = new Map()
    for (const e of filtered) {
      const ym = String(e.event_date || '').slice(0, 7)
      if (!g.has(ym)) g.set(ym, [])
      g.get(ym).push(e)
    }
    return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, rows]) => ({ key, rows }))
  }, [filtered, groupBy])

  const filtersActive = status !== 'all' || carrierId !== 'all' || categoryId !== 'all' || chargeTo !== 'all' || dispatcherKey !== 'all' || !!search.trim()

  function openCreate() { setDrawer({ open: true, mode: 'create', row: null }) }
  function openEdit(row) { setDrawer({ open: true, mode: 'edit', row }) }
  function closeDrawer() { setDrawer(d => ({ ...d, open: false })) }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> After Hours
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lumpers</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Advances paid at the dock — what's still owed, who owes it, and whether it came back.</p>
        </div>
        <button onClick={openCreate} className={ORANGE_BTN}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add lumper
        </button>
      </div>

      <UsageRangeControl presets={LUMPER_PRESETS} defaultMode="90" onChange={handleRange} />

      {/* Stats band */}
      <StatsBand summary={loading ? null : summary} rangeDays={range?.start && range?.end ? (ageDays(range.start) - ageDays(range.end) + 1) : 0} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={e => setStatus(e.target.value)} className="w-auto">
          <option value="all">All statuses</option>
          {['open', 'pending', 'paid', 'unpaid'].map(s => <option key={s} value={s}>{LUMPER_STATUS_LABEL[s]}</option>)}
        </Select>
        <Select value={carrierId} onChange={e => setCarrierId(e.target.value)} className="w-auto">
          <option value="all">All carriers</option>
          {refLists.carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-auto">
          <option value="all">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={chargeTo} onChange={e => setChargeTo(e.target.value)} className="w-auto">
          <option value="all">All charge-to</option>
          {CHARGE_TO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select value={dispatcherKey} onChange={e => setDispatcherKey(e.target.value)} className="w-auto">
          <option value="all">All dispatchers</option>
          {dispatcherOptions.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
        </Select>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
            placeholder="Search driver, load #, EFS, invoice…"
            className={`${S.input} ${search ? 'pr-7' : ''}`}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xs" aria-label="Clear search">✕</button>
          )}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs ml-auto">
          {[['month', 'Group: Month'], ['none', 'Flat']].map(([k, l]) => (
            <button key={k} onClick={() => setGroupBy(k)} className={`px-3 py-2 ${groupBy === k ? 'bg-orange-500 text-white font-semibold' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{l}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={`${S.tableHead} sticky top-0 z-10`}>
              <tr>
                {['Date', 'Driver', 'Octopus # / Broker', 'Carrier', 'Dispatcher', 'Category', 'Amount', 'EFS', 'Total', 'Charge to', 'RC', 'Status', 'Docs', 'By'].map((h, i) => (
                  <th key={h} className={`${S.th} !py-2.5 whitespace-nowrap ${i >= 6 && i <= 8 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500 mx-auto" /></td></tr>
              ) : error ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center text-sm text-red-600 dark:text-red-400">Couldn&apos;t load lumpers for this range.</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={COLSPAN} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-slate-500">{filtersActive ? 'No lumpers match the current filters.' : 'No lumpers in this range yet.'}</td></tr>
              ) : (
                groups.map(group => (
                  <GroupBlock key={group.key ?? 'flat'} group={group} byMonth={byMonth} usersById={usersById} onRowClick={openEdit} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LumperDrawer
        open={drawer.open}
        mode={drawer.mode}
        row={drawer.row}
        categories={categories}
        refLists={refLists}
        onCategoriesChange={setCategories}
        onClose={closeDrawer}
        onSaved={reload}
      />
    </div>
  )
}

function GroupBlock({ group, byMonth, usersById, onRowClick }) {
  const monthRow = group.key ? byMonth.get(group.key) : null
  return (
    <>
      {group.key && (
        <tr className="bg-gray-50 dark:bg-white/[0.03] border-y border-gray-200 dark:border-white/5">
          <td colSpan={COLSPAN} className="px-4 py-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-slate-300">
                {fmtMonth(group.key)} <span className="text-gray-400 dark:text-slate-500 font-medium normal-case">· {group.rows.length} record{group.rows.length === 1 ? '' : 's'}</span>
              </span>
              {monthRow && (
                <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400 tabular-nums">
                  Advanced <span className="text-gray-800 dark:text-slate-200">{money(monthRow.advanced, 0)}</span>
                  <span className="mx-1.5 text-gray-300 dark:text-slate-600">·</span>
                  Open <span className="text-orange-600 dark:text-orange-400">{money(monthRow.open, 0)}</span>
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
      {group.rows.map(row => <LumperRow key={row.id} row={row} usersById={usersById} onClick={() => onRowClick(row)} />)}
    </>
  )
}

function LumperRow({ row, usersById, onClick }) {
  const meta = statusMeta(row.status)
  const disp = dispatcherDisplay(row)
  // Age/overdue applies to outstanding rows (open + pending).
  const age = (row.status === 'open' || row.status === 'pending') ? ageDays(row.event_date) : null
  const overdue = age != null && age > 30
  const ageTone = age == null ? '' : age > 30 ? 'text-red-600 dark:text-red-400 font-semibold' : age >= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-slate-500'
  const rcTone = { received: 'text-emerald-600 dark:text-emerald-400', pending: 'text-amber-600 dark:text-amber-400', not_required: 'text-gray-400 dark:text-slate-500' }[row.rc_status] || ''
  const rcLabel = RC_STATUS.find(r => r[0] === row.rc_status)?.[1] || row.rc_status || '—'
  const chargeLabel = CHARGE_TO.find(c => c[0] === row.charge_to)?.[1] || row.charge_to || '—'

  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-100 dark:border-white/[0.03] cursor-pointer transition-colors ${overdue ? 'bg-red-50/50 dark:bg-red-500/[0.06] hover:bg-red-50 dark:hover:bg-red-500/[0.1]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.02]'}`}
    >
      <td className="px-4 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-400">{fmtDate(row.event_date)}</td>
      <td className="px-3 py-2.5 min-w-[130px]">
        <p className="font-medium text-gray-900 dark:text-slate-200 leading-tight">{row.driver?.full_name || row.driver_name || '—'}</p>
        {row.state_code && <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight">{row.state_code}</p>}
      </td>
      <td className="px-3 py-2.5 min-w-[130px]">
        <p className="font-mono text-gray-900 dark:text-slate-200 leading-tight">{row.load_number || '—'}</p>
        {(() => {
          // Broker: prefer the joined customers.name, fall back to the denormalized
          // broker_name text; render nothing when both are empty.
          const broker = row.customer?.name || row.broker_name
          return broker ? <p className="text-[10px] text-gray-400 dark:text-slate-500 leading-tight truncate max-w-[160px]" title={broker}>{broker}</p> : null
        })()}
      </td>
      <td className="px-3 py-2.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{row.carrier?.name || '—'}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={disp.muted ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-600 dark:text-slate-400'}>{disp.name}</span>
      </td>
      <td className="px-3 py-2.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{row.category?.name || '—'}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-700 dark:text-slate-300">{money(row.amount)}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-500 dark:text-slate-400">{money(row.efs_fee)}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-gray-900 dark:text-slate-200">{money(row.total_amount)}</td>
      <td className="px-3 py-2.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{chargeLabel}</td>
      <td className="px-3 py-2.5 whitespace-nowrap"><span className={`text-[11px] font-medium ${rcTone}`}>{rcLabel}</span></td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.pill}`}>
          <span className="w-2 h-2 rounded-full" style={{ background: meta.dot }} />{meta.label}
        </span>
        {age != null && <p className={`text-[10px] mt-0.5 ${ageTone}`}>{age}d{overdue ? ' overdue' : ''}</p>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <DocChip label="R" title="Receipt" state={docState(row.receipt_path, row.receipt_in_octopus)} />
          <DocChip label="RC" title="Revised rate con" state={docState(row.revised_rc_path, row.revised_rc_in_octopus)} />
        </div>
      </td>
      <td className="px-4 py-2.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{recorderLabel(row, usersById)}</td>
    </tr>
  )
}

// File present → in BUDDY (green); else in-Octopus mark → purple; else missing.
const docState = (path, inOctopus) => (path ? 'buddy' : inOctopus ? 'octopus' : 'missing')
const DOC_CHIP = {
  // In BUDDY — green. In Octopus — purple (a full peer of green). Missing — grey.
  buddy:   { cls: 'text-[#157A3B] dark:text-emerald-400 border-[#BFE5CB] dark:border-emerald-500/30 bg-[#DFF3E6] dark:bg-emerald-500/15', tip: 'in BUDDY' },
  octopus: { cls: 'text-[#4F46E5] dark:text-indigo-300 border-[#C5C8F6] dark:border-indigo-500/30 bg-[#E8EAFD] dark:bg-indigo-500/15', tip: 'in Octopus' },
  missing: { cls: 'text-[#B6BCC5] dark:text-slate-600 border-[#EDEFF2] dark:border-white/10 bg-[#F4F5F7] dark:bg-transparent', tip: 'missing' },
}
function DocChip({ label, title, state }) {
  const v = DOC_CHIP[state] || DOC_CHIP.missing
  return (
    <span title={`${title}: ${v.tip}`}
      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded text-[9px] font-bold border ${v.cls}`}>{label}</span>
  )
}
