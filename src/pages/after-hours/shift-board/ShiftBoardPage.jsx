import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import PriorityGroup from './PriorityGroup'
import EndShiftModal from './EndShiftModal'
import {
  SHIFT_TYPES, GROUPS, groupKeyFor, shiftName, shiftWindow,
  fetchSettings, fetchOpenShift, startShift, fetchShiftSummary, fetchWeekSummary, fetchBoard,
  upsertDriverCheck, removeDriverCheck, logActivity, markRequestHandled,
  thisWeekChicago, todayChicago, fmtDayLabel, fmtClock, elapsedSince,
  buildGroupCopy, buildWeekCopy, copyText,
} from './shiftBoardData'

const ORANGE_BTN = 'flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20'

export default function ShiftBoardPage() {
  const { profile: me } = useAuth()
  const toast = useToast()

  const [settings, setSettings] = useState({})
  const [shift, setShift] = useState(null)      // open shift row
  const [summary, setSummary] = useState(null)  // shift summary
  const [week, setWeek] = useState(null)
  const [board, setBoard] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const [flagFor, setFlagFor] = useState(null)  // row being flagged
  const [, setNowTick] = useState(0)

  const weekRange = useMemo(() => thisWeekChicago(), [])
  const dateLabel = useMemo(() => fmtDayLabel(todayChicago()), [])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [st, wk, sh] = await Promise.all([
        fetchSettings(), fetchWeekSummary(weekRange.start, weekRange.end), fetchOpenShift(me?.id),
      ])
      setSettings(st || {}); setWeek(wk); setShift(sh)
      const [bd, sm] = await Promise.all([fetchBoard(sh?.id ?? null), sh ? fetchShiftSummary(sh.id) : Promise.resolve(null)])
      setBoard(bd); setSummary(sm)
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
    const [bd, sm] = await Promise.all([fetchBoard(shift?.id ?? null), shift ? fetchShiftSummary(shift.id) : Promise.resolve(null)])
    setBoard(bd); setSummary(sm)
  }, [shift])

  async function doStart(type) {
    setStarting(true)
    try {
      const res = await startShift(type)
      const sh = { id: res.shift_id, shift_type: res.shift_type, started_at: res.started_at, status: 'active' }
      setShift(sh)
      const [bd, sm] = await Promise.all([fetchBoard(sh.id), fetchShiftSummary(sh.id)])
      setBoard(bd); setSummary(sm)
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

  async function onAction(row, type) {
    if (!shift) return
    try {
      await logActivity({ shiftId: shift.id, type, loadId: row.load_id, loadNumber: row.load_number, driverId: row.driver_id, userId: me?.id })
      // Booking against a raised request marks that request handled.
      if (type === 'load_booked' && row.open_request_id) await markRequestHandled(row.open_request_id, me?.id)
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

  // Expanded/collapsed per group (seeded from defaults).
  const [expanded, setExpanded] = useState(() => new Set(GROUPS.filter(g => g.expanded).map(g => g.key)))
  const toggleGroup = (key) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of board) { const k = groupKeyFor(r); if (!map.has(k)) map.set(k, []); map.get(k).push(r) }
    return GROUPS.map(g => ({ g, rows: map.get(g.key) || [] })).filter(x => x.rows.length > 0)
  }, [board])

  async function copyGroup(g, rows) {
    try { await copyText(buildGroupCopy({ heading: g.heading, rows, shiftLabel, dateLabel })); toast.success('Group copied') }
    catch (e) { toast.error("Couldn't copy", e) }
  }
  async function copyWeek() {
    try { await copyText(buildWeekCopy(week, dateLabel)); toast.success('Week summary copied') }
    catch (e) { toast.error("Couldn't copy", e) }
  }

  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> After Hours
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shift Board</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Every active driver, grouped by what needs doing tonight.</p>
      </div>

      {error ? (
        <div className={S.errorBox}>Couldn&apos;t load the shift board. <button onClick={load} className="underline font-medium">Retry</button></div>
      ) : loading ? (
        <div className="space-y-4">
          <div className="h-20 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          <div className="h-24 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
          <div className="h-40 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
        </div>
      ) : (
        <>
          {/* 1. Shift header */}
          <ShiftHeader shift={shift} summary={summary} starting={starting} onStart={doStart}
            onEnd={() => setShowEnd(true)} />

          {/* 2. This-week block (above shift stats) */}
          <WeekBlock week={week} onCopy={copyWeek} />

          {/* 3. Shift stats */}
          {shift && summary && <ShiftStats summary={summary} />}

          {/* 4. Priority groups */}
          {grouped.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 p-8 text-center text-sm text-gray-400 dark:text-slate-500">No active drivers on the board.</div>
          ) : (
            <div className="space-y-3">
              {grouped.map(({ g, rows }) => (
                <PriorityGroup key={g.key} group={g} rows={rows}
                  expanded={expanded.has(g.key)} onToggle={() => toggleGroup(g.key)}
                  onCopy={() => copyGroup(g, rows)} settings={settings} shift={shift}
                  onOk={onOk} onAction={onAction} onFlag={setFlagFor} />
              ))}
            </div>
          )}
        </>
      )}

      {flagFor && <FlagPopover row={flagFor} onClose={() => setFlagFor(null)} onSave={saveFlag} />}
      <EndShiftModal open={showEnd} shift={shift} users={users}
        onClose={() => setShowEnd(false)} onEnded={() => { setShowEnd(false); load() }} />
    </div>
  )
}

// ── Shift header ────────────────────────────────────────────────────────────
function ShiftHeader({ shift, summary, starting, onStart, onEnd }) {
  if (!shift) {
    return (
      <div className={`${S.card} p-5`}>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">Start your shift</p>
        <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 mb-3">Pick the shift you&apos;re covering. Resumes automatically if you already have one open.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SHIFT_TYPES.map(s => (
            <button key={s.value} onClick={() => onStart(s.value)} disabled={starting}
              className="rounded-xl border border-gray-300 dark:border-slate-700 px-3 py-3 text-left hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-500/10 transition-colors disabled:opacity-50">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.name}</p>
              <p className="text-[11px] text-gray-500 dark:text-slate-500">{s.window}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className={`${S.card} p-5 flex flex-wrap items-center gap-x-6 gap-y-2`}>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">On shift</span>
      </div>
      <Fact label="Shift" value={shiftName(shift.shift_type)} />
      <Fact label="Associate" value={summary?.associate || '—'} />
      <Fact label="Window" value={shiftWindow(shift.shift_type)} />
      <Fact label="Elapsed" value={elapsedSince(shift.started_at)} />
      <Fact label="Started" value={fmtClock(shift.started_at)} />
      <div className="ml-auto flex items-center gap-2">
        <button onClick={onEnd} className={ORANGE_BTN}>End shift &amp; hand off</button>
      </div>
    </div>
  )
}
function Fact({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{value}</p>
    </div>
  )
}

// ── Week block ──────────────────────────────────────────────────────────────
function WeekBlock({ week, onCopy }) {
  const cards = [
    ['Shifts logged', week?.shifts_logged ?? 0],
    ['Loads booked', week?.loads_booked ?? 0],
    ['PODs', week?.pods ?? 0],
    ['BOLs', week?.bols ?? 0],
    ['Checkpoints', week?.checkpoints ?? 0],
    ['Accessorials', week?.accessorials_count ?? 0],
    ['Lumpers', week?.lumpers_count ?? 0],
    ['Requests raised', week?.requests_raised ?? 0],
  ]
  return (
    <div className={`${S.card} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">This week · {week?.range_start} → {week?.range_end}</p>
        <button onClick={onCopy} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">📋 Copy week summary</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {cards.map(([label, val]) => (
          <div key={label} className="rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2.5">
            <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums leading-none">{val}</p>
            <p className="text-[10px] text-gray-500 dark:text-slate-500 uppercase tracking-wide mt-1">{label}</p>
          </div>
        ))}
      </div>
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
