import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
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
  SHIFT_TYPES, GROUP_META, groupKeyFor, shiftName, LIFECYCLE, LIFECYCLE_RANK,
  fetchSettings, fetchOpenShift, startShift, fetchShiftSummary, fetchWeekSummary, fetchBoard, fetchBoardTabs,
  fetchCheckpointExceptions,
  upsertDriverCheck, logShiftActivity,
  fetchRowActions, updateShiftActivity, deleteShiftActivity, clearDriverCheck,
  fetchEscalationRecipients, acknowledgeEscalation, fetchEscalationCopyText,
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
  const [boardTabs, setBoardTabs] = useState(null) // per-tab progress + tone
  const [rowActions, setRowActions] = useState([]) // per-driver activities + check state
  const [recipients, setRecipients] = useState([]) // escalation targets (admins/managers)
  const [exceptions, setExceptions] = useState([]) // checkpoint exception queue (phase 3)
  const [actionTarget, setActionTarget] = useState(null) // { row, type, existing } — popover
  const [searchInput, setSearchInput] = useState('')    // raw search box value
  const [search, setSearch] = useState('')              // debounced query
  const [highlightDriver, setHighlightDriver] = useState(null) // deep-link target
  const [params] = useSearchParams()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const [cpOpen, setCpOpen] = useState(true)    // Times-needed group expanded
  const [editTarget, setEditTarget] = useState(null) // load being checkpointed
  const [openRequestId, setOpenRequestId] = useState(null) // raised request detail panel
  const [, setNowTick] = useState(0)

  const trackCheckpoints = !!settings?.track_checkpoints

  const weekRange = useMemo(() => thisWeekChicago(), [])
  const dateLabel = useMemo(() => fmtDayLabel(todayChicago()), [])

  // Read these through refs so the data callbacks don't list them as deps.
  // `toast` is the critical one: ToastContext hands back a fresh `value` object
  // every time a toast appears or auto-dismisses, so putting it in a dep array
  // recreates the callback and refires the mount effect — that was the phantom
  // refetch on toast-show and again ~3s later on toast-dismiss.
  const toastRef = useRef(toast); toastRef.current = toast
  const settingsRef = useRef(settings); settingsRef.current = settings
  const shiftRef = useRef(shift); shiftRef.current = shift

  // One coordinated refresh of everything that moves after a shift transition or
  // a board action: board, its tabs, the shift summary, the checkpoint queue and
  // (only when asked) the week strip. Deliberately does NOT refetch settings — a
  // single config row loaded once on mount. Stable identity (weekRange is memo'd)
  // so no effect churns on it. Pass the shift row to target (post start/end),
  // omit to use the current one.
  const refresh = useCallback(async (shArg, { week = false } = {}) => {
    const sh = shArg !== undefined ? shArg : shiftRef.current
    const [bd, sm, ex, tb, ra, wk] = await Promise.all([
      fetchBoard(sh?.id ?? null),
      sh ? fetchShiftSummary(sh.id) : Promise.resolve(null),
      settingsRef.current?.track_checkpoints ? fetchCheckpointExceptions() : Promise.resolve([]),
      fetchBoardTabs(sh?.id ?? null).catch(() => null),
      sh ? fetchRowActions(sh.id).catch(() => []) : Promise.resolve([]),
      week ? fetchWeekSummary(weekRange.start, weekRange.end) : Promise.resolve(undefined),
    ])
    setBoard(bd); setSummary(sm); setExceptions(ex); setBoardTabs(tb); setRowActions(ra)
    if (week && wk !== undefined) setWeek(wk)
  }, [weekRange.start, weekRange.end])

  // Light refresh after a row action: just the affected state and counters — row
  // actions, tab progress and the shift summary — never the 128-row board. One
  // fast cycle, so a button reflects a confirmed write immediately.
  const refreshActions = useCallback(async () => {
    const sh = shiftRef.current
    if (!sh) { await refresh(); return }
    const [ra, tb, sm] = await Promise.all([
      fetchRowActions(sh.id).catch(() => []),
      fetchBoardTabs(sh.id).catch(() => null),
      fetchShiftSummary(sh.id),
    ])
    setRowActions(ra); setBoardTabs(tb); setSummary(sm)
  }, [refresh])

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [st, wk, sh] = await Promise.all([
        fetchSettings(), fetchWeekSummary(weekRange.start, weekRange.end), fetchOpenShift(me?.id),
      ])
      setSettings(st || {}); setWeek(wk); setShift(sh)
      settingsRef.current = st || {} // so a refresh in the same tick sees track_checkpoints
      const [bd, sm, ex, tb, ra] = await Promise.all([
        fetchBoard(sh?.id ?? null),
        sh ? fetchShiftSummary(sh.id) : Promise.resolve(null),
        st?.track_checkpoints ? fetchCheckpointExceptions() : Promise.resolve([]),
        fetchBoardTabs(sh?.id ?? null).catch(() => null),
        sh ? fetchRowActions(sh.id).catch(() => []) : Promise.resolve([]),
      ])
      setBoard(bd); setSummary(sm); setExceptions(ex); setBoardTabs(tb); setRowActions(ra)
    } catch (e) {
      setError(true); toastRef.current.error("Couldn't load the shift board", e)
    } finally { setLoading(false) }
  }, [me?.id, weekRange.start, weekRange.end])

  useEffect(() => { load() }, [load])

  // Active users for the handoff "hand off to" picker.
  useEffect(() => {
    supabase.from('users').select('id, full_name').eq('status', 'active').order('full_name')
      .then(({ data }) => setUsers(data || [])).catch(() => {})
  }, [])

  // Escalation recipients — small, static-ish list; fetched once.
  useEffect(() => { fetchEscalationRecipients().then(setRecipients).catch(() => {}) }, [])

  // Debounce the search box (~200ms). setState fires from the timer, not the
  // effect body, so it doesn't churn.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 200)
    return () => clearTimeout(id)
  }, [searchInput])

  // Keep elapsed time roughly live.
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  // A request raised/handled anywhere refreshes the board so "Raised by dispatch"
  // updates within one refresh while the board is open.
  useEffect(() => {
    const h = () => refresh()
    window.addEventListener(REQUESTS_CHANGED_EVENT, h)
    return () => window.removeEventListener(REQUESTS_CHANGED_EVENT, h)
  }, [refresh])

  // Realtime push (not a poll — no idle requests): when a shift_activity for this
  // shift changes elsewhere — e.g. the recipient acknowledges an escalation —
  // light-refresh so the raiser sees it without reloading.
  useEffect(() => {
    if (!shift?.id) return
    const nonce = Math.random().toString(36).slice(2, 10)
    const ch = supabase
      .channel(`shift-activities-${shift.id}-${nonce}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_activities', filter: `shift_id=eq.${shift.id}` }, () => refreshActions())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [shift?.id, refreshActions])

  async function doStart(type) {
    setStarting(true)
    try {
      const res = await startShift(type)
      const sh = { id: res.shift_id, shift_type: res.shift_type, started_at: res.started_at, status: 'active' }
      setShift(sh)
      await refresh(sh, { week: true }) // one coordinated cycle; settings untouched
      toastRef.current.success(res.resumed ? 'Resumed your open shift' : 'Shift started')
    } catch (e) {
      toastRef.current.error("Couldn't start the shift", e)
    } finally { setStarting(false) }
  }

  // End is committed by EndShiftModal; here we just reflect it and refresh once.
  async function doEnded() {
    setShowEnd(false)
    setShift(null)
    await refresh(null, { week: true })
  }

  // Ticking checks the driver; unticking clears the whole check row (which also
  // decrements the tab counter). A flag is the same row with is_ok=false.
  async function onOk(row, checked) {
    if (!shift) return
    try {
      if (checked) await upsertDriverCheck({ shiftId: shift.id, driverId: row.driver_id, loadId: row.load_id, checkedBy: me?.id, isOk: true })
      else await clearDriverCheck(shift.id, row.driver_id)
      await refreshActions()
    } catch (e) { toast.error("Couldn't update the review", e) }
  }

  // Every action opens a popover first (openAct). Saving routes to the right RPC:
  // a flag is a driver-check; Book/POD/BOL/Esc are logged activities. Editing an
  // existing one updates it; Book captures the booked load number, Esc the
  // recipient (which also fires a notification).
  const openAct = (row, type, existing) => setActionTarget({ row, type, existing: existing || null })

  async function submitAction(note, loadNumber, mentioned) {
    const t = actionTarget
    if (!t) return
    const trimmed = (note || '').trim()
    try {
      // Escalate is mention-driven: the first @mention is the primary recipient,
      // every mention gets a notification. Keep the popover open (return the id)
      // so Copy for Telegram is right there.
      if (t.type === 'escalated') {
        const ids = mentioned || []
        if (!ids.length) { toast.error('Mention someone with @ so they get notified.'); return }
        let activityId
        if (t.existing) {
          const prev = parseMentions(t.existing.note || '', recipients, me?.id)
          const same = prev.length === ids.length && prev.every((v, i) => v === ids[i])
          if (same) { await updateShiftActivity(t.existing.id, trimmed || null, null); activityId = t.existing.id }
          else { await deleteShiftActivity(t.existing.id); activityId = (await logShiftActivity('escalated', t.row.load_id, t.row.driver_id, trimmed || null, null, ids))?.id }
        } else {
          activityId = (await logShiftActivity('escalated', t.row.load_id, t.row.driver_id, trimmed || null, null, ids))?.id
        }
        toast.success('Escalated')
        await refreshActions()
        return activityId || (t.existing?.id ?? null)
      }

      if (t.type === 'flag') {
        if (!shift) { toast.error('Start a shift to flag'); return }
        await upsertDriverCheck({ shiftId: shift.id, driverId: t.row.driver_id, loadId: t.row.load_id, checkedBy: me?.id, isOk: false, issueNote: trimmed || null })
      } else if (t.existing) {
        await updateShiftActivity(t.existing.id, trimmed || null, t.type === 'load_booked' ? (loadNumber || null) : null)
      } else {
        const res = await logShiftActivity(t.type, t.row.load_id, t.row.driver_id, trimmed || null)
        // Book captures the actual load number typed (may differ from the row's).
        if (t.type === 'load_booked' && loadNumber && res?.id) await updateShiftActivity(res.id, trimmed || null, loadNumber)
      }
      const labels = { load_booked: 'Load booked', pod_collected: 'POD logged', bol_collected: 'BOL logged', flag: 'Issue flagged' }
      toast.success(labels[t.type] || 'Saved')
      setActionTarget(null)
      await refreshActions()
    } catch (e) { toast.error("Couldn't save that", e) }
  }

  async function removeAction() {
    const t = actionTarget
    if (!t) return
    try {
      if (t.type === 'flag') await clearDriverCheck(shift?.id, t.row.driver_id)
      else if (t.existing) await deleteShiftActivity(t.existing.id)
      setActionTarget(null)
      await refreshActions()
    } catch (e) { toast.error("Couldn't remove that", e) }
  }

  async function onAcknowledge(activityId) {
    try {
      await acknowledgeEscalation(activityId)
      toast.success('Acknowledged')
      await refreshActions()
    } catch (e) { toast.error("Couldn't acknowledge", e) }
  }

  async function copyEscalation(activityId) {
    try {
      const text = await fetchEscalationCopyText(activityId)
      await copyText(text)
      toast.success('Escalation copied for Telegram')
    } catch (e) { toast.error("Couldn't copy", e) }
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
    const base = grouped.map(x => ({ key: x.g.key, g: x.g, count: x.rows.length, order: x.order }))
    // Raised stays visible even at 0 so the associate can see nothing's waiting.
    if (!base.some(t => t.key === 'raised')) base.push({ key: 'raised', g: GROUP_META.raised, count: 0, order: 1 })
    return base
      .map(t => {
        const prog = boardTabs?.[RPC_KEY[t.key]] || null
        const tone = prog?.tone || GROUP_TONE_FALLBACK[t.key] || 'grey'
        // Chip is progress ("done of total") where the RPC provides it, else the
        // plain count. Raised counts handled/total; the rest reviewed/total.
        const chip = !prog ? String(t.count)
          : t.key === 'raised' ? `${prog.handled ?? 0} of ${prog.total ?? 0}`
            : `${prog.reviewed ?? 0} of ${prog.total ?? 0}`
        return { ...t, tone, chip }
      })
      .sort((a, b) => a.order - b.order)
  }, [grouped, boardTabs])

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
  const rowActionsByDriver = useMemo(() => new Map(rowActions.map(a => [a.driver_id, a])), [rowActions])
  const recipientsById = useMemo(() => new Map(recipients.map(r => [r.id, r.full_name])), [recipients])
  const isManager = me?.role === 'admin' || me?.role === 'manager'

  // Deep link: /after-hours/shift-board?driver=<uuid> switches to the tab holding
  // that driver, scrolls to the row and highlights it briefly. Applied once, when
  // the board contains the driver.
  const deepLinkedRef = useRef(false)
  useEffect(() => {
    const driverId = params.get('driver')
    if (!driverId || deepLinkedRef.current || !board.length) return
    const row = board.find(r => r.driver_id === driverId)
    if (!row) return
    deepLinkedRef.current = true
    setSelectedTab(groupKeyFor(row))
    setHighlightDriver(driverId)
    const id = setTimeout(() => setHighlightDriver(null), 4500)
    return () => clearTimeout(id)
  }, [params, board])

  // LOAD STATE filter (multi-select; empty = all) + sort (off → asc → desc, by
  // lifecycle sequence, never alphabetical). Default sort is unchanged (off).
  const [stateFilter, setStateFilter] = useState(() => new Set())
  const [stateSort, setStateSort] = useState(null)
  const toggleStateFilter = (key) => setStateFilter(prev => {
    if (key == null) return new Set()
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
  })
  const toggleStateSort = () => setStateSort(s => (s === 'asc' ? 'desc' : s === 'desc' ? null : 'asc'))
  const stateCounts = useMemo(() => {
    const c = {}
    for (const r of activeRows) if (r.lifecycle) c[r.lifecycle] = (c[r.lifecycle] || 0) + 1
    return c
  }, [activeRows])
  const displayRows = useMemo(() => {
    let list = stateFilter.size ? activeRows.filter(r => r.lifecycle && stateFilter.has(r.lifecycle)) : activeRows
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r => rowMatches(r, q))
    if (stateSort) {
      const dir = stateSort === 'asc' ? 1 : -1
      list = [...list].sort((a, b) => ((LIFECYCLE_RANK[a.lifecycle] ?? 99) - (LIFECYCLE_RANK[b.lifecycle] ?? 99)) * dir)
    }
    return list
  }, [activeRows, stateFilter, stateSort, search])
  const searching = search.trim().length > 0

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
    // Fixed to the viewport (minus the global header + main padding) so the
    // bands and tabs stay put and only the driver list scrolls — the page itself
    // doesn't scroll on this route.
    <div className="h-[calc(100vh-6rem)] flex flex-col min-h-0 gap-3">
      {error ? (
        <>
          <BoardHeader shift={shift} starting={starting} onStart={doStart} onEnd={() => setShowEnd(true)} />
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
          {/* Title + shift control, then the labelled week band; the shift band
              only when a shift is open. */}
          <BoardHeader shift={shift} starting={starting} onStart={doStart} onEnd={() => setShowEnd(true)} />
          <WeekStrip week={week} onCopy={copyWeek} />
          {shift && summary && <ShiftStrip summary={summary} shift={shift} />}

          {/* Detention queue — surfaced above the tabs only when there's actually
              something waiting at a dock. */}
          {trackCheckpoints && exceptions.length > 0 && (
            <TimesNeededGroup exceptions={exceptions} expanded={cpOpen} onToggle={() => setCpOpen(o => !o)} onOpen={openFromException} />
          )}

          {/* Tabs replace the stacked groups; Copy group sits on the right */}
          <div className="flex items-center gap-1 border-b border-gray-200 dark:border-white/10 overflow-x-auto">
            {tabs.map(t => {
              const on = t.key === activeTab
              const tone = TAB_STYLE[t.tone] || TAB_STYLE.grey
              // Tone shows on every tab (a red Raised must draw the eye even when
              // it isn't the open tab); the underline marks the active one.
              return (
                <button key={t.key} onClick={() => setSelectedTab(t.key)}
                  className={`relative shrink-0 px-3 py-2 text-sm font-semibold whitespace-nowrap transition-opacity ${tone.text} ${on ? '' : 'opacity-60 hover:opacity-100'}`}>
                  {t.g.heading}
                  <span className={`ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${tone.chip}`}>{t.chip}</span>
                  {on && <span className={`absolute left-0 right-0 -bottom-px h-0.5 ${tone.underline}`} />}
                </button>
              )
            })}
            {activeMeta && activeRows.length > 0 && (
              <div className="ml-auto flex items-center gap-2 pl-2">
                {searching && <span className="text-[11px] tabular-nums text-gray-400 dark:text-slate-500 whitespace-nowrap">{displayRows.length} of {activeRows.length}</span>}
                <div className="relative">
                  <input
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') setSearchInput('') }}
                    placeholder="Search drivers…"
                    className="w-40 sm:w-48 pl-2.5 pr-6 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-800/60 text-gray-700 dark:text-slate-200 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
                  />
                  {searchInput && (
                    <button onClick={() => setSearchInput('')} title="Clear search" aria-label="Clear search"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xs">✕</button>
                  )}
                </div>
                <LoadStateFilter selected={stateFilter} counts={stateCounts} onToggle={toggleStateFilter} />
                <button onClick={() => copyGroup(activeMeta, displayRows)} title="Copy this tab as plain text"
                  className="shrink-0 inline-flex items-center gap-1 px-2 text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">
                  📋 Copy group
                </button>
              </div>
            )}
          </div>

          {activeMeta && (
            <PriorityGroup group={activeMeta} rows={displayRows} settings={settings} shift={shift}
              rowActionsByDriver={rowActionsByDriver} recipientsById={recipientsById} meId={me?.id} isManager={isManager}
              highlightDriver={highlightDriver} stateSort={stateSort} onToggleStateSort={toggleStateSort}
              onOk={onOk} onAct={openAct} onAcknowledge={onAcknowledge} onCopyEscalation={copyEscalation} onCheckpoints={openFromRow} onOpenRequest={setOpenRequestId} />
          )}
        </>
      )}

      {editTarget && (
        <CheckpointEditor target={editTarget} shiftId={shift?.id ?? null}
          onClose={() => setEditTarget(null)} onSaved={() => refresh()} toast={toast} />
      )}
      {actionTarget && <ActionPopover target={actionTarget} recipients={recipients} meId={me?.id} onClose={() => setActionTarget(null)} onSubmit={submitAction} onRemove={removeAction} onCopy={copyEscalation} />}
      <EndShiftModal open={showEnd} shift={shift} users={users.filter(u => u.id !== me?.id)}
        onClose={() => setShowEnd(false)} onEnded={doEnded} />
      <RequestDetailPanel open={!!openRequestId} requestId={openRequestId}
        onClose={() => setOpenRequestId(null)} onChanged={() => refresh()} toast={toast} />
    </div>
  )
}

// ── Compact header ──────────────────────────────────────────────────────────
const ORANGE_BTN_SM = 'inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors disabled:opacity-50'
// Tab colour keyed by the RPC's `tone` (used as-is, never recomputed). Grey is
// the "done" state. Non-progress groups fall back to a sensible tone by key.
const TAB_STYLE = {
  red:    { text: 'text-red-600 dark:text-red-400',       underline: 'bg-red-500',     chip: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' },
  orange: { text: 'text-orange-600 dark:text-orange-400',  underline: 'bg-orange-500',  chip: 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300' },
  amber:  { text: 'text-amber-600 dark:text-amber-400',    underline: 'bg-amber-500',   chip: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' },
  green:  { text: 'text-emerald-600 dark:text-emerald-400', underline: 'bg-emerald-500', chip: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' },
  grey:   { text: 'text-gray-600 dark:text-slate-300',     underline: 'bg-gray-400',    chip: 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300' },
}
// Client-side row search over the already-loaded fields (no refetch). Origin and
// destination are raw TMS strings that still contain the city, so a substring
// match finds them.
function rowMatches(r, q) {
  const hay = [r.driver_name, r.load_number, r.truck, r.trailer, r.dispatcher_name, r.carrier_name, r.origin, r.destination]
    .filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q)
}

// group key → tab-progress RPC key, and a tone fallback when there's no progress.
const RPC_KEY = { raised: 'raised', todo: 'active', never_dispatched: 'never' }
const GROUP_TONE_FALLBACK = { raised: 'red', uncovered: 'orange', due: 'amber', idle: 'grey', todo: 'green', never_dispatched: 'grey' }

// 'YYYY-MM-DD' → 'Jul 27' (Chicago-agnostic — the range is already date-only).
function shortDay(v) {
  const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return v || ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function BoardHeader({ shift, starting, onStart, onEnd }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> After Hours
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Shift Board</h1>
      </div>
      <ShiftControl shift={shift} starting={starting} onStart={onStart} onEnd={onEnd} />
    </div>
  )
}

// Labelled weekly band (~60px). Clearly weekly, not tonight — a "THIS WEEK"
// block with the range, then the stats spread edge-to-edge. Non-zero values pop
// orange; zeros recede grey so the eye lands on what actually happened. The warm
// tint is muted right down in dark mode so it doesn't glow.
function WeekStrip({ week, onCopy }) {
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
    <div className="flex items-stretch rounded-2xl border border-orange-100 dark:border-white/10 overflow-hidden bg-gradient-to-r from-[#FFF8F3] to-white dark:from-orange-500/[0.05] dark:to-transparent">
      <div className="flex flex-col justify-center px-4 py-2 border-r-2 border-orange-400 dark:border-orange-500/40 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400">This week</span>
        <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums whitespace-nowrap">{shortDay(week?.range_start)} – {shortDay(week?.range_end)}</span>
      </div>
      <div className="flex-1 flex items-stretch">
        {stats.map(([label, val, tip], i) => (
          <div key={label} title={tip} className={`flex-1 flex flex-col items-center justify-center px-1 py-2 cursor-default ${i > 0 ? 'border-l border-orange-100/70 dark:border-white/5' : ''}`}>
            <span className={`text-[19px] font-bold leading-none tabular-nums ${Number(val) > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-400 dark:text-slate-600'}`}>{val}</span>
            <span className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center px-3 shrink-0 border-l border-orange-100/70 dark:border-white/5">
        <button onClick={onCopy} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 whitespace-nowrap">📋 Copy week</button>
      </div>
    </div>
  )
}

// Top-right shift control: a loud NOT ON SHIFT alarm + four one-click shift pills
// (hours on hover), or the live on-shift state + End shift. Off-shift status
// carries the "still recorded" note as a tooltip, so the old banner isn't needed.
function ShiftControl({ shift, starting, onStart, onEnd }) {
  if (shift) {
    // On shift: static green state — the absence of motion is what gives the
    // off-shift pulse its meaning.
    return (
      <div className="flex items-center gap-2 shrink-0">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-emerald-500" /> On shift · {shiftName(shift.shift_type)} · {elapsedSince(shift.started_at)}
        </span>
        <button onClick={onEnd} className={ORANGE_BTN_SM}>End shift</button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
      <span aria-live="polite" title="Actions are still recorded, just not counted toward a shift."
        className="inline-flex items-center gap-2 cursor-default whitespace-nowrap">
        {/* 14px dot pulses indefinitely (motion in the dot, not the text); the
            label holds full opacity for legibility. */}
        <span className="w-[14px] h-[14px] rounded-full bg-red-500 not-on-shift-dot-pulse" />
        <span className="text-[15px] font-extrabold uppercase tracking-wide text-red-600 dark:text-red-400">Not on shift</span>
      </span>
      <div className="flex items-center gap-1.5">
        {SHIFT_TYPES.map(s => (
          <button key={s.value} onClick={() => onStart(s.value)} disabled={starting} title={s.window}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-full border border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-300 bg-orange-50/60 dark:bg-orange-500/10 hover:bg-orange-100 dark:hover:bg-orange-500/20 transition-colors disabled:opacity-50 whitespace-nowrap">
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}

// Multi-select LOAD STATE filter. The menu is PORTALED to document.body and
// positioned `fixed` from the trigger's rect — the tab row (and the table
// wrapper) are `overflow: auto`, which clips any in-flow absolute child to a few
// pixels regardless of z-index. A portal is the only placement that survives an
// arbitrary overflow ancestor. Closes on backdrop click, Escape; repositions on
// scroll/resize so the fixed menu tracks the moving trigger.
function LoadStateFilter({ selected, counts, onToggle }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null) // { top, right } in viewport coords
  const btnRef = useRef(null)
  const n = selected.size

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('scroll', place, true) // capture — catches inner scrollers too
    window.addEventListener('resize', place)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="shrink-0">
      <button ref={btnRef} onClick={() => (open ? setOpen(false) : openMenu())}
        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg border transition-colors ${n ? 'border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-300 bg-orange-50/60 dark:bg-orange-500/10' : 'border-gray-200 dark:border-white/10 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
        Load state{n ? ` · ${n}` : ''} ▾
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-50 w-52 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-xl py-1">
            {LIFECYCLE.map(l => (
              <label key={l.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer">
                <input type="checkbox" checked={selected.has(l.key)} onChange={() => onToggle(l.key)} className="w-3.5 h-3.5 accent-orange-500" />
                <span className="flex-1 text-sm text-gray-700 dark:text-slate-300">{l.label}</span>
                <span className="text-[11px] tabular-nums text-gray-400 dark:text-slate-500">{counts[l.key] || 0}</span>
              </label>
            ))}
            {n > 0 && (
              <button onClick={() => onToggle(null)} className="w-full text-left px-3 py-1.5 mt-0.5 border-t border-gray-100 dark:border-white/5 text-[11px] text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5">
                Clear filter
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

// Labelled shift band (~60px, down from ~275px of cards). Mirrors the week strip
// so the two read as a pair; a cooler tint keeps them distinguishable. Drivers
// reviewed is the hero (own cell + progress bar); the other eight compress with
// their LOG/AUTO badges kept.
function ShiftStrip({ summary, shift }) {
  const reviewed = Number(summary.drivers_reviewed) || 0
  const total = Number(summary.active_drivers) || 0
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0
  const stats = [
    ['Booked', summary.loads_booked, 'LOG'],
    ['PODs', summary.pods_collected, 'LOG'],
    ['BOLs', summary.bols_collected, 'LOG'],
    ['Chkpt', summary.checkpoints, 'LOG'],
    ['Escal', summary.escalations, 'LOG'],
    ['Access', summary.accessorials, 'LOG'],
    ['Lumpers', summary.lumpers, 'AUTO'],
    ['Flagged', summary.drivers_flagged, 'LOG'],
  ]
  return (
    <div className="flex items-stretch rounded-2xl border border-emerald-100 dark:border-white/10 overflow-hidden bg-gradient-to-r from-emerald-50/70 to-white dark:from-emerald-500/[0.04] dark:to-transparent">
      <div className="flex flex-col justify-center px-4 py-2 border-r-2 border-emerald-400 dark:border-emerald-500/40 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">This shift</span>
        <span className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">{shiftName(shift.shift_type)} · {elapsedSince(shift.started_at)}</span>
      </div>
      {/* Hero — drivers reviewed */}
      <div className="flex flex-col justify-center px-4 py-2 border-r border-emerald-100 dark:border-white/5 shrink-0 min-w-[8.5rem]" title={`${pct}% of active drivers checked this shift`}>
        <div className="flex items-baseline gap-1">
          <span className="text-[22px] font-bold leading-none tabular-nums text-orange-600 dark:text-orange-400">{reviewed}</span>
          <span className="text-sm text-gray-400 dark:text-slate-500 tabular-nums">/ {total}</span>
        </div>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Drivers reviewed</span>
        <div className="mt-1 h-1 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-orange-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex-1 flex items-stretch">
        {stats.map(([label, val, badge], i) => (
          <div key={label} className={`flex-1 flex flex-col items-center justify-center px-1 py-2 ${i > 0 ? 'border-l border-emerald-100/70 dark:border-white/5' : ''}`}>
            <span className="text-[16px] font-bold leading-none tabular-nums text-gray-900 dark:text-white">{Number(val) || 0}</span>
            <span className="mt-1 flex items-center gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</span>
              <span className={`text-[6.5px] font-bold px-0.5 rounded ${badge === 'AUTO' ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-slate-400'}`}>{badge}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Action popover ──────────────────────────────────────────────────────────
// One dialog for all five actions. Every save captures a note (required for
// Escalate and Flag); Book adds an editable load-number field prefilled from the
// row. Reopening a done action prefills it and offers Remove. Portaled to the
// body (a centered modal), so the table's scroll container can't clip it.
const ACTION_PROMPTS = {
  load_booked:   { title: 'Book a load',   prompt: 'What load did you book?', hasLoad: true },
  pod_collected: { title: 'POD collected', prompt: 'Anything to note?' },
  bol_collected: { title: 'BOL collected', prompt: 'Anything to note?' },
  escalated:     { title: 'Escalate',      prompt: "What's happening?", required: true },
  flag:          { title: 'Flag an issue', prompt: "What's the issue?", required: true },
}
// Searchable, keyboard-navigable person picker (grows as managers are added).
// Type to filter on name; ↑/↓ move, Enter selects. Rendered inside the popover
// modal, which isn't overflow-clipped, so a plain absolute dropdown is fine.
function PersonPicker({ people, value, onChange }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const ref = useRef(null)
  const selected = people.find(p => p.id === value)
  const filtered = q.trim() ? people.filter(p => p.full_name.toLowerCase().includes(q.trim().toLowerCase())) : people
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const pick = (p) => { onChange(p.id); setQ(''); setOpen(false) }
  const inputCls = 'w-full text-sm rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2.5 py-1.5 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40'
  return (
    <div ref={ref} className="relative mt-1">
      <input
        value={open ? q : (selected ? selected.full_name : '')}
        onChange={e => { setQ(e.target.value); setOpen(true); setHi(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hi]) pick(filtered[hi]) }
          else if (e.key === 'Escape') { setOpen(false) }
        }}
        placeholder="Search a person…" className={inputCls} />
      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-xl">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No match</div>
          ) : filtered.map((p, i) => (
            <button key={p.id} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(p)}
              className={`w-full text-left px-3 py-1.5 text-sm ${i === hi ? 'bg-orange-50 dark:bg-orange-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'} ${p.id === value ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-slate-300'}`}>
              {p.full_name}{p.role ? <span className="text-[11px] text-gray-400 dark:text-slate-500"> · {p.role}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Ordered, de-duped user ids for the @handles present in `text`. Self-mentions
// and unknown handles are ignored.
function parseMentions(text, recipients, meId) {
  const byHandle = new Map(recipients.map(r => [(r.handle || '').toLowerCase(), r]))
  const seen = new Set(); const out = []
  for (const m of String(text || '').matchAll(/@(\w+)/g)) {
    const r = byHandle.get(m[1].toLowerCase())
    if (r && r.id !== meId && !seen.has(r.id)) { seen.add(r.id); out.push(r.id) }
  }
  return out
}

// Slack-style @mention textarea. The <textarea> holds plain, copy-pasteable text;
// a mirror div behind it highlights valid @handles (subtle orange). Typing @
// opens an inline picker filtered on handle and full name.
function MentionField({ value, onChange, recipients, meId, autoFocus }) {
  const taRef = useRef(null)
  const mirrorRef = useRef(null)
  const [menu, setMenu] = useState(null) // { start } while the caret is in an @token
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)

  const byHandle = useMemo(() => new Map(recipients.map(r => [(r.handle || '').toLowerCase(), r])), [recipients])
  const options = useMemo(() => {
    if (!menu) return []
    const s = q.toLowerCase()
    return recipients.filter(r => r.id !== meId &&
      ((r.handle || '').toLowerCase().includes(s) || (r.full_name || '').toLowerCase().includes(s))).slice(0, 8)
  }, [menu, q, recipients, meId])

  const detect = (el) => {
    const m = el.value.slice(0, el.selectionStart).match(/(?:^|\s)@(\w*)$/)
    if (m) { setMenu({ start: el.selectionStart - m[1].length - 1 }); setQ(m[1]); setHi(0) }
    else setMenu(null)
  }
  const pick = (r) => {
    const el = taRef.current
    const before = value.slice(0, menu.start)
    const after = value.slice(el.selectionStart)
    const insert = `@${r.handle} `
    onChange(before + insert + after); setMenu(null)
    requestAnimationFrame(() => { const c = (before + insert).length; el.focus(); el.setSelectionRange(c, c) })
  }
  const onKeyDown = (e) => {
    if (!menu || !options.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[Math.min(hi, options.length - 1)]) }
    else if (e.key === 'Escape') { e.preventDefault(); setMenu(null) }
  }

  // Mirror highlight — same box metrics as the textarea, valid @handles wrapped.
  const nodes = []
  let last = 0; const re = /@(\w+)/g; let mm
  while ((mm = re.exec(value))) {
    const r = byHandle.get(mm[1].toLowerCase())
    if (r && r.id !== meId) {
      if (mm.index > last) nodes.push(value.slice(last, mm.index))
      nodes.push(<span key={mm.index} className="rounded bg-orange-100 dark:bg-orange-500/25 text-orange-700 dark:text-orange-300">@{mm[1]}</span>)
      last = mm.index + mm[0].length
    }
  }
  nodes.push(value.slice(last) + '​')

  const boxCls = 'w-full text-sm px-2.5 py-2 rounded-lg border leading-normal'
  return (
    <div className="relative mt-1">
      {/* Mirror carries the background so the transparent textarea reveals the
          highlighted @handles beneath it (in both themes). */}
      <div ref={mirrorRef} aria-hidden className={`${boxCls} absolute inset-0 whitespace-pre-wrap break-words overflow-hidden pointer-events-none border-transparent bg-white dark:bg-slate-800/80 text-gray-900 dark:text-slate-100`}>
        {value ? nodes : <span className="text-gray-400 dark:text-slate-500">Type @ to mention…</span>}
      </div>
      <textarea ref={taRef} rows={3} autoFocus={autoFocus} value={value}
        onChange={e => { onChange(e.target.value); detect(e.target) }}
        onKeyDown={onKeyDown}
        onClick={e => detect(e.target)}
        onScroll={() => { if (mirrorRef.current && taRef.current) mirrorRef.current.scrollTop = taRef.current.scrollTop }}
        placeholder="Type @ to mention…"
        className={`${boxCls} relative bg-transparent text-transparent caret-gray-900 dark:caret-white border-gray-300 dark:border-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/40`} />
      {menu && options.length > 0 && (
        <div className="absolute z-20 left-0 top-full mt-1 w-full max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-xl">
          {options.map((r, i) => (
            <button key={r.id} type="button" onMouseDown={e => { e.preventDefault(); pick(r) }} onMouseEnter={() => setHi(i)}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${i === hi ? 'bg-orange-50 dark:bg-orange-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'}`}>
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 text-[10px] font-bold">{r.initials || (r.handle || '?').slice(0, 2).toUpperCase()}</span>
              <span className="flex-1 text-gray-700 dark:text-slate-300">@{r.handle} <span className="text-gray-400 dark:text-slate-500">· {r.full_name}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionPopover({ target, recipients = [], meId, onClose, onSubmit, onRemove, onCopy }) {
  const meta = ACTION_PROMPTS[target.type] || {}
  const editing = !!target.existing
  const isEsc = target.type === 'escalated'
  const [note, setNote] = useState(target.existing?.note || '')
  const [loadNumber, setLoadNumber] = useState(meta.hasLoad ? (target.existing?.load_number || target.row.load_number || '') : '')
  const [showPicker, setShowPicker] = useState(false)
  const [savedId, setSavedId] = useState(null) // set after an escalate save → reveal Copy + Done
  const [busy, setBusy] = useState(false)

  const mentionIds = useMemo(() => (isEsc ? parseMentions(note, recipients, meId) : []), [isEsc, note, recipients, meId])
  const canSave = isEsc ? mentionIds.length > 0 : (!meta.required || note.trim().length > 0)
  const copyId = savedId || (isEsc && editing ? target.existing?.id : null)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await onSubmit(note, loadNumber, mentionIds)
      if (isEsc && res) setSavedId(res) // keep open so Copy for Telegram is right there
      else onClose()
    } finally { setBusy(false) }
  }
  const remove = async () => { setBusy(true); try { await onRemove() } finally { setBusy(false) } }
  const addPerson = (id) => {
    const r = recipients.find(x => x.id === id)
    if (r) setNote(n => `${n}${n && !/\s$/.test(n) ? ' ' : ''}@${r.handle} `)
    setShowPicker(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0B1120] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{meta.title}</h3>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 truncate">{target.row.driver_name}{target.row.load_number ? ` · #${target.row.load_number}` : ''}</p>
        </div>
        {meta.hasLoad && (
          <label className="block">
            <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400">Load number</span>
            <input value={loadNumber} onChange={e => setLoadNumber(e.target.value)} placeholder="e.g. 2607-1564"
              className="mt-1 w-full text-sm rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-2.5 py-1.5 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          </label>
        )}

        {isEsc ? (
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400">{meta.prompt} — mention with @ *</span>
              <button type="button" onClick={() => setShowPicker(s => !s)} className="text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline">+ Add person</button>
            </div>
            <MentionField value={note} onChange={setNote} recipients={recipients} meId={meId} autoFocus />
            {showPicker && <PersonPicker people={recipients} value="" onChange={addPerson} />}
            {mentionIds.length === 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Mention someone with @ so they get notified.</p>}
          </div>
        ) : (
          <label className="block">
            <span className="text-[11px] font-medium text-gray-500 dark:text-slate-400">{meta.prompt}{meta.required ? ' *' : ''}</span>
            <textarea rows={3} autoFocus={!meta.hasLoad} value={note} onChange={e => setNote(e.target.value)}
              placeholder={meta.required ? 'Required' : 'Optional'} className={`mt-1 ${S.textarea}`} />
          </label>
        )}

        {isEsc && copyId && (
          <button type="button" onClick={() => onCopy?.(copyId)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-gray-200 dark:border-white/10 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">
            📋 Copy for Telegram
          </button>
        )}

        {savedId ? (
          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-colors">Done</button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div>
              {editing && (
                <button onClick={remove} disabled={busy} className="px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-50">Remove</button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} disabled={busy} className={S.btnCancel}>Cancel</button>
              <button onClick={submit} disabled={busy || !canSave}
                className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Save</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
