import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

// Bell icon + dropdown for in-app notifications.
// Subscribes via Supabase Realtime to inserts/updates on the
// notifications table for the current user. Fallback polling kicks in
// every 60s in case realtime drops.
export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  const userId = user?.id

  const load = useCallback(async () => {
    if (!userId) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    setItems(data || [])
  }, [userId])

  useEffect(() => { load() }, [load])

  // Realtime subscription. Channel name carries a per-mount nonce because
  // supabase-js caches channels by name internally; reusing a name across
  // remounts triggers "cannot add postgres_changes callbacks after
  // subscribe()" when the second mount tries to chain .on() on the cached
  // (already-subscribed) channel.
  useEffect(() => {
    if (!userId) return
    const nonce = Math.random().toString(36).slice(2, 10)
    const ch = supabase
      .channel(`notifications-${userId}-${nonce}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}` },
        () => load())
      .subscribe()
    const poll = setInterval(load, 60000)
    return () => {
      supabase.removeChannel(ch)
      clearInterval(poll)
    }
  }, [userId, load])

  // Click-away
  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const unread = items.filter(n => !n.read_at)
  const unreadCount = unread.length

  async function openItem(n) {
    setOpen(false)
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    }
    if (n.link_url) navigate(n.link_url)
  }

  async function markAllRead() {
    if (!userId || !unreadCount) return
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_user_id', userId)
      .is('read_at', null)
    load()
  }

  if (!userId) return null

  const badge = unreadCount === 0 ? null : unreadCount > 9 ? '9+' : String(unreadCount)

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
        {unreadCount > 0 && unreadCount <= 1 ? (
          // Single-unread case: small red dot with white border (per spec).
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
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-xs text-gray-400 dark:text-slate-500">No notifications yet.</li>
            ) : items.map(n => (
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
                      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{relTime(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 py-2 border-t border-gray-100 dark:border-white/5">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
            >
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
  return 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400'
}

function typeIcon(t) {
  if (t === 'mention') return '@'
  return '●'
}

function relTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return `${Math.floor(diff / 604800)}w ago`
}
