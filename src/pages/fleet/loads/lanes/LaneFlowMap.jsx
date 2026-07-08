import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '../../../../contexts/ToastContext'
import { useAuth } from '../../../../contexts/AuthContext'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import LoadsFreshness from '../../../../components/LoadsFreshness'
import CopyButton from '../../../../components/CopyButton'
import LaneHeatCanvas from './LaneHeatCanvas'
import LaneMapCanvas from './LaneMapCanvas'
import GeoHeatMap from './GeoHeatMap'
import TopPerformers from './TopPerformers'
import TrailerTypeTrends from './TrailerTypeTrends'
import { aggregateLanes, EXCLUDED_STATUSES, fetchLaneLegs, makeRpmScale, makeTypeColorMap, makeWidthScale, pickAllLoadMetrics, resolveLegTypes, RPM_NULL_COLOR, UNKNOWN_TYPE } from './laneData'
import { binHeatCells } from './mapShared'
import { fmtMoney, fmtNum, fmtRpm, formatRange, shiftYmd, spanDays, thisMonth, thisWeek } from '../spotlight/spotlightShared'

// Lane Flow Map — where the money moves, geographically. Every leg in the
// window draws as an origin → destination arc: thickness = volume on that
// lane, color = $/mile (rose → amber → emerald). Additive showcase route;
// the existing Profitability page, calendar, and Spotlight are untouched.

const PRESET_LABEL = { week: 'This week', month: 'This month', custom: 'Custom' }
const LEADERBOARD_SORTS = [
  { key: 'revenue', label: 'Revenue', fn: (a, b) => b.revenue - a.revenue },
  { key: 'rpm', label: '$/mile', fn: (a, b) => (b.rpm ?? -1) - (a.rpm ?? -1) },
  { key: 'loads', label: 'Loads', fn: (a, b) => b.loads - a.loads || b.revenue - a.revenue },
]
// Sort-value accessor per leaderboard column (for the clickable header sort).
const LEADERBOARD_COL_VAL = {
  loads: l => l.loads,
  revenue: l => l.revenue,
  rpm: l => l.rpm,
  avgMiles: l => l.avgMiles,
}

// Deadhead (empty-miles) warning thresholds — flag a lane running a high empty
// share, but only once the absolute empty miles matter (skip tiny lanes).
const DEADHEAD_PCT_WARN = 0.25 // ≥ 25% of miles empty
const DEADHEAD_MIN_MI = 150    // and at least this many empty miles
function deadheadFlagged(lane) {
  return lane?.deadheadPct != null && lane.deadheadPct >= DEADHEAD_PCT_WARN && (lane.realEmptyMiles || 0) >= DEADHEAD_MIN_MI
}

// Amber ⚠ shown on deadhead-heavy leaderboard lanes; hover/focus reveals the
// empty-miles breakdown. Informational — a flagged lane can be legitimate.
// Renders nothing below threshold (keeps the table clean). TONU already excluded
// upstream (deadhead sums use the lane's real miles).
function DeadheadIcon({ lane }) {
  if (!deadheadFlagged(lane)) return null
  const empty = Math.round(lane.realEmptyMiles || 0)
  const loaded = Math.round(lane.realLoadedMiles || 0)
  const pct = Math.round((lane.deadheadPct || 0) * 100)
  const label = `Deadhead: ${empty.toLocaleString()} empty mi · ${pct}% of total (${loaded.toLocaleString()} loaded + ${empty.toLocaleString()} empty)`
  return (
    <button type="button" aria-label={label} title={label} onClick={e => e.stopPropagation()}
      className="ml-1 inline-flex align-middle text-amber-500 dark:text-amber-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/60 rounded">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinejoin="round" /><path d="M12 9v4M12 17h.01" strokeLinecap="round" /></svg>
    </button>
  )
}

// Clickable, sortable column header with an active-sort arrow.
function SortTh({ label, colKey, sortKey, sortDir, onSort, className }) {
  const active = sortKey === colKey
  return (
    <th className={`${className} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`} onClick={() => onSort(colKey)} title="Click to sort">
      <span className="inline-flex items-center gap-0.5 justify-end">{label}{active && <span className="text-orange-500">{sortDir === 'desc' ? '▾' : '▴'}</span>}</span>
    </th>
  )
}

// options: [key, label, disabled?] — disabled keeps the pill visible so the
// toolbar has the same shape in every view; it just can't be picked here.
function Pills({ value, onChange, options, title }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0" title={title}>
      {options.map(([k, lbl, disabled]) => (
        <button key={k} disabled={disabled} onClick={() => onChange(k)}
          className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${disabled ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed' : value === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
          {lbl}
        </button>
      ))}
    </div>
  )
}

function TypeBadge({ type, color }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-gray-200 dark:border-white/10 text-[10px] font-medium text-gray-600 dark:text-slate-300 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {type}
    </span>
  )
}

// One load-leg line item — shared by the "Loads on this lane" card (arc
// click) and the "Loads in this area" card (heat-spot click).
function LegRow({ leg, dateCol, rpmScale, showLane, showPhase, canEdit, onMilesSaved }) {
  const legRpm = leg.leg_total_miles > 0 ? leg.leg_revenue / leg.leg_total_miles : null
  const phaseLabels = { booked: 'Booked', in_transit: 'In transit', delivered: 'Delivered' }
  return (
    <li className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
      <div className="min-w-0">
        <p className="font-medium text-gray-900 dark:text-slate-200 truncate inline-flex items-center gap-0.5">
          #{leg.load_number || leg.load_id}
          {leg.load_number && <CopyButton value={String(leg.load_number).trim()} label="Copy load number" />}
          {showPhase && leg.load_phase && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
            leg.load_phase === 'booked' ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400' :
            leg.load_phase === 'in_transit' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' :
            'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}>{phaseLabels[leg.load_phase]}</span>}
        </p>
        {showLane && <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">{leg.origin} → {leg.destination}</p>}
        <p className="text-gray-400 dark:text-slate-500 truncate">{leg[dateCol] || '—'} · {leg.customer_name || '—'}</p>
        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Dispatcher: {leg.dispatcher_name || '—'}</p>
        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">Driver: {leg.driver_display || '—'}</p>
        <p className="text-gray-400 dark:text-slate-500 truncate text-[11px]">
          Trailer: {leg.effective_trailer_unit || leg.trailer_display || '—'} · {leg.effective_trailer_type || UNKNOWN_TYPE}
          {leg.trailer_inferred && <span className="ml-1 text-gray-300 dark:text-slate-600 italic">(inferred)</span>}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono text-gray-900 dark:text-slate-200">{fmtMoney(leg.leg_revenue)}</p>
        <p className="font-mono text-[11px]" style={{ color: rpmScale ? rpmScale.color(legRpm) : undefined }}>
          {legRpm != null ? `${fmtRpm(legRpm)}/mi` : '—'}
        </p>
        <p className="font-mono text-gray-400 dark:text-slate-500 inline-flex items-center gap-1 justify-end">
          {fmtNum(leg.leg_total_miles)} mi
          <MilesEditor legId={leg.leg_id} loaded={leg.leg_loaded_miles} empty={leg.leg_empty_miles} total={leg.leg_total_miles} canEdit={canEdit} onSaved={onMilesSaved} />
        </p>
      </div>
    </li>
  )
}

// Inline miles editor — a pencil + non-blocking popover to correct a leg's
// total miles (override flows through leg_total_miles → $/mi, avg mi, cards,
// leaderboard on refetch). Renders nothing without canEdit or a leg_id (e.g. a
// multi-leg load, which the single-leg override can't cleanly target).
function MilesEditor({ legId, loaded, empty, total, canEdit, onSaved }) {
  const toast = useToast()
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null) // fixed anchor → escapes scroll-container clipping
  const [miles, setMiles] = useState('')
  const [note, setNote] = useState('')
  const [hasOverride, setHasOverride] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = pos !== null
  if (!canEdit || !legId) return null

  function close() { setPos(null); setBusy(false) }
  async function openEditor() {
    const r = btnRef.current?.getBoundingClientRect()
    setPos(r ? { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 236) } : { top: 80, left: 80 })
    setNote(''); setMiles(''); setHasOverride(false) // blank input; current total shown as placeholder
    // Fetch the override state so "Clear override" only shows when one exists.
    const { data } = await supabase.from('load_legs').select('total_miles_override, miles_override_note').eq('id', legId).maybeSingle()
    if (data?.total_miles_override != null) setHasOverride(true)
    if (data?.miles_override_note) setNote(data.miles_override_note)
  }
  const validMiles = miles.trim() !== '' && Number.isFinite(Number(miles)) && Number(miles) > 0
  async function save() {
    if (!validMiles) return // guard against blank / 0 / negative no-op overrides
    const v = Number(miles)
    setBusy(true)
    const { error } = await supabase.rpc('set_load_leg_miles', { p_leg_id: legId, p_miles: v, p_note: note.trim() || null })
    setBusy(false)
    if (error) { toast.error("Couldn't save miles", error); return }
    close(); onSaved?.()
  }
  async function clearOverride() {
    setBusy(true)
    const { error } = await supabase.rpc('clear_load_leg_miles', { p_leg_id: legId })
    setBusy(false)
    if (error) { toast.error("Couldn't clear override", error); return }
    close(); onSaved?.()
  }

  return (
    <span className="inline-flex align-middle" onClick={e => e.stopPropagation()}>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : openEditor())} title="Edit miles" aria-label="Edit miles"
        className="p-0.5 text-gray-300 dark:text-slate-600 hover:text-orange-500 dark:hover:text-orange-400 transition-colors">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M12 20h9" strokeLinecap="round" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => !busy && close()} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left }} className="z-50 w-56 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg p-3 text-left">
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
              Total {fmtNum(total)} · loaded {fmtNum(loaded)} · empty {fmtNum(empty)} mi
            </p>
            <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-400 dark:text-slate-500 mb-1">Corrected total miles</label>
            <input type="number" min="0" step="0.01" value={miles} onChange={e => setMiles(e.target.value)}
              placeholder={total != null ? String(total) : 'miles'}
              className="w-full text-xs rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-[#0d0d1f] px-2 py-1 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            {loaded != null && Number(loaded) > 0 && (
              <button type="button" onClick={() => setMiles(String(loaded))} className="mt-1.5 text-[11px] text-orange-600 dark:text-orange-400 hover:underline">Use loaded miles ({fmtNum(loaded)})</button>
            )}
            {miles.trim() !== '' && !validMiles && <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">Enter miles greater than 0</p>}
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="note (optional)"
              className="w-full mt-2 text-[11px] rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-[#0d0d1f] px-2 py-1 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
            <div className="flex items-center gap-2 mt-2.5">
              <button disabled={busy || !validMiles} onClick={save} className="text-[11px] px-2 py-1 rounded-md bg-orange-500 text-white font-medium hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed">{busy ? '…' : 'Save'}</button>
              {hasOverride && <button disabled={busy} onClick={clearOverride} className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">Clear override</button>}
              <button disabled={busy} onClick={close} className="text-[11px] px-2 py-1 rounded-md text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 ml-auto">Cancel</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </span>
  )
}

function ReasonBadge({ reason }) {
  const map = {
    missing: { label: 'No miles', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
    inflated: { label: 'Deadhead?', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
  }
  const m = map[reason] || { label: reason || '—', cls: 'bg-gray-100 text-gray-600 dark:bg-slate-700/40 dark:text-slate-300' }
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${m.cls}`}>{m.label}</span>
}

// Calendar day of a timestamptz in America/Chicago, e.g. "Jul 8".
function fmtReviewedAt(ts) {
  if (!ts) return '—'
  try { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(ts)) } catch { return '—' }
}

// "Mark reviewed" (✓) — accept a load's miles as correct and stop flagging it,
// WITHOUT changing the miles (distinct from the pencil edit). Non-blocking
// confirm, portal-anchored so a scroll container can't clip it.
function MarkReviewedButton({ legId, loadNumber, onDone }) {
  const toast = useToast()
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [busy, setBusy] = useState(false)
  const open = pos !== null
  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect()
    setPos(r ? { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 236) } : { top: 80, left: 80 })
  }
  function close() { setPos(null); setBusy(false) }
  async function confirm() {
    setBusy(true)
    const { error } = await supabase.rpc('dismiss_miles_review', { p_leg_id: legId, p_note: null })
    setBusy(false)
    if (error) { toast.error("Couldn't mark reviewed", error); return }
    close(); onDone?.()
  }
  return (
    <span className="inline-flex align-middle" onClick={e => e.stopPropagation()}>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : openMenu())} title="Mark miles reviewed — accept as-is" aria-label="Mark miles reviewed"
        className="p-0.5 text-gray-300 dark:text-slate-600 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => !busy && close()} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left }} className="z-50 w-60 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg p-3 text-left">
            <p className="text-[11px] text-gray-600 dark:text-slate-300">
              Mark <span className="font-mono font-semibold">{loadNumber}</span> miles as reviewed? It&apos;ll drop off unless the miles change on a future import.
            </p>
            <div className="flex items-center gap-2 mt-2.5 justify-end">
              <button disabled={busy} onClick={close} className="text-[11px] px-2 py-1 rounded-md text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">Cancel</button>
              <button disabled={busy} onClick={confirm} className="text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white font-medium hover:brightness-105 disabled:opacity-50">{busy ? '…' : 'Mark reviewed'}</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </span>
  )
}

// Undo a "mark reviewed" — safe/reversible, so no confirm.
function RestoreReviewButton({ legId, onDone }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function restore() {
    setBusy(true)
    const { error } = await supabase.rpc('restore_miles_review', { p_leg_id: legId })
    setBusy(false)
    if (error) { toast.error("Couldn't restore", error); return }
    onDone?.()
  }
  return (
    <button disabled={busy} onClick={restore} className="ml-auto text-[11px] font-medium px-2 py-0.5 rounded-md border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
      {busy ? '…' : 'Restore'}
    </button>
  )
}

// Pinned "needs miles review" banner — real (non-TONU) loads with no RPM or
// inflated deadhead for the current period, biggest revenue first (RPC order).
// Each row can be fixed (pencil) or accepted as-is (✓ Mark reviewed). Reviewed
// loads live in a collapsed subsection with Restore. Self-clears as loads are
// overridden/reviewed; a reviewed load re-surfaces if its miles later change.
// Refetches on period change, after any miles edit (reloadKey), and after a
// mark/restore (local tick).
function MilesReviewBanner({ from, to, reloadKey, canEdit, onSaved }) {
  const [rows, setRows] = useState(null)
  const [dismissed, setDismissed] = useState([])
  const [open, setOpen] = useState(false)
  const [showReviewed, setShowReviewed] = useState(false)
  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let stale = false
    Promise.all([
      supabase.rpc('loads_needing_miles_review', { p_start: from, p_end: to }),
      supabase.rpc('miles_review_dismissed', { p_start: from, p_end: to }),
    ]).then(([act, dis]) => {
      if (stale) return
      setRows(act.error ? [] : (act.data || []))
      setDismissed(dis.error ? [] : (dis.data || []))
    }).catch(() => { if (!stale) { setRows([]); setDismissed([]) } })
    return () => { stale = true }
  }, [from, to, reloadKey, tick])

  const count = rows?.length || 0
  // Show while there's anything to act on — active OR reviewed (so Reviewed
  // stays reachable for Restore even once every active row is cleared).
  if (!rows || (count === 0 && dismissed.length === 0)) return null

  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/[0.08] overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left">
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">⚠ Miles review ({count})</span>
        <span className="text-[11px] text-amber-700/80 dark:text-amber-300/70 inline-flex items-center gap-1">
          {open ? 'Hide' : 'Real loads with missing or inflated miles — fix or accept'} <span>{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-amber-200/60 dark:border-amber-500/20">
          {count === 0 ? (
            <p className="px-4 py-2 text-xs text-amber-700/80 dark:text-amber-300/70">No loads need review right now.</p>
          ) : (
            <div className="divide-y divide-amber-200/60 dark:divide-amber-500/20 max-h-[320px] overflow-y-auto">
              {rows.map(r => (
                <div key={r.leg_id} className="px-4 py-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-xs">
                  <span className="font-medium text-gray-900 dark:text-slate-200">{r.origin} → {r.destination}</span>
                  <span className="inline-flex items-center gap-0.5">
                    <span className="font-mono text-gray-500 dark:text-slate-400">#{r.load_number}</span>
                    {r.load_number && <CopyButton value={String(r.load_number).trim()} label="Copy load number" />}
                  </span>
                  <span className="text-gray-500 dark:text-slate-400">· {r.customer || '—'}</span>
                  <span className="text-gray-500 dark:text-slate-400">· {r.driver_name || '—'}</span>
                  <span className="font-mono text-gray-700 dark:text-slate-300">· {fmtMoney(r.revenue)}</span>
                  <ReasonBadge reason={r.reason} />
                  <span className="ml-auto inline-flex items-center gap-1">
                    <MilesEditor legId={r.leg_id} loaded={r.loaded_miles} empty={r.empty_miles} total={r.total_miles} canEdit={canEdit} onSaved={onSaved} />
                    {canEdit && <MarkReviewedButton legId={r.leg_id} loadNumber={r.load_number} onDone={refetch} />}
                  </span>
                </div>
              ))}
            </div>
          )}

          {dismissed.length > 0 && (
            <div className="border-t border-amber-200/60 dark:border-amber-500/20 px-4 py-2">
              <button onClick={() => setShowReviewed(s => !s)} className="text-xs font-semibold text-amber-700/90 dark:text-amber-300/80 hover:text-amber-900 dark:hover:text-amber-200 inline-flex items-center gap-1">
                <span className="w-3">{showReviewed ? '▾' : '▸'}</span> Reviewed ({dismissed.length})
              </button>
              {showReviewed && (
                <div className="mt-2 divide-y divide-amber-200/50 dark:divide-amber-500/15 max-h-[240px] overflow-y-auto">
                  {dismissed.map(d => (
                    <div key={d.leg_id} className="py-1.5 flex items-center gap-x-2 gap-y-1 flex-wrap text-xs">
                      <span className="font-medium text-gray-800 dark:text-slate-300">{d.origin} → {d.destination}</span>
                      <span className="inline-flex items-center gap-0.5">
                        <span className="font-mono text-gray-500 dark:text-slate-400">#{d.load_number}</span>
                        {d.load_number && <CopyButton value={String(d.load_number).trim()} label="Copy load number" />}
                      </span>
                      <span className="font-mono text-gray-600 dark:text-slate-400">· {fmtMoney(d.revenue)}</span>
                      <span className="text-gray-400 dark:text-slate-500">· reviewed {fmtReviewedAt(d.dismissed_at)}</span>
                      {d.note && <span className="text-gray-400 dark:text-slate-500 truncate">· {d.note}</span>}
                      {canEdit && <RestoreReviewButton legId={d.leg_id} onDone={refetch} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub }) {
  return (
    <div className={`${S.card} px-4 py-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white font-mono leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 dark:text-slate-500">{sub}</p>}
    </div>
  )
}

// ── Worst-load card advisory notes ──────────────────────────────────────────
// Strictly additive — never hide or change the displayed value/lane.

// Realistic revenue floor: a sub-$500 same-city load is almost certainly a TONU.
const TONU_FLOOR = 500
const sameCity = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

const TONU_TRIANGLE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
  </svg>
)
const TONU_PILL_CLS = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-300'

// Amber "Possible TONU" pill on the worst-by-revenue card. Shown only when the
// displayed load is UNREVIEWED (is_tonu == null) and matches the heuristic
// (sub-$500 same-city). For managers it's a one-tap action → Confirm/Not popover
// → set_load_tonu → refetch so the card re-ranks. Non-managers see the static
// pill. The displayed value is never hidden or altered.
function WorstRevenueNote({ load, canEdit, onReviewed }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!load || load.is_tonu != null || !(Number(load.revenue) < TONU_FLOOR && sameCity(load.origin, load.destination))) return null

  async function review(isTonu) {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('set_load_tonu', { p_load_number: load.load_number, p_is_tonu: isTonu })
      if (!error) { setOpen(false); onReviewed?.() }
    } catch { /* fail-safe: leave the pill as-is */ } finally { setBusy(false) }
  }

  if (!canEdit) {
    return (
      <div className="mt-2">
        <span title="Below the $500 realistic floor · same-city pickup & drop" className={TONU_PILL_CLS}>{TONU_TRIANGLE} Possible TONU</span>
      </div>
    )
  }
  return (
    <div className="mt-2 relative">
      <button type="button" onClick={() => setOpen(o => !o)} title="Below the $500 realistic floor · same-city pickup & drop — tap to review" className={`${TONU_PILL_CLS} cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/50`}>
        {TONU_TRIANGLE} Possible TONU
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg p-1.5 flex flex-col gap-1 min-w-[140px]">
          <button disabled={busy} onClick={() => review(true)} className="text-left text-xs px-2 py-1 rounded-md font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 disabled:opacity-50">Confirm TONU</button>
          <button disabled={busy} onClick={() => review(false)} className="text-left text-xs px-2 py-1 rounded-md font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">Not a TONU</button>
        </div>
      )}
    </div>
  )
}

// "+N TONU excluded" muted footnote on the best/worst cards (N = confirmed
// TONUs in the current scope). Tap → popover listing them. Renders nothing at 0.
function ExcludedTonuFootnote({ tonuLoads }) {
  const [open, setOpen] = useState(false)
  const n = tonuLoads?.length || 0
  if (n === 0) return null
  return (
    <div className="mt-1 relative">
      <button type="button" onClick={() => setOpen(o => !o)} className="text-[10px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 underline decoration-dotted">
        +{n} TONU excluded
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg p-2 min-w-[160px] max-h-48 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1">Confirmed TONUs ({n})</p>
          <ul className="space-y-0.5">
            {tonuLoads.map(l => (
              <li key={l.load_id} className="text-[11px] text-gray-600 dark:text-slate-300 flex justify-between gap-2">
                <span className="font-mono">#{l.load_number}</span>
                <span className="text-gray-400 dark:text-slate-500">{fmtMoney(l.revenue)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// "Worst load · by $/mi" → blue combined-load note. One RPC scoped to the
// single worst load_number, memoized on it (re-fires only when it changes).
// Fail-safe: any error / empty / 'none' renders nothing.
function WorstRpmCombineNote({ loadNumber }) {
  const [info, setInfo] = useState(null)
  // Rendered with key={loadNumber} so the component remounts when the worst
  // load changes — state resets without a synchronous in-effect reset.
  useEffect(() => {
    if (!loadNumber) return
    let stale = false
    supabase.rpc('worst_load_combine_flag', { p_load_number: loadNumber })
      .then(({ data, error }) => {
        if (stale) return
        const row = !error && Array.isArray(data) && data.length ? data[0] : null
        setInfo(row && (row.combine_state === 'candidate' || row.combine_state === 'tagged') ? row : null)
      })
      .catch(() => { if (!stale) setInfo(null) })
    return () => { stale = true }
  }, [loadNumber])

  if (!info) return null
  const tagged = info.combine_state === 'tagged'
  const partners = String(info.partner_load || '').split(', ').filter(Boolean).map(n => `#${n}`).join(', ')
  const rpm = info.combined_rpm == null ? null : `$${Number(info.combined_rpm).toFixed(2)}/mi`
  const tooltip = `${tagged ? 'Grouped' : 'Candidate'} w/ ${partners || '—'}${rpm ? ` · combined ≈ ${rpm}` : ''}`
  return (
    <div className="mt-2">
      <span
        title={tooltip}
        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-900/60 dark:text-blue-300"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v6a5 5 0 0 0 5 5h5m0 0-3-3m3 3-3 3" />
        </svg>
        {tagged ? 'Combined load' : 'Possible combine'}
      </span>
    </div>
  )
}

export default function LaneFlowMap() {
  const toast = useToast()
  const { canEdit } = useAuth() // admin/manager — gates TONU review actions
  // Bumped after a TONU confirm/undo so the lane data refetches and re-ranks.
  const [reloadKey, setReloadKey] = useState(0)
  const reloadLanes = useCallback(() => setReloadKey(k => k + 1), [])
  const [preset, setPreset] = useState('week')
  const [range, setRange] = useState(thisWeek)
  const [basis, setBasis] = useState('delivery')
  const [selectedPhases, setSelectedPhases] = useState(new Set(['in_transit', 'delivered'])) // booked | in_transit | delivered
  const [weight, setWeight] = useState('revenue') // intensity: revenue | loads | rpm (rpm is heat-only)
  const [colorBy, setColorBy] = useState('rpm') // arc color: rpm | type
  const [mapMode, setMapMode] = useState('heat') // lanes (arcs) | heat (density)
  function switchMapMode(m) {
    setMapMode(m)
    // $/mile is an average — meaningful as heat intensity, not as arc
    // thickness, so leaving Heat falls back to revenue weighting.
    if (m === 'lanes' && weight === 'rpm') setWeight('revenue')
  }
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')
  // Pills pick a metric (always descending); column headers toggle asc/desc.
  const setSortFromPills = useCallback((key) => { setSortKey(key); setSortDir('desc') }, [])
  const toggleColSort = useCallback((key) => {
    setSortKey(prevKey => {
      if (prevKey === key) { setSortDir(d => (d === 'desc' ? 'asc' : 'desc')); return key }
      setSortDir('desc'); return key
    })
  }, [])
  const [dispatcherSearchOpen, setDispatcherSearchOpen] = useState(false)
  const [dispatcherSearchQuery, setDispatcherSearchQuery] = useState('')
  const dispatcherInputRef = useRef(null)

  // Fetched legs are stored with the period key they belong to, so a
  // period/basis change invalidates them by derivation (Spotlight pattern).
  const dataKey = `${range.from}|${range.to}|${basis}`
  const [legState, setLegState] = useState({ key: null, legs: null })

  // Dispatcher filter is keyed to the data window like the selection below —
  // changing period/basis resets it by derivation, no reset effect needed.
  const [dispFilterState, setDispFilterState] = useState({ key: null, id: null })
  const dispatcherFilter = dispFilterState.key === dataKey ? dispFilterState.id : null
  const setDispatcherFilter = useCallback((id) => setDispFilterState({ key: dataKey, id }), [dataKey])

  const clearDispatcherFilter = useCallback((reopen) => {
    setDispatcherFilter(null)
    setDispatcherSearchQuery('')
    setDispatcherSearchOpen(!!reopen)
    if (reopen) dispatcherInputRef.current?.focus()
  }, [setDispatcherFilter])
  useEffect(() => {
    let stale = false
    // Trailer type comes from v_lane_geo.effective_trailer_type (linked or
    // inferred from the assignment window) — resolved in the query, not a join.
    fetchLaneLegs({ from: range.from, to: range.to, basis })
      .then(legs => { if (!stale) setLegState({ key: dataKey, legs }) })
      .catch(err => {
        if (!stale) {
          toast.error("Couldn't load lane data", err)
          setLegState({ key: dataKey, legs: [] })
        }
      })
    return () => { stale = true }
  }, [dataKey, range.from, range.to, basis, toast, reloadKey])
  const loading = legState.key !== dataKey

  const typedLegs = useMemo(
    () => (legState.legs ? resolveLegTypes(legState.legs) : null),
    [legState],
  )

  // Type list is derived from the data so new trailer types appear on their
  // own; Unknown sorts last when present.
  const typeOptions = useMemo(() => {
    if (!typedLegs) return []
    const set = new Set(typedLegs.map(l => l.trailer_type))
    const known = [...set].filter(t => t !== UNKNOWN_TYPE).sort((a, b) => a.localeCompare(b))
    return set.has(UNKNOWN_TYPE) ? [...known, UNKNOWN_TYPE] : known
  }, [typedLegs])

  const typeColorMap = useMemo(() => makeTypeColorMap(typeOptions), [typeOptions])
  const typeColorFor = useCallback((t) => typeColorMap.get(t) || RPM_NULL_COLOR, [typeColorMap])

  // Trailer-type filter, window-keyed like the dispatcher filter.
  // null = all types, otherwise the array of types kept.
  const [typeFilterState, setTypeFilterState] = useState({ key: null, sel: null })
  const typeFilter = typeFilterState.key === dataKey ? typeFilterState.sel : null
  function toggleType(t) {
    // Functional update so rapid clicks can't act on a stale selection.
    setTypeFilterState(s => {
      const cur = s.key === dataKey ? s.sel : null
      let next
      if (!cur) next = [t] // from "all", the first click isolates that type
      else if (cur.includes(t)) next = cur.filter(x => x !== t)
      else next = [...cur, t]
      if (!next.length || next.length >= typeOptions.length) next = null
      return { key: dataKey, sel: next }
    })
  }

  const dispatchers = useMemo(() => {
    if (!legState.legs) return []
    const seen = new Map()
    for (const l of legState.legs) {
      if (l.dispatcher_id && !seen.has(l.dispatcher_id))
        seen.set(l.dispatcher_id, l.dispatcher_name || String(l.dispatcher_id))
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [legState.legs])

  const filteredDispatchers = useMemo(() => {
    const q = dispatcherSearchQuery.trim().toLowerCase()
    return dispatchers.filter(d => d.name.toLowerCase().includes(q))
  }, [dispatchers, dispatcherSearchQuery])

  const filteredLegs = useMemo(() => {
    if (!typedLegs) return typedLegs
    let legs = typedLegs
    if (dispatcherFilter) legs = legs.filter(l => l.dispatcher_id === dispatcherFilter)
    if (typeFilter) legs = legs.filter(l => typeFilter.includes(l.trailer_type))
    return legs
  }, [typedLegs, dispatcherFilter, typeFilter])

  // Lanes split per trailer type so every $/mi row is type-pure — a mixed
  // corridor becomes one row per type, never a blended rate.
  const agg = useMemo(
    () => (loading ? null : aggregateLanes(filteredLegs, [...selectedPhases], { byType: true })),
    [loading, filteredLegs, selectedPhases],
  )
  const rpmScale = useMemo(() => (agg ? makeRpmScale(agg.lanes) : null), [agg])
  const widthFor = useMemo(() => (agg ? makeWidthScale(agg.lanes, weight === 'rpm' ? 'revenue' : weight) : null), [agg, weight])

  // Client-side leaderboard sort: current column + direction, nulls/— last,
  // revenue as the tiebreak. Instant on the already-loaded lanes.
  const ranked = useMemo(() => {
    if (!agg) return []
    const get = LEADERBOARD_COL_VAL[sortKey] || LEADERBOARD_COL_VAL.revenue
    const dir = sortDir === 'asc' ? 1 : -1
    return [...agg.lanes].sort((a, b) => {
      const av = get(a), bv = get(b)
      const an = av == null || !Number.isFinite(av)
      const bn = bv == null || !Number.isFinite(bv)
      if (an && bn) return b.revenue - a.revenue
      if (an) return 1   // nulls always last, regardless of direction
      if (bn) return -1
      if (av === bv) return b.revenue - a.revenue
      return (av - bv) * dir
    })
  }, [agg, sortKey, sortDir])

  // "Deadhead only" leaderboard filter — narrows to lanes carrying the warning
  // icon. Composes with sort (applied to `ranked`) and the basis toggle.
  const [deadheadOnly, setDeadheadOnly] = useState(false)
  const deadheadCount = useMemo(() => ranked.filter(deadheadFlagged).length, [ranked])
  const displayedLanes = useMemo(() => (deadheadOnly ? ranked.filter(deadheadFlagged) : ranked), [ranked, deadheadOnly])

  // Best/worst loads by both metrics simultaneously, independent of leaderboard toggle
  const allLoadMetrics = useMemo(() => (agg ? pickAllLoadMetrics(agg.loads, EXCLUDED_STATUSES) : null), [agg])
  // Confirmed-TONU loads in scope — drives the "+N TONU excluded" footnote.
  const tonuExcluded = useMemo(() => (agg ? agg.loads.filter(l => l.is_tonu === true) : []), [agg])

  function togglePhase(phase) {
    setSelectedPhases(prev => {
      const next = new Set(prev)
      if (next.has(phase)) {
        // Don't allow deselecting if it's the only one selected
        if (next.size > 1) next.delete(phase)
      } else {
        next.add(phase)
      }
      return next
    })
  }

  // Selection is keyed to (period, phases): switching window or phases clears
  // it by derivation rather than a reset effect.
  const phasesKey = [...selectedPhases].sort().join('|')
  const selKey = `${dataKey}|${phasesKey}`
  const [selState, setSelState] = useState({ key: null, lane: null })
  const selectedKey = selState.key === selKey ? selState.lane : null
  const setSelected = useCallback((lane) => setSelState({ key: selKey, lane }), [selKey])
  const selectedLane = selectedKey && agg ? agg.lanes.find(l => l.key === selectedKey) : null

  // Heat-spot selection mirrors the lane selection: clicking a hot cell pins
  // it and the side panel lists the loads touching that area.
  const heatCells = useMemo(() => (agg ? binHeatCells(agg.lanes) : []), [agg])
  const [heatCellState, setHeatCellState] = useState({ key: null, cell: null })
  const selectedCellKey = heatCellState.key === selKey ? heatCellState.cell : null
  const setSelectedCell = useCallback((k) => setHeatCellState({ key: selKey, cell: k }), [selKey])
  const selectedCell = selectedCellKey ? heatCells.find(c => c.key === selectedCellKey) : null

  // An active selection's detail card takes the leaderboard's slot in the
  // side panel (small screens shouldn't scroll to find it); "← Leaderboard"
  // brings the list back. Heat-spot selection wins while in the Heat view.
  const activeDetail = mapMode === 'heat' && selectedCell ? 'cell' : selectedLane ? 'lane' : null

  function setPresetRange(p) {
    setPreset(p)
    if (p === 'week') setRange(thisWeek())
    else if (p === 'month') setRange(thisMonth())
  }
  function shiftRange(dir) {
    setRange(r => {
      const span = spanDays(r.from, r.to)
      return { from: shiftYmd(r.from, dir * span), to: shiftYmd(r.to, dir * span) }
    })
  }

  // Lane KPIs count distinct corridors, not the type-split rows.
  const distinctLanes = agg ? new Set(agg.lanes.map(l => `${l.origin} → ${l.destination}`)).size : 0
  const offMapLanes = agg ? new Set(agg.lanes.filter(l => !l.geocoded).map(l => `${l.origin} → ${l.destination}`)).size : 0
  const typesPresent = useMemo(
    () => (agg ? typeOptions.filter(t => agg.lanes.some(l => l.trailerType === t)) : []),
    [agg, typeOptions],
  )
  const laneColorFor = colorBy === 'type' ? (lane) => typeColorFor(lane.trailerType) : null
  // Isolating a single trailer type tints the heat ramp toward that type's
  // color so a screenshot identifies itself.
  const heatTint = typeFilter && typeFilter.length === 1 ? typeColorFor(typeFilter[0]) : null
  const dateCol = basis === 'pickup' ? 'pickup_date' : 'delivery_date'

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lane Flow Map</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Every load drawn origin → destination — thick arcs carry the volume, green arcs pay the best per mile.
            <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 align-middle whitespace-nowrap" title="Fuel, insurance, and driver pay aren't in BUDDY yet — lane $/mile is a revenue signal, not a margin verdict.">
              Revenue view — net margin pending cost layer
            </span>
          </p>
          {/* Freshness of the underlying loads — when data was last imported,
              not the same as the date-range filter (that's when loads happened). */}
          <LoadsFreshness className="mt-1" />
        </div>
      </div>

      {/* ── KPI band ── */}
      {agg && agg.totals.legs > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi label="Lanes" value={fmtNum(distinctLanes)} sub={offMapLanes ? `${offMapLanes} off-map` : 'all on map'} />
          <Kpi label="Loads" value={fmtNum(agg.totals.loads)} sub={[...selectedPhases].sort().join(' + ')} />
          <Kpi label="Revenue" value={fmtMoney(agg.totals.revenue)} sub={`${fmtNum(agg.totals.miles)} mi`} />
          <Kpi label="$/mile" value={agg.totals.rpm == null ? '—' : `${fmtRpm(agg.totals.rpm)}/mi`} sub="all lanes" />
          <Kpi label="Map coverage" value={agg.coverage == null ? '—' : `${Math.round(agg.coverage * 100)}%`} sub="of loads geocoded" />
        </div>
      )}

      {/* ── Controls — one toolbar that sits right against the map, so changing
          a filter and seeing the result never needs a scroll. Every control is
          present in both views (disabled when not applicable) so the bar keeps
          the exact same shape switching Lanes ↔ Heat. ── */}
      <div className="flex items-center flex-wrap gap-2">
          <Pills value={mapMode} onChange={switchMapMode} title="Lanes = origin→destination arcs · Heat = where freight concentrates"
            options={[['lanes', 'Lanes'], ['heat', 'Heat']]} />
          <div className="flex items-center gap-1 flex-wrap">
            {['booked', 'in_transit', 'delivered'].map(phase => {
              const labels = { booked: 'Booked', in_transit: 'In transit', delivered: 'Delivered' }
              const isSelected = selectedPhases.has(phase)
              return (
                <button key={phase} onClick={() => togglePhase(phase)}
                  title={phase === 'in_transit' ? 'Picked up, not yet delivered' : phase === 'booked' ? 'Pickup date in the future' : 'Delivery date has passed'}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400'
                      : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}>
                  {labels[phase]}
                </button>
              )
            })}
          </div>
          <Pills value={weight} onChange={setWeight}
            title={mapMode === 'heat' ? 'Heat intensity: revenue sum, load count, or revenue-weighted average $/mile' : 'What arc thickness represents — $/mile weighting applies to the Heat view'}
            options={[['revenue', 'Weight: revenue'], ['loads', 'Weight: loads'], ['rpm', 'Weight: $/mile', mapMode !== 'heat']]} />
          <Pills value={colorBy} onChange={setColorBy}
            title={mapMode === 'heat' ? 'Arc color applies to the Lanes view' : 'Arc color: $/mile gradient, or one categorical color per trailer type'}
            options={[['rpm', 'Color: $/mi', mapMode === 'heat'], ['type', 'Color: type', mapMode === 'heat']]} />
          {typeOptions.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              {typeOptions.map(t => {
                const active = !typeFilter || typeFilter.includes(t)
                return (
                  <button key={t} onClick={() => toggleType(t)}
                    title={typeFilter ? 'Click to add or remove this trailer type' : 'Click to isolate this trailer type'}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] transition-colors ${active ? 'border-gray-300 dark:border-white/20 text-gray-700 dark:text-slate-200 bg-white dark:bg-white/5' : 'border-gray-200 dark:border-white/10 text-gray-400 dark:text-slate-600 opacity-60'}`}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: typeColorFor(t), opacity: active ? 1 : 0.4 }} />
                    {t}
                  </button>
                )
              })}
              {typeFilter && (
                <button onClick={() => setTypeFilterState({ key: dataKey, sel: null })}
                  className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline px-1" title="Show all trailer types">
                  All types
                </button>
              )}
            </div>
          )}
          {dispatchers.length > 1 && (
            <div className="relative">
              <input
                ref={dispatcherInputRef}
                type="text"
                value={dispatcherFilter ? (dispatchers.find(d => d.id === dispatcherFilter)?.name || '') : dispatcherSearchQuery}
                onChange={e => {
                  // Editing while a dispatcher is selected turns the text into a
                  // fresh search — emptying the box can never leave a stale filter.
                  if (dispatcherFilter) setDispatcherFilter(null)
                  setDispatcherSearchQuery(e.target.value)
                  setDispatcherSearchOpen(true)
                }}
                onFocus={() => setDispatcherSearchOpen(true)}
                onBlur={() => setTimeout(() => setDispatcherSearchOpen(false), 150)}
                onKeyDown={e => { if (e.key === 'Escape') clearDispatcherFilter(false) }}
                placeholder="Filter dispatchers…"
                className={`${S.input} w-32 text-xs ${dispatcherFilter ? 'pr-7 ring-2 ring-orange-400/50' : ''}`}
                title="Search and filter by dispatcher — ✕ or Escape resets to all"
              />
              {dispatcherFilter && (
                <button
                  onMouseDown={e => { e.preventDefault(); clearDispatcherFilter(true) }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-[10px] leading-none text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-white/10"
                  title="Clear dispatcher filter (back to all dispatchers)"
                  aria-label="Clear dispatcher filter"
                >✕</button>
              )}
              {dispatcherSearchOpen && (
                <div className="absolute z-50 mt-1 w-48 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg overflow-hidden">
                  <button
                    onMouseDown={e => { e.preventDefault(); setDispatcherFilter(null); setDispatcherSearchQuery(''); setDispatcherSearchOpen(false) }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-slate-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 border-b border-gray-100 dark:border-white/[0.06]"
                  >
                    All dispatchers
                  </button>
                  {filteredDispatchers.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</p>
                  ) : (
                    filteredDispatchers.map(d => (
                      <button
                        key={d.id}
                        onMouseDown={e => { e.preventDefault(); setDispatcherFilter(d.id); setDispatcherSearchQuery(''); setDispatcherSearchOpen(false) }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-orange-50 dark:hover:bg-orange-500/10 ${dispatcherFilter === d.id ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}
                      >
                        {d.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => shiftRange(-1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Previous period">◀</button>
            <Pills value={preset} onChange={setPresetRange} options={[['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']]} />
            <button onClick={() => shiftRange(1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Next period">▶</button>
            <Pills value={basis} onChange={setBasis} options={[['delivery', 'By delivery'], ['pickup', 'By pickup']]} />
            {preset === 'custom' && (
              <div className="flex items-center gap-1.5 shrink-0">
                <input type="date" className={`${S.input} w-[9rem]`} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                <span className="text-gray-400 text-xs">→</span>
                <input type="date" className={`${S.input} w-[9rem]`} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
              </div>
            )}
        </div>
        <p className="basis-full text-[11px] text-gray-400 dark:text-slate-500 -mt-1">{[...selectedPhases].sort((a, b) => {
            const order = { booked: 0, in_transit: 1, delivered: 2 }
            return (order[a] ?? 3) - (order[b] ?? 3)
          }).map(p => p === 'in_transit' ? 'In transit' : p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')} · {formatRange(range.from, range.to)} · by {basis} date</p>
      </div>

      {/* Miles review — pinned worklist of real loads with missing/inflated miles. */}
      <MilesReviewBanner from={range.from} to={range.to} reloadKey={reloadKey} canEdit={canEdit} onSaved={reloadLanes} />

      {/* ── Map + leaderboard ── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Map card */}
        <div className="rounded-3xl border border-gray-200 dark:border-white/10 bg-gradient-to-b from-white to-gray-50 dark:from-[#12132e] dark:to-[#0a0a18] overflow-hidden">
          <div className="flex items-start justify-between flex-wrap gap-4 px-5 pt-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Map
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Origin → destination</h2>
              <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
                {[...selectedPhases].sort((a, b) => {
                  const order = { booked: 0, in_transit: 1, delivered: 2 }
                  return (order[a] ?? 3) - (order[b] ?? 3)
                }).map(p => p === 'in_transit' ? 'In transit' : p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')} {mapMode === 'heat' ? 'heat' : 'flow'} · {formatRange(range.from, range.to)}
              </p>
            </div>
            {mapMode === 'heat' ? null : colorBy === 'type' && typesPresent.length > 0 ? (
              <div className="flex items-center gap-2.5 flex-wrap text-[10px] text-gray-400 dark:text-slate-500">
                {typesPresent.map(t => (
                  <span key={t} className="inline-flex items-center gap-1">
                    <span className="rounded-full" style={{ background: typeColorFor(t), height: 3, width: 12 }} />
                    {t}
                  </span>
                ))}
              </div>
            ) : rpmScale && (
              <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-slate-500">
                <span className="font-mono">{fmtRpm(rpmScale.domain[0])}/mi</span>
                <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${rpmScale.colorAt(0)}, ${rpmScale.colorAt(0.5)}, ${rpmScale.colorAt(1)})` }} />
                <span className="font-mono">{fmtRpm(rpmScale.domain[1])}/mi</span>
              </div>
            )}
          </div>
          {loading ? (
            <div className="aspect-[975/610] m-5 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          ) : agg.totals.legs === 0 ? (
            <div className="aspect-[975/610] flex items-center justify-center text-sm text-gray-400 dark:text-slate-500 px-8 text-center">
              No {[...selectedPhases].sort().join(' + ')} loads in this window. Try another period or select different phases.
            </div>
          ) : (
            <div className="px-2 pb-1">
              {/* Both layers stay mounted and cross-fade on toggle; the
                  transition collapses under prefers-reduced-motion. */}
              <div className="relative">
                <div className={`transition-opacity duration-300 motion-reduce:transition-none ${mapMode === 'heat' ? 'opacity-0 pointer-events-none absolute inset-0' : 'opacity-100'}`} aria-hidden={mapMode === 'heat'}>
                  <LaneMapCanvas
                    lanes={agg.lanes}
                    cities={agg.cities}
                    colorFor={rpmScale.color}
                    widthFor={widthFor}
                    selectedKey={selectedKey}
                    onSelect={setSelected}
                    laneColorFor={laneColorFor || undefined}
                    typeColorFor={typeColorFor}
                    selectedPhases={selectedPhases}
                  />
                </div>
                <div className={`transition-opacity duration-300 motion-reduce:transition-none ${mapMode === 'lanes' ? 'opacity-0 pointer-events-none absolute inset-0' : 'opacity-100'}`} aria-hidden={mapMode === 'lanes'}>
                  <LaneHeatCanvas cells={heatCells} metric={weight} tintColor={heatTint}
                    selectedKey={selectedCellKey} onSelect={setSelectedCell} />
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-2 px-5 pb-3 pt-1">
            <p className="text-[11px] text-gray-400 dark:text-slate-500">
              {agg && agg.coverage != null && agg.coverage < 1
                ? `Geocode coverage: ${Math.round(agg.coverage * 100)}% of loads — the rest stay in the table below.`
                : mapMode === 'heat' ? 'Hover a hot area for what drives it.' : 'Hover an arc for the lane, click to pin it.'}
            </p>
            {mapMode === 'heat' ? (
              <p className="text-[11px] text-gray-400 dark:text-slate-500">
                Each load glows at its origin and destination — brighter = more {weight === 'rpm' ? 'revenue per mile' : weight === 'loads' ? 'loads' : 'revenue'}.
              </p>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
                <span className="inline-block w-4 h-0.5 rounded-full bg-gray-400 dark:bg-slate-400" style={{ height: 2 }} /> thin = light volume
                <span className="inline-block w-4 rounded-full bg-gray-400 dark:bg-slate-400" style={{ height: 5 }} /> thick = heavy volume
              </p>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4 min-w-0">
          {/* Best / worst loads by both revenue and $/mi */}
          {allLoadMetrics && (
            <div className="space-y-3">
              {/* By Revenue row */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Best load · by revenue', allLoadMetrics.bestByRevenue, 'text-emerald-600 dark:text-emerald-400', true],
                  ['Worst load · by revenue', allLoadMetrics.worstByRevenue, 'text-rose-600 dark:text-rose-400', true],
                ].map(([lbl, load, cls]) => (
                  <div key={lbl} className={`${S.card} px-4 py-3 text-left`}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{lbl}</p>
                    <p className={`text-lg font-bold font-mono leading-tight mt-0.5 ${cls}`}>{fmtMoney(load.revenue)}</p>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate" title={`${load.origin} → ${load.destination}`}>{load.origin} → {load.destination}</p>
                    {load.trailer_type && <p className="mt-0.5"><TypeBadge type={load.trailer_type} color={typeColorFor(load.trailer_type)} /></p>}
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 inline-flex items-center gap-0.5">#{load.load_number}{load.load_number && <CopyButton value={String(load.load_number).trim()} label="Copy load number" />}</p>
                    <p className="text-[10px] text-gray-400 dark:text-slate-500 inline-flex items-center gap-1">
                      {fmtRpm(load.rpm)}/mi · {fmtNum(load.miles)} mi
                      <MilesEditor legId={load.leg_id} loaded={load.loaded_miles} empty={load.empty_miles} total={load.total_miles} canEdit={canEdit} onSaved={reloadLanes} />
                    </p>
                    {lbl.startsWith('Worst') && <WorstRevenueNote load={load} canEdit={canEdit} onReviewed={reloadLanes} />}
                    <ExcludedTonuFootnote tonuLoads={tonuExcluded} />
                  </div>
                ))}
              </div>
              {/* By $/mi row */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Best load · by $/mi', allLoadMetrics.bestByRpm, 'text-emerald-600 dark:text-emerald-400', false],
                  ['Worst load · by $/mi', allLoadMetrics.worstByRpm, 'text-rose-600 dark:text-rose-400', false],
                ].map(([lbl, load, cls]) => (
                  <div key={lbl} className={`${S.card} px-4 py-3 text-left`}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{lbl}</p>
                    {load ? (
                      <>
                        <p className={`text-lg font-bold font-mono leading-tight mt-0.5 ${cls}`}>{fmtRpm(load.rpm)}/mi</p>
                        <p className="text-[11px] text-gray-500 dark:text-slate-400 truncate" title={`${load.origin} → ${load.destination}`}>{load.origin} → {load.destination}</p>
                        {load.trailer_type && <p className="mt-0.5"><TypeBadge type={load.trailer_type} color={typeColorFor(load.trailer_type)} /></p>}
                        <p className="text-[10px] text-gray-400 dark:text-slate-500 inline-flex items-center gap-0.5">#{load.load_number}{load.load_number && <CopyButton value={String(load.load_number).trim()} label="Copy load number" />}</p>
                        <p className="text-[10px] text-gray-400 dark:text-slate-500 inline-flex items-center gap-1">
                          {fmtMoney(load.revenue)} · {fmtNum(load.miles)} mi
                          <MilesEditor legId={load.leg_id} loaded={load.loaded_miles} empty={load.empty_miles} total={load.total_miles} canEdit={canEdit} onSaved={reloadLanes} />
                        </p>
                        {lbl.startsWith('Worst') && <WorstRpmCombineNote key={load.load_number} loadNumber={load.load_number} />}
                        <ExcludedTonuFootnote tonuLoads={tonuExcluded} />
                      </>
                    ) : (
                      <p className="text-[11px] text-gray-400 dark:text-slate-500">—</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leaderboard — hidden while a selection's detail card uses its slot */}
          {!activeDetail && (
          <div className={`${S.card} overflow-hidden`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/5">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Lane leaderboard</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeadheadOnly(v => !v)}
                  disabled={!deadheadOnly && deadheadCount === 0}
                  aria-pressed={deadheadOnly}
                  aria-label="Show deadhead lanes only"
                  title="Show deadhead lanes only"
                  className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    deadheadOnly
                      ? 'bg-amber-500 text-slate-900 border-amber-500'
                      : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" strokeLinejoin="round" /><path d="M12 9v4M12 17h.01" strokeLinecap="round" /></svg>
                  {deadheadCount > 0 && <span>{deadheadCount}</span>}
                </button>
                <Pills value={sortKey} onChange={setSortFromPills} options={LEADERBOARD_SORTS.map(s => [s.key, s.label])} title="Revenue — total $ on the lane · $/mile — revenue ÷ miles · Loads — how many loads ran this origin→destination. Or click a column header to sort (toggles asc/desc). Tied lanes sorted by revenue." />
              </div>
            </div>
            <div className="max-h-[460px] overflow-y-auto">
              {ranked.length === 0 ? (
                <p className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">No lanes in this window.</p>
              ) : displayedLanes.length === 0 ? (
                <p className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">No deadhead-flagged lanes this period.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className={`${S.tableHead} sticky top-0 bg-white dark:bg-[#0d0d1f] z-10`}>
                    <tr>
                      <th className={`${S.th} !px-3`}>Lane</th>
                      <SortTh label="Loads" colKey="loads" sortKey={sortKey} sortDir={sortDir} onSort={toggleColSort} className={`${S.th} !px-2 text-right`} />
                      <SortTh label="Revenue" colKey="revenue" sortKey={sortKey} sortDir={sortDir} onSort={toggleColSort} className={`${S.th} !px-2 text-right`} />
                      <SortTh label="$/mi" colKey="rpm" sortKey={sortKey} sortDir={sortDir} onSort={toggleColSort} className={`${S.th} !px-2 text-right`} />
                      <SortTh label="Avg mi" colKey="avgMiles" sortKey={sortKey} sortDir={sortDir} onSort={toggleColSort} className={`${S.th} !px-3 text-right`} />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLanes.map(lane => {
                      // Show phase breakdown in leaderboard when multiple phases shown
                      const phaseLabels = { booked: 'Booked', in_transit: 'In transit', delivered: 'Delivered' }
                      const phaseBreakdown = selectedPhases.size > 1 && lane.legs ? (() => {
                        const phases = new Map()
                        for (const phase of ['booked', 'in_transit', 'delivered']) {
                          phases.set(phase, lane.legs.filter(l => l.load_phase === phase).length)
                        }
                        return phases
                      })() : null
                      return (
                      <tr key={lane.key} onClick={() => setSelected(lane.key === selectedKey ? null : lane.key)}
                        className={`${S.tableRow} cursor-pointer ${selectedKey === lane.key ? 'bg-orange-50 dark:bg-orange-500/10' : ''}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900 dark:text-slate-200 leading-tight">{lane.origin}</p>
                          <p className="text-gray-400 dark:text-slate-500 leading-tight">→ {lane.destination}{!lane.geocoded && <span className="ml-1 text-amber-600 dark:text-amber-400" title="This lane couldn't be geocoded, so it isn't drawn on the map.">⌀ off-map</span>}<DeadheadIcon lane={lane} /></p>
                          {lane.trailerType && <p className="mt-1 leading-none"><TypeBadge type={lane.trailerType} color={typeColorFor(lane.trailerType)} /></p>}
                          {phaseBreakdown && (
                            <p className="mt-1 text-[10px] text-gray-500 dark:text-slate-400 flex flex-wrap gap-1">
                              {[...phaseBreakdown].map(([phase, count]) => count > 0 && (
                                <span key={phase} className={`inline-block px-1.5 py-0.5 rounded-full ${
                                  phase === 'booked' ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400' :
                                  phase === 'in_transit' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' :
                                  'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                }`}>{phaseLabels[phase]} {count}</span>
                              ))}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{lane.loads}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-900 dark:text-slate-200">{fmtMoney(lane.revenue)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold" style={{ color: rpmScale ? rpmScale.color(lane.rpm) : RPM_NULL_COLOR }}>{lane.rpm == null ? '—' : fmtRpm(lane.rpm)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600 dark:text-slate-400">{lane.avgMiles == null ? '—' : fmtNum(lane.avgMiles)}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {displayedLanes.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100 dark:border-white/5 text-[10px] text-gray-400 dark:text-slate-500">
                $/mi &amp; avg mi exclude TONU · revenue &amp; loads include it
              </div>
            )}
          </div>
          )}

          {/* Loads on the selected lane */}
          {activeDetail === 'lane' && selectedLane && (
            <div className={`${S.card} overflow-hidden`}>
              <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Loads on this lane</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedLane.origin} <span className="text-orange-500">→</span> {selectedLane.destination}</p>
                  {selectedLane.trailerType && <p className="mt-1"><TypeBadge type={selectedLane.trailerType} color={typeColorFor(selectedLane.trailerType)} /></p>}
                </div>
                <button onClick={() => setSelected(null)}
                  className="shrink-0 text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline"
                  title="Clear selection and show the lane leaderboard">← Leaderboard</button>
              </div>
              <ul className="divide-y divide-gray-50 dark:divide-white/[0.03] max-h-72 overflow-y-auto">
                {selectedLane.legs.map(leg => <LegRow key={leg.leg_id} leg={leg} dateCol={dateCol} rpmScale={rpmScale} showPhase={selectedPhases.size > 1} canEdit={canEdit} onMilesSaved={reloadLanes} />)}
              </ul>
            </div>
          )}

          {/* Loads touching the pinned heat spot (heat view's lane click) */}
          {activeDetail === 'cell' && selectedCell && (
            <div className={`${S.card} overflow-hidden`}>
              <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Loads in this area</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{selectedCell.topCity || 'Selected area'}</p>
                  <p className="text-[11px] text-gray-400 dark:text-slate-500">{selectedCell.legs.length} load{selectedCell.legs.length === 1 ? '' : 's'} · {fmtMoney(selectedCell.revenue)} touching</p>
                </div>
                <button onClick={() => setSelectedCell(null)}
                  className="shrink-0 text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline"
                  title="Clear selection and show the lane leaderboard">← Leaderboard</button>
              </div>
              <ul className="divide-y divide-gray-50 dark:divide-white/[0.03] max-h-72 overflow-y-auto">
                {selectedCell.legs.map(leg => <LegRow key={leg.leg_id} leg={leg} dateCol={dateCol} rpmScale={rpmScale} showLane showPhase={selectedPhases.size > 1} canEdit={canEdit} onMilesSaved={reloadLanes} />)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── Geo heat map section ── */}
      <GeoHeatMap
        range={range}
        phases={selectedPhases}
        pageTitle="Lanes by region & state"
      />

      {/* ── Top performers section ── */}
      <TopPerformers
        range={range}
        phases={selectedPhases}
      />

      {/* ── Trailer type trends section ── */}
      <TrailerTypeTrends />

      {/* ── Honesty footer ── */}
      <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center max-w-3xl mx-auto">
        Revenue, miles, and $/mile are live BUDDY data. City positions come from a bundled US Census gazetteer — loads whose city can't be placed stay in the table and are counted in the coverage figure.
        Fuel, insurance, and driver pay are not in BUDDY yet, so lane $/mile is a revenue signal, not net margin.
      </p>
    </div>
  )
}
