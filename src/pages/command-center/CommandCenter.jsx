import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import {
  loadCommandCenter, loadActivity, setTaskStatus, saveTaskNote, reassignTask, addTask,
  todayCT, ctDate, greetingDateParts, relTime,
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
const cardSurface = 'bg-white dark:bg-[#18222E] border border-gray-200 dark:border-[#2A3744]'

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'
}
function firstNameOf(name) { return (name || '').trim().split(/\s+/)[0] || 'there' }

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

  const [tasks, setTasks] = useState(null)
  const [usersById, setUsersById] = useState(new Map())
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const { tasks, users, usersById } = await loadCommandCenter()
      setTasks(tasks); setUsers(users); setUsersById(usersById); setError('')
    } catch (e) {
      console.error('[CommandCenter] load failed', e)
      setError(e.message || 'Failed to load tasks')
      setTasks([])
    }
  }, [])
  useEffect(() => {
    let stale = false
    loadCommandCenter()
      .then(({ tasks, users, usersById }) => { if (!stale) { setTasks(tasks); setUsers(users); setUsersById(usersById); setError('') } })
      .catch(e => { if (!stale) { console.error('[CommandCenter] load failed', e); setError(e.message || 'Failed to load tasks'); setTasks([]) } })
    return () => { stale = true }
  }, [])

  // Optimistic local patch + reconcile from the returned row.
  const patchTask = useCallback((id, patch) => {
    setTasks(prev => (prev || []).map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  async function changeStatus(task, status) {
    patchTask(task.id, { status, closed_at: status === 'closed' ? new Date().toISOString() : null })
    try { const row = await setTaskStatus(task, status, me); patchTask(task.id, row) }
    catch (e) { console.error(e); reload() }
  }
  async function reassign(task, userId) {
    const name = usersById.get(userId)?.full_name
    patchTask(task.id, { assignee: userId })
    try { const row = await reassignTask(task.id, userId, me, name); patchTask(task.id, row) }
    catch (e) { console.error(e); reload() }
  }
  async function onAdd(payload) {
    const row = await addTask(payload, me)
    setTasks(prev => [row, ...(prev || [])])
    setTab('cc')
  }

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
        <nav className="ml-auto flex gap-1 rounded-full p-1 bg-white dark:bg-[#18222E] border border-gray-200 dark:border-[#2A3744]">
          {[['cc', 'Command Center'], ['add', 'Add task'], ['ins', 'Insights']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)}
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
            tasks={tasks} me={me} usersById={usersById}
            greeting={{ firstName, weekday, month, day }}
            onChangeStatus={changeStatus} onReassign={reassign}
            onGoAdd={() => setTab('add')}
          />
        </ErrorBoundary>
      )}
      {tab === 'add' && (
        <ErrorBoundary label="the add-task form">
          <AddTaskForm me={me} users={users} onAdd={onAdd} onCancel={() => setTab('cc')} />
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
function CommandCenterView({ tasks, me, usersById, greeting, onChangeStatus, onReassign, onGoAdd }) {
  const [filters, setFilters] = useState({ source: 'all', status: 'open', priority: 'all' })
  const [revealed, setRevealed] = useState(false)
  const isDefault = filters.source === 'all' && filters.status === 'open' && filters.priority === 'all'

  const today = todayCT()
  const loading = tasks === null
  const all = useMemo(() => tasks || [], [tasks])

  // Focus = highest-priority open task (priority → due → created).
  const focusId = useMemo(() => {
    const open = all.filter(t => t.status === 'open')
    if (!open.length) return null
    const sorted = [...open].sort(cmpTask)
    return sorted[0].id
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
    for (const t of all) { const g = assignGroup(t, focusId, me, today); if (g) m[g].push(t) }
    for (const k of Object.keys(m)) m[k].sort(cmpTask)
    return m
  }, [all, focusId, me, today])

  function passes(t) {
    if (filters.source !== 'all' && t.source !== filters.source) return false
    if (filters.status === 'wb') { if (t.status !== 'waiting' && t.status !== 'blocked') return false }
    else if (filters.status !== 'all' && t.status !== filters.status) return false
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false
    return true
  }

  // Upkeep progress (all upkeep tasks, regardless of filter).
  const upkeep = byGroup.upkeep
  const upkeepDone = upkeep.filter(t => t.status === 'closed').length

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
        <p className="text-[13px] text-gray-500 dark:text-slate-500 mt-0.5">Today is {greeting.weekday}, {greeting.month} {greeting.day} · here’s where to point your attention.</p>
      </div>

      <Briefing tasks={all} upkeepDone={upkeepDone} upkeepTotal={upkeep.length} />

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
        <div className="flex items-center gap-1.5 flex-wrap mt-2 pt-2 border-t border-dashed border-gray-200 dark:border-[#2A3744]">
          <span className="text-[9.5px] font-semibold tracking-widest uppercase text-gray-400 dark:text-slate-500 mr-1">Status</span>
          {['all', 'open', 'waiting', 'blocked', 'closed'].map(s => (
            <FChip key={s} active={filters.status === s} onClick={() => setFilters(f => ({ ...f, status: s }))}>{s === 'all' ? 'All' : STATUSES[s].label}</FChip>
          ))}
          <span className="w-px h-4 bg-gray-200 dark:bg-[#2A3744] mx-1" />
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
              <GroupHeader group={g} upkeep={g.key === 'upkeep' ? { done: upkeepDone, total: upkeep.length } : null} />
              {items.map(t => (
                <TaskRow key={t.id} task={t} focus={t.id === focusId} usersById={usersById}
                  users={[...usersById.values()]} onChangeStatus={onChangeStatus} onReassign={onReassign} />
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
function assignGroup(t, focusId, me, today) {
  if (t.id === focusId) return 'focus'
  if (t.source === 'upkeep') return 'upkeep'
  if (t.source === 'calendar') return 'calendar'
  if (t.assignee === me && t.created_by && t.created_by !== me) return 'tagged'
  if (t.status === 'closed') return ctDate(t.closed_at) === today ? 'closed' : null
  return 'needs'
}

// priority → due_date → created_at
function cmpTask(a, b) {
  const pr = (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1)
  if (pr) return pr
  const ad = a.due_date || '9999-12-31', bd = b.due_date || '9999-12-31'
  if (ad !== bd) return ad < bd ? -1 : 1
  return (a.created_at || '') < (b.created_at || '') ? -1 : 1
}

function FChip({ active, dot, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`text-[12px] font-medium px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 transition-colors ${
        active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white dark:bg-[#18222E] text-gray-600 dark:text-slate-300 border-gray-200 dark:border-[#2A3744] hover:border-gray-300 dark:hover:border-slate-600'
      }`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white/80' : dot}`} />}
      {children}
    </button>
  )
}

function StatCard({ n, label, attn, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`relative text-left rounded-xl px-3.5 py-3 transition-all ${cardSurface} hover:-translate-y-px ${active ? 'ring-[1.5px] ring-orange-500 border-orange-500' : ''}`}>
      {active && <span className="absolute top-2 right-2.5 text-[9px] font-semibold text-orange-500" style={{ fontFamily: 'JetBrains Mono, monospace' }}>▼ filtered</span>}
      <div className={`text-[25px] font-bold leading-none ${attn ? 'text-orange-500' : 'text-gray-900 dark:text-white'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{n}</div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mt-1.5">{label}</div>
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
    <div className="text-[11px] tracking-[0.18em] uppercase font-bold text-gray-400 dark:text-slate-500 mt-1.5 px-0.5 flex items-center gap-2">
      {group.label}
      {group.key === 'tagged' && <span className="text-[9.5px] tracking-wide bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300 px-1.5 py-0.5 rounded normal-case font-semibold">Preview · rollout</span>}
    </div>
  )
}

// ── Task row + detail drawer ────────────────────────────────────────────────
function TaskRow({ task, focus, usersById, users, onChangeStatus, onReassign }) {
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const src = SOURCES[task.source] || SOURCES.manual
  const st = STATUSES[task.status] || STATUSES.open
  const isUpkeep = task.source === 'upkeep'
  const closed = task.status === 'closed'
  const timeLabel = task.due_date ? shortDue(task.due_date) : (isUpkeep ? 'daily' : '')

  return (
    <div className={`relative rounded-xl ${cardSurface} ${isUpkeep ? 'px-4 py-2.5' : 'px-4 py-3'} ${focus ? 'ring-1 ring-orange-500 border-orange-500' : ''} ${closed ? 'opacity-60' : ''}`}>
      <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded ${src.spine}`} />
      {focus && <span className="absolute -top-2 left-3.5 bg-orange-500 text-white text-[9.5px] font-bold tracking-wider uppercase px-2 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Can’t wait</span>}
      <div className="flex items-start gap-3 pl-2">
        {/* quick-close checkbox */}
        <button
          role="checkbox" aria-checked={closed} tabIndex={0}
          onClick={() => onChangeStatus(task, closed ? 'open' : 'closed')}
          className={`w-5 h-5 rounded-md border-2 grid place-items-center shrink-0 mt-0.5 transition-colors ${closed ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-[#2A3744] hover:border-green-500'}`}
          title={closed ? 'Reopen' : 'Mark done'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" className={`w-3 h-3 ${closed ? 'opacity-100' : 'opacity-0'}`}><path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(e => !e)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${src.chip}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{src.tag}</span>
            {task.priority === 'high' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" style={{ fontFamily: 'JetBrains Mono, monospace' }}>High</span>}
            {task.priority === 'low' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-slate-500" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Low</span>}
            {timeLabel && <span className="ml-auto text-[12px] text-gray-400 dark:text-slate-500 whitespace-nowrap" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{timeLabel}</span>}
          </div>
          <div className={`font-semibold text-[14.5px] mt-0.5 ${closed ? 'line-through text-gray-400 dark:text-slate-600' : 'text-gray-900 dark:text-white'}`}>{task.title}</div>
          {task.note && !expanded && <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">📝 note · tap to expand</div>}
        </div>

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
                    className={`flex w-full items-center gap-2 text-[13px] px-2 py-1.5 rounded-lg text-left hover:bg-gray-50 dark:hover:bg-white/5 ${closed && s !== 'closed' ? 'mt-1 border-t border-gray-100 dark:border-[#2A3744] pt-2 text-green-700 dark:text-green-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}>
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
          <TaskDetail task={task} usersById={usersById} users={users} onReassign={onReassign} />
        </ErrorBoundary>
      )}
    </div>
  )
}

function TaskDetail({ task, usersById, users, onReassign }) {
  const { user } = useAuth()
  const me = user?.id
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
        await saveTaskNote(task.id, v, me, firstEdit.current)
        firstEdit.current = false
        setSavedAt(Date.now())
        task.note = v // keep the row's note in sync without a reload
      } catch (e) { console.error('[CommandCenter] note save failed', e) }
    }, 600)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const assignee = task.assignee ? usersById.get(task.assignee) : null

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-[#2A3744]">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-6 h-6 rounded-full bg-orange-500 grid place-items-center text-white text-[10px] font-bold">{initials(assignee?.full_name || 'Unassigned')}</span>
        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{assignee?.full_name || 'Unassigned'}</span>
        <button onClick={() => setReassigning(r => !r)} className="ml-auto text-[12px] text-orange-600 dark:text-orange-400 border border-dashed border-gray-300 dark:border-slate-600 rounded-lg px-2.5 py-1 hover:bg-orange-50 dark:hover:bg-orange-500/10">@ reassign</button>
      </div>
      {reassigning && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {users.map(u => (
            <button key={u.id} onClick={() => { onReassign(task, u.id); setReassigning(false) }}
              className={`inline-flex items-center gap-1.5 text-[12px] rounded-full border px-2.5 py-1 ${task.assignee === u.id ? 'border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30' : 'border-gray-200 dark:border-[#2A3744] text-gray-600 dark:text-slate-300 hover:border-gray-300'}`}>
              <span className="w-4 h-4 rounded-full bg-gray-400 dark:bg-slate-600 grid place-items-center text-white text-[8px] font-bold">{initials(u.full_name)}</span>
              {u.full_name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-5">
        <div className="flex-1 min-w-[200px]">
          <div className="text-[10px] tracking-[0.1em] uppercase font-semibold text-gray-400 dark:text-slate-500 mb-2" style={{ fontFamily: 'JetBrains Mono, monospace' }}>Issue / notes</div>
          <textarea value={note} onChange={e => onNote(e.target.value)} placeholder="Add a note or what’s blocking this…"
            className="w-full rounded-lg border border-gray-200 dark:border-[#2A3744] bg-white dark:bg-[#0F1822] text-gray-900 dark:text-slate-100 text-[13px] px-3 py-2.5 min-h-[92px] resize-y focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
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
                  <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-slate-600 mt-1.5 shrink-0" />
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
  return ({ created: 'Created', status_changed: 'Status changed', note_edited: 'Note updated', assigned: 'Reassigned', reopened: 'Reopened', tagged: 'Tagged' })[a.kind] || a.kind
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
      <div className="text-[11px] tracking-[0.22em] uppercase font-bold text-orange-400 mb-2.5 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />Today’s briefing <span className="text-orange-300/70">· {dateLabel}</span>
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

// ── Add task form ───────────────────────────────────────────────────────────
function AddTaskForm({ me, users, onAdd, onCancel }) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('manual')
  const [priority, setPriority] = useState('normal')
  const [repeat, setRepeat] = useState('one_time')
  const [dueDate, setDueDate] = useState(todayCT())
  const [status, setStatus] = useState('open')
  const [assignee, setAssignee] = useState(me)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const oneTime = repeat === 'one_time'
  async function submit() {
    if (!title.trim()) { setErr('Give the task a title.'); return }
    setSaving(true); setErr('')
    try {
      await onAdd({
        title: title.trim(), source, priority, repeat,
        due_date: dueDate || null, status, assignee: assignee || me, note: note.trim() || null,
      })
    } catch (e) { console.error(e); setErr(e.message || 'Could not add the task'); setSaving(false) }
  }

  return (
    <div className={`max-w-[560px] mx-auto rounded-2xl overflow-hidden ${cardSurface}`}>
      <div className="bg-gradient-to-br from-[#1F2A37] to-[#0F1822] text-slate-100 px-6 py-4">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Add a task</h2>
        <p className="text-[12.5px] text-slate-400 mt-0.5">Drops straight into your command center.</p>
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
                className={`text-[13px] inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 ${source === s ? 'border-orange-300 bg-orange-50 text-orange-700 font-semibold dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30' : 'border-gray-200 dark:border-[#2A3744] text-gray-600 dark:text-slate-300'}`}>
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
                className={`inline-flex items-center gap-1.5 text-[12.5px] rounded-full border px-2.5 py-1 ${assignee === u.id ? 'border-orange-300 bg-orange-50 text-orange-700 font-semibold dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30' : 'border-gray-200 dark:border-[#2A3744] text-gray-600 dark:text-slate-300'}`}>
                <span className="w-5 h-5 rounded-full bg-gray-400 dark:bg-slate-600 grid place-items-center text-white text-[9px] font-bold">{initials(u.full_name)}</span>
                {u.id === me ? 'You' : u.full_name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Note" hint="optional">
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Context, a blocker, anything to remember…" className={`${inputCls} min-h-[110px] resize-y`} />
        </Field>
      </div>
      <div className="flex gap-2.5 px-6 py-4 border-t border-gray-100 dark:border-[#2A3744]">
        <button onClick={submit} disabled={saving} className="flex-1 font-semibold text-sm bg-orange-500 hover:brightness-105 disabled:opacity-60 text-white rounded-xl py-2.5">{saving ? 'Adding…' : 'Add to command center'}</button>
        <button onClick={onCancel} disabled={saving} className="font-semibold text-sm border border-gray-200 dark:border-[#2A3744] text-gray-600 dark:text-slate-300 rounded-xl px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5">Cancel</button>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-gray-200 dark:border-[#2A3744] bg-white dark:bg-[#0F1822] text-gray-900 dark:text-slate-100 text-[14px] px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/40'
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
