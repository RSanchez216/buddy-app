import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import CopyButton from '../../../../components/CopyButton'
import { fmtMoney } from '../spotlight/spotlightShared'

// Idle review — trucks, trailers, and drivers earning $0 while still costing
// money (3+ days since last load activity). Tag a reason, watch the duration,
// resolve when sold / terminated / back to work. Read/writes go through the
// idle_subjects / set_idle_reason / resolve_idle RPCs (already deployed).

const UNIT_REASONS = ['Pending - TBD', 'Parked', 'Dedicated lane site', 'Under repairs', 'Under claim', 'For sale', 'Lease to Purchase', 'Other']
const DRIVER_REASONS = ['Pending - TBD', 'Vacation', 'Home-time', 'Under repairs', 'Health', 'Family', 'Other']

// Benign reasons read as expected idle (low severity); the rest are
// "attention" (amber). Anything uncategorized, or idle 14+ days, escalates red.
const BENIGN = new Set(['Vacation', 'Parked', 'Dedicated lane site', 'For sale'])

function severity(row) {
  const chronic = (row.days_idle ?? 0) >= 14
  // A driver holding no company-owned equipment ($0 run-rate) is low severity
  // — listed for the revenue gap, but no company cost. Chronic idle still
  // nudges it to red so a long-idle driver gets a look.
  if (row.subject_type === 'driver' && Number(row.monthly_cost) === 0 && !chronic) return 'low'
  if (chronic) return 'red'
  if (!row.reason) return 'red'
  if (BENIGN.has(row.reason)) return 'low'
  return 'amber'
}
const SEV_RANK = { red: 0, amber: 1, low: 2 }
const SEV_DOT = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  low: 'bg-teal-500',
}

const CAP = 10

// Compact, clearly-pressable secondary button for the per-row Resolve/Reopen.
const ROW_BTN = 'inline-flex items-center px-2 py-1 text-[11px] font-medium rounded-md border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 active:bg-gray-100 dark:active:bg-white/10 transition-colors'

const COST_TIP = "Monthly carrying cost — the lease or loan payment for this unit, which keeps being charged while it sits idle. It's the monthly run-rate, not prorated to the idle days shown. Driver-owned equipment is $0. For a driver, it's the combined carrying cost of the company truck and trailer they're holding."

// Column defs drive the sortable headers + comparator. `get` returns the sort
// value; `type` picks the comparator (text / numeric / severity). Hoisted to
// module scope so the reference is stable across renders (memoization-safe).
const UNIT_COLUMNS = [
  { key: 'label', label: 'Unit', type: 'text', get: r => r.label || '' },
  { key: 'days', label: 'Idle', type: 'num', align: 'right', get: r => r.days_idle },
  { key: 'extra', label: 'Assigned driver', type: 'text', get: r => r.extra || '' },
  { key: 'cost', label: '$/mo', type: 'num', align: 'right', tip: COST_TIP, get: r => Number(r.monthly_cost) },
  { key: 'reason', label: 'Reason', type: 'severity', get: r => SEV_RANK[severity(r)] },
]
const DRIVER_COLUMNS = [
  { key: 'label', label: 'Driver', type: 'text', get: r => r.label || '' },
  { key: 'days', label: 'Idle', type: 'num', align: 'right', get: r => r.days_idle },
  { key: 'cost', label: 'Holding (cost)', type: 'num', align: 'right', tip: COST_TIP, get: r => Number(r.monthly_cost) },
  { key: 'reason', label: 'Reason', type: 'severity', get: r => SEV_RANK[severity(r)] },
]

function fmtDays(d) {
  if (d == null) return '—'
  return `${d}d`
}

// Formats a date-only 'YYYY-MM-DD' string from idle_subjects (resolved_on,
// reason_since, last_activity) without a UTC shift. new Date('2026-06-23')
// parses as UTC midnight and renders a day early in Central; building from the
// Y-M-D parts constructs in local time, so the calendar day is preserved.
function fmtDateOnly(s) {
  if (!s) return '—'
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return '—'
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// last_reviewed_at is a timestamptz (the row's updated_at, stamped when a
// reason/note is saved). Render the calendar day in America/Chicago, e.g.
// "Jul 6". Null → null (caller shows "Not reviewed").
function fmtReviewed(ts) {
  if (!ts) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(ts))
  } catch { return null }
}

// Opens the subject's profile (truck / trailer / driver) in a new tab.
// subject_type is singular; the routes are plural (+'s'). Falls back to plain
// text when there's no id to link to.
function SubjectLink({ row }) {
  const label = row.label || '—'
  if (!row.subject_id) return label
  return (
    <Link
      to={`/fleet/${row.subject_type}s/${row.subject_id}`}
      target="_blank" rel="noopener noreferrer"
      title="Open profile in a new tab"
      className="hover:underline hover:text-orange-600 dark:hover:text-orange-400"
    >
      {label}
    </Link>
  )
}

export default function IdleReview() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('active') // 'active' | 'resolved'
  const [reviewFilter, setReviewFilter] = useState('all') // 'all' | 'reviewed' | 'needs' | 'pending' — separate axis

  async function load() {
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('idle_subjects', { p_threshold: 3 })
      if (err) throw err
      setRows(data || [])
    } catch (e) {
      console.error('Failed to load idle subjects:', e)
      setError(e.message || String(e))
      setRows([])
    }
  }

  useEffect(() => { load() }, [])

  const activeRows = useMemo(() => (rows || []).filter(r => !r.resolved), [rows])
  const resolvedRows = useMemo(() => (rows || []).filter(r => r.resolved), [rows])

  const groupOf = (list) => {
    const g = { truck: [], trailer: [], driver: [] }
    for (const r of list) (g[r.subject_type] || (g[r.subject_type] = [])).push(r)
    return g
  }
  // Cards + bubble count ACTIVE only (unaffected by the review filter), so
  // resolving a case lowers them.
  const activeGroups = useMemo(() => groupOf(activeRows), [activeRows])
  // The tables honor the Reviewed/Needs-review filter on top of Active/Resolved.
  // "Reviewed" = has a last_reviewed_at. Client-side, instant, no refetch.
  const viewGroups = useMemo(() => {
    const base = view === 'resolved' ? resolvedRows : activeRows
    const list = reviewFilter === 'all'
      ? base
      : reviewFilter === 'pending'
        ? base.filter(r => r.reason === 'Pending - TBD')
        : base.filter(r => (reviewFilter === 'reviewed' ? !!r.last_reviewed_at : !r.last_reviewed_at))
    return groupOf(list)
  }, [view, activeRows, resolvedRows, reviewFilter])

  // Counts for the review-filter chips, within the current Active/Resolved view.
  const reviewCounts = useMemo(() => {
    const base = view === 'resolved' ? resolvedRows : activeRows
    const reviewed = base.filter(r => !!r.last_reviewed_at).length
    const pending = base.filter(r => r.reason === 'Pending - TBD').length
    return { all: base.length, reviewed, needs: base.length - reviewed, pending }
  }, [view, activeRows, resolvedRows])

  const sumCost = (list) => list.reduce((s, r) => s + (Number(r.monthly_cost) || 0), 0)

  // One call writes BOTH reason and note (the RPC overwrites both), so callers
  // pass the field they're editing plus the row's CURRENT value for the other.
  // Returns true on success so inline editors can show non-blocking feedback.
  async function setReason(row, reason, note) {
    try {
      const { error: err } = await supabase.rpc('set_idle_reason', {
        p_subject_type: row.subject_type, p_subject_id: row.subject_id,
        p_reason: reason || null, p_note: note || null,
      })
      if (err) throw err
      await load()
      return true
    } catch (e) {
      console.error('set_idle_reason failed:', e)
      return false
    }
  }
  async function resolve(row) {
    try {
      const { error: err } = await supabase.rpc('resolve_idle', { p_subject_type: row.subject_type, p_subject_id: row.subject_id })
      if (err) throw err
      await load()
    } catch (e) {
      console.error('resolve_idle failed:', e)
    }
  }
  async function reopen(row) {
    try {
      const { error: err } = await supabase.rpc('reopen_idle', { p_subject_type: row.subject_type, p_subject_id: row.subject_id })
      if (err) throw err
      await load()
    } catch (e) {
      console.error('reopen_idle failed:', e)
    }
  }

  const loading = rows === null
  const resolvedView = view === 'resolved'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Idle review</h1>
        <p className="text-sm text-gray-700 dark:text-slate-500 mt-0.5">
          Trucks, trailers, and drivers earning $0 while still on the books — tag a reason and watch the clock.
        </p>
      </div>

      {/* Summary cards — active only */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          label="Idle trucks"
          count={activeGroups.truck.length}
          sub={`${fmtMoney(sumCost(activeGroups.truck))}/mo carrying`}
          loading={loading}
          tip="A subject is idle when it's been 3+ days since its last load activity (latest pickup or delivery, booked loads included). The $/mo is the monthly carrying run-rate of currently-idle equipment — not accrued loss. Equipment idle is judged by its assigned driver's activity (truck-on-load data is incomplete), so routing through the driver is the reliable signal."
        />
        <SummaryCard label="Idle trailers" count={activeGroups.trailer.length} sub={`${fmtMoney(sumCost(activeGroups.trailer))}/mo carrying`} loading={loading} />
        <SummaryCard label="Idle drivers" count={activeGroups.driver.length} sub="not moving freight" loading={loading} />
      </div>

      {/* Filters: Active/Resolved (which spell) + Reviewed/Needs (review state). */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs w-fit">
          {[['active', `Active (${activeRows.length})`], ['resolved', `Resolved (${resolvedRows.length})`]].map(([k, lbl]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 whitespace-nowrap ${view === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{lbl}</button>
          ))}
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-xs w-fit">
          {[['all', `All (${reviewCounts.all})`], ['reviewed', `Reviewed (${reviewCounts.reviewed})`], ['needs', `Needs review (${reviewCounts.needs})`], ['pending', `Pending (${reviewCounts.pending})`]].map(([k, lbl]) => (
            <button key={k} onClick={() => setReviewFilter(k)} className={`px-3 py-1.5 whitespace-nowrap ${reviewFilter === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{lbl}</button>
          ))}
        </div>
      </div>

      {error && <div className={S.errorBox}>Couldn't load idle data: {error}</div>}

      {loading ? (
        <div className={`${S.card} p-12 text-center text-sm text-gray-500 dark:text-slate-500 animate-pulse`}>Finding idle subjects…</div>
      ) : (
        <>
          <IdleSection title="Trucks" kind="unit" rows={viewGroups.truck} reasons={UNIT_REASONS} resolvedView={resolvedView} reviewFilter={reviewFilter} onSetReason={setReason} onResolve={resolve} onReopen={reopen} />
          <IdleSection title="Trailers" kind="unit" rows={viewGroups.trailer} reasons={UNIT_REASONS} resolvedView={resolvedView} reviewFilter={reviewFilter} onSetReason={setReason} onResolve={resolve} onReopen={reopen} />
          <IdleSection title="Drivers" kind="driver" rows={viewGroups.driver} reasons={DRIVER_REASONS} resolvedView={resolvedView} reviewFilter={reviewFilter} onSetReason={setReason} onResolve={resolve} onReopen={reopen} />
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, count, sub, loading, tip }) {
  return (
    <div className={`${S.card} px-4 py-3`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">
        {label}
        {tip && (
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-slate-600 text-[9px] text-gray-500 dark:text-slate-400 cursor-help"
            title={tip}
          >?</span>
        )}
      </div>
      <div className="mt-0.5 text-2xl font-mono font-bold text-gray-900 dark:text-white">{loading ? '…' : count}</div>
      <div className="text-[11px] text-gray-500 dark:text-slate-500">{sub}</div>
    </div>
  )
}

function IdleSection({ title, kind, rows, reasons, resolvedView, reviewFilter, onSetReason, onResolve, onReopen }) {
  const columns = kind === 'unit' ? UNIT_COLUMNS : DRIVER_COLUMNS

  const [sort, setSort] = useState({ key: 'days', dir: 'desc' })
  const [expanded, setExpanded] = useState(false)

  const sorted = useMemo(() => {
    // Reviewed view: stalest review first (last_reviewed_at ascending) so the
    // ones most due for a refresh sit at the top.
    if (reviewFilter === 'reviewed') {
      const ts = r => (r.last_reviewed_at ? new Date(r.last_reviewed_at).getTime() : Infinity)
      return [...rows].sort((a, b) => ts(a) - ts(b))
    }
    const col = columns.find(c => c.key === sort.key) || columns[1]
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (col.type === 'text') return col.get(a).localeCompare(col.get(b)) * mul
      // severity + num both numeric; null/NaN treated as lowest.
      const av = col.get(a), bv = col.get(b)
      const na = av == null || !Number.isFinite(av) ? -Infinity : av
      const nb = bv == null || !Number.isFinite(bv) ? -Infinity : bv
      if (na === nb) return 0
      return (na - nb) * mul
    })
  }, [rows, sort, columns, reviewFilter])

  const visible = expanded ? sorted : sorted.slice(0, CAP)

  function toggleSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '')

  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title} <span className="font-normal text-gray-500 dark:text-slate-500">({rows.length})</span></h2>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
          {resolvedView ? 'No resolved cases in this group.' : 'None idle — everything in this group is moving.'}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  {columns.map(c => (
                    <th
                      key={c.key}
                      className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300 ${c.align === 'right' ? 'text-right' : ''}`}
                      onClick={() => toggleSort(c.key)}
                      title={c.key === 'reason' ? 'Sort by severity (red → amber → low)' : 'Sort'}
                    >
                      {c.label}{arrow(c.key)}
                      {c.tip && (
                        <span
                          onClick={e => e.stopPropagation()}
                          className="ml-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-slate-600 text-[9px] text-gray-500 dark:text-slate-400 cursor-help align-middle"
                          title={c.tip}
                        >?</span>
                      )}
                    </th>
                  ))}
                  <th className={`${S.th} text-right`} />
                </tr>
              </thead>
              <tbody>
                {visible.map(r => (
                  <IdleRow key={`${r.subject_type}:${r.subject_id}`} row={r} kind={kind} reasons={reasons} resolvedView={resolvedView} onSetReason={onSetReason} onResolve={onResolve} onReopen={onReopen} />
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > CAP && (
            <div className="px-4 py-2.5 border-t border-gray-100 dark:border-white/5">
              <button onClick={() => setExpanded(e => !e)} className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline">
                {expanded ? 'Show fewer' : `Show all (${sorted.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Per-row note affordance: a note icon (filled when a note exists, hover shows
// a preview) opening a compact inline editor. Save preserves the row's current
// reason (the setter overwrites both fields). Non-blocking feedback.
function NoteButton({ row, onSetReason }) {
  const btnRef = useRef(null)
  const [pos, setPos] = useState(null) // fixed-position anchor (escapes table overflow)
  const [draft, setDraft] = useState(row.reason_note || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const hasNote = !!(row.reason_note && row.reason_note.trim())
  const open = pos !== null

  function openEditor() {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 252) })
    setDraft(row.reason_note || ''); setErr('')
  }
  function close() { setPos(null); setSaving(false) }
  async function save() {
    setSaving(true); setErr('')
    const ok = await onSetReason(row, row.reason || '', draft.trim())
    if (ok) close()
    else { setErr('Save failed — try again'); setSaving(false) }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? close() : openEditor())}
        aria-label={hasNote ? 'Edit note' : 'Add note'}
        title={hasNote ? row.reason_note : 'Add note'}
        className={`p-1 rounded transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/60 ${hasNote ? 'text-orange-500 dark:text-orange-400' : 'text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400'}`}
      >
        {hasNote ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V5z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V5z" strokeLinejoin="round" /><path d="M8 9h8M8 12.5h5" strokeLinecap="round" /></svg>
        )}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => !saving && close()} />
          <div style={{ position: 'fixed', top: pos.top, left: pos.left }} className={`z-50 w-60 ${S.card} p-2 shadow-lg text-left`}>
            <textarea
              autoFocus rows={3} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a note…"
              className="w-full text-xs rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2 py-1.5 text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-y"
            />
            {err && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{err}</div>}
            <div className="flex justify-end gap-1.5 mt-1.5">
              <button onClick={close} disabled={saving} className="text-[11px] px-2 py-1 rounded-md text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">Cancel</button>
              <button onClick={save} disabled={saving} className="text-[11px] px-2 py-1 rounded-md bg-orange-500 text-white font-medium hover:brightness-105 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}

// Always-visible note text, filling the open space to the right of the reason
// control. Short notes render in full; long ones clamp to ~3 lines with a small
// click "more/less" toggle (no hover-only reveal). Nothing renders when empty.
function InlineNote({ text }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 140
  return (
    <div className="min-w-0 text-xs leading-snug text-left text-gray-500 dark:text-slate-400 break-words">
      <span className={!expanded && long ? 'line-clamp-3' : ''}>{text}</span>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="ml-1 align-baseline text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline"
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  )
}

function IdleRow({ row, kind, reasons, resolvedView, onSetReason, onResolve, onReopen }) {
  const sev = severity(row)

  const daysCls = (row.days_idle ?? 0) >= 14 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-slate-300'

  // Auto-captured on every save — shown muted under the reason control.
  const reviewLine = (
    <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
      {row.last_reviewed_at ? `Reviewed ${fmtReviewed(row.last_reviewed_at)}` : 'Not reviewed'}
    </div>
  )

  // The note reads inline in the empty space to the right of the reason control
  // (the icon stays the edit trigger). Rendered for active and resolved alike.
  const noteTrimmed = row.reason_note && row.reason_note.trim()
  const inlineNote = noteTrimmed
    ? <div className="flex-1 min-w-0"><InlineNote text={noteTrimmed} /></div>
    : null

  // Active rows: editable reason dropdown + note popover. Resolved rows: read-only.
  const reasonCell = resolvedView ? (
    <div className="flex items-start gap-3">
      <div className="flex flex-col gap-0.5 shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[sev]}`} />
          <span className="text-gray-700 dark:text-slate-300">{row.reason || '— no reason —'}</span>
        </div>
        {reviewLine}
      </div>
      {inlineNote}
    </div>
  ) : (
    <div className="flex items-start gap-3">
      <div className="flex flex-col gap-0.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${SEV_DOT[sev]}`} title={sev === 'red' ? 'Needs attention' : sev === 'amber' ? 'Watch' : 'Expected idle'} />
          <select
            value={row.reason || ''}
            onChange={e => onSetReason(row, e.target.value, row.reason_note || '')}
            className={`text-xs bg-white dark:bg-slate-800/80 border rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${row.reason ? 'border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200' : 'border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-400'}`}
          >
            <option value="">{row.reason ? '— Clear —' : 'set reason'}</option>
            {reasons.map(rs => <option key={rs} value={rs}>{rs}</option>)}
          </select>
          <NoteButton row={row} onSetReason={onSetReason} />
        </div>
        {reviewLine}
      </div>
      {inlineNote}
    </div>
  )

  const actionsCell = (
    <td className={`${S.td} text-right whitespace-nowrap`}>
      {resolvedView ? (
        <span className="inline-flex items-center gap-2">
          <span className="text-[11px] text-gray-500 dark:text-slate-500">Resolved {fmtDateOnly(row.resolved_on)}</span>
          <button onClick={() => onReopen(row)} className={ROW_BTN} title="Retract this resolve — returns the case to Active for review">Reopen</button>
        </span>
      ) : (
        <button onClick={() => onResolve(row)} className={ROW_BTN} title="Close this idle spell (sold, terminated, or back to work). Reversible from the Resolved tab.">Resolve</button>
      )}
    </td>
  )

  if (kind === 'unit') {
    return (
      <tr className={S.tableRow}>
        <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
          <span className="inline-flex items-center gap-1.5">
            <SubjectLink row={row} />
            {row.label && <CopyButton value={row.label.replace(/^#/, '').trim()} label="Copy unit number" />}
          </span>
        </td>
        <td className={`${S.td} text-right font-mono ${daysCls}`}>{fmtDays(row.days_idle)}</td>
        <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>
          {row.extra ? (
            <span className="inline-flex items-center gap-1.5">
              {row.extra}
              <CopyButton value={row.extra.trim()} label="Copy driver name" />
            </span>
          ) : '—'}
        </td>
        <td className={`${S.td} text-right font-mono text-amber-600 dark:text-amber-400`}>{Number(row.monthly_cost) > 0 ? `${fmtMoney(row.monthly_cost)}` : '$0'}</td>
        <td className={S.td}>{reasonCell}</td>
        {actionsCell}
      </tr>
    )
  }
  // driver
  return (
    <tr className={S.tableRow}>
      <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
        <span className="inline-flex items-center gap-1.5">
          <SubjectLink row={row} />
          {row.label && <CopyButton value={row.label.trim()} label="Copy driver name" />}
          {row.detail && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">{row.detail}</span>}
        </span>
      </td>
      <td className={`${S.td} text-right font-mono ${daysCls}`}>{fmtDays(row.days_idle)}</td>
      <td className={`${S.td} text-right`}>
        <span className={`font-mono ${Number(row.monthly_cost) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-slate-600'}`}>{Number(row.monthly_cost) > 0 ? `${fmtMoney(row.monthly_cost)}/mo` : '$0'}</span>
        {row.extra && <div className="text-[11px] text-gray-500 dark:text-slate-500">{row.extra}</div>}
      </td>
      <td className={S.td}>{reasonCell}</td>
      {actionsCell}
    </tr>
  )
}
