import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import ComboBox from '../../../components/ComboBox'
import CopyButton from '../../../components/CopyButton'
import LoadsFreshness from '../../../components/LoadsFreshness'
import { parseLoadsWorkbook } from './loadsParse'
import { buildPlan } from './loadsPlan'
import { stageBatch, loadPendingBatch, applyBatch, discardBatch, loadRecentBatches, linkKey } from './loadsApply'

// Loads ingest — Phase 2 review/approve screen. Upload the TMS "All Loads"
// export → parse + resolve + diff + stage → review New/Updated/Unchanged,
// link any unmatched drivers/trucks/trailers, approve/skip per updated
// load → Apply writes through to loads/load_legs. A pending batch is
// reloaded on mount so a refresh resumes the review.

function fmtVal(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('en-US')
  return String(v)
}

// Expected-optional TMS columns. `key` matches the parser's resolved `cols`
// map so "missing" agrees exactly with what populates the field. Warning only —
// never blocks the import (required columns keep their hard-error behavior).
const OPTIONAL_COLS = [
  { key: 'truck',        label: 'Truck Number' },
  { key: 'loadNotes',    label: 'Load Notes' },
  { key: 'loadInstr',    label: 'Load Instructions' },
  { key: 'invoiceNotes', label: 'Invoice Notes' },
]

// ── Import-time TONU heuristic ──────────────────────────────────────────────
// Same-city pickup & drop under the realistic floor flags a possible TONU.
const TONU_FLOOR = 500
// City+state = the portion before ", US" in a PU/DEL info string. Label keeps
// the original case for display; key lowercases it for comparison.
function tonuCityLabel(info) {
  return String(info || '').split(/,\s*US\b/i)[0].trim()
}
function tonuCityKey(info) {
  return tonuCityLabel(info).toLowerCase()
}
function fieldLabel(f) {
  return ({
    linehaul: 'Linehaul', status: 'Status', pickup_date: 'Pickup date', delivery_date: 'Delivery date',
    driver: 'Driver', truck: 'Truck', trailer: 'Trailer', total_miles: 'Total miles',
  })[f] || f
}

// ── Smart approval classification ──
const STATUS_RANK = {
  'booked': 1,
  'at shipper': 2, 'in transit': 2, 'at receiver': 2,
  'delayed': 2, 'abnormal delay': 2, 'update needed': 2,
  'delivered': 3, 'pending to bill': 4, 'billed': 5,
}
const MILEAGE_PCT = 0.01
const MILEAGE_ABS = 5

function statusRank(s) {
  return STATUS_RANK[(s || '').toLowerCase().trim()] ?? null
}

function classifyLoad(p) {
  const allDiffs = [...p.header_diffs, ...p.legs.flatMap(l => l.diffs)]
  for (const d of allDiffs) {
    if (d.field === 'linehaul') return 'rate_change'
    if (d.field === 'status') {
      const isCT = s => /^(canceled|cancelled|tonu)$/i.test(s || '')
      if (isCT(d.old) || isCT(d.new)) return 'cancel_tonu'
      const oR = statusRank(d.old), nR = statusRank(d.new)
      if (oR === null || nR === null) return 'unknown_status'
      if (nR < oR) return 'status_regression'
    }
    if (['driver','truck','trailer'].includes(d.field)) return 'reassignment'
    if (['pickup_date','delivery_date'].includes(d.field)) return 'date_change'
    if (d.field === 'total_miles') {
      const o = Number(d.old)||0, n = Number(d.new)||0
      const diff = Math.abs(n - o)
      const pct = o > 0 ? diff/o : (diff > 0 ? 1 : 0)
      if (diff > MILEAGE_ABS && pct > MILEAGE_PCT) return 'large_mileage'
    }
  }
  return null
}

const REVIEW_GROUPS = [
  { key: 'rate_change',       label: 'Rate changes' },
  { key: 'reassignment',      label: 'Reassignments' },
  { key: 'cancel_tonu',       label: 'Canceled / TONU' },
  { key: 'date_change',       label: 'Date changes' },
  { key: 'status_regression', label: 'Status regressions' },
  { key: 'large_mileage',     label: 'Large mileage changes' },
  { key: 'unknown_status',    label: 'Unknown status' },
]

function isHighlightedField(field, reason) {
  const map = {
    rate_change: ['linehaul'],
    cancel_tonu: ['status'],
    reassignment: ['driver','truck','trailer'],
    date_change: ['pickup_date','delivery_date'],
    status_regression: ['status'],
    large_mileage: ['total_miles'],
    unknown_status: ['status'],
  }
  return (map[reason] || []).includes(field)
}

export default function LoadsImport() {
  const { user, canEdit } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)          // staging or applying
  const [batch, setBatch] = useState(null)
  const [plan, setPlan] = useState([])
  const [counts, setCounts] = useState({})
  // Per-updated-load approve/skip + per-unmatched-entity link choices.
  const [decisions, setDecisions] = useState(() => new Map())
  const [links, setLinks] = useState(() => new Map())
  // Determinate apply progress: { phase, done, total } while running.
  const [progress, setProgress] = useState(null)
  // Set when an apply stops mid-way: { done, total } → show counter + Retry.
  const [applyError, setApplyError] = useState(null)
  // Recent import batches (history) + a dismissible post-apply summary.
  const [recent, setRecent] = useState([])
  const [applySummary, setApplySummary] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [routineExpanded, setRoutineExpanded] = useState(false)
  // Fleet pick-lists for linking unmatched entities.
  const [fleet, setFleet] = useState({ drivers: [], trucks: [], trailers: [] })
  // Map of driver ID to internal_id for display in needs-review table
  const [internalById, setInternalById] = useState(new Map())
  // Import-time TONU review: load_numbers already classified (is_tonu NOT NULL —
  // their prior decision stands) + the reviewer's per-candidate decisions.
  const [tonuClassified, setTonuClassified] = useState(() => new Set())
  const [tonuDecisions, setTonuDecisions] = useState(() => new Map()) // load_number -> 'tonu' | 'real'
  // Dismiss flag for the missing-optional-columns warning banner.
  const [optionalWarningDismissed, setOptionalWarningDismissed] = useState(false)

  useEffect(() => { init() }, [])

  // Which of this batch's loads are already TONU-classified — so we never
  // re-prompt a prior decision. Re-runs when the staged plan changes.
  useEffect(() => {
    const nums = plan.map(p => p.load_number)
    if (!nums.length) return
    let stale = false
    supabase.from('loads').select('load_number, is_tonu').in('load_number', nums).not('is_tonu', 'is', null)
      .then(({ data, error }) => { if (!stale && !error) setTonuClassified(new Set((data || []).map(r => r.load_number))) })
    return () => { stale = true }
  }, [plan])

  async function init() {
    setLoading(true)
    const [{ batch: b, plan: p, counts: c }, dRes, tkRes, trRes, rec] = await Promise.all([
      loadPendingBatch(),
      supabase.from('drivers').select('id, full_name').order('full_name'),
      supabase.from('trucks').select('id, unit_number').order('unit_number'),
      supabase.from('trailers').select('id, unit_number').order('unit_number'),
      loadRecentBatches(),
    ])
    setFleet({ drivers: dRes.data || [], trucks: tkRes.data || [], trailers: trRes.data || [] })
    setBatch(b); setPlan(p || []); setCounts(c || {})
    setRecent(rec)
    setDecisions(new Map()); setLinks(new Map())
    setTonuDecisions(new Map()); setTonuClassified(new Set())
    setLoading(false)
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (file) await handleUpload(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleUpload(file) {
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const { rows, errors, cols } = parseLoadsWorkbook(buf)
      if (errors.length) { toast.error("Couldn't read the file", errors[0]); return }

      // Expected-optional columns absent from this file — detected via the
      // parser's own resolved `cols` (same header matching that populates the
      // fields), so it never disagrees with the real mapping. Warning only.
      const missingOptional = OPTIONAL_COLS.filter(c => !cols?.[c.key]).map(c => c.label)
      const presentOptional = OPTIONAL_COLS.filter(c => cols?.[c.key]).map(c => c.label)
      setOptionalWarningDismissed(false)

      // Reference + existing-load data for resolve/diff.
      const loadNumbers = [...new Set(rows.map(r => r.load_number))]
      const [drv, trk, trl, car, cus, dis, exLoads] = await Promise.all([
        supabase.from('drivers').select('id, full_name, internal_id'),
        supabase.from('trucks').select('id, unit_number'),
        supabase.from('trailers').select('id, unit_number'),
        supabase.from('carriers').select('id, name'),
        supabase.from('customers').select('id, name, trailer_required'),
        supabase.from('dispatchers').select('id, name'),
        supabase.from('loads').select('id, load_number, status, linehaul, pickup_date, delivery_date').in('load_number', loadNumbers),
      ])
      const existingLoads = exLoads.data || []
      let existingLegs = []
      if (existingLoads.length) {
        const { data: legs } = await supabase.from('load_legs')
          .select('id, load_id, leg_seq, driver_raw, truck_raw, trailer_raw, total_miles')
          .in('load_id', existingLoads.map(l => l.id))
        existingLegs = legs || []
      }

      const { plan: built, counts: builtCounts } = buildPlan({
        rows,
        refs: {
          drivers: drv.data || [], trucks: trk.data || [], trailers: trl.data || [],
          carriers: car.data || [], customers: cus.data || [], dispatchers: dis.data || [],
        },
        existing: { loads: existingLoads, legs: existingLegs },
      })

      // Stash the missing/present optional columns on the batch counts (jsonb,
      // no schema change) so the warning survives the stage → reload round-trip.
      const stagedCounts = { ...builtCounts, missing_optional: missingOptional, present_optional: presentOptional }
      const { batchId, error } = await stageBatch({ plan: built, counts: stagedCounts, filename: file.name, userId: user?.id })
      if (error) { toast.error("Couldn't stage the import", error); return }
      toast.success(`Staged ${file.name} — review below`)
      // Reload from the staged rows (canonical source for review + apply).
      const reloaded = await loadPendingBatch()
      setBatch(reloaded.batch); setPlan(reloaded.plan); setCounts(reloaded.counts || {})
      setDecisions(new Map()); setLinks(new Map())
      void batchId
    } finally {
      setBusy(false)
    }
  }

  // Distinct unmatched entities across all legs, with the importer's fuzzy
  // suggestion, for the link controls.
  const unmatched = useMemo(() => {
    const seen = new Map()
    for (const p of plan) for (const leg of p.legs) {
      for (const type of ['driver', 'truck', 'trailer']) {
        const r = leg.resolved?.[type]
        if (!r || r.match_status !== 'unmatched') continue
        const key = linkKey(type, r.raw)
        if (!seen.has(key)) seen.set(key, { type, raw: r.raw, suggestion: r.suggestion || null, key })
      }
    }
    return [...seen.values()]
  }, [plan])

  const updatedLoads = useMemo(() => plan.filter(p => p.classification === 'updated'), [plan])
  const newLoads = useMemo(() => plan.filter(p => p.classification === 'new'), [plan])
  // Advisory "needs review" loads (e.g. missing trailer, customer not exempt).
  const needsReviewLoads = useMemo(() => plan.filter(p => p.header?.needs_review), [plan])

  // Fetch driver internal IDs for the needs-review table — one query per
  // batch load, keyed off the matched driver UUIDs on those rows. Declared
  // after needsReviewLoads so its dependency reference isn't a TDZ access.
  useEffect(() => {
    let cancelled = false
    async function fetchDriverInternalIds() {
      const ids = [...new Set(needsReviewLoads
        .flatMap(p => p.legs || [])
        .map(l => l.resolved?.driver?.id)
        .filter(Boolean))]

      if (!ids.length) {
        setInternalById(new Map())
        return
      }

      const { data, error } = await supabase
        .from('drivers')
        .select('id, internal_id')
        .in('id', ids)

      if (!cancelled && !error && data) {
        setInternalById(new Map(data.map(d => [d.id, d.internal_id])))
      }
    }

    fetchDriverInternalIds()
    return () => { cancelled = true }
  }, [needsReviewLoads])

  const unchangedCount = useMemo(() => plan.filter(p => p.classification === 'unchanged').length, [plan])
  // Canceled/TONU split: genuine flips (status changed on an existing load)
  // vs. brand-new loads that simply arrive Canceled/TONU. Banner copy keys
  // off this so a first import doesn't say loads "flipped" when nothing did.
  const statusFlag = useMemo(() => ({
    flips:    plan.filter(p => p.is_status_flag && p.classification === 'updated').length,
    arriving: plan.filter(p => p.is_status_flag && p.classification === 'new').length,
  }), [plan])

  const classifiedLoads = useMemo(() =>
    updatedLoads.map(p => ({ ...p, _reviewReason: classifyLoad(p) })),
    [updatedLoads]
  )
  const routineLoads  = useMemo(() => classifiedLoads.filter(p => p._reviewReason === null), [classifiedLoads])
  const reviewLoads   = useMemo(() => classifiedLoads.filter(p => p._reviewReason !== null), [classifiedLoads])
  const reviewByReason = useMemo(() => {
    const m = Object.fromEntries(REVIEW_GROUPS.map(g => [g.key, []]))
    for (const p of reviewLoads) m[p._reviewReason]?.push(p)
    return m
  }, [reviewLoads])
  const approvedCount = useMemo(() =>
    classifiedLoads.filter(p => decisionFor(p.load_number) !== 'skipped').length,
    [classifiedLoads, decisions]
  )

  function decisionFor(loadNumber) { return decisions.get(loadNumber) || 'approved' }
  function setDecision(loadNumber, d) {
    setDecisions(prev => { const n = new Map(prev); n.set(loadNumber, d); return n })
  }
  function approveAllRoutine() {
    setDecisions(prev => {
      const next = new Map(prev)
      for (const p of routineLoads) next.set(p.load_number, 'approved')
      return next
    })
  }
  function approveGroup(reason) {
    setDecisions(prev => {
      const next = new Map(prev)
      for (const p of reviewByReason[reason] || []) next.set(p.load_number, 'approved')
      return next
    })
  }
  function approveAll() {
    setDecisions(prev => {
      const next = new Map(prev)
      for (const p of classifiedLoads) next.set(p.load_number, 'approved')
      return next
    })
  }
  function setLink(key, id) {
    setLinks(prev => { const n = new Map(prev); if (id) n.set(key, id); else n.delete(key); return n })
  }

  // Loads in this batch matching the same-city < $TONU_FLOOR heuristic. Already-
  // classified loads are split out so their prior decision stays untouched.
  const tonuMatches = useMemo(() => plan.filter(p => {
    const lh = Number(p.header?.linehaul)
    if (!Number.isFinite(lh) || lh >= TONU_FLOOR) return false
    const pk = tonuCityKey(p.header?.pu_info), dk = tonuCityKey(p.header?.del_info)
    return !!pk && pk === dk
  }), [plan])
  const tonuCandidates = useMemo(() => tonuMatches.filter(p => !tonuClassified.has(p.load_number)), [tonuMatches, tonuClassified])
  const tonuAlreadyCount = useMemo(() => tonuMatches.filter(p => tonuClassified.has(p.load_number)).length, [tonuMatches, tonuClassified])

  function setTonuDecision(loadNumber, d) {
    setTonuDecisions(prev => { const n = new Map(prev); if (d) n.set(loadNumber, d); else n.delete(loadNumber); return n })
  }
  function bulkTonu(d) {
    setTonuDecisions(prev => { const n = new Map(prev); for (const p of tonuCandidates) n.set(p.load_number, d); return n })
  }

  async function onApply() {
    if (!batch || busy) return
    setBusy(true)
    setApplyError(null)
    setProgress({ phase: 'Starting', done: 0, total: 0 })
    try {
      // The apply is idempotent (loads upsert on load_number, notes
      // write-once, legs matched against current DB), so Retry just re-runs
      // from the start — already-written rows no-op.
      const fname = batch.filename
      const cancelTonu = Number(counts.status_flags || 0)
      const { appliedLoads, appliedLegs, appliedCustomers, appliedDispatchers, error, done, total } = await applyBatch({
        batchId: batch.id, decisions, linkOverrides: links, onProgress: setProgress,
      })
      if (error) {
        // Record how many items didn't make it so history reflects the
        // interruption (the batch stays pending_review and is retryable).
        await supabase.from('load_import_batches')
          .update({ counts: { ...counts, failed: Math.max(0, (total ?? 0) - (done ?? 0)) } }).eq('id', batch.id)
        setApplyError({ done: done ?? 0, total: total ?? 0 })
        toast.error('Apply interrupted — you can retry', error)
        setRecent(await loadRecentBatches())
        return
      }
      toast.success(`Applied — ${appliedLoads} load${appliedLoads === 1 ? '' : 's'}, ${appliedLegs} leg${appliedLegs === 1 ? '' : 's'}`)

      // Classify reviewed TONU candidates via the RPC — the ONLY writer of the
      // TONU columns. Runs AFTER the upsert so each load exists. Few per import,
      // so a simple loop is fine; an RPC failure is logged, never blocks apply.
      let tonuApplied = 0
      for (const [ln, d] of tonuDecisions) {
        if (d !== 'tonu' && d !== 'real') continue
        const { error: tErr } = await supabase.rpc('set_load_tonu', { p_load_number: ln, p_is_tonu: d === 'tonu' })
        if (tErr) console.error('[LoadsImport] set_load_tonu failed for', ln, tErr)
        else tonuApplied++
      }
      if (tonuApplied > 0) toast.success(`Classified ${tonuApplied} TONU review${tonuApplied === 1 ? '' : 's'}`)

      // Durable summary so a user who navigated away still sees the outcome.
      setApplySummary({ filename: fname, loads: appliedLoads, legs: appliedLegs, customers: appliedCustomers, dispatchers: appliedDispatchers, cancelTonu })
      setProgress(null)
      await init()
    } finally {
      setBusy(false)
    }
  }

  async function onDiscard() {
    if (!batch || busy) return
    if (!window.confirm('Discard this import batch? Nothing has been written yet.')) return
    setBusy(true)
    try {
      const { error } = await discardBatch(batch.id)
      if (error) { toast.error("Couldn't discard", error); return }
      toast.success('Batch discarded')
      await init()
    } finally {
      setBusy(false)
    }
  }

  // Cancel from the missing-optional-columns warning: discard the staged batch
  // (nothing was written to loads yet) so the user can re-export with the
  // columns ticked. Non-blocking — no window.confirm (the banner IS the prompt).
  async function cancelForReexport() {
    if (!batch || busy) return
    setBusy(true)
    try {
      const { error } = await discardBatch(batch.id)
      if (error) { toast.error("Couldn't discard", error); return }
      await init()
    } finally {
      setBusy(false)
    }
  }

  const linkOptionsFor = (type) => {
    const list = type === 'driver' ? fleet.drivers : type === 'truck' ? fleet.trucks : fleet.trailers
    return list.map(x => ({
      id: x.id,
      name: type === 'driver' ? x.full_name : x.unit_number,
      searchText: type === 'driver' ? x.full_name : x.unit_number,
    }))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Loads Import</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Upload the daily TMS “All Loads” export. Review changes, then apply — nothing is written until you approve.
          </p>
          {/* How current the loads data is — reflects the last applied import. */}
          <LoadsFreshness className="mt-1" />
        </div>
        {canEdit && !batch && (
          <div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className={S.btnPrimary}>
              {busy ? 'Reading…' : 'Upload All Loads file'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
      ) : !batch ? (
        <div className={`${S.card} p-8 text-center`}>
          <p className="text-sm text-gray-500 dark:text-slate-400">No import in progress.</p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Upload the “All Loads” .xlsx to stage a review.</p>
        </div>
      ) : (
        <>
          {/* Missing optional-columns warning — soft, non-blocking. Shown
              before Apply; Continue keeps the staged batch, Cancel discards it
              (nothing was written) so the user can re-export. */}
          {Array.isArray(counts.missing_optional) && counts.missing_optional.length > 0 && !optionalWarningDismissed && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-500/[0.06] px-4 py-3 text-amber-800 dark:text-amber-300">
              <p className="text-sm font-semibold mb-1">⚠️ Heads up — some optional columns are missing from this file</p>
              <p className="text-xs">
                <span className="font-medium">Missing:</span> {counts.missing_optional.join(', ')}.
                {counts.present_optional?.length ? <> <span className="font-medium">Present:</span> {counts.present_optional.join(', ')}.</> : null}
              </p>
              <p className="text-xs mt-1">
                These aren&apos;t required, but <strong>Truck Number</strong> drives assignment matching, and the notes/instructions are collected for your records. If you continue, these fields will be blank for the loads in this file — or cancel and re-export from the TMS with the columns ticked.
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <button onClick={() => setOptionalWarningDismissed(true)} disabled={busy} className={S.btnSave}>Continue import</button>
                <button onClick={cancelForReexport} disabled={busy} className={S.btnCancel}>Cancel &amp; re-export</button>
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <Stat label="New" value={counts.new ?? 0} tone="emerald" />
            <Stat label="Updated" value={counts.updated ?? 0} tone="amber" />
            <Stat label="Unchanged" value={counts.unchanged ?? 0} tone="slate" />
            <Stat label="New legs" value={counts.new_legs ?? 0} tone="cyan" />
            <Stat label="New customers" value={counts.new_customers ?? 0} tone="cyan" />
            <Stat label="New dispatchers" value={counts.new_dispatchers ?? 0} tone="cyan" />
            <Stat label="Unmatched" value={counts.unmatched ?? 0} tone={(counts.unmatched ?? 0) > 0 ? 'red' : 'slate'} />
          </div>

          {(statusFlag.flips + statusFlag.arriving) > 0 && (() => {
            const { flips, arriving } = statusFlag
            const ld = n => `load${n === 1 ? '' : 's'}`
            // Pure-arriving is informational (nothing changed); any genuine
            // flip makes it a warning.
            const warn = flips > 0
            return (
              <div className={`rounded-xl border px-4 py-2.5 text-sm ${warn
                ? 'border-red-200 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/[0.06] text-red-700 dark:text-red-300'
                : 'border-cyan-200 dark:border-cyan-500/20 bg-cyan-50/60 dark:bg-cyan-500/[0.06] text-cyan-700 dark:text-cyan-300'}`}>
                {flips > 0 && arriving === 0 && (
                  <>⚠️ {flips} {ld(flips)} flipped to <span className="font-semibold">Canceled / TONU</span> — review highlighted below.</>
                )}
                {flips === 0 && arriving > 0 && (
                  <>ℹ️ {arriving} new {ld(arriving)} {arriving === 1 ? 'is' : 'are'} <span className="font-semibold">Canceled / TONU</span> — they'll import (Canceled is excluded from profit; TONU counts). Review highlighted below.</>
                )}
                {flips > 0 && arriving > 0 && (
                  <>⚠️ {flips} existing {ld(flips)} flipped to <span className="font-semibold">Canceled / TONU</span>, and {arriving} new {ld(arriving)} arrive Canceled/TONU — review highlighted below.</>
                )}
              </div>
            )
          })()}

          {/* Possible TONUs — import-time review (manager only). Classified via
              set_load_tonu after the upsert; untouched candidates stay NULL. */}
          {canEdit && tonuCandidates.length > 0 && (
            <Section
              title={`Possible TONUs detected (${tonuCandidates.length})`}
              subtitle={`Same-city pickup & drop under $${TONU_FLOOR}. Confirm TONU (excluded from rate metrics) or mark Real — untouched candidates stay unclassified.${tonuAlreadyCount > 0 ? ` ${tonuAlreadyCount} already classified, unchanged.` : ''}`}
              action={
                <span className="flex items-center gap-2">
                  <button onClick={() => bulkTonu('tonu')} className={`${S.btnSecondary} text-xs`}>Confirm all</button>
                  <button onClick={() => bulkTonu('real')} className={`${S.btnSecondary} text-xs`}>Reject all</button>
                </span>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className={S.tableHead}><tr>
                    <th className={S.th}>Load #</th><th className={S.th}>Lane</th>
                    <th className={`${S.th} text-right`}>Linehaul</th>
                    <th className={`${S.th} text-right`}>Decision</th>
                  </tr></thead>
                  <tbody>
                    {tonuCandidates.map(p => {
                      const d = tonuDecisions.get(p.load_number) || ''
                      const lh = p.header?.linehaul
                      return (
                        <tr key={p.load_number} className={`${S.tableRow} ${d === 'tonu' ? 'bg-amber-50/40 dark:bg-amber-500/[0.04]' : ''}`}>
                          <td className={`${S.td} font-mono`}>{p.load_number}</td>
                          <td className={S.td}>{tonuCityLabel(p.header?.pu_info) || '—'} → {tonuCityLabel(p.header?.del_info) || '—'}</td>
                          <td className={`${S.td} text-right font-mono`}>{lh == null ? '—' : `$${Number(lh).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}</td>
                          <td className={`${S.td} text-right`}>
                            <span className="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
                              <button onClick={() => setTonuDecision(p.load_number, 'tonu')} className={`px-2.5 py-1 ${d === 'tonu' ? 'bg-amber-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>TONU</button>
                              <button onClick={() => setTonuDecision(p.load_number, 'real')} className={`px-2.5 py-1 ${d === 'real' ? 'bg-emerald-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>Real</button>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Unmatched entities */}
          {unmatched.length > 0 && (
            <Section title={`Unmatched entities (${unmatched.length})`} subtitle="Link each to an existing fleet record, or leave it to import with the raw text and link later. Never auto-linked.">
              <div className="space-y-2">
                {unmatched.map(u => (
                  <div key={u.key} className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 w-16 text-center">{u.type}</span>
                    <span className="font-mono text-sm text-gray-900 dark:text-slate-200 min-w-[140px]">{u.raw}</span>
                    {u.suggestion && (
                      <button
                        type="button"
                        onClick={() => setLink(u.key, u.suggestion.id)}
                        className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline"
                        title="Use the suggested match"
                      >
                        suggest: {u.suggestion.name} →
                      </button>
                    )}
                    <div className="w-64">
                      <ComboBox
                        options={linkOptionsFor(u.type)}
                        value={links.get(u.key) || ''}
                        onChange={id => setLink(u.key, id)}
                        placeholder="— Leave unmatched —"
                        searchPlaceholder={`Search ${u.type}s…`}
                        noResultsLabel="No match"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Needs review — advisory, non-blocking (e.g. missing trailer). */}
          {needsReviewLoads.length > 0 && (
            <Section title={`Needs review (${needsReviewLoads.length})`} subtitle="Advisory only — these loads still import on Apply. Worth a manual look (e.g. a missing trailer on a customer that normally supplies one).">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className={S.tableHead}><tr>
                    <th className={S.th}>Load #</th><th className={S.th}>Customer</th>
                    <th className={S.th}>Driver(s)</th><th className={S.th}>Reason</th>
                  </tr></thead>
                  <tbody>
                    {needsReviewLoads.map(p => (
                      <tr key={p.load_number} className={S.tableRow}>
                        <td className={`${S.td} font-mono`}>{p.load_number}</td>
                        <td className={S.td}>{p.resolved.customer?.name || '—'}</td>
                        <td className={S.td}>
                          {p.legs.map((l, i) => {
                            const name = l.resolved?.driver?.raw || l.parsed.driver_raw
                            const driverId = l.resolved?.driver?.id
                            const internalId = driverId ? internalById.get(driverId) : null
                            return (
                              <div key={i} className="flex items-center gap-1 mb-1 last:mb-0">
                                {internalId && <span className="text-xs text-gray-500 dark:text-slate-400">{internalId} ·</span>}
                                <span>{name || '—'}</span>
                                {name && <CopyButton value={name} label="Copy driver name" />}
                              </div>
                            )
                          })}
                          {!p.legs.length && '—'}
                        </td>
                        <td className={S.td}>
                          {(p.header.review_reasons || []).map(rsn => (
                            <span key={rsn} className="inline-block mr-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">{rsn}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Updated — smart approval flow */}
          {classifiedLoads.length > 0 && (
            <Section title={`Updated (${classifiedLoads.length})`} subtitle="Smart approval: routine changes bulk-approved in one click; material changes grouped for review.">
              <div className="space-y-4">
                {/* Running count + global Approve all */}
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
                  <span>{approvedCount} of {classifiedLoads.length} approved</span>
                  <button onClick={approveAll} className={S.btnSecondary}>Approve all ({classifiedLoads.length})</button>
                </div>

                {/* Needs your review */}
                {reviewLoads.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Needs your review ({reviewLoads.length})</p>
                    {REVIEW_GROUPS.filter(g => reviewByReason[g.key].length > 0).map(g => (
                      <div key={g.key} className="space-y-2 pl-2 border-l-2 border-amber-300 dark:border-amber-500/30">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                            {g.label} ({reviewByReason[g.key].length})
                          </p>
                          <button onClick={() => approveGroup(g.key)} className={S.btnSecondary + ' text-xs'}>Approve group</button>
                        </div>
                        {reviewByReason[g.key].map(p => {
                          const skipped = decisionFor(p.load_number) === 'skipped'
                          const legDiffs = p.legs.flatMap(l => l.diffs.map(d => ({ ...d, leg_seq: l.leg_seq })))
                          return (
                            <div key={p.load_number} className={`rounded-lg border p-3 ${skipped ? 'border-gray-200 dark:border-white/5 opacity-60' : 'border-amber-200 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-500/[0.03]'}`}>
                              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-semibold text-gray-900 dark:text-slate-200 text-sm">{p.load_number}</span>
                                  {p.is_status_flag && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300">Canceled/TONU</span>}
                                  {p.header.is_team_load && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">team · {p.legs.length} legs</span>}
                                </div>
                                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
                                  <button onClick={() => setDecision(p.load_number, 'approved')} className={`px-2.5 py-1 ${!skipped ? 'bg-emerald-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>Approve</button>
                                  <button onClick={() => setDecision(p.load_number, 'skipped')} className={`px-2.5 py-1 ${skipped ? 'bg-gray-400 dark:bg-slate-600 text-white font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>Skip</button>
                                </div>
                              </div>
                              <ul className="space-y-1 text-xs">
                                {p.header_diffs.map((d, i) => <DiffRow key={`h${i}`} scope="header" d={d} highlight={p._reviewReason} />)}
                                {legDiffs.map((d, i) => <DiffRow key={`l${i}`} scope={`leg ${d.leg_seq}`} d={d} highlight={p._reviewReason} />)}
                              </ul>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {/* Routine (collapsed by default) */}
                {routineLoads.length > 0 && (
                  <div className="rounded-xl border border-gray-200 dark:border-white/10">
                    <button
                      onClick={() => setRoutineExpanded(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800 dark:text-slate-200">Routine ({routineLoads.length})</span>
                        <span className="text-xs text-gray-400 dark:text-slate-500">— status progressions & minor mileage, straight from TMS</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); approveAllRoutine() }}
                          className={S.btnSuccess + ' text-xs'}
                        >
                          Approve all routine
                        </button>
                        <span className="text-gray-400 dark:text-slate-500">{routineExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>
                    {routineExpanded && (
                      <div className="border-t border-gray-100 dark:border-white/[0.06] px-4 pb-4 space-y-2 pt-3">
                        {routineLoads.map(p => {
                          const skipped = decisionFor(p.load_number) === 'skipped'
                          const legDiffs = p.legs.flatMap(l => l.diffs.map(d => ({ ...d, leg_seq: l.leg_seq })))
                          return (
                            <div key={p.load_number} className={`rounded-lg border p-3 text-xs ${skipped ? 'border-gray-200 dark:border-white/5 opacity-60' : 'border-gray-200 dark:border-white/5 bg-gray-50/30 dark:bg-white/[0.02]'}`}>
                              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-semibold text-gray-900 dark:text-slate-200">{p.load_number}</span>
                                  {p.header.is_team_load && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">team · {p.legs.length} legs</span>}
                                </div>
                                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
                                  <button onClick={() => setDecision(p.load_number, 'approved')} className={`px-2.5 py-1 ${!skipped ? 'bg-emerald-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>Approve</button>
                                  <button onClick={() => setDecision(p.load_number, 'skipped')} className={`px-2.5 py-1 ${skipped ? 'bg-gray-400 dark:bg-slate-600 text-white font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>Skip</button>
                                </div>
                              </div>
                              <ul className="space-y-1 text-xs">
                                {p.header_diffs.map((d, i) => <DiffRow key={`h${i}`} scope="header" d={d} />)}
                                {legDiffs.map((d, i) => <DiffRow key={`l${i}`} scope={`leg ${d.leg_seq}`} d={d} />)}
                              </ul>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* New (collapsible) */}
          {newLoads.length > 0 && (
            <Section
              title={`New (${newLoads.length})`}
              subtitle="Brand-new loads — applied as-is."
              action={<button onClick={() => setShowNew(s => !s)} className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline">{showNew ? 'Hide' : 'Show'}</button>}
            >
              {showNew && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className={S.tableHead}><tr>
                      <th className={S.th}>Load #</th><th className={S.th}>Customer</th>
                      <th className={S.th}>Status</th><th className={`${S.th} text-right`}>Linehaul</th>
                      <th className={`${S.th} text-right`}>Legs</th>
                    </tr></thead>
                    <tbody>
                      {newLoads.map(p => (
                        <tr key={p.load_number} className={S.tableRow}>
                          <td className={`${S.td} font-mono`}>
                            {p.load_number}
                            {p.header?.needs_review && (
                              <span className="ml-1.5 text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" title={(p.header.review_reasons || []).join(', ')}>review</span>
                            )}
                          </td>
                          <td className={S.td}>{p.resolved.customer?.name || '—'}{p.resolved.customer?.match_status === 'to_create' && <span className="ml-1 text-[10px] text-cyan-600 dark:text-cyan-400">(new)</span>}</td>
                          <td className={S.td}>{p.header.status || '—'}</td>
                          <td className={`${S.td} text-right font-mono`}>{p.header.linehaul == null ? '—' : `$${Number(p.header.linehaul).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}</td>
                          <td className={`${S.td} text-right`}>{p.legs.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {unchangedCount > 0 && (
            <p className="text-xs text-gray-400 dark:text-slate-500">{unchangedCount} unchanged load{unchangedCount === 1 ? '' : 's'} — skipped on apply (no writes).</p>
          )}

          {/* Apply progress — determinate bar + counter + phase caption.
              Advances per batch (React repaints between awaited writes). */}
          {progress && !applyError && (() => {
            const { phase, done, total } = progress
            const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0
            return (
              <div className={`${S.card} p-4 space-y-2`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-slate-300">{phase}…</span>
                  <span className="font-mono text-gray-600 dark:text-slate-400">{done.toLocaleString()} / {total.toLocaleString()}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                  <div className="h-full bg-orange-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })()}

          {/* Mid-apply failure — show how far it got + Retry (safe to re-run). */}
          {applyError && (
            <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/[0.06] px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between flex-wrap gap-2">
              <span>Apply interrupted at <span className="font-mono font-semibold">{applyError.done.toLocaleString()} of {applyError.total.toLocaleString()}</span>. It's safe to retry — already-applied rows are skipped.</span>
              <span className="flex items-center gap-2">
                <button onClick={onDiscard} disabled={busy} className={S.btnCancel}>Discard batch</button>
                <button onClick={onApply} disabled={busy} className={S.btnSave}>{busy ? 'Retrying…' : 'Retry'}</button>
              </span>
            </div>
          )}

          {/* Actions */}
          {canEdit && !progress && !applyError && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={onDiscard} disabled={busy} className={S.btnCancel}>Discard batch</button>
              <button onClick={onApply} disabled={busy} className={S.btnSave}>{busy ? 'Applying…' : 'Apply approved'}</button>
            </div>
          )}
        </>
      )}

      {/* Post-apply success summary — durable so a user who navigated away
          mid-apply still sees the outcome on return. Dismissible. */}
      {applySummary && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-start justify-between gap-3">
          <span>
            ✓ Import applied{applySummary.filename ? ` — ${applySummary.filename}` : ''}:{' '}
            <span className="font-semibold">{applySummary.loads.toLocaleString()} load{applySummary.loads === 1 ? '' : 's'}, {applySummary.legs.toLocaleString()} leg{applySummary.legs === 1 ? '' : 's'}</span>
            {(applySummary.customers > 0 || applySummary.dispatchers > 0) && `, ${applySummary.customers} customer${applySummary.customers === 1 ? '' : 's'}, ${applySummary.dispatchers} dispatcher${applySummary.dispatchers === 1 ? '' : 's'}`}.
            {applySummary.cancelTonu > 0 && ` ${applySummary.cancelTonu} Canceled/TONU.`}
          </span>
          <button onClick={() => setApplySummary(null)} className="text-emerald-600 dark:text-emerald-400 hover:opacity-70 shrink-0" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Recent imports — durable history; renders in every state. */}
      {!loading && <RecentImports recent={recent} />}
    </div>
  )
}

// ── Recent imports history ────────────────────────────────────────────────
const CHICAGO = { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
function fmtChicago(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString('en-US', CHICAGO) } catch { return '—' }
}
const STATUS_BADGE = {
  applied:        { label: 'Applied',        cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
  pending_review: { label: 'Pending review', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
  discarded:      { label: 'Discarded',      cls: 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-600/40' },
}

const RECENT_FILTERS = [
  { key: 'applied', label: 'Applied' },
  { key: 'discarded', label: 'Discarded' },
]

function RecentImports({ recent }) {
  const [openId, setOpenId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('applied')
  const num = (c, k) => Number(c?.[k] ?? 0)
  const counts = useMemo(() => ({
    applied: recent.filter(b => b.status === 'applied').length,
    discarded: recent.filter(b => b.status !== 'applied').length,
  }), [recent])
  const filtered = useMemo(
    () => recent.filter(b => (statusFilter === 'applied' ? b.status === 'applied' : b.status !== 'applied')),
    [recent, statusFilter]
  )
  return (
    <div className={`${S.card} p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent imports</h2>
        <div className="flex items-center gap-2">
          {RECENT_FILTERS.map(f => {
            const active = statusFilter === f.key
            return (
              <button
                key={f.key}
                onClick={() => { setStatusFilter(f.key); setOpenId(null) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  active
                    ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                    : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                }`}
              >
                {f.label} <span className="ml-1 opacity-70">{counts[f.key] ?? 0}</span>
              </button>
            )
          })}
        </div>
      </div>
      {recent.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500">No imports yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500">No {statusFilter} imports.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/5">
          {filtered.map(b => {
            const badge = STATUS_BADGE[b.status] || STATUS_BADGE.discarded
            const c = b.counts || {}
            const open = openId === b.id
            const failed = c.failed
            return (
              <div key={b.id} className="py-2.5">
                <button onClick={() => setOpenId(open ? null : b.id)} className="w-full flex items-center justify-between gap-3 text-left">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">{b.filename || '(unnamed file)'}</span>
                    <span className="text-[11px] text-gray-400 dark:text-slate-500">{b.total_rows} rows</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-slate-400 shrink-0">
                    <span className="hidden sm:inline">New {num(c, 'new')} · Updated {num(c, 'updated')} · Unmatched {num(c, 'unmatched')}{num(c, 'status_flags') > 0 ? ` · ${num(c, 'status_flags')} Canc/TONU` : ''}</span>
                    <span>{b.status === 'applied' ? fmtChicago(b.applied_at) : fmtChicago(b.uploaded_at)}</span>
                    <span className="text-gray-400">{open ? '▾' : '▸'}</span>
                  </div>
                </button>
                {open && (
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px] text-gray-600 dark:text-slate-400 pl-1">
                    <Detail label="New" v={num(c, 'new')} />
                    <Detail label="Updated" v={num(c, 'updated')} />
                    <Detail label="Unchanged" v={num(c, 'unchanged')} />
                    <Detail label="New legs" v={num(c, 'new_legs')} />
                    <Detail label="Unmatched" v={num(c, 'unmatched')} />
                    <Detail label="New customers" v={num(c, 'new_customers')} />
                    <Detail label="New dispatchers" v={num(c, 'new_dispatchers')} />
                    <Detail label="Canceled/TONU" v={num(c, 'status_flags')} />
                    <Detail label="Uploaded" v={fmtChicago(b.uploaded_at)} />
                    {b.status === 'applied' && <Detail label="Applied" v={fmtChicago(b.applied_at)} />}
                    {b.status === 'applied' && <Detail label="Applied loads" v={num(c, 'applied_loads')} />}
                    <Detail label="Failed" v={failed == null ? '—' : Number(failed)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Detail({ label, v }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-400 dark:text-slate-500">{label}</span>
      <span className="font-mono text-gray-700 dark:text-slate-300">{typeof v === 'number' ? v.toLocaleString() : v}</span>
    </div>
  )
}

function Stat({ label, value, tone }) {
  const toneText = {
    emerald: 'text-emerald-700 dark:text-emerald-400', amber: 'text-amber-700 dark:text-amber-400',
    cyan: 'text-cyan-700 dark:text-cyan-400', red: 'text-red-700 dark:text-red-400',
    slate: 'text-gray-900 dark:text-slate-200',
  }[tone] || 'text-gray-900 dark:text-slate-200'
  return (
    <div className={`${S.card} p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-mono font-medium ${toneText}`}>{value}</p>
    </div>
  )
}

function Section({ title, subtitle, action, children }) {
  return (
    <div className={`${S.card} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function DiffRow({ scope, d, highlight }) {
  const isStatusFlip = d.field === 'status'
  const isHighlighted = highlight && isHighlightedField(d.field, highlight)
  return (
    <li className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500 w-14">{scope}</span>
      <span className="text-gray-500 dark:text-slate-400">{fieldLabel(d.field)}:</span>
      <span className="font-mono text-gray-400 dark:text-slate-500 line-through">{fmtVal(d.old)}</span>
      <span className="text-gray-400">→</span>
      <span className={`font-mono ${isHighlighted
        ? 'font-bold text-amber-700 dark:text-amber-400'
        : isStatusFlip ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-900 dark:text-slate-200'}`}>{fmtVal(d.new)}</span>
    </li>
  )
}
