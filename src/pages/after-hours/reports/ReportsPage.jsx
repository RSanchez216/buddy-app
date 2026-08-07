import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import CoverageStrip from './CoverageStrip'
import ShiftHistory from './ShiftHistory'
import AssociateTable from './AssociateTable'
import { MetricStrip, StripLead, StripEyebrow, StripCells, StripCell } from '../../../components/MetricStrip'
import {
  fetchShiftList, fetchAssociateRollup, fetchShiftDetail, fetchOrphanActivityCount,
  weekOf, shiftWeek, isCurrentWeek, fmtRange, shiftTypeLabel, orderShiftTypes,
  deriveTotals, buildCoverage, gapRows, sortHistory,
  historyToCsv, downloadCsv, fmtHours, fmtDay, money, pct,
} from './reportsData'
import { buildShiftReportsPdf } from './reportsPdf'

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
  const [pdfBusy, setPdfBusy] = useState(false)
  const [shiftPdfId, setShiftPdfId] = useState(null) // which row's PDF is building

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

  // PDF export. The report is what's on screen, so it exports the FULL week's
  // rows — not the rows that happen to be expanded. Detail is lazily fetched per
  // shift, so anything not yet opened is fetched here first; the session cache is
  // reused for the rest and is written back so expanding a row afterwards is
  // instant. A shift whose detail fails is still exported, just without its
  // expanded block — one bad RPC shouldn't cost the whole document.
  // Fetch whatever detail these ids don't have yet, and write it back to the
  // session cache so expanding a row afterwards is instant. Returns the merged
  // map; a shift whose RPC failed simply has no `data` and is reported.
  const ensureDetails = useCallback(async (ids) => {
    const missing = ids.filter(id => !details[id]?.data)
    if (!missing.length) return details
    const fetched = await Promise.all(
      missing.map(id => fetchShiftDetail(id).then(data => [id, { loading: false, data }])
        .catch(e => [id, { loading: false, error: e?.message || 'failed' }])),
    )
    const merged = { ...details, ...Object.fromEntries(fetched) }
    setDetails(merged)
    return merged
  }, [details])

  const filterNote = () => (filtersActive
    ? `Filtered — ${[
      typeFilter.size ? `${[...typeFilter].map(shiftTypeLabel).join(', ')}` : null,
      assocFilter.size ? `${assocOptions.filter(a => assocFilter.has(a.id)).map(a => a.name).join(', ')}` : null,
    ].filter(Boolean).join('  ·  ')}`
    : '')

  async function exportPdf() {
    if (!history.length || pdfBusy) return
    setPdfBusy(true)
    try {
      const ids = history.filter(r => !r.is_gap && r.shift_id).map(r => r.shift_id)
      const merged = await ensureDetails(ids)
      const failed = ids.filter(id => !merged[id]?.data).length
      await buildShiftReportsPdf({
        week, totals, coverage, history, rollup, details: merged, filterNote: filterNote(),
      })
      if (failed > 0) toast.error(`PDF exported — ${failed} shift${failed === 1 ? '' : 's'} without detail`)
      else toast.success('PDF exported')
    } catch (e) {
      toast.error("Couldn't build the PDF", e)
    } finally {
      setPdfBusy(false)
    }
  }

  // One shift's own PDF. Same generator, narrowed by onlyShiftId — the week
  // summary, coverage grid, history table and rollup all drop out.
  async function exportShiftPdf(row) {
    if (!row?.shift_id || row.is_gap || shiftPdfId) return
    setShiftPdfId(row.shift_id)
    try {
      const merged = await ensureDetails([row.shift_id])
      if (!merged[row.shift_id]?.data) throw new Error("Couldn't load that shift's detail.")
      await buildShiftReportsPdf({
        week, totals, coverage, history, rollup, details: merged, onlyShiftId: row.shift_id,
      })
      toast.success(`${fmtDay(row.shift_date)} ${shiftTypeLabel(row.shift_type)} exported`)
    } catch (e) {
      toast.error("Couldn't build that shift's PDF", e)
    } finally {
      setShiftPdfId(null)
    }
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
          {/* PDF is primary: it's the version that gets read and sent. Excel stays
              because Accounting pulls the numbers back out of it — different
              readers, and dropping it would cost a workflow to gain nothing. */}
          <button onClick={exportPdf} disabled={!history.length || pdfBusy}
            className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all">
            {pdfBusy ? 'Building…' : 'Download PDF'}
          </button>
          <button onClick={exportCsv} disabled={!history.length || pdfBusy}
            className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40 transition-colors">
            Excel
          </button>
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
          <ShiftHistory rows={history} openId={openId} onToggle={toggleRow} details={details} onRetry={openDetail}
            onDownloadShift={exportShiftPdf} downloadingId={shiftPdfId} />
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

// ── Week strip ──────────────────────────────────────────────────────────────
// One compact row matching the Shift Board's band (shared MetricStrip). Summed
// from the shift list, never from after_hours_week_summary — that uses a
// different lumper window and the two totals would contradict each other. The
// thirteen old tiles merge to eight cells so currency values never truncate.
function Tiles({ t }) {
  const V = 'text-[18px] text-gray-900 dark:text-white'
  const cells = [
    { label: 'Avg reviewed', value: pct(t.avgReviewedPct) },
    { label: 'Booked', value: t.booked },
    { label: 'Paperwork', sublabel: 'POD / BOL', value: `${t.pods} / ${t.bols}` },
    { label: 'Chkpt', value: t.checkpoints },
    { label: 'Requests', sublabel: 'Raised / Handled', value: `${t.requestsRaised} / ${t.requestsHandled}` },
    { label: 'Escalations', value: t.escalations, valueCls: `text-[18px] ${t.escalations > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-900 dark:text-white'}` },
    {
      label: 'Accessorials', sublabel: 'Claimed / Collected',
      value: <>{money(t.accessorialsClaimed)} <span className="text-gray-300 dark:text-slate-600">/</span> <span className={t.accessorialsCollected > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>{money(t.accessorialsCollected)}</span></>,
    },
    { label: 'Lumpers', value: money(t.lumpersAmount) },
  ]
  return (
    <MetricStrip tone="orange">
      <StripLead tone="orange">
        <StripEyebrow tone="orange">Shifts logged</StripEyebrow>
        <span className="text-lg font-black text-orange-600 dark:text-orange-400 font-mono tabular-nums leading-none whitespace-nowrap">
          {t.shifts}<span className="text-sm font-bold text-orange-500/70 dark:text-orange-400/60"> shifts</span>
          {t.open > 0 && <span className="text-sm font-bold text-orange-500/70 dark:text-orange-400/60"> · {t.open} open</span>}
        </span>
        <span className="mt-0.5 text-[11px] text-orange-700/70 dark:text-orange-400/70 whitespace-nowrap">{fmtHours(t.hours)} covered</span>
      </StripLead>
      <StripCells>
        {cells.map((c, i) => (
          <StripCell key={c.label} tone="orange" first={i === 0} label={c.label} sublabel={c.sublabel}
            value={c.value} valueCls={c.valueCls || V} />
        ))}
      </StripCells>
    </MetricStrip>
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
