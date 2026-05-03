import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { S } from '../lib/styles'

const FILTERS = [
  { id: 'all',      label: 'All' },
  { id: 'unread',   label: 'Unread' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'system',   label: 'System' },
]

export default function NotificationsPage() {
  const { user } = useAuth()
  const userId = user?.id
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  // Subscribe so the page updates as new notifications arrive.
  // Per-mount nonce — see NotificationBell for the rationale.
  useEffect(() => {
    if (!userId) return
    const nonce = Math.random().toString(36).slice(2, 10)
    const ch = supabase
      .channel(`notifications-page-${userId}-${nonce}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${userId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [userId, load])

  const filtered = useMemo(() => {
    if (filter === 'unread')   return items.filter(n => !n.read_at)
    if (filter === 'mentions') return items.filter(n => n.notification_type === 'mention')
    if (filter === 'system')   return items.filter(n => n.notification_type !== 'mention')
    return items
  }, [items, filter])

  const counts = useMemo(() => ({
    all: items.length,
    unread: items.filter(n => !n.read_at).length,
    mentions: items.filter(n => n.notification_type === 'mention').length,
    system: items.filter(n => n.notification_type !== 'mention').length,
  }), [items])

  async function toggleRead(n) {
    await supabase
      .from('notifications')
      .update({ read_at: n.read_at ? null : new Date().toISOString() })
      .eq('id', n.id)
  }

  async function markAllRead() {
    if (!userId) return
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_user_id', userId)
      .is('read_at', null)
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Mentions, alerts, and system events. {counts.unread > 0 && `${counts.unread} unread.`}
          </p>
        </div>
        {counts.unread > 0 && (
          <button onClick={markAllRead} className={S.btnSecondary}>
            Mark all read
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={S.filterBtn(filter === f.id)}
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-70">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${S.card} p-12 text-center`}>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {filter === 'all' ? 'No notifications yet.' : 'Nothing in this filter.'}
          </p>
        </div>
      ) : (
        <ul className={`${S.card} divide-y divide-gray-100 dark:divide-white/5`}>
          {filtered.map(n => (
            <li key={n.id} className={`p-4 transition-colors ${!n.read_at ? 'bg-cyan-50/30 dark:bg-cyan-500/[0.04]' : ''}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                  n.notification_type === 'mention'
                    ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                    : 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400'
                }`}>
                  {n.notification_type === 'mention' ? '@' : '●'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-200">{n.title}</p>
                    <span className="text-[11px] text-gray-400 dark:text-slate-500 whitespace-nowrap">
                      {fmtAt(n.created_at)}
                    </span>
                  </div>
                  {n.body && <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 line-clamp-3">{n.body}</p>}
                  <div className="mt-2 flex items-center gap-3">
                    {n.link_url && (
                      <Link to={n.link_url} className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
                        Open →
                      </Link>
                    )}
                    <button
                      onClick={() => toggleRead(n)}
                      className="text-xs text-gray-500 dark:text-slate-400 hover:underline"
                    >
                      Mark {n.read_at ? 'unread' : 'read'}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function fmtAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
