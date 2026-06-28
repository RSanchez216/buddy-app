import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import {
  loadCommandCenter, loadActivity, setTaskStatus, saveTaskNote, reassignTask, addTask, updateTask,
  todayCT, ctDate, greetingDateParts, relTime, notifyTasksChanged,
} from './commandCenterData'

// ── Config: source + status + priority visual maps (light + dark) ───────────
const SOURCES = {
  email:    { label: 'Email',    tag: 'Email', spine: 'bg-blue-500',   dot: 'bg-blue-500',   chip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  calendar: { label: 'Calendar', tag: 'Cal',   spine: 'bg-green-500',  dot: 'bg-green-500',  chip: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300' },
  telegram: { label: 'Telegram', tag: 'TG',    spine: 'bg-teal-500',   dot: 'bg-teal-500',   chip: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' },
  manual:   { label: 'Manual',   tag: 'Note',  spine: 'bg-amber-500',  dot: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  // upkeep accent = violet-600 (#7C3AED) — exact, no gray fallback anywhere.
  upkeep:   { label: 'Upkeep',   tag: 'Upkeep',spine: 'bg-violet-600', dot: 'bg-violet-600', chip: 'bg-violet-100 text-violet-700 dark:bg-violet-600/[0.18] dark:text-[#C4B0E8]' },
}
const SOURCE_ORDER = ['email', 'calendar', 'telegram', 'manual', 'upkeep']

// Display-only friendly names for tasks.source_account. The DB keeps the raw
// key; this map is the single place to extend as mailboxes are added. Unknown
// keys fall back to the raw value, title-cased.
const MAILBOX_NAMES = {
  'rebeca-manas':     'Manas · You',
  'accounting-manas': 'Manas Accounting',
  'accounting-tms':   'TMS',
  'accounting-pj':    'PJ Twins',
  'accounting-uskg':  'USKG',
  'personal':         'Personal',
}
function mailboxName(key) {
  if (MAILBOX_NAMES[key]) return MAILBOX_NAMES[key]
  return String(key).split(/[-_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// Briefing label pills — tinted per source on the dark slate banner (same tints
// in both themes, since the banner is dark in both). Keyed by source so every
// label gets its own color instead of one flat gray pill.
const BRIEF_LABEL = {
  email:    { background: 'rgba(37,99,235,.28)',  color: '#BBD0FB' },
  telegram: { background: 'rgba(13,148,136,.30)', color: '#A9E5DD' },
  calendar: { background: 'rgba(22,163,74,.30)',  color: '#A8E6BC' },
  manual:   { background: 'rgba(217,119,6,.30)',  color: '#F2CE97' },
  upkeep:   { background: 'rgba(124,58,237,.30)', color: '#D2BCF7' },
}
const STATUSES = {
  open:    { label: 'Open',    pill: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30', dot: 'bg-orange-500' },
  waiting: { label: 'Waiting', pill: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',     dot: 'bg-amber-500' },
  blocked: { label: 'Blocked', pill: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',                 dot: 'bg-red-500' },
  closed:  { label: 'Closed',  pill: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30',      dot: 'bg-green-500' },
}
const PRIO_RANK = { high: 0, normal: 1, low: 2 }
// Dark tokens lifted for contrast: card #1B2632 (clearly above page bg), hover
// #22303F, border #30404F. Light theme unchanged.
const cardSurface = 'bg-white dark:bg-[#1B2632] border border-gray-200 dark:border-[#30404F]'

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}
function firstNameOf(name) { return (name || '').trim().split(/\s+/)[0] || 'there' }

// Deterministic per-user avatar color. The signed-in user is always brand
// orange; unassigned stays gray (null → gray classes in <Avatar>).
const AVATAR_PALETTE = ['#F97316', '#2563EB', '#0D9488', '#7C3AED', '#DC2626', '#16A34A', '#D97706', '#DB2777', '#4F46E5']
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }
function avatarColor(userId, me) {
  if (!userId) return null
  if (userId === me) return '#F97316'
  return AVATAR_PALETTE[hashStr(String(userId)) % AVATAR_PALETTE.length]
}
function Avatar({ userId, name, me, size = 20, className = '' }) {
  const color = avatarColor(userId, me)
  return (
    <span
      className={`rounded-full grid place-items-center text-white font-bold shrink-0 ${color ? '' : 'bg-gray-400 dark:bg-slate-600'} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ...(color ? { background: color } : null) }}>
      {initials(name)}
    </span>
  )
}

// 'YYYY-MM-DD' → a short label (Today / Mon / Jun 26), built from local parts.
function shortDue(s) {
  if (!s) return ''
  if (s === todayCT()) return 'Today'
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CommandCenter() {
  const { profile } = useAuth()
  const me = profile?.id || null
  const [tab, setTab] = useState('cc') // cc | add | ins
  const [editTask, setEditTask] = useState(null) // when set, the form is in edit mode

  const [tasks, setTasks] = useState(null)
  const [usersById, setUsersById] = useState(new Map())
  const [users, setUsers] = useState([])
  const [latestActivityByTask, setLatestActivityByTask] = useState(() => new Map())
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const { tasks, users, usersById, latestActivityByTask } = await loadCommandCenter()
      setTasks(tasks); setUsers(users); setUsersById(usersById); setLatestActivityByTask(latestActivityByTask); setError('')
    } catch (e) {
      console.error('[CommandCenter] load failed', e)
      setError(e.message || 'Failed to load tasks')
      setTasks([])
    }
  }, [])
  useEffect(() => {
    let stale = false
    loadCommandCenter()
      .then(({ tasks, users, usersById, latestActivityByTask }) => { if (!stale) { setTasks(tasks); setUsers(users); setUsersById(usersById); setLatestActivityByTask(latestActivityByTask); setError('') } })
      .catch(e => { if (!stale) { console.error('[CommandCenter] load failed', e); setError(e.message || 'Failed to load tasks'); setTasks([]) } })
    return () => { stale = true }
  }, [])

  // Optimistic local patch + reconcile from the returned row.
  const patchTask = useCallback((id, patch) => {
    setTasks(prev => (prev || []).map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  async function changeStatus(task, status) {
    patchTask(task.id, { status, closed_at: status === 'closed' ? new Date().toISOString() : null })
    notifyTasksChanged() // refresh the nav's open-count bubble
    try { const row = await setTaskStatus(task, status); patchTask(task.id, row); notifyTasksChanged() }
    catch (e) { console.error(e); reload() }
  }
  async function reassign(task, userId) {
    const name = usersById.get(userId)?.full_name
    patchTask(task.id, { assignee: userId })
    try { const row = await reassignTask(task.id, userId, name); patchTask(task.id, row) }
    catch (e) { console.error(e); reload() }
  }
  // One submit path for both create and edit (TaskForm always calls onSubmit(payload)).
  async function submitForm(payload) {
    if (editTask) {
      const name = usersById.get(payload.assignee)?.full_name
      const row = await updateTask(editTask, payload, name)
      patchTask(editTask.id, row)
    } else {
      const row = await addTask(payload)
      setTasks(prev => [row, ...(prev || [])])
    }
    notifyTasksChanged() // a create or status edit can change the open count
    setEditTask(null)
    setTab('cc')
  }
  function startEdit(task) { setEditTask(task); setTab('add') }
  function selectTab(k) { if (k === 'add') setEditTask(null); setTab(k) }

  const firstName = firstNameOf(profile?.full_name)
  const { weekday, month, day } = greetingDateParts()

  return (
    <div className="max-w-[1040px] mx-auto">
      {/* Header */}
      <header className="flex items-center gap-3 pb-4">
        <div className="w-10 h-10 rounded-full bg-orange-500 grid place-items-center text-white font-bold text-lg shrink-0 shadow">
          {initials(profile?.full_name)}
        </div>
        <div className="leading-tight">
          <div className="font-bold text-lg tracking-wide text-gray-900 dark:text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>BUDDY</div>
          <div className="text-[10px] tracking-[0.2em] uppercase text-gray-400 dark:text-slate-500 font-semibold">Command Center</div>
        </div>
        <nav className="ml-auto flex gap-1 rounded-full p-1 bg-white dark:bg-[#1B2632] border border-gray-200 dark:border-[#30404F]">
          {[['cc', 'Command Center'], ['add', 'Add task'], ['ins', 'Insights']].map(([k, lbl]) => (
            <button key={k} onClick={() => selectTab(k)}
              className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-colors ${tab === k ? 'bg-orange-500 text-white' : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'}`}>
              {lbl}
            </button>
          ))}
        </nav>
      </header>

      {error && <div className="mb-3 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">Couldn’t load: {error}</div>}

      {tab === 'cc' && (
        <ErrorBoundary label="the command center">
          <CommandCenterView
            tasks={tasks} me={me} usersById={usersById} latestActivityByTask={latestActivityByTask}
            greeting={{ firstName, weekday, month, day }}
            onChangeStatus={changeStatus} onReassign={reassign}
            onGoAdd={() => selectTab('add')} onEditTask={startEdit}
          />
        </ErrorBoundary>
      )}
      {tab === 'add' && (
        <ErrorBoundary label="the task form">
          <TaskForm
            mode={editTask ? 'edit' : 'create'} task={editTask}
            me={me} users={users} onSubmit={submitForm}
            onCancel={() => { setEditTask(null); setTab('cc') }}
          />
        </ErrorBoundary>
      )}
      {tab === 'ins' && <InsightsPlaceholder />}

      <p className="mt-6 text-center text-xs text-gray-400 dark:text-slate-600">
        BUDDY Command Center · cowork → supabase.tasks → buddy
      </p>
    </div>
  )
}

// ── Command Center view ─────────────────────────────────────────────────────
function CommandCenterView({ tasks, me, usersById, latestActivityByTask, greeting, onChangeStatus, onReassign, onGoAdd, onEditTask }) {
  const [filters, setFilters] = useState({ source: 'all', status: 'open', priority: 'all' })
  const [revealed, setRevealed] = useState(false)
  // Tasks the user has acted on this session — clears the "new reply" badge
  // immediately (e.g. on note save) without waiting for a reload.
  const [actedIds, setActedIds] = useState(() => new Set())
  const markActed = useCallback((id) => setActedIds(prev => prev.has(id) ? prev : new Set(prev).add(id)), [])
  const isDefault = filters.source === 'all' && filters.status === 'open' && filters.priority === 'all'

  const today = todayCT()
  const loading = tasks === null
  const all = useMemo(() => tasks || [], [tasks])

  // Open tasks whose most recent activity is a reply that hasn't been acted on
  // yet — the heuristic for "a reply came in and you haven't responded." Reads
  // only already-loaded data; missing activity simply means no badge.
  const replyIds = useMemo(() => {
    const s = new Set()
    for (const t of all) {
      if (t.status === 'open' && !actedIds.has(t.id) && latestActivityByTask.get(t.id)?.kind === 'reply_received') s.add(t.id)
    }
    return s
  }, [all, actedIds, latestActivityByTask])

  // Wrap the mutating actions so any of them also clears this row's reply badge.
  const handleChangeStatus = useCallback((task, status) => { markActed(task.id); onChangeStatus(task, status) }, [markActed, onChangeStatus])
  const handleReassign = useCallback((task, userId) => { markActed(task.id); onReassign(task, userId) }, [markActed, onReassign])

  // Focus now = EVERY open high-priority task (any source). Returning 'focus'
  // first in assignGroup de-dupes these out of needs/calendar/upkeep/tagged.
  const focusIds = useMemo(() => {
    const s = new Set()
    for (const t of all) if (t.status === 'open' && t.priority === 'high') s.add(t.id)
    return s
  }, [all])

  const GROUPS = [
    { key: 'focus',    label: 'Focus now' },
    { key: 'upkeep',   label: 'Keep BUDDY running' },
    { key: 'needs',    label: 'Needs attention' },
    { key: 'tagged',   label: 'Tagged by your team' },
    { key: 'calendar', label: 'On your calendar' },
    { key: 'closed',   label: 'Closed today' },
  ]
  const byGroup = useMemo(() => {
    const m = { focus: [], upkeep: [], needs: [], tagged: [], calendar: [], closed: [] }
    for (const t of all) { const g = assignGroup(t, focusIds, me, today); if (g) m[g].push(t) }
    for (const k of Object.keys(m)) m[k].sort((a, b) => cmpTask(a, b, replyIds))
    return m
  }, [all, focusIds, me, today, replyIds])

  function passes(t) {
    if (filters.source !== 'all' && t.source !== filters.source) return false
    if (filters.status === 'wb') { if (t.status !== 'waiting' && t.status !== 'blocked') return false }
    else if (filters.status !== 'all' && t.status !== filters.status) return false
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false
    return true
  }

  // Upkeep progress is computed from ALL source='upkeep' tasks — independent of
  // which section renders them — so a high upkeep task moving into Focus now
  // doesn't change the N / M math.
  const upkeepAll = useMemo(() => all.filter(t => t.source === 'upkeep'), [all])
  const upkeepTotal = upkeepAll.length
  const upkeepDone = upkeepAll.filter(t => t.status === 'closed').length

  // Stat-card counts (over all tasks).
  const counts = useMemo(() => ({
    open: all.filter(t => t.status === 'open').length,
    meetings: all.filter(t => t.source === 'calendar' && t.status === 'open').length,
    wb: all.filter(t => t.status === 'waiting' || t.status === 'blocked').length,
    closed: all.filter(t => t.status === 'closed' && ctDate(t.closed_at) === today).length,
  }), [all, today])

  function toggleCard(card) {
    setRevealed(false)
    setFilters(f => {
      if (card === 'meetings') return { ...f, source: f.source === 'calendar' ? 'all' : 'calendar' }
      if (card === 'open')   return { ...f, status: f.status === 'open' ? 'all' : 'open' }
      if (card === 'wb')     return { ...f, status: f.status === 'wb' ? 'all' : 'wb' }
      if (card === 'closed') return { ...f, status: f.status === 'closed' ? 'all' : 'closed' }
      return f
    })
  }
  const cardActive = { open: filters.status === 'open', meetings: filters.source === 'calendar', wb: filters.status === 'wb', closed: filters.status === 'closed' }

  if (loading) {
    return <div className="py-20 text-center"><div className="inline-block animate-spin rounded-full h-7 w-7 border-b-2 border-orange-500" /></div>
  }

  return (
    <>
      {/* Greeting */}
      <div className="mb-3">
        <h1 className="text-[23px] font-bold tracking-tight text-gray-900 dark:text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Hello, {greeting.firstName}</h1>
        <p className="text-[13px] text-gray-500 dark:text-slate-400 mt-0.5">Today is {greeting.weekday}, {greeting.month} {greeting.day} · here’s where to point your attention.</p>
      </div>

      <Briefing tasks={all} upkeepDone={upkeepDone} upkeepTotal={upkeepTotal} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
        <StatCard n={counts.open} label="Needs attention" attn active={cardActive.open} onClick={() => toggleCard('open')} />
        <StatCard n={counts.meetings} label="Meetings" active={cardActive.meetings} onClick={() => toggleCard('meetings')} />
        <StatCard n={counts.wb} label="Waiting / blocked" active={cardActive.wb} onClick={() => toggleCard('wb')} />
        <StatCard n={counts.closed} label="Closed today" active={cardActive.closed} onClick={() => toggleCard('closed')} />
      </div>

      {/* Filters */}
      <div className={`${cardSurface} rounded-xl px-3 py-2.5 mb-3`}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9.5px] font-semibold tracking-widest uppercase text-gray-400 dark:text-slate-500 mr-1">Source</span>
          <FChip active={filters.source === 'all'} onClick={() => setFilters(f => ({ ...f, source: 'all' }))}>All</FChip>
          {SOURCE_ORDER.map(s => (
            <FChip key={s} active={filters.source === s} dot={SOURCES[s].dot} onClick={() => setFilters(f => ({ ...f, source: s }))}>{SOURCES[s].label}</FChip>
          ))}
          <button onClick={onGoAdd} className="ml-auto text-[12.5px] font-semibold bg-orange-500 text-white px-3.5 py-1.5 rounded-full hover:brightness-105">+ Add task</button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-2 pt-2 border-t border-dashed border-gray-200 dark:border-[#30404F]">
          <span className="text-[9.5px] font-semibold tracking-widest uppercase text-gray-400 dark:text-slate-500 mr-1">Status</span>
          {['all', 'open', 'waiting', 'blocked', 'closed'].map(s => (
            <FChip key={s} active={filters.status === s} onClick={() => setFilters(f => ({ ...f, status: s }))}>{s === 'all' ? 'All' : STATUSES[s].label}</FChip>
          ))}
          <span className="w-px h-4 bg-gray-200 dark:bg-[#30404F] mx-1" />
          <span className="text-[9.5px] font-semibold tracking-widest uppercase text-gray-400 dark:text-slate-500 mr-1">Priority</span>
          {['all', 'high', 'normal', 'low'].map(p => (
            <FChip key={p} active={filters.priority === p} onClick={() => setFilters(f => ({ ...f, priority: p }))}>{p === 'all' ? 'All' : p[0].toUpperCase() + p.slice(1)}</FChip>
          ))}
        </div>
      </div>

      {/* Grouped list */}
      <div className="flex flex-col gap-2.5">
        {GROUPS.map(g => {
          let items = byGroup[g.key].filter(passes)
          if (!items.length) return null
          // Default view: cap low-priority items in "needs" behind a reveal.
          let hiddenLow = 0
          if (g.key === 'needs' && isDefault && !revealed) {
            const low = items.filter(t => t.priority === 'low')
            hiddenLow = low.length
            items = items.filter(t => t.priority !== 'low')
          }
          return (
            <div key={g.key} className="flex flex-col gap-2.5">
              <GroupHeader group={g} upkeep={g.key === 'upkeep' ? { done: upkeepDone, total: upkeepTotal } : null} />
              {items.map(t => (
                <TaskRow key={t.id} task={t} focus={focusIds.has(t.id)} hasNewReply={replyIds.has(t.id)} me={me} usersById={usersById}
                  users={[...usersById.values()]} onChangeStatus={handleChangeStatus} onReassign={handleReassign} onEditTask={onEditTask} onActed={markActed} />
              ))}
              {hiddenLow > 0 && (
                <button onClick={() => setRevealed(true)} className={`${cardSurface} rounded-xl py-2.5 text-[13px] font-semibold text-gray-700 dark:text-slate-300 border-dashed hover:bg-gray-50 dark:hover:bg-white/5`}>
                  Show {hiddenLow} more lower-priority ↓
                </button>
              )}
            </div>
          )
        })}
        {GROUPS.every(g => byGroup[g.key].filter(passes).length === 0) && (
          <div className={`${cardSurface} rounded-2xl p-10 text-center text-sm text-gray-500 dark:text-slate-400`}>Nothing matches these filters.</div>
        )}
      </div>
    </>
  )
}

// Which group a task lands in. Pure (no component closure) so the byGroup memo
// stays valid under the React Compiler lint.
function assignGroup(t, focusIds, me, today) {
  if (focusIds.has(t.id)) return 'focus'
  if (t.source === 'upkeep') return 'upkeep'
  if (t.source === 'calendar') return 'calendar'
  if (t.assignee === me && t.created_by && t.created_by !== me) return 'tagged'
  if (t.status === 'closed') return ctDate(t.closed_at) === today ? 'closed' : null
  return 'needs'
}

// priority → (unacted reply nudge) → due_date → created_at. The reply nudge only
// breaks ties between equal-priority tasks, so re-surfaced items rise without
// overriding priority order.
function cmpTask(a, b, replyIds) {
  const pr = (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1)
  if (pr) return pr
  if (replyIds) {
    const ar = replyIds.has(a.id), br = replyIds.has(b.id)
    if (ar !== br) return ar ? -1 : 1
  }
  const ad = a.due_date || '9999-12-31', bd = b.due_date || '9999-12-31'
  if (ad !== bd) return ad < bd ? -1 : 1
  return (a.created_at || '') < (b.created_at || '') ? -1 : 1
}

function FChip({ active, dot, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`text-[12px] font-medium px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 transition-colors ${
        active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-[#1B2632] text-gray-600 dark:text-slate-300 border-gray-200 dark:border-[#30404F] hover:border-gray-300 dark:hover:border-slate-600'
      }`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white/80' : dot}`} />}
      {children}
    </button>
  )
}

function StatCard({ n, label, attn, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`relative text-left rounded-xl px-3.5 py-3 transition-all ${cardSurface} hover:-translate-y-px dark:hover:bg-[#22303F] ${active ? 'ring-[1.5px] ring-orange-500 border-orange-500' : ''}`}>
      {active && <span className="absolute top-2 right-2.5 text-[9px] font-semibold text-orange-500" style={{ fontFamily: 'JetBrains Mono, monospace' }}>▼ filtered</span>}
      <div className={`text-[25px] font-bold leading-none ${attn ? 'text-orange-500' : 'text-gray-900 dark:text-[#F3F6FA]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{n}</div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#B7C3D1] mt-1.5">{label}</div>
    </button>
  )
}

function GroupHeader({ group, upkeep }) {
  if (group.key === 'upkeep') {
    const pct = upkeep.total ? Math.round((upkeep.done / upkeep.total) * 100) : 0
    return (
      <div className="flex items-center gap-2.5 flex-wrap mt-1.5 px-0.5">
        <div className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-1.5" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>⚙ Keep BUDDY running</div>
        <span className="text-[9.5px] font-semibold tracking-wide uppercase bg-violet-100 text-violet-700 dark:bg-violet-600/[0.18] dark:text-[#C4B0E8] px-1.5 py-0.5 rounded">Recurring · resets daily</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{upkeep.done} / {upkeep.total} done</span>
          <span className="w-[90px] h-[7px] rounded-full bg-gray-100 dark:bg-[#0F1822] overflow-hidden">
            <span className="block h-full bg-violet-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-gray-400 dark:text-[#9FB0BF] mt-1.5 px-0.5 flex items-center gap-2">
      {group.label}
      {group.key === 'tagged' && <span className="text-[9.5px] tracking-wide bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300 px-1.5 py-0.5 rounded normal-case font-semibold">Preview · rollout</span>}
    </div>
  )
}

// ── Source metadata (email subject / from / source link) ────────────────────
// metadata is jsonb on tasks; treat anything non-object as absent.
function taskMeta(task) {
  const m = task.metadata
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
}

const ctrlCls = 'shrink-0 inline-flex items-center justify-center gap-1 rounded p-0.5 text-gray-400 hover:text-orange-500 dark:text-slate-500 dark:hover:text-orange-400 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/60'

// Copies `text` verbatim; icon swaps to a check for ~1.5s. Stops propagation so
// it never toggles the row. Clipboard failures are swallowed.
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  const tref = useRef(null)
  useEffect(() => () => { if (tref.current) clearTimeout(tref.current) }, [])
  async function onCopy(e) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (tref.current) clearTimeout(tref.current)
      tref.current = setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — fail silently */ }
  }
  return (
    <button type="button" onClick={onCopy} aria-label={label} title={copied ? 'Copied' : label} className={ctrlCls}>
      {copied ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-green-600 dark:text-green-400"><path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" strokeLinecap="round" /></svg>
      )}
    </button>
  )
}

// Opens `href` in a new tab. Stops propagation so it never toggles the row.
function OpenLink({ href, label, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}
      onClick={e => e.stopPropagation()} className={`${ctrlCls} px-1`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M14 3h7v7" strokeLinecap="round" strokeLinejoin="round" /><path d="M21 3l-9 9" strokeLinecap="round" /><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {children}
    </a>
  )
}

// Muted chip showing which mailbox an email task came from. Renders only when a
// source_account is present; the name is display-only (see MAILBOX_NAMES).
function MailboxChip({ account }) {
  if (!account) return null
  const name = mailboxName(account)
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-slate-400" title={`Mailbox: ${name}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>
      <span aria-hidden>📬</span>{name}
    </span>
  )
}

// Compact secondary line for the collapsed row: ✉ subject [copy] · from … [open].
// Renders only the elements whose metadata is present.
function SourceMetaLine({ task }) {
  const m = taskMeta(task)
  const isEmail = task.source === 'email'
  const subject = isEmail ? m.subject : null
  const from = isEmail ? m.from : null
  const link = m.link
  if (!subject && !link) return null
  return (
    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-400 dark:text-slate-500 min-w-0" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
      {subject && (
        <span className="inline-flex items-center gap-1 min-w-0">
          <span className="shrink-0" aria-hidden>✉</span>
          <span className="truncate">{subject}</span>
          <CopyButton text={subject} label="Copy email subject" />
        </span>
      )}
      {from && <span className="truncate hidden sm:inline max-w-[140px]">· from {from}</span>}
      {link && <OpenLink href={link} label={isEmail ? 'Open source email' : 'Open source'} />}
    </div>
  )
}

// ── Task row + detail drawer ────────────────────────────────────────────────
function TaskRow({ task, focus, hasNewReply, me, usersById, users, onChangeStatus, onReassign, onEditTask, onActed }) {
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const src = SOURCES[task.source] || SOURCES.manual
  const st = STATUSES[task.status] || STATUSES.open
  const isUpkeep = task.source === 'upkeep'
  const closed = task.status === 'closed'
  const timeLabel = task.due_date ? shortDue(task.due_date) : (isUpkeep ? 'daily' : '')
  const taggedBy = task.created_by && task.created_by !== me ? usersById.get(task.created_by) : null

  return (
    <div className={`group relative rounded-xl ${cardSurface} dark:hover:bg-[#22303F] transition-colors ${isUpkeep ? 'px-4 py-2.5' : 'px-4 py-3'} ${focus ? 'ring-1 ring-orange-500 border-orange-500' : ''} ${closed ? 'opacity-60' : ''}`}>
      <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded ${src.spine}`} />
      {focus && <span className="absolute -top-2 left-3.5 bg-orange-500 text-white text-[9.5px] font-bold tracking-wider uppercase px-2 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Can’t wait</span>}
      <div className="flex items-start gap-3 pl-2">
        {/* quick-close checkbox */}
        <button
          role="checkbox" aria-checked={closed} tabIndex={0}
          onClick={() => onChangeStatus(task, closed ? 'open' : 'closed')}
          className={`w-5 h-5 rounded-md border-2 grid place-items-center shrink-0 mt-0.5 transition-colors ${closed ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-[#30404F] hover:border-green-500'}`}
          title={closed ? 'Reopen' : 'Mark done'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" className={`w-3 h-3 ${closed ? 'opacity-100' : 'opacity-0'}`}><path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(e => !e)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${src.chip}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{src.tag}</span>
            {task.source === 'email' && task.source_account && <MailboxChip account={task.source_account} />}
            {task.priority === 'high' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" style={{ fontFamily: 'JetBrains Mono, monospace' }}>High</span>}
            {task.priority === 'low' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-slate-500" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Low</span>}
            {hasNewReply && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-500 text-white inline-flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono, monospace' }}><span aria-hidden>↩</span> New reply</span>}
            {taggedBy && <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400"><Avatar userId={taggedBy.id} name={taggedBy.full_name} me={me} size={16} />{firstNameOf(taggedBy.full_name)}</span>}
            {timeLabel && <span className="ml-auto text-[12px] text-gray-400 dark:text-slate-500 whitespace-nowrap" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{timeLabel}</span>}
          </div>
          <div className={`font-semibold text-[14.5px] mt-0.5 ${closed ? 'line-through text-gray-400 dark:text-slate-600' : 'text-gray-900 dark:text-white'}`}>{task.title}</div>
          <SourceMetaLine task={task} />
          {task.note && !expanded && <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">📝 note · tap to expand</div>}
        </div>

        {/* edit (hover) */}
        <button onClick={() => onEditTask(task)} title="Edit task"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity self-center shrink-0 text-gray-400 hover:text-orange-500 dark:text-slate-500 dark:hover:text-orange-400 p-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 20h9" strokeLinecap="round" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        {/* status pill + menu */}
        <div className="relative self-center shrink-0">
          <button onClick={() => setMenuOpen(o => !o)}
            className={`text-[11px] font-semibold border rounded-full px-2.5 py-1 whitespace-nowrap ${st.pill}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {st.label}
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className={`absolute right-0 top-[calc(100%+6px)] z-20 ${cardSurface} rounded-xl shadow-lg p-1.5 min-w-[140px]`}>
                {['open', 'waiting', 'blocked', 'closed'].map(s => (
                  <button key={s} onClick={() => { setMenuOpen(false); onChangeStatus(task, s) }}
                    className={`flex w-full items-center gap-2 text-[13px] px-2 py-1.5 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-white/5 ${closed && s !== 'closed' ? 'mt-1 border-t border-gray-100 dark:border-[#30404F] pt-2 text-green-700 dark:text-green-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}>
                    <span className={`w-2 h-2 rounded-full ${STATUSES[s].dot}`} />
                    {closed && s !== 'closed' ? `Reopen → ${STATUSES[s].label}` : STATUSES[s].label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <ErrorBoundary label="task details">
          <TaskDetail task={task} me={me} usersById={usersById} users={users} onReassign={onReassign} onEditTask={onEditTask} onActed={onActed} />
        </ErrorBoundary>
      )}
    </div>
  )
}

function TaskDetail({ task, me, usersById, users, onReassign, onEditTask, onActed }) {
  const [note, setNote] = useState(task.note || '')
  const [savedAt, setSavedAt] = useState(null)
  const [activity, setActivity] = useState(null)
  const [reassigning, setReassigning] = useState(false)
  const timer = useRef(null)
  const firstEdit = useRef(true)

  useEffect(() => {
    let stale = false
    loadActivity(task.id).then(a => { if (!stale) setActivity(a) }).catch(() => { if (!stale) setActivity([]) })
    return () => { stale = true }
  }, [task.id])

  function onNote(v) {
    setNote(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        await saveTaskNote(task.id, v, firstEdit.current)
        firstEdit.current = false
        setSavedAt(Date.now())
        task.note = v // keep the row's note in sync without a reload
        onActed?.(task.id) // acting on the task clears its "new reply" badge
      } catch (e) { console.error('[CommandCenter] note save failed', e) }
    }, 600)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const assignee = task.assignee ? usersById.get(task.assignee) : null
  const meta = taskMeta(task)
  const isEmail = task.source === 'email'
  const metaSubject = isEmail ? meta.subject : null
  const metaFrom = isEmail ? meta.from : null
  const metaLink = meta.link

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-[#30404F]">
      <div className="flex items-center gap-2 mb-2.5">
        <Avatar userId={task.assignee} name={assignee?.full_name || 'Unassigned'} me={me} size={24} />
        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{assignee?.full_name || 'Unassigned'}</span>
        <button onClick={() => onEditTask(task)} className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-gray-600 dark:text-slate-300 border border-dashed border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1 hover:bg-gray-50 dark:hover:bg-white/5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M12 20h9" strokeLinecap="round" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Edit
        </button>
        <button onClick={() => setReassigning(r => !r)} className="text-[12px] text-orange-600 dark:text-orange-400 border border-dashed border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1 hover:bg-orange-50 dark:hover:bg-orange-500/10">@ reassign</button>
      </div>
      {isEmail && task.source_account && (
        <div className="mb-2"><MailboxChip account={task.source_account} /></div>
      )}
      {(metaSubject || metaLink) && (
        <div className="mb-3 rounded-lg border border-gray-200 dark:border-[#30404F] bg-gray-50 dark:bg-[#0F1822] px-3 py-2.5">
          {metaSubject && (
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-gray-400 dark:text-slate-500 text-[12.5px]" aria-hidden>✉</span>
              <span className="flex-1 min-w-0 text-[12.5px] text-gray-700 dark:text-slate-300 break-words">{metaSubject}</span>
              <CopyButton text={metaSubject} label="Copy email subject" />
            </div>
          )}
          {metaFrom && <div className="mt-1 text-[11.5px] text-gray-400 dark:text-slate-500 break-words" style={{ fontFamily: 'JetBrains Mono, monospace' }}>from {metaFrom}</div>}
          {metaLink && (
            <div className="mt-2">
              <OpenLink href={metaLink} label={isEmail ? 'Open source email' : 'Open source'}>
                <span className="text-[12px] font-semibold">Open {isEmail ? 'email' : 'source'}</span>
              </OpenLink>
            </div>
          )}
        </div>
      )}
      {reassigning && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {users.map(u => (
            <button key={u.id} onClick={() => { onReassign(task, u.id); setReassigning(false) }}
              className={`inline-flex items-center gap-1.5 text-[12px] rounded-full border px-2.5 py-1 ${task.assignee === u.id ? 'border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30' : 'border-gray-200 dark:border-[#30404F] text-gray-600 dark:text-slate-300 hover:border-gray-300'}`}>
              <Avatar userId={u.id} name={u.full_name} me={me} size={16} />
              {u.full_name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-5">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] tracking-[0.1em] uppercase font-semibold text-gray-400 dark:text-slate-500 mb-2" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Issue / notes</div>
          <textarea value={note} onChange={e => onNote(e.target.value)} placeholder="Add a note or what’s blocking this…"
            className="w-full rounded-lg border border-gray-200 dark:border-[#30404F] bg-white dark:bg-[#0F1822] text-gray-900 dark:text-slate-100 text-[13px] px-3 py-2.5 min-h-[92px] resize-y focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1.5 flex items-center gap-1.5" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{savedAt ? 'Saved' : 'Autosaves as you type'}
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] tracking-[0.1em] uppercase font-semibold text-gray-400 dark:text-slate-500 mb-2" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Activity</div>
          {activity === null ? (
            <div className="text-[12px] text-gray-400 dark:text-slate-500">Loading…</div>
          ) : activity.length === 0 ? (
            <div className="text-[12px] text-gray-400 dark:text-slate-500">No activity yet.</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {activity.map(a => (
                <div key={a.id} className="flex gap-2.5 text-[12.5px] text-gray-600 dark:text-slate-400">
                  <ActMarker kind={a.kind} />
                  <div>
                    <span className="text-gray-900 dark:text-slate-200 font-medium">{actLabel(a)}</span>
                    <div className="text-[10.5px] text-gray-400 dark:text-slate-500" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {relTime(a.created_at)}{a.actor && usersById.get(a.actor) ? ` · ${usersById.get(a.actor).full_name}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function actLabel(a) {
  if (a.detail) return a.detail
  return ({ created: 'Created', status_changed: 'Status changed', note_edited: 'Note updated', assigned: 'Reassigned', reopened: 'Reopened', tagged: 'Tagged', reply_received: 'New reply' })[a.kind] || a.kind
}

// Per-kind marker in the activity timeline. Re-surfacing kinds get an accent
// glyph; everything else (known or future) falls back to the neutral dot.
function ActMarker({ kind }) {
  if (kind === 'reply_received') return <span className="shrink-0 mt-0.5 text-[13px] leading-none text-orange-500 dark:text-orange-400" aria-hidden>↩</span>
  if (kind === 'reopened') return <span className="shrink-0 mt-0.5 text-[13px] leading-none text-orange-500 dark:text-orange-400" aria-hidden>↺</span>
  return <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-slate-600 mt-1.5 shrink-0" />
}

// ── Briefing ────────────────────────────────────────────────────────────────
function Briefing({ tasks, upkeepDone, upkeepTotal }) {
  const lines = []
  const openOf = (src) => tasks.filter(t => t.source === src && t.status !== 'closed')
  const top = (list) => [...list].sort(cmpTask)[0]
  for (const src of SOURCE_ORDER) {
    if (src === 'upkeep') continue
    const list = openOf(src)
    if (!list.length) continue
    const t = top(list)
    lines.push({ src, text: <><b className="text-white font-semibold">{list.length} open.</b> {t?.title}{list.length > 1 ? ` · +${list.length - 1} more` : ''}</> })
  }
  if (upkeepTotal > 0) {
    lines.push({ src: 'upkeep', text: <><b className="text-white font-semibold">{upkeepTotal} daily checks</b> to keep BUDDY current — {upkeepDone} done, {upkeepTotal - upkeepDone} to go.</> })
  }
  if (!lines.length) return null
  const order = { email: 0, telegram: 1, calendar: 2, manual: 3, upkeep: 4 }
  lines.sort((a, b) => (order[a.src] ?? 9) - (order[b.src] ?? 9))

  // Eyebrow date, built from America/Chicago parts (not new Date(iso)) → "FRI JUN 26".
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', ...o }).format(new Date())
  const dateLabel = `${fmt({ weekday: 'short' })} ${fmt({ month: 'short' })} ${fmt({ day: 'numeric' })}`.toUpperCase()

  return (
    <div className="relative overflow-hidden rounded-2xl mb-3 px-5 py-4 text-slate-100 bg-gradient-to-br from-[#1F2A37] to-[#0F1822] shadow">
      <style>{`@keyframes ccPulse{0%{box-shadow:0 0 0 0 rgba(249,115,22,.55)}70%{box-shadow:0 0 0 10px rgba(249,115,22,0)}100%{box-shadow:0 0 0 0 rgba(249,115,22,0)}}@media (prefers-reduced-motion:reduce){.cc-pulse-dot{animation:none!important}}`}</style>
      {/* top-right corner glow ("bright spot") — clipped by the card's overflow-hidden */}
      <span aria-hidden className="pointer-events-none absolute -top-12 -right-12 w-[180px] h-[180px]" style={{ background: 'radial-gradient(circle, rgba(249,115,22,.38), transparent 65%)' }} />
      <div className="relative text-[11px] tracking-[0.22em] uppercase font-bold text-orange-400 mb-2.5 flex items-center gap-2">
        <span className="cc-pulse-dot rounded-full shrink-0" style={{ width: 8, height: 8, background: '#F97316', animation: 'ccPulse 2.4s infinite' }} />Today’s briefing <span className="text-orange-300/70">· {dateLabel}</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className={`flex gap-3 items-baseline py-1.5 ${i ? 'border-t border-white/10' : ''}`}>
          <span className="text-[10px] font-semibold tracking-wide px-[7px] py-0.5 rounded-[5px] text-center shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace', minWidth: 64, ...(BRIEF_LABEL[l.src] || BRIEF_LABEL.manual) }}>
            {(SOURCES[l.src]?.label || l.src).toUpperCase()}
          </span>
          <p className="text-[13.5px] text-slate-200">{l.text}</p>
        </div>
      ))}
    </div>
  )
}

// ── Task form (create | edit) ───────────────────────────────────────────────
function TaskForm({ mode = 'create', task = null, me, users, onSubmit, onCancel }) {
  const isEdit = mode === 'edit'
  const [title, setTitle] = useState(task?.title || '')
  const [source, setSource] = useState(task?.source || 'manual')
  const [priority, setPriority] = useState(task?.priority || 'normal')
  const [repeat, setRepeat] = useState(task?.repeat || 'one_time')
  const [dueDate, setDueDate] = useState(task?.due_date || todayCT())
  const [status, setStatus] = useState(task?.status || 'open')
  const [assignee, setAssignee] = useState(task?.assignee || me)
  const [note, setNote] = useState(task?.note || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const oneTime = repeat === 'one_time'
  async function submit() {
    if (!title.trim()) { setErr('Give the task a title.'); return }
    setSaving(true); setErr('')
    try {
      await onSubmit({
        title: title.trim(), source, priority, repeat,
        due_date: dueDate || null, status, assignee: assignee || me, note: note.trim() || null,
      })
    } catch (e) { console.error(e); setErr(e.message || (isEdit ? 'Could not save changes' : 'Could not add the task')); setSaving(false) }
  }

  return (
    <div className={`max-w-[560px] mx-auto rounded-2xl overflow-hidden ${cardSurface}`}>
      <div className="bg-gradient-to-br from-[#1F2A37] to-[#0F1822] text-slate-100 px-6 py-4">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{isEdit ? 'Edit task' : 'Add a task'}</h2>
        <p className="text-[12.5px] text-slate-400 mt-0.5">{isEdit ? 'Changes apply right away in your command center.' : 'Drops straight into your command center.'}</p>
      </div>
      <div className="px-6 py-5 space-y-4">
        {err && <div className="rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[13px] text-red-700 dark:text-red-300">{err}</div>}
        <Field label="Task">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to happen?" className={inputCls} />
        </Field>
        <Field label="Source">
          <div className="flex gap-1.5 flex-wrap">
            {SOURCE_ORDER.map(s => (
              <button key={s} onClick={() => setSource(s)}
                className={`text-[13px] inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 ${source === s ? 'border-orange-300 bg-orange-50 text-orange-700 font-semibold dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30' : 'border-gray-200 dark:border-[#30404F] text-gray-600 dark:text-slate-300'}`}>
                <span className={`w-2 h-2 rounded-full ${SOURCES[s].dot}`} />{s === 'manual' ? 'Manual' : s === 'upkeep' ? 'BUDDY upkeep' : SOURCES[s].label}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex gap-3.5">
          <Field label="Priority" className="flex-1">
            <select value={priority} onChange={e => setPriority(e.target.value)} className={inputCls}>
              <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
            </select>
          </Field>
          <Field label="Repeat" className="flex-1">
            <select value={repeat} onChange={e => setRepeat(e.target.value)} className={inputCls}>
              <option value="one_time">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </Field>
        </div>
        <Field label={oneTime ? 'Due date' : 'Start date'} hint={oneTime ? 'task surfaces on this day' : `first time it appears, then repeats ${repeat}`}>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
            <option value="open">Open</option><option value="waiting">Waiting</option><option value="blocked">Blocked</option><option value="closed">Closed</option>
          </select>
        </Field>
        <Field label="Assign to">
          <div className="flex gap-1.5 flex-wrap">
            {users.map(u => (
              <button key={u.id} onClick={() => setAssignee(u.id)}
                className={`inline-flex items-center gap-1.5 text-[12.5px] rounded-full border px-2.5 py-1 ${assignee === u.id ? 'border-orange-300 bg-orange-50 text-orange-700 font-semibold dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30' : 'border-gray-200 dark:border-[#30404F] text-gray-600 dark:text-slate-300'}`}>
                <Avatar userId={u.id} name={u.full_name} me={me} size={20} />
                {u.id === me ? 'You' : u.full_name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Note" hint="optional">
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Context, a blocker, anything to remember…" className={`${inputCls} min-h-[110px] resize-y`} />
        </Field>
      </div>
      <div className="flex gap-2.5 px-6 py-4 border-t border-gray-100 dark:border-[#30404F]">
        <button onClick={submit} disabled={saving} className="flex-1 font-semibold text-sm bg-orange-500 hover:brightness-105 disabled:opacity-60 text-white rounded-xl py-2.5">{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to command center'}</button>
        <button onClick={onCancel} disabled={saving} className="font-semibold text-sm border border-gray-200 dark:border-[#30404F] text-gray-600 dark:text-slate-300 rounded-xl px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5">Cancel</button>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-gray-200 dark:border-[#30404F] bg-white dark:bg-[#0F1822] text-gray-900 dark:text-slate-100 text-[14px] px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/40'
function Field({ label, hint, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-[10.5px] tracking-[0.08em] uppercase font-semibold text-gray-400 dark:text-slate-500 mb-1.5" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {label}{hint && <span className="normal-case tracking-normal text-gray-400/70 dark:text-slate-600 ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

function InsightsPlaceholder() {
  return (
    <div className={`rounded-2xl ${cardSurface} p-12 text-center`}>
      <div className="text-3xl mb-2">📊</div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Insights — coming soon</h2>
      <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-md mx-auto">Where your work comes from, status mix, upkeep completion, and how busy each day runs. Built in a follow-up.</p>
    </div>
  )
}
