// Data layer for the Command Center. Reads/writes tasks + task_activity via the
// app-wide Supabase client (RLS scopes rows to owner/assignee). Pure data —
// grouping/filtering lives in the page.

import { supabase } from '../../lib/supabase'

// Today's date (YYYY-MM-DD) in America/Chicago — used for "closed today" and
// the date label, built from parts to avoid a UTC month/day shift.
export function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

// A timestamptz → its America/Chicago calendar date (YYYY-MM-DD), or null.
export function ctDate(ts) {
  if (!ts) return null
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ts)) } catch { return null }
}

// Weekday / Month / Day parts for the greeting, in America/Chicago.
export function greetingDateParts() {
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', ...o }).format(new Date())
  return { weekday: fmt({ weekday: 'long' }), month: fmt({ month: 'long' }), day: fmt({ day: 'numeric' }) }
}

// Relative "time ago" for activity rows.
export function relTime(ts) {
  if (!ts) return ''
  const then = new Date(ts).getTime()
  const diff = Date.now() - then
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(new Date(ts))
}

// One round trip: the user's tasks + a users lookup for assignee/actor display,
// plus the latest activity row per task (for the "new reply" heuristic).
export async function loadCommandCenter() {
  const [taskRes, userRes] = await Promise.all([
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name, email, role, status'),
  ])
  if (taskRes.error) throw taskRes.error
  const usersById = new Map((userRes.data || []).map(u => [u.id, u]))
  const tasks = taskRes.data || []
  const latestActivityByTask = await loadLatestActivityByTask(tasks.map(t => t.id))
  return { tasks, users: userRes.data || [], usersById, latestActivityByTask }
}

// Latest task_activity row per task, in one query (no per-row fetches). Used to
// decide which open tasks carry an unacted reply. Degrades gracefully: on any
// error it returns an empty map, so the page simply shows no reply badges.
async function loadLatestActivityByTask(taskIds) {
  const map = new Map()
  if (!taskIds.length) return map
  const { data, error } = await supabase
    .from('task_activity')
    .select('task_id, kind, detail, created_at')
    .in('task_id', taskIds)
    .order('created_at', { ascending: false })
  if (error) { console.error('[CommandCenter] latest activity load failed', error); return map }
  for (const r of data || []) {
    if (!map.has(r.task_id)) map.set(r.task_id, r) // first per task = newest (desc order)
  }
  return map
}

// Activity for one task (newest first).
export async function loadActivity(taskId) {
  const { data, error } = await supabase
    .from('task_activity')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// The signed-in user's id (= auth.uid()), read straight from the session.
// task_activity's RLS `with check` requires actor = auth.uid(), so we never
// trust a passed-in id — we source it from auth, the only value that passes.
async function authUid() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.id ?? null
}

// Insert one activity row. actor is always the authenticated user. Failures are
// surfaced to the console (with context) but never crash the calling action —
// a missing log row shouldn't block closing/assigning a task.
async function logActivity(taskId, kind, detail, metadata = null) {
  const actor = await authUid()
  if (!actor) { console.error('[CommandCenter] activity insert skipped — no authenticated user', { taskId, kind }); return }
  const row = { task_id: taskId, actor, kind, detail }
  if (metadata != null) row.metadata = metadata // omit when absent — don't reference a column we aren't using
  const { error } = await supabase.from('task_activity').insert(row)
  if (error) console.error('[CommandCenter] activity insert failed', { taskId, kind, actor, error })
}

// Status change → tasks.status (+ closed_at) + a status_changed / reopened entry.
export async function setTaskStatus(task, status) {
  const wasClosed = task.status === 'closed'
  const closed_at = status === 'closed' ? new Date().toISOString() : null
  const { data, error } = await supabase
    .from('tasks')
    .update({ status, closed_at })
    .eq('id', task.id)
    .select('*')
    .single()
  if (error) throw error
  const kind = wasClosed && status !== 'closed' ? 'reopened' : 'status_changed'
  await logActivity(task.id, kind, `${cap(task.status)} → ${cap(status)}`)
  return data
}

// Debounced note save (caller debounces). Logs note_edited only on the first
// save of a session (firstEdit=true) so we don't spam one per keystroke.
export async function saveTaskNote(taskId, note, firstEdit) {
  const { error } = await supabase.from('tasks').update({ note }).eq('id', taskId)
  if (error) throw error
  if (firstEdit) await logActivity(taskId, 'note_edited', 'Note updated')
}

export async function reassignTask(taskId, assignee, assigneeName) {
  const { data, error } = await supabase.from('tasks').update({ assignee }).eq('id', taskId).select('*').single()
  if (error) throw error
  await logActivity(taskId, 'assigned', assigneeName ? `Assigned to ${assigneeName}` : 'Reassigned')
  return data
}

export async function addTask(payload) {
  const created_by = await authUid()
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...payload, created_by })
    .select('*')
    .single()
  if (error) throw error
  await logActivity(data.id, 'created', 'Task created')
  return data
}

// Full edit of an existing task. Core fields just update the row; the three
// fields that have activity kinds (status, assignee, note) log when they change
// — no new activity kind is invented (no schema change this round).
export async function updateTask(prev, payload, assigneeName) {
  const patch = { ...payload }
  const statusChanged = payload.status !== undefined && payload.status !== prev.status
  if (statusChanged) patch.closed_at = payload.status === 'closed' ? new Date().toISOString() : null

  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', prev.id)
    .select('*')
    .single()
  if (error) throw error

  if (statusChanged) {
    const kind = prev.status === 'closed' && payload.status !== 'closed' ? 'reopened' : 'status_changed'
    await logActivity(prev.id, kind, `${cap(prev.status)} → ${cap(payload.status)}`)
  }
  if (payload.assignee !== undefined && payload.assignee !== prev.assignee) {
    await logActivity(prev.id, 'assigned', assigneeName ? `Assigned to ${assigneeName}` : 'Reassigned')
  }
  if (payload.note !== undefined && (payload.note || '') !== (prev.note || '')) {
    await logActivity(prev.id, 'note_edited', 'Note updated')
  }
  return data
}
