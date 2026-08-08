import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import {
  fetchEfsWeeks, fetchWeekChecks, fetchMatchers, createTargetsFrom, fetchCandidates,
  reconConfirm, createLumperFromCheck, createAccessorialFromCheck,
  parseEfsWorkbook, checkYearOverlap, detectSwaps, applySwaps, feeSanity, applyEfsImport, REQUIRED_FIELDS,
  resolveDriverNames, fetchRoster, PURPOSE_CATEGORIES,
  addDays, todayYmd, fmtRange, money,
} from './crossMatchingData'

// EFS cross-matching hub. Screen A is the weekly table; a row click drills into
// Screen B (that week's checks + one action per row). Import a report opens the
// guarded importer. All matching is done in the DB — this reads the views/RPCs.

const g = (o, ...keys) => { for (const k of keys) { const v = o?.[k]; if (v != null) return v } return null }

export default function CrossMatching() {
  const { canEdit } = useAuth()
  const toast = useToast()

  const [params] = useSearchParams()
  const [year, setYear] = useState(() => Number((params.get('week') || todayYmd()).slice(0, 4)))
  const [weeks, setWeeks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // ?week=YYYY-MM-DD (from the Lumpers banner) opens that week's drill-in.
  const [selectedWeek, setSelectedWeek] = useState(() => params.get('week') || null)
  const [importOpen, setImportOpen] = useState(false)
  const [targets, setTargets] = useState({})

  const toastRef = useRef(toast); toastRef.current = toast
  useEffect(() => { fetchMatchers().then(m => setTargets(createTargetsFrom(m))).catch(() => {}) }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      setWeeks(await fetchEfsWeeks(`${year}-01-01`, `${year}-12-31`))
    } catch (e) { setError(true); toastRef.current.error("Couldn't load the weekly reconciliation", e) }
    finally { setLoading(false) }
  }, [year])
  useEffect(() => { load() }, [load])

  if (selectedWeek) {
    return <WeekDrillIn weekStart={selectedWeek} targets={targets} canEdit={canEdit} toast={toast}
      onBack={() => setSelectedWeek(null)} onChanged={load} />
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Cross-matching
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">EFS checks → Load-related charges</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Every EFS check for the week, matched against what&apos;s on the Lumpers and Accessorials boards. The broker reimburses these only if they&apos;re recorded.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="text-sm rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2.5 py-1.5 text-gray-900 dark:text-slate-100">
            {yearOptions().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {canEdit && (
            <button onClick={() => setImportOpen(true)} className={S.btnPrimary}>Import a report</button>
          )}
        </div>
      </div>

      {error ? (
        <div className={S.errorBox}>Couldn&apos;t load the weekly table. <button onClick={load} className="underline font-medium">Retry</button></div>
      ) : loading ? (
        <div className="h-64 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
      ) : (
        <div className={`${S.card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-white/10">
              <tr className="text-left">
                {['Week', 'Checks', 'Total', 'Load-related', 'Reimbursable $', 'Recorded', 'To review', 'Missing', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => {
                const start = g(w, 'week_start', 'week')
                const end = g(w, 'week_end') || (start ? addDays(start, 6) : null)
                const checks = g(w, 'checks', 'check_count')
                const imported = g(w, 'imported') != null ? !!g(w, 'imported') : (checks != null && Number(checks) > 0)
                const missing = Number(g(w, 'missing') || 0)
                const toReview = Number(g(w, 'to_review') || 0)
                const dot = !imported ? 'bg-gray-300 dark:bg-slate-600' : missing > 0 ? 'bg-red-500' : toReview > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                return (
                  <tr key={start || i} onClick={() => imported && setSelectedWeek(start)}
                    className={`border-b border-gray-100 dark:border-white/[0.04] ${imported ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : 'opacity-70'}`}>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-800 dark:text-slate-200">{start ? fmtRange(start, end) : '—'}</td>
                    {!imported ? (
                      <td colSpan={7} className="px-3 py-2 text-gray-400 dark:text-slate-500 italic">— Not imported</td>
                    ) : (
                      <>
                        <td className="px-3 py-2 tabular-nums">{num(checks)}</td>
                        <td className="px-3 py-2 tabular-nums">{money(g(w, 'total', 'total_amount'))}</td>
                        <td className="px-3 py-2 tabular-nums">{num(g(w, 'load_related', 'load_related_count'))}</td>
                        <td className="px-3 py-2 tabular-nums">{money(g(w, 'reimbursable', 'reimbursable_amount'))}</td>
                        <td className="px-3 py-2 tabular-nums">{num(g(w, 'recorded'))}</td>
                        <td className="px-3 py-2 tabular-nums">{num(toReview)}</td>
                        <td className={`px-3 py-2 tabular-nums ${missing > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>{num(missing)}</td>
                      </>
                    )}
                    <td className="px-3 py-2"><span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} title={!imported ? 'Not imported' : missing > 0 ? 'Missing records' : toReview > 0 ? 'To review' : 'All recorded'} /></td>
                  </tr>
                )
              })}
              {weeks.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400 dark:text-slate-500">No weeks in {year}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && <ImportWizard onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load() }} toast={toast} />}
    </div>
  )
}

// ── Screen B ──────────────────────────────────────────────────────────────────
function WeekDrillIn({ weekStart, targets, canEdit, toast, onBack, onChanged }) {
  const [checks, setChecks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(null) // purpose_category chip
  const [reviewFor, setReviewFor] = useState(null) // check being reviewed

  const load = useCallback(async () => {
    setLoading(true)
    try { setChecks(await fetchWeekChecks(weekStart)) }
    catch (e) { toast.error("Couldn't load the week", e) }
    finally { setLoading(false) }
  }, [weekStart, toast])
  useEffect(() => { load() }, [load])

  const cards = useMemo(() => {
    const recorded = checks.filter(c => g(c, 'lumper_state') === 'yes' || g(c, 'accessorial_state') === 'yes')
    const needsChoice = checks.filter(c => !recorded.includes(c) && (g(c, 'lumper_state') === 'maybe' || g(c, 'accessorial_state') === 'maybe'))
    const notRecorded = checks.filter(c => isLoadRelated(c) && g(c, 'lumper_state') === 'no' && g(c, 'accessorial_state') === 'no')
    const notLoad = checks.filter(c => !isLoadRelated(c))
    const notRecordedTotal = notRecorded.reduce((s, c) => s + (Number(g(c, 'total_amount', 'check_amount')) || 0), 0)
    return { recorded, needsChoice, notRecorded, notLoad, notRecordedTotal }
  }, [checks])

  const categories = useMemo(() => [...new Set(checks.map(c => g(c, 'purpose_category')).filter(Boolean))].sort(), [checks])
  const rows = filter ? checks.filter(c => g(c, 'purpose_category') === filter) : checks

  const afterAction = async () => { await load(); await onChanged?.() }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <button onClick={onBack} className="text-xs text-orange-600 dark:text-orange-400 hover:underline">← All weeks</button>
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Week of {fmtRange(weekStart, addDays(weekStart, 6))}</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CardStat label="Already recorded" value={cards.recorded.length} tone="emerald" />
        <CardStat label="Needs a choice" value={cards.needsChoice.length} tone="amber" />
        <CardStat label="Not recorded anywhere" value={cards.notRecorded.length} sub={money(cards.notRecordedTotal)} tone="red" />
        <CardStat label="Not load-related" value={cards.notLoad.length} tone="slate" />
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Chip on={!filter} onClick={() => setFilter(null)}>All</Chip>
          {categories.map(cat => <Chip key={cat} on={filter === cat} onClick={() => setFilter(cat)}>{labelCat(cat)}</Chip>)}
        </div>
      )}

      {loading ? (
        <div className="h-64 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
      ) : (
        <div className={`${S.card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-white/10">
              <tr className="text-left">
                {['Date', 'Money code', 'Driver', 'Description', 'Amount', 'Lumpers', 'Accessorials', 'Action'].map(h => (
                  <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={g(c, 'check_id', 'money_code')} className="border-b border-gray-100 dark:border-white/[0.04]">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(g(c, 'tx_date'))}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{g(c, 'money_code') || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{g(c, 'driver_name') || '—'}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate" title={g(c, 'purpose_raw') || ''}>{g(c, 'purpose_raw') || '—'}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{money(g(c, 'total_amount', 'check_amount'))}</td>
                  <td className="px-3 py-2 text-center"><StateCell s={g(c, 'lumper_state')} /></td>
                  <td className="px-3 py-2 text-center"><StateCell s={g(c, 'accessorial_state')} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <RowAction c={c} targets={targets} canEdit={canEdit} toast={toast}
                      onReview={() => setReviewFor(c)} onChanged={afterAction} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400 dark:text-slate-500">No checks{filter ? ' in this category' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {reviewFor && <ReviewModal check={reviewFor} toast={toast} onClose={() => setReviewFor(null)} onConfirmed={async () => { setReviewFor(null); await afterAction() }} />}
    </div>
  )
}

// One action per row, decided by state (never Create + Review together).
function RowAction({ c, targets, canEdit, toast, onReview, onChanged }) {
  const [busy, setBusy] = useState(false)
  const lumper = g(c, 'lumper_state'), acc = g(c, 'accessorial_state')
  const cat = g(c, 'purpose_category')
  const checkId = g(c, 'check_id', 'id')

  if (lumper === 'yes' || acc === 'yes') {
    const to = lumper === 'yes' ? '/after-hours/lumpers' : '/after-hours/requests'
    return <a href={to} className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline">Open</a>
  }
  if (lumper === 'maybe' || acc === 'maybe') {
    const n = Number(g(c, 'candidate_count') || 0)
    return <button onClick={onReview} className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline">Review {n || ''}→</button>
  }
  if (!isLoadRelated(c)) {
    return <span className="text-[11px] text-gray-400 dark:text-slate-500">Ignore</span>
  }
  // both 'no', load-related → create per category (from recon_matchers config)
  const t = targets[cat] || defaultTargets(cat)
  const doCreate = async (fn) => {
    if (!canEdit || busy) return
    setBusy(true)
    try {
      const { data, error } = await fn()
      if (error) { toast.error("Couldn't create that", error); return }
      toast.success('Created — check the board'); void data
      await onChanged()
    } finally { setBusy(false) }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {t?.lumper && (
        <button disabled={busy || !canEdit} onClick={() => doCreate(() => createLumperFromCheck(checkId))}
          className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline disabled:opacity-50">+ Create lumper</button>
      )}
      {t?.lumper && t?.accessorial && <span className="text-gray-300 dark:text-slate-600">|</span>}
      {t?.accessorial && (
        <button disabled={busy || !canEdit} onClick={() => doCreate(() => createAccessorialFromCheck(checkId, t.accessorial.type_code))}
          className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 hover:underline disabled:opacity-50">+ Create accessorial</button>
      )}
      {!t?.lumper && !t?.accessorial && <span className="text-[11px] text-gray-400 dark:text-slate-500">—</span>}
    </span>
  )
}

function ReviewModal({ check, toast, onClose, onConfirmed }) {
  const [cands, setCands] = useState(null)
  const [busy, setBusy] = useState(false)
  const checkId = g(check, 'check_id', 'id')
  useEffect(() => { fetchCandidates(checkId).then(setCands).catch(() => setCands([])) }, [checkId])
  const confirm = async (matchId) => {
    setBusy(true)
    try {
      const { error } = await reconConfirm(matchId)
      if (error) { toast.error("Couldn't link that", error); return }
      toast.success('Linked — money code written back')
      await onConfirmed()
    } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} title="Link this check">
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">{g(check, 'driver_name') || '—'} · {money(g(check, 'total_amount', 'check_amount'))} · {g(check, 'purpose_raw') || ''}</p>
      {cands == null ? (
        <div className="h-16 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
      ) : cands.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500 italic">No candidates found.</p>
      ) : (
        <div className="space-y-1.5">
          {/* recon_matches columns: match_kind, day_gap, amount_delta, reason. */}
          {cands.map(m => (
            <button key={m.id} disabled={busy} onClick={() => confirm(m.id)}
              className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 text-sm disabled:opacity-50">
              <span className="font-medium text-gray-800 dark:text-slate-200 capitalize">{g(m, 'match_kind') || 'candidate'}</span>
              <span className="text-gray-400 dark:text-slate-500 ml-2 text-xs">
                {g(m, 'amount_delta') != null ? `Δ ${money(Math.abs(Number(g(m, 'amount_delta'))))}` : ''}
                {g(m, 'day_gap') != null ? ` · ${g(m, 'day_gap')}d gap` : ''}
                {g(m, 'reason') ? ` · ${g(m, 'reason')}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ── Import wizard: Columns · Drivers · Purposes · Import ──────────────────────
// A review step between choosing a file and writing anything. Unrecognised driver
// names and purposes get assigned first (and remembered), so a one-character-off
// name doesn't report a recorded lumper as "missing". Nothing is written until
// Import is pressed; unassigned rows still import (blocking is worse).
const groupBy = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) } return m }

function ImportWizard({ onClose, onDone, toast }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [mapStep, setMapStep] = useState(null)
  const [yearBlock, setYearBlock] = useState(null)
  const [review, setReview] = useState(null) // { filename, rows, span, roster, drivers, purposes, swaps, feeIssues }
  const [swapChoice, setSwapChoice] = useState(true)

  const beginReview = async ({ rows, span, filename }) => {
    if (!rows.length) { toast.error('No check rows found.'); return }
    const overlap = await checkYearOverlap(span)
    if (!overlap.ok) { setYearBlock({ span, board: overlap }); return }

    const [roster, resolved] = await Promise.all([
      fetchRoster(),
      resolveDriverNames(rows.map(r => r.driver_name)),
    ])
    const norm = (x) => String(x ?? '').toLowerCase().trim()
    const byName = new Map(resolved.map(x => [norm(x.raw ?? x.raw_value ?? x.name ?? x.driver_name ?? x.input), x]))

    // Only names that still need a human decision (suggestion / none).
    const drivers = []
    for (const [raw, grp] of groupBy(rows.filter(r => r.driver_name), r => r.driver_name)) {
      const res = byName.get(norm(raw)) || { state: 'none' }
      if (res.state === 'exact' || res.state === 'mapped') continue
      const mappedId = res.mapped_id ?? (roster.find(d => d.full_name === res.mapped_value)?.id ?? '')
      drivers.push({
        raw, state: res.state, similarity: res.similarity ?? null,
        mappedId: mappedId || '', mappedValue: res.mapped_value ?? '',
        count: grp.length, amount: grp.reduce((s, r) => s + (Number(r.total_amount) || 0), 0),
        remember: true,
      })
    }
    const purposes = [...groupBy(rows.filter(r => r.purpose_category === 'unclassified' && r.purpose_raw), r => r.purpose_raw)]
      .map(([raw, grp]) => ({ raw, category: '', count: grp.length, amount: grp.reduce((s, r) => s + (Number(r.total_amount) || 0), 0), remember: true }))

    setReview({ filename, rows, span, roster, drivers, purposes, swaps: detectSwaps(rows, roster.map(d => d.full_name)), feeIssues: feeSanity(rows) })
  }

  const onFile = async (file) => {
    if (!file) return
    setBusy(true); setYearBlock(null); setReview(null); setMapStep(null)
    try {
      const buf = await file.arrayBuffer()
      const parsed = parseEfsWorkbook(buf)
      if (parsed.errors.length) { toast.error(parsed.errors[0]); return }
      if (parsed.missing.length) { setMapStep({ buf, filename: file.name, headers: parsed.headers, missing: parsed.missing, cols: parsed.cols }); return }
      await beginReview({ ...parsed, filename: file.name })
    } catch (e) { toast.error("Couldn't read the file", e) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const applyMapping = async (mapping) => {
    setBusy(true)
    try {
      const parsed = parseEfsWorkbook(mapStep.buf, mapping)
      if (parsed.missing.length) { toast.error('Still missing a required column.'); return }
      const filename = mapStep.filename; setMapStep(null)
      await beginReview({ ...parsed, filename })
    } finally { setBusy(false) }
  }

  const setDriver = (i, patch) => setReview(rv => ({ ...rv, drivers: rv.drivers.map((d, j) => j === i ? { ...d, ...patch } : d) }))
  const setPurpose = (i, patch) => setReview(rv => ({ ...rv, purposes: rv.purposes.map((p, j) => j === i ? { ...p, ...patch } : p) }))

  const doImport = async (withAssignments) => {
    if (!review || busy) return
    setBusy(true)
    try {
      const rows = swapChoice && review.swaps.length ? applySwaps(review.rows, review.swaps) : review.rows
      const assignments = []
      if (withAssignments) {
        for (const d of review.drivers) if (d.remember && d.mappedValue) assignments.push({ field: 'driver_name', raw_value: d.raw, mapped_value: d.mappedValue, mapped_id: d.mappedId || null, confidence: 1 })
        for (const p of review.purposes) if (p.remember && p.category) assignments.push({ field: 'purpose_category', raw_value: p.raw, mapped_value: p.category, mapped_id: null, confidence: 1 })
      }
      const res = await applyEfsImport({ rows, filename: review.filename, span: review.span, assignments })
      if (res.error) { toast.error("Couldn't import", res.error); return }
      toast.success(`Imported ${res.imported} checks${res.skipped ? `, ${res.skipped} already present` : ''}`)
      onDone()
    } finally { setBusy(false) }
  }

  const unassigned = review ? review.drivers.filter(d => !d.mappedValue).length + review.purposes.filter(p => !p.category).length : 0
  // Two or more file spellings pointing at one driver.
  const dupes = useMemo(() => {
    if (!review) return []
    const by = groupBy(review.drivers.filter(d => d.mappedId), d => d.mappedId)
    return [...by.values()].filter(g => g.length > 1)
  }, [review])

  return (
    <Modal onClose={onClose} title="Import an EFS report" wide>
      {!review && !yearBlock && !mapStep && (
        <label className={`${S.btnPrimary} cursor-pointer inline-block ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
          {busy ? 'Reading…' : 'Choose file'}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} disabled={busy} />
        </label>
      )}

      {mapStep && <MappingStep step={mapStep} busy={busy} onCancel={() => setMapStep(null)} onConfirm={applyMapping} />}

      {yearBlock && (
        <div className="space-y-3">
          <div className={S.errorBox}>
            This file covers {fmtRange(yearBlock.span.min, yearBlock.span.max)} — no overlap with the board&apos;s data
            ({fmtRange(yearBlock.board.boardMin, yearBlock.board.boardMax)}). It looks like the wrong year&apos;s export. Nothing was imported.
          </div>
          <div className="flex justify-end"><button onClick={() => setYearBlock(null)} className={S.btnCancel}>Choose another file</button></div>
        </div>
      )}

      {review && (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto -mx-1 px-1">
          {/* Stepper */}
          <div className="flex items-center gap-1 text-[11px] font-semibold flex-wrap">
            <StepChip label="Columns" done />
            <StepChip label="Drivers" done={review.drivers.length === 0} count={review.drivers.length} />
            <StepChip label="Purposes" done={review.purposes.length === 0} count={review.purposes.length} />
            <StepChip label="Import" />
          </div>

          {review.swaps.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <input type="checkbox" checked={swapChoice} onChange={e => setSwapChoice(e.target.checked)} className="mt-0.5 accent-amber-600" />
              <span>{review.swaps.length} row{review.swaps.length === 1 ? '' : 's'} look like Purpose/Driver were transposed. Swap them back on import.</span>
            </label>
          )}

          {/* Drivers */}
          {review.drivers.length === 0 ? (
            <DoneLine>All driver names matched the roster.</DoneLine>
          ) : (
            <section className="space-y-2">
              <h4 className={SECTION_H}>Drivers to assign ({review.drivers.length})</h4>
              {dupes.length > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  {dupes.map(g => `${g.map(d => d.raw).join(', ')} → one driver`).join(' · ')}. Same person under several spellings.
                </p>
              )}
              <div className="space-y-1.5">
                {review.drivers.map((d, i) => (
                  <div key={d.raw} className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="font-mono text-red-600 dark:text-red-400 min-w-[150px]">{d.raw}</span>
                    <span className="text-gray-300 dark:text-slate-600">→</span>
                    <select value={d.mappedId || ''} onChange={e => { const dr = review.roster.find(x => String(x.id) === e.target.value); setDriver(i, { mappedId: e.target.value, mappedValue: dr?.full_name || '' }) }}
                      className="text-[12px] rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-1 text-gray-900 dark:text-slate-100 min-w-[180px]">
                      <option value="">— unassigned —</option>
                      {review.roster.map(dr => <option key={dr.id} value={dr.id}>{dr.full_name}</option>)}
                    </select>
                    {d.similarity != null && (
                      <span className={`tabular-nums ${d.similarity >= 0.7 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{Number(d.similarity).toFixed(2)}</span>
                    )}
                    <span className="text-gray-400 dark:text-slate-500 tabular-nums">{d.count}× · {money(d.amount)}</span>
                    <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                      <input type="checkbox" checked={d.remember} onChange={e => setDriver(i, { remember: e.target.checked })} className="accent-orange-500" /> Remember
                    </label>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Purposes */}
          {review.purposes.length === 0 ? (
            <DoneLine>No unclassified purposes.</DoneLine>
          ) : (
            <section className="space-y-2">
              <h4 className={SECTION_H}>Purposes to classify ({review.purposes.length})</h4>
              <p className="text-[11px] text-gray-400 dark:text-slate-500">Choose Unclassified when the purpose was never really recorded (e.g. a unit number typed in the field) — guessing would inflate a spend total on no evidence.</p>
              <div className="space-y-1.5">
                {review.purposes.map((p, i) => (
                  <div key={p.raw} className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="font-mono text-red-600 dark:text-red-400 min-w-[150px] truncate" title={p.raw}>{p.raw}</span>
                    <span className="text-gray-300 dark:text-slate-600">→</span>
                    <select value={p.category} onChange={e => setPurpose(i, { category: e.target.value })}
                      className="text-[12px] rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-1 text-gray-900 dark:text-slate-100 min-w-[160px]">
                      <option value="">— choose —</option>
                      {PURPOSE_CATEGORIES.map(c => <option key={c} value={c}>{labelCat(c)}</option>)}
                    </select>
                    <span className="text-gray-400 dark:text-slate-500 tabular-nums">{p.count}× · {money(p.amount)}</span>
                    <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                      <input type="checkbox" checked={p.remember} onChange={e => setPurpose(i, { remember: e.target.checked })} className="accent-orange-500" /> Remember
                    </label>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Import footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 dark:border-white/5 pt-3">
            <p className="text-[11px] text-gray-500 dark:text-slate-400">
              {review.rows.length} checks from {fmtRange(review.span?.min, review.span?.max)}{unassigned > 0 ? ` · ${unassigned} still unassigned` : ' · all assigned'}. Re-importing is safe.
            </p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={busy} className={S.btnCancel}>Cancel</button>
              <button onClick={() => doImport(false)} disabled={busy} className="px-3 py-2 text-sm font-medium rounded-xl border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">Import without assigning</button>
              <button onClick={() => doImport(true)} disabled={busy} className={S.btnPrimary}>{busy ? 'Importing…' : `Import ${review.rows.length} checks`}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
const SECTION_H = 'text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500'
function StepChip({ label, done, count }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${done ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300'}`}>
      {done && <span aria-hidden>✓</span>}{label}{count != null && count > 0 ? ` · ${count}` : ''}
    </span>
  )
}
function DoneLine({ children }) {
  return <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5"><span aria-hidden>✓</span>{children}</p>
}

const FIELD_LABELS = { money: 'Money Code', date: 'TX Date', purpose: 'Check Purpose', amount: 'Check Amount', driver: 'Driver' }
// Column-mapping fallback — shown instead of an error when a required header can't
// be auto-detected, so a renamed export never needs hand-editing.
function MappingStep({ step, busy, onCancel, onConfirm }) {
  const fields = ['money', 'date', 'purpose', 'amount', 'driver']
  const [map, setMap] = useState(() => { const m = {}; for (const f of fields) m[f] = step.cols?.[f] || ''; return m })
  const canGo = REQUIRED_FIELDS.every(f => map[f])
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700 dark:text-slate-300">
        Couldn&apos;t auto-detect {step.missing.map(f => FIELD_LABELS[f] || f).join(', ')}. Pick the matching column{step.missing.length > 1 ? 's' : ''} — no need to edit the file.
      </p>
      <div className="space-y-2">
        {fields.map(f => (
          <label key={f} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-gray-500 dark:text-slate-400">{FIELD_LABELS[f]}{REQUIRED_FIELDS.includes(f) ? ' *' : ''}</span>
            <select value={map[f] || ''} onChange={e => setMap(m => ({ ...m, [f]: e.target.value }))}
              className="w-1/2 text-sm rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-1.5 text-gray-900 dark:text-slate-100">
              <option value="">— none —</option>
              {step.headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className={S.btnCancel}>Back</button>
        <button onClick={() => onConfirm(map)} disabled={busy || !canGo} className={S.btnPrimary}>Continue</button>
      </div>
    </div>
  )
}

// ── small components ──────────────────────────────────────────────────────────
function isLoadRelated(c) {
  const v = g(c, 'is_load_related')
  if (v != null) return !!v
  // Fallback: a check with any lumper/accessorial state other than absent is load-related.
  return g(c, 'lumper_state') != null || g(c, 'accessorial_state') != null
}
function defaultTargets(cat) {
  if (cat === 'lumper') return { lumper: true }
  if (cat === 'escort_fee' || cat === 'late_fee') return { lumper: true, accessorial: { type_code: cat } }
  if (cat === 'detention' || cat === 'layover') return { accessorial: { type_code: cat } }
  return {}
}
function StateCell({ s }) {
  if (s === 'yes') return <span className="text-emerald-600 dark:text-emerald-400 font-bold" title="Recorded">✓</span>
  if (s === 'maybe') return <span className="text-amber-600 dark:text-amber-400 font-bold" title="Candidate found">?</span>
  return <span className="text-gray-300 dark:text-slate-600" title="Not found">–</span>
}
function CardStat({ label, value, sub, tone }) {
  const t = { emerald: 'text-emerald-700 dark:text-emerald-400', amber: 'text-amber-700 dark:text-amber-400', red: 'text-red-700 dark:text-red-400', slate: 'text-gray-900 dark:text-slate-200' }[tone] || 'text-gray-900 dark:text-slate-200'
  return (
    <div className={`${S.card} p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-mono font-medium ${t}`}>{num(value)}</p>
      {sub && <p className="text-[11px] text-gray-400 dark:text-slate-500 tabular-nums">{sub}</p>}
    </div>
  )
}
function Chip({ on, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${on ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{children}</button>
  )
}
function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-white dark:bg-[#0B1120] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-lg' : 'max-w-md'} p-5 space-y-1`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200" aria-label="Close">✕</button>
        </div>
        <div className="pt-2">{children}</div>
      </div>
    </div>
  )
}

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'))
function fmtDay(v) { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—' }
function labelCat(cat) { return String(cat || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
function yearOptions() { const y = Number(todayYmd().slice(0, 4)); return [y + 1, y, y - 1, y - 2] }
