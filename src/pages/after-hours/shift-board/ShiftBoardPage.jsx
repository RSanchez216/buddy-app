import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import PriorityGroup from './PriorityGroup'
import EndShiftModal from './EndShiftModal'
import TimesNeededGroup from './TimesNeededGroup'
import CheckpointEditor from './CheckpointEditor'
import RequestDetailPanel from './RequestDetailPanel'
import {
  SHIFT_TYPES, GROUP_META, groupKeyFor, shiftName,
  fetchSettings, fetchOpenShift, startShift, fetchShiftSummary, fetchWeekSummary, fetchBoard,
  fetchCheckpointExceptions,
  upsertDriverCheck, removeDriverCheck, logShiftActivity,
  thisWeekChicago, todayChicago, fmtDayLabel, elapsedSince,
  buildGroupCopy, buildWeekCopy, copyText,
} from './shiftBoardData'
import { REQUESTS_CHANGED_EVENT } from '../requests/requestsData'

export default function ShiftBoardPage() {
  const { profile: me } = useAuth()
  const toast = useToast()

  const [settings, setSettings] = useState({})
  const [shift, setShift] = useState(null)      // open shift row
  const [summary, setSummary] = useState(null)  // shift summary
  const [week, setWeek] = useState(null)
  const [board, setBoard] = useState([])
  const [exceptions, setExceptions] = useState([]) // checkpoint exception queue (phase 3)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const [flagFor, setFlagFor] = useState(null)  // row being flagged
  const [cpOpen, setCpOpen] = useState(true)    // Times-needed group expanded
  const [editTarget, setEditTarget] = useState(null) // load being checkpointed
  const [openRequestId, setOpenRequestId] = useState(null) // raised request detail panel
  const [, setNowTick] = useState(0)

  const trackCheckpoints = !!settings?.track_checkpoints

  const weekRange = useMemo(() => thisWeekChicago(), [])
  const dateLabel = useMemo(() => fmtDayLabel(todayChicago()), [])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [st, wk, sh] = await Promise.all([
        fetchSettings(), fetchWeekSummary(weekRange.start, weekRange.end), fetchOpenShift(me?.id),
      ])
      setSettings(st || {}); setWeek(wk); setShift(sh)
      const [bd, sm, ex] = await Promise.all([
        fetchBoard(sh?.id ?? null),
        sh ? fetchShiftSummary(sh.id) : Promise.resolve(null),
        st?.track_checkpoints ? fetchCheckpointExceptions() : Promise.resolve([]),
      ])
      setBoard(bd); setSummary(sm); setExceptions(ex)
    } catch (e) {
      setError(true); toast.error("Couldn't load the shift board", e)
    } finally { setLoading(false) }
  }, [me?.id, weekRange.start, weekRange.end, toast])

  useEffect(() => { load() }, [load])

  // Active users for the handoff "hand off to" picker.
  useEffect(() => {
    supabase.from('users').select('id, full_name').eq('status', 'active').order('full_name')
      .then(({ data }) => setUsers(data || [])).catch(() => {})
  }, [])

  // Keep elapsed time roughly live.
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  const reloadBoard = useCallback(async () => {
    const [bd, sm, ex] = await Promise.all([
      fetchBoard(shift?.id ?? null),
      shift ? fetchShiftSummary(shift.id) : Promise.resolve(null),
      settings?.track_checkpoints ? fetchCheckpointExceptions() : Promise.resolve([]),
    ])
    setBoard(bd); setSummary(sm); setExceptions(ex)
  }, [shift, settings?.track_checkpoints])

  // A request raised/handled anywhere refreshes the board so "Raised by dispatch"
  // updates within one refresh while the board is open.
  useEffect(() => {
    const h = () => reloadBoard()
    window.addEventListener(REQUESTS_CHANGED_EVENT, h)
    return () => window.removeEventListener(REQUESTS_CHANGED_EVENT, h)
  }, [reloadBoard])

  async function doStart(type) {
    setStarting(true)
    try {
      const res = await startShift(type)
      const sh = { id: res.shift_id, shift_type: res.shift_type, started_at: res.started_at, status: 'active' }
      setShift(sh)
      const [bd, sm, ex] = await Promise.all([
        fetchBoard(sh.id), fetchShiftSummary(sh.id),
        settings?.track_checkpoints ? fetchCheckpointExceptions() : Promise.resolve([]),
      ])
      setBoard(bd); setSummary(sm); setExceptions(ex)
      toast.success(res.resumed ? 'Resumed your open shift' : 'Shift started')
    } catch (e) {
      toast.error("Couldn't start the shift", e)
    } finally { setStarting(false) }
  }

  async function onOk(row, checked) {
    if (!shift) return
    try {
      if (checked) await upsertDriverCheck({ shiftId: shift.id, driverId: row.driver_id, loadId: row.load_id, checkedBy: me?.id, isOk: true })
      else await removeDriverCheck(shift.id, row.driver_id)
      await reloadBoard()
    } catch (e) { toast.error("Couldn't update the review", e) }
  }

  // Row actions record via log_shift_activity — no open shift required; the shift
  // is attached automatically when one is open. Requests are handled from the
  // detail panel (handle_help_request), not here.
  async function onAction(row, type) {
    try {
      await logShiftActivity(type, row.load_id, row.driver_id)
      const labels = { load_booked: 'Load booked', pod_collected: 'POD logged', bol_collected: 'BOL logged', escalated: 'Escalated' }
      toast.success(labels[type] || 'Logged')
      await reloadBoard()
    } catch (e) { toast.error("Couldn't log that action", e) }
  }

  async function saveFlag(note) {
    if (!shift || !flagFor) return
    try {
      await upsertDriverCheck({ shiftId: shift.id, driverId: flagFor.driver_id, loadId: flagFor.load_id, checkedBy: me?.id, isOk: false, issueNote: note.trim() || null })
      setFlagFor(null)
      toast.success('Issue flagged')
      await reloadBoard()
    } catch (e) { toast.error("Couldn't flag the issue", e) }
  }

  const shiftLabel = shift ? shiftName(shift.shift_type) : '—'

  const grouped = useMemo(() => {
    // Group rows by key, carrying the RPC's group_order so the page order is
    // authoritative (never a hardcoded sequence). raised/uncovered share order 1;
    // raised is pulled out first at render time, so no tiebreaker is needed here.
    const map = new Map()
    for (const r of board) {
      const k = groupKeyFor(r)
      if (!map.has(k)) map.set(k, { order: Number(r.group_order ?? 99), rows: [] })
      map.get(k).rows.push(r)
    }
    return [...map.entries()]
      .map(([key, v]) => ({ g: GROUP_META[key], rows: v.rows, order: v.order }))
      .filter(x => x.g && x.rows.length > 0)
      .sort((a, b) => a.order - b.order)
  }, [board])

  // Tabs replace the stacked groups. Order is group_order (already sorted in
  // `grouped`). Empty tabs hide, except Raised by dispatch which stays visible at
  // 0 so the associate can see nothing's waiting.
  const tabs = useMemo(() => {
    const list = grouped.map(x => ({ key: x.g.key, g: x.g, count: x.rows.length, order: x.order }))
    if (!list.some(t => t.key === 'raised')) list.push({ key: 'raised', g: GROUP_META.raised, count: 0, order: 1 })
    return list.sort((a, b) => a.order - b.order)
  }, [grouped])

  // The effective tab is the user's explicit pick when it's still a live tab,
  // otherwise the default: Raised when it has something, else All active drivers.
  // Derived (not stored) so it self-corrects after a reload without an effect.
  const [selectedTab, setSelectedTab] = useState(null)
  const activeTab = useMemo(() => {
    if (selectedTab && tabs.some(t => t.key === selectedTab)) return selectedTab
    const raised = tabs.find(t => t.key === 'raised')
    return raised && raised.count > 0 ? 'raised' : (tabs.find(t => t.key === 'todo')?.key || tabs[0]?.key || null)
  }, [selectedTab, tabs])
  const activeRows = useMemo(() => grouped.find(x => x.g.key === activeTab)?.rows || [], [grouped, activeTab])
  const activeMeta = activeTab ? GROUP_META[activeTab] : null

  // Board row per load — lets a Times-needed row prefill the editor with the
  // load's existing checkpoint timestamps.
  const boardByLoad = useMemo(() => {
    const m = new Map()
    for (const r of board) if (r.load_id) m.set(r.load_id, r)
    return m
  }, [board])
  const openFromRow = (r) => {
    if (!r.load_id) return
    setEditTarget({ loadId: r.load_id, loadNumber: r.load_number, driverName: r.driver_name, pickupIn: r.cp_pickup_in, pickupOut: r.cp_pickup_out, deliveryIn: r.cp_delivery_in, deliveryOut: r.cp_delivery_out })
  }
  const openFromException = (e) => {
    const r = boardByLoad.get(e.load_id)
    setEditTarget({ loadId: e.load_id, loadNumber: e.load_number, driverName: e.driver_name, pickupIn: r?.cp_pickup_in ?? null, pickupOut: r?.cp_pickup_out ?? null, deliveryIn: r?.cp_delivery_in ?? null, deliveryOut: r?.cp_delivery_out ?? null })
  }

  async function copyGroup(g, rows) {
    try { await copyText(buildGroupCopy({ heading: g.heading, rows, shiftLabel, dateLabel })); toast.success('Group copied') }
    catch (e) { toast.error("Couldn't copy", e) }
  }
  async function copyWeek() {
    try { await copyText(buildWeekCopy(week, dateLabel)); toast.success('Week summary copied') }
    catch (e) { toast.error("Couldn't copy", e) }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <>
          <BoardHeader shift={shift} week={week} starting={starting} onStart={doStart} onEnd={() => setShowEnd(true)} onCopyWeek={copyWeek} />
          <div className={S.errorBox}>Couldn&apos;t load the shift board. <button onClick={load} className="underline font-medium">Retry</button></div>
        </>
      ) : loading ? (
        <div className="space-y-3">
          <div className="h-24 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          <div className="h-10 rounded-xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          <div className="h-64 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
        </div>
      ) : (
        <>
          {/* Compact one-line header: title + shift control, then week stat strip */}
          <BoardHeader shift={shift} week={week} starting={starting} onStart={doStart} onEnd={() => setShowEnd(true)} onCopyWeek={copyWeek} />

          {/* Per-shift progress — only while on shift */}
          {shift && summary && <ShiftStats summary={summary} />}

          {/* Detention queue — surfaced above the tabs only when there's actually
              something waiting at a dock. */}
          {trackCheckpoints && exceptions.length > 0 && (
            <TimesNeededGroup exceptions={exceptions} expanded={cpOpen} onToggle={() => setCpOpen(o => !o)} onOpen={openFromException} />
          )}

          {/* Tabs replace the stacked groups; Copy group sits on the right */}
          <div className="flex items-center gap-1 border-b border-gray-200 dark:border-white/10 overflow-x-auto">
            {tabs.map(t => {
              const on = t.key === activeTab
              const tone = TAB_TONE[t.key] || TAB_TONE._default
              return (
                <button key={t.key} onClick={() => setSelectedTab(t.key)}
                  className={`relative shrink-0 px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${on ? tone.text : 'text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300'}`}>
                  {t.g.heading}
                  <span className={`ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${on ? tone.chip : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-slate-500'}`}>{t.count}</span>
                  {on && <span className={`absolute left-0 right-0 -bottom-px h-0.5 ${tone.underline}`} />}
                </button>
              )
            })}
            {activeMeta && activeRows.length > 0 && (
              <button onClick={() => copyGroup(activeMeta, activeRows)} title="Copy this tab as plain text"
                className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">
                📋 Copy group
              </button>
            )}
          </div>

          {activeMeta && (
            <PriorityGroup group={activeMeta} rows={activeRows} settings={settings} shift={shift}
              onOk={onOk} onAction={onAction} onFlag={setFlagFor} onCheckpoints={openFromRow} onOpenRequest={setOpenRequestId} />
          )}
        </>
      )}

      {editTarget && (
        <CheckpointEditor target={editTarget} shiftId={shift?.id ?? null}
          onClose={() => setEditTarget(null)} onSaved={reloadBoard} toast={toast} />
      )}
      {flagFor && <FlagPopover row={flagFor} onClose={() => setFlagFor(null)} onSave={saveFlag} />}
      <EndShiftModal open={showEnd} shift={shift} users={users.filter(u => u.id !== me?.id)}
        onClose={() => setShowEnd(false)} onEnded={() => { setShowEnd(false); load() }} />
      <RequestDetailPanel open={!!openRequestId} requestId={openRequestId}
        onClose={() => setOpenRequestId(null)} onChanged={reloadBoard} toast={toast} />
    </div>
  )
}

// ── Compact header ──────────────────────────────────────────────────────────
const ORANGE_BTN_SM = 'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors disabled:opacity-50'
// Tab colour per group. Red / green / grey are the three live today; the rest
// keep sensible tones for when their phase or condition surfaces them.
const TAB_TONE = {
  raised:           { text: 'text-red-600 dark:text-red-400',       underline: 'bg-red-500',     chip: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' },
  uncovered:        { text: 'text-orange-600 dark:text-orange-400',  underline: 'bg-orange-500',  chip: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300' },
  due:              { text: 'text-amber-600 dark:text-amber-400',    underline: 'bg-amber-500',   chip: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
  idle:             { text: 'text-gray-600 dark:text-slate-300',     underline: 'bg-gray-400',    chip: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300' },
  reviewed:         { text: 'text-gray-600 dark:text-slate-300',     underline: 'bg-gray-400',    chip: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300' },
  todo:             { text: 'text-emerald-600 dark:text-emerald-400', underline: 'bg-emerald-500', chip: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' },
  never_dispatched: { text: 'text-gray-600 dark:text-slate-300',     underline: 'bg-gray-400',    chip: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300' },
  _default:         { text: 'text-gray-600 dark:text-slate-300',     underline: 'bg-gray-400',    chip: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300' },
}

// 'YYYY-MM-DD' → 'Jul 27' (Chicago-agnostic — the range is already date-only).
function shortDay(v) {
  const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return v || ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function BoardHeader({ shift, week, starting, onStart, onEnd, onCopyWeek }) {
  const stats = [
    ['SHIFTS', week?.shifts_logged ?? 0, 'Shifts logged this week'],
    ['BOOKED', week?.loads_booked ?? 0, 'Loads booked by After-Hours this week'],
    ['POD', week?.pods ?? 0, 'Proofs of delivery collected this week'],
    ['BOL', week?.bols ?? 0, 'Bills of lading collected this week'],
    ['CHKPT', week?.checkpoints ?? 0, 'Driver checkpoint times collected this week'],
    ['ACC', week?.accessorials_count ?? 0, 'Detention, layover and TONU claims raised this week'],
    ['LUMPERS', week?.lumpers_count ?? 0, 'Lumper payments recorded this week'],
    ['REQUESTS', week?.requests_raised ?? 0, 'Help requests raised by dispatch this week'],
  ]
  return (
    <div className={`${S.card} px-4 py-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> After Hours
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Shift Board</h1>
        </div>
        <ShiftControl shift={shift} starting={starting} onStart={onStart} onEnd={onEnd} />
      </div>

      <div className="my-2.5 border-t border-gray-100 dark:border-white/5" />

      <div className="flex flex-wrap items-center gap-y-1.5">
        <div className="flex flex-wrap items-center">
          {stats.map(([label, val, tip], i) => (
            <div key={label} title={tip} className="flex items-center cursor-default">
              {i > 0 && <span className="mx-2 text-gray-200 dark:text-white/10">·</span>}
              <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{val}</span>
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</span>
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 pl-3">
          <span className="text-[11px] text-gray-400 dark:text-slate-500 whitespace-nowrap tabular-nums">{shortDay(week?.range_start)} – {shortDay(week?.range_end)}</span>
          <button onClick={onCopyWeek} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 whitespace-nowrap">📋 Copy week</button>
        </div>
      </div>
    </div>
  )
}

// Top-right shift control: status text + a Start-shift dropdown, or the live
// on-shift state + End shift. Off-shift status carries the "still recorded" note
// as a tooltip, so the old banner isn't needed.
function ShiftControl({ shift, starting, onStart, onEnd }) {
  const [open, setOpen] = useState(false)
  if (shift) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> On shift · {shiftName(shift.shift_type)} · {elapsedSince(shift.started_at)}
        </span>
        <button onClick={onEnd} className={ORANGE_BTN_SM}>End shift</button>
      </div>
    )
  }
  return (
    <div className="relative flex items-center gap-2 shrink-0">
      <span title="Actions are still recorded, just not counted toward a shift." className="text-[11px] font-medium text-gray-500 dark:text-slate-400 cursor-default whitespace-nowrap">Not on shift</span>
      <button onClick={() => setOpen(o => !o)} disabled={starting} className={ORANGE_BTN_SM}>Start shift ▾</button>
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-xl py-1">
          {SHIFT_TYPES.map(s => (
            <button key={s.value} onClick={() => { setOpen(false); onStart(s.value) }} disabled={starting}
              className="w-full flex items-baseline justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
              <span className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</span>
              <span className="text-[11px] text-gray-400 dark:text-slate-500">{s.window}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shift stats ─────────────────────────────────────────────────────────────
function ShiftStats({ summary }) {
  const reviewed = Number(summary.drivers_reviewed) || 0
  const total = Number(summary.active_drivers) || 0
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0
  const cards = [
    ['Loads booked', summary.loads_booked, 'LOG'],
    ['PODs', summary.pods_collected, 'LOG'],
    ['BOLs', summary.bols_collected, 'LOG'],
    ['Checkpoints', summary.checkpoints, 'LOG'],
    ['Escalations', summary.escalations, 'LOG'],
    ['Accessorials', summary.accessorials, 'LOG'],
    ['Lumpers', summary.lumpers, 'AUTO'],
    ['Flagged', summary.drivers_flagged, 'LOG'],
  ]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
      {/* Hero — drivers reviewed */}
      <div className="sm:col-span-2 lg:col-span-2 rounded-2xl border-2 border-orange-300 dark:border-orange-500/40 bg-gradient-to-br from-orange-50 to-orange-100/60 dark:from-orange-500/[0.12] dark:to-orange-500/[0.04] p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-orange-700/80 dark:text-orange-400/80">Drivers reviewed</p>
        <p className="text-4xl font-black text-orange-600 dark:text-orange-400 font-mono tabular-nums leading-tight mt-1">{reviewed} <span className="text-2xl text-orange-500/60 dark:text-orange-400/50">/ {total}</span></p>
        <div className="mt-3 h-2 rounded-full bg-orange-200/60 dark:bg-orange-500/20 overflow-hidden">
          <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-orange-700/70 dark:text-orange-400/70 mt-1.5">{pct}% of active drivers checked this shift</p>
      </div>
      {cards.map(([label, val, badge]) => (
        <div key={label} className={`${S.card} px-4 py-3`}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
            <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${badge === 'AUTO' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-slate-400'}`}>{badge}</span>
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-white font-mono tabular-nums leading-tight mt-1">{Number(val) || 0}</p>
        </div>
      ))}
    </div>
  )
}

// ── Flag issue popover ──────────────────────────────────────────────────────
function FlagPopover({ row, onClose, onSave }) {
  const [note, setNote] = useState('')
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0B1120] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Flag an issue</h3>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 truncate">{row.driver_name}{row.load_number ? ` · #${row.load_number}` : ''}</p>
        </div>
        <textarea rows={3} autoFocus className={S.textarea} value={note} onChange={e => setNote(e.target.value)} placeholder="What's wrong — missing paperwork, wrong location, no answer…" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={() => onSave(note)} className="px-4 py-2 text-sm font-semibold bg-red-500 hover:bg-red-400 text-white rounded-xl transition-colors">Flag it</button>
        </div>
      </div>
    </div>
  )
}
