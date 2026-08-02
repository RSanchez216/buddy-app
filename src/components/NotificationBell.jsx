import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// In-app notification bell. Reads through the RLS-guarded RPCs so it shows only
// the caller's rows (escalations, mentions, …). Kept live by a Realtime push;
// the fallback poll runs at most once a minute and only while the tab is
// visible — the app makes no fast background requests.
export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [acking, setAcking] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const wrapperRef = useRef(null)
  const userId = user?.id

  const load = useCallback(async () => {
    if (!userId || document.hidden) return
    const [{ data: list }, { data: cnt }] = await Promise.all([
      supabase.rpc('my_notifications', { p_limit: 20, p_unread_only: false }),
      supabase.rpc('my_unread_notification_count'),
    ])
    // Unread first, then newest (smallest age) first.
    const sorted = [...(list || [])].sort((a, b) =>
      (a.read_at ? 1 : 0) - (b.read_at ? 1 : 0) || (Number(a.age_minutes) || 0) - (Number(b.age_minutes) || 0))
    setItems(sorted)
    setCount(Number(cnt) || 0)
  }, [userId])

  useEffect(() => { load() }, [load])

  // Realtime push + a visible-only 60s fallback. Refresh immediately when the
  // tab becomes visible again so a badge isn't stale on return.
  useEffect(() => {
    if (!userId) return
    const nonce = Math.random().toString(36).slice(2, 10)
    const ch = supabase
      .channel(`notifications-${userId}-${nonce}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}` },
        () => load())
      .subscribe()
    const poll = setInterval(() => { if (!document.hidden) load() }, 60000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [userId, load])

  // Click-away
  useEffect(() => {
    if (!open) return
    function onClick(e) { if (!wrapperRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function openItem(n) {
    setOpen(false)
    if (!n.read_at) {
      await supabase.rpc('mark_notification_read', { p_id: n.id })
      load()
    }
    if (n.link_url) navigate(n.link_url)
  }

  async function markAllRead() {
    if (!userId || !count) return
    await supabase.rpc('mark_all_notifications_read')
    load()
  }

  // Acknowledge an escalation straight from the panel (recipient-only, enforced
  // server-side). The notification's source_id is the shift_activity id.
  async function ack(n, e) {
    e.stopPropagation()
    setAcking(n.id)
    try {
      await supabase.rpc('acknowledge_escalation', { p_activity_id: n.source_id })
      await supabase.rpc('mark_notification_read', { p_id: n.id })
      await load()
    } catch { /* server enforces who can ack; ignore refusal here */ }
    finally { setAcking(null) }
  }

  // Copy the escalation as a Telegram-ready block (reflects live ack state).
  async function copyEsc(n, e) {
    e.stopPropagation()
    try {
      const { data } = await supabase.rpc('escalation_copy_text', { p_activity_id: n.source_id })
      await navigator.clipboard.writeText(data || '')
      setCopiedId(n.id); setTimeout(() => setCopiedId(c => (c === n.id ? null : c)), 1500)
    } catch { /* clipboard blocked / no text — no-op */ }
  }

  if (!userId) return null

  const badge = count === 0 ? null : count > 9 ? '9+' : String(count)

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        className="relative w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {count > 0 && count <= 1 ? (
          <span className="absolute top-1 right-1 w-[7px] h-[7px] rounded-full bg-red-500 ring-[1.5px] ring-white dark:ring-[#0d0d1f]" />
        ) : badge ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-[1.5px] ring-white dark:ring-[#0d0d1f]">
            {badge}
          </span>
        ) : null}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-2xl bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-2xl overflow-hidden z-40">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-white/5">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-slate-400">Notifications</span>
            {count > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-xs text-gray-400 dark:text-slate-500">No notifications yet.</li>
            ) : items.map(n => {
              const isEsc = n.notification_type === 'escalation' && n.source_id
              return (
                <li key={n.id}>
                  <button
                    onClick={() => openItem(n)}
                    className={`w-full text-left px-4 py-2.5 border-b border-gray-50 dark:border-white/[0.04] last:border-0 transition-colors ${
                      n.read_at
                        ? 'hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                        : 'bg-cyan-50/50 dark:bg-cyan-500/[0.06] hover:bg-cyan-50 dark:hover:bg-cyan-500/[0.1]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-1 shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${typeChipClass(n.notification_type)}`}>
                        {typeIcon(n.notification_type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">{n.title}</p>
                        {n.body && (
                          <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2 mt-0.5">{n.body}</p>
                        )}
                        <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{relTime(n.age_minutes)}</p>
                        {isEsc && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <button type="button" onClick={e => ack(n, e)} disabled={acking === n.id}
                              className="px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-500/40 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50">
                              {acking === n.id ? 'Acknowledging…' : '✓ Acknowledge'}
                            </button>
                            <button type="button" onClick={e => copyEsc(n, e)}
                              className="px-2 py-0.5 rounded border border-gray-200 dark:border-white/10 text-[11px] font-medium text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">
                              {copiedId === n.id ? 'Copied' : '📋 Copy'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-white/5">
            <Link to="/notifications" onClick={() => setOpen(false)} className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
              See all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function typeChipClass(t) {
  if (t === 'mention') return 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
  if (t === 'escalation') return 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'
  return 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400'
}
function typeIcon(t) {
  if (t === 'mention') return '@'
  if (t === 'escalation') return '🚨'
  return '●'
}
// Relative time from the RPC's age_minutes (already server-computed).
function relTime(mins) {
  const m = Math.max(0, Math.floor(Number(mins) || 0))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (m < 1440) return `${Math.floor(m / 60)}h ago`
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`
  return `${Math.floor(m / 10080)}w ago`
}
