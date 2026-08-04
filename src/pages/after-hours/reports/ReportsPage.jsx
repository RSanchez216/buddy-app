import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import CoverageStrip from './CoverageStrip'
import ShiftHistory from './ShiftHistory'
import AssociateTable from './AssociateTable'
import {
  fetchShiftList, fetchAssociateRollup, fetchShiftDetail, fetchOrphanActivityCount,
  weekOf, shiftWeek, isCurrentWeek, fmtRange, shiftTypeLabel, orderShiftTypes,
  deriveTotals, buildCoverage, gapRows, sortHistory,
  historyToCsv, downloadCsv, fmtHours, money, pct,
} from './reportsData'

// After Hours › Shift Reports. Opens on the current Mon–Sun week in Central.
//
// Two RPC calls per week (list + rollup, plus a cheap orphan count); the detail
// RPC fires only when a row is expanded and is cached per shift_id for the
// session. No polling — the Shift Board had it removed for a reason.

export default function ReportsPage() {
  const toast = useToast()

  const [week, setWeek] = useState(() => weekOf())
  const [shifts, setShifts] = useState([])
  const [rollup, setRollup] = useState([])
  const [orphans, setOrphans] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [typeFilter, setTypeFilter] = useState(() => new Set())
  const [assocFilter, setAssocFilter] = useState(() => new Set())

  const [openId, setOpenId] = useState(null)
  const [details, setDetails] = useState({}) // shift_id → { loading, data, error }

  // toast identity changes on every toast show/dismiss, so it goes through a ref
  // rather than a dep array — putting it in one refires the fetch effect.
  const toastRef = useRef(toast); toastRef.current = toast

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [list, roll, orphan] = await Promise.all([
        fetchShiftList(week.start, week.end),
        fetchAssociateRollup(week.start, week.end),
        fetchOrphanActivityCount(week.start, week.end).catch(() => 0), // informational only
      ])
      setShifts(list); setRollup(roll); setOrphans(orphan)
    } catch (e) {
      setError(true)
      toastRef.current.error("Couldn't load shift reports", e)
    } finally { setLoading(false) }
  }, [week.start, week.end])

  useEffect(() => { load() }, [load])

  // Changing week closes any expanded row — its detail belongs to a shift that
  // may no longer be listed.
  const goWeek = (n) => { setOpenId(null); setWeek(w => shiftWeek(w, n)) }
  const goThisWeek = () => { setOpenId(null); setWeek(weekOf()) }

  // ── Filters ───────────────────────────────────────────────────────────────
  const typeOptions = useMemo(
    () => orderShiftTypes([...new Set(shifts.map(s => s.shift_type).filter(Boolean))]),
    [shifts],
  )
  const assocOptions = useMemo(() => {
    const m = new Map()
    for (const s of shifts) if (s.associate_id) m.set(s.associate_id, s.associate)
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [shifts])

  const filtered = useMemo(() => shifts.filter(s =>
    (typeFilter.size === 0 || typeFilter.has(s.shift_type)) &&
    (assocFilter.size === 0 || assocFilter.has(s.associate_id))
  ), [shifts, typeFilter, assocFilter])

  const filtersActive = typeFilter.size > 0 || assocFilter.size > 0
  const clearFilters = () => { setTypeFilter(new Set()); setAssocFilter(new Set()) }

  // Everything below is derived from the SAME filtered array, so the tiles, the
  // coverage grid and the table can never disagree.
  const totals = useMemo(() => deriveTotals(filtered), [filtered])
  const coverage = useMemo(() => buildCoverage(filtered, week), [filtered, week])
  const history = useMemo(() => sortHistory([...filtered, ...gapRows(coverage)]), [filtered, coverage])

  // ── Lazy detail, cached for the session ───────────────────────────────────
  const openDetail = useCallback(async (shiftId) => {
    setDetails(d => (d[shiftId]?.data ? d : { ...d, [shiftId]: { loading: true } }))
    try {
      const data = await fetchShiftDetail(shiftId)
      setDetails(d => ({ ...d, [shiftId]: { loading: false, data } }))
    } catch (e) {
      setDetails(d => ({ ...d, [shiftId]: { loading: false, error: e?.message || 'Could not load the shift.' } }))
    }
  }, [])

  // Collapsing and re-expanding must not refetch — the cache is checked first.
  const toggleRow = useCallback((shiftId) => {
    setOpenId(cur => {
      if (cur === shiftId) return null
      setDetails(d => {
        if (!d[shiftId]?.data && !d[shiftId]?.loading) openDetail(shiftId)
        return d
      })
      return shiftId
    })
  }, [openDetail])

  function exportCsv() {
    if (!history.length) return
    downloadCsv(`shift-reports-${week.start}-to-${week.end}.csv`, historyToCsv(history))
    toast.success('History exported')
  }

  const empty = !loading && !error && filtered.length === 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> After Hours
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shift Reports</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Who covered which shift, what they got through, and what they handed over.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Dropdown label="Shift" options={typeOptions.map(t => ({ id: t, name: shiftTypeLabel(t) }))}
            selected={typeFilter} onToggle={k => setTypeFilter(toggled(typeFilter, k))} />
          <Dropdown label="Associate" options={assocOptions}
            selected={assocFilter} onToggle={k => setAssocFilter(toggled(assocFilter, k))} />
          {filtersActive && (
            <button onClick={clearFilters} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">Clear</button>
          )}

          <div className="flex items-center gap-1 rounded-xl border border-gray-300 dark:border-slate-700 px-1 py-0.5">
            <StepBtn onClick={() => goWeek(-1)} label="Previous week">‹</StepBtn>
            <span className="px-2 text-xs font-semibold text-gray-800 dark:text-slate-200 tabular-nums whitespace-nowrap">{fmtRange(week)}</span>
            <StepBtn onClick={() => goWeek(1)} label="Next week">›</StepBtn>
          </div>
          {!isCurrentWeek(week) && (
            <button onClick={goThisWeek}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 hover:bg-orange-100 dark:hover:bg-orange-500/20">
              This week
            </button>
          )}
          <button onClick={exportCsv} disabled={!history.length} className={`${S.btnSecondary} disabled:opacity-40`}>Export</button>
        </div>
      </div>

      {error ? (
        <div className={S.errorBox}>
          Couldn&apos;t load shift reports for this week. <button onClick={load} className="underline font-medium">Retry</button>
        </div>
      ) : loading ? (
        <div className="space-y-4">
          <div className="h-24 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          <div className="h-40 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          <div className="h-64 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
        </div>
      ) : empty ? (
        // One empty state, not twelve zero tiles.
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 p-12 text-center">
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
            {filtersActive ? 'No shifts match these filters.' : 'No shifts logged this week.'}
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            {filtersActive
              ? 'Clear the filters to see the whole week.'
              : `Nothing was started between ${fmtRange(week)}. Step back a week to see earlier shifts.`}
          </p>
          <div className="flex items-center justify-center gap-2 mt-4">
            {filtersActive && <button onClick={clearFilters} className={S.btnCancel}>Clear filters</button>}
            <button onClick={() => goWeek(-1)} className={S.btnSecondary}>‹ Previous week</button>
          </div>
        </div>
      ) : (
        <>
          <Tiles t={totals} />
          <CoverageStrip coverage={coverage} orphanCount={orphans} />
          <ShiftHistory rows={history} openId={openId} onToggle={toggleRow} details={details} onRetry={openDetail} />
          <AssociateTable rows={rollup} />
        </>
      )}
    </div>
  )
}

const toggled = (set, key) => {
  const n = new Set(set)
  n.has(key) ? n.delete(key) : n.add(key)
  return n
}

// ── Week tiles ──────────────────────────────────────────────────────────────
// Summed from the shift list, never from after_hours_week_summary — that uses a
// different lumper window and the two totals would contradict each other.
function Tiles({ t }) {
  const cards = [
    ['Avg reviewed', pct(t.avgReviewedPct)],
    ['Booked', t.booked],
    ['PODs', t.pods],
    ['BOLs', t.bols],
    ['Chkpt', t.checkpoints],
    ['Req raised', t.requestsRaised],
    ['Req handled', t.requestsHandled],
    ['Escalations', t.escalations],
    ['Acc claimed', money(t.accessorialsClaimed)],
    ['Acc collected', money(t.accessorialsCollected)],
    ['Lumpers', money(t.lumpersAmount)],
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      <div className="col-span-2 rounded-2xl border-2 border-orange-300 dark:border-orange-500/40 bg-gradient-to-br from-orange-50 to-orange-100/60 dark:from-orange-500/[0.12] dark:to-orange-500/[0.04] p-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-orange-700/80 dark:text-orange-400/80">Shifts logged</p>
        <p className="text-3xl font-black text-orange-600 dark:text-orange-400 font-mono tabular-nums leading-tight mt-1">
          {t.shifts}
          {t.open > 0 && <span className="text-lg text-orange-500/70 dark:text-orange-400/60"> · {t.open} open</span>}
        </p>
        <p className="text-[11px] text-orange-700/70 dark:text-orange-400/70 mt-0.5">{fmtHours(t.hours)} covered</p>
      </div>
      {cards.map(([label, val]) => (
        <div key={label} className={`${S.card} px-3 py-2.5`}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white font-mono tabular-nums leading-tight mt-0.5">{val}</p>
        </div>
      ))}
    </div>
  )
}

function StepBtn({ onClick, label, children }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className="w-6 h-6 inline-flex items-center justify-center rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/10">
      {children}
    </button>
  )
}

// Portalled to the body and positioned `fixed` from the trigger's rect. An
// in-flow absolute menu gets clipped to a few pixels by any `overflow: auto`
// ancestor regardless of z-index — that has already bitten the Shift Board's
// Load state filter twice.
function Dropdown({ label, options, selected, onToggle }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const n = selected.size

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 232)) })
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('scroll', place, true) // capture — inner scrollers too
    window.addEventListener('resize', place)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, place])

  if (options.length === 0) return null

  return (
    <div className="shrink-0">
      <button ref={btnRef} onClick={() => { if (open) { setOpen(false) } else { place(); setOpen(true) } }}
        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
          n ? 'border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-300 bg-orange-50/60 dark:bg-orange-500/10'
            : 'border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
        }`}>
        {label}{n ? ` · ${n}` : ''} ▾
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-50 w-56 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-xl py-1 max-h-72 overflow-y-auto">
            {options.map(o => (
              <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer">
                <input type="checkbox" checked={selected.has(o.id)} onChange={() => onToggle(o.id)} className="w-3.5 h-3.5 accent-orange-500" />
                <span className="flex-1 text-sm text-gray-700 dark:text-slate-300 truncate">{o.name}</span>
              </label>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
