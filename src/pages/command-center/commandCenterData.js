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

// One round trip: the user's tasks + a users lookup for assignee/actor display.
export async function loadCommandCenter() {
  const [taskRes, userRes] = await Promise.all([
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name, email, role, status'),
  ])
  if (taskRes.error) throw taskRes.error
  const usersById = new Map((userRes.data || []).map(u => [u.id, u]))
  return { tasks: taskRes.data || [], users: userRes.data || [], usersById }
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

async function logActivity(taskId, actor, kind, detail, metadata = null) {
  const { error } = await supabase.from('task_activity').insert({ task_id: taskId, actor, kind, detail, metadata })
  if (error) console.error('[CommandCenter] activity insert failed', error)
}

// Status change → tasks.status (+ closed_at) + a status_changed / reopened entry.
export async function setTaskStatus(task, status, actor) {
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
  await logActivity(task.id, actor, kind, `Status → ${status}`)
  return data
}

// Debounced note save (caller debounces). Logs note_edited only on the first
// save of a session (firstEdit=true) so we don't spam one per keystroke.
export async function saveTaskNote(taskId, note, actor, firstEdit) {
  const { error } = await supabase.from('tasks').update({ note }).eq('id', taskId)
  if (error) throw error
  if (firstEdit) await logActivity(taskId, actor, 'note_edited', 'Note updated')
}

export async function reassignTask(taskId, assignee, actor, assigneeName) {
  const { data, error } = await supabase.from('tasks').update({ assignee }).eq('id', taskId).select('*').single()
  if (error) throw error
  await logActivity(taskId, actor, 'assigned', assigneeName ? `Assigned to ${assigneeName}` : 'Reassigned')
  return data
}

export async function addTask(payload, actor) {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ ...payload, created_by: actor })
    .select('*')
    .single()
  if (error) throw error
  await logActivity(data.id, actor, 'created', 'Task created')
  return data
}
