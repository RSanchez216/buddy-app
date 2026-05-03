import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import CommentComposer from './CommentComposer'
import CommentItem from './CommentItem'
import { formatEventType } from '../utils/events'
import { fmtDateTime, fmtRelative } from '../utils/format'

const EVENT_DOT = {
  created:           'bg-emerald-500',
  updated:           'bg-blue-500',
  status_changed:    'bg-purple-500',
  title_released:    'bg-emerald-500',
  document_added:    'bg-gray-400 dark:bg-slate-500',
  document_removed:  'bg-gray-400 dark:bg-slate-500',
  equipment_linked:  'bg-teal-500',
  equipment_unlinked:'bg-amber-500',
  driver_updated:    'bg-orange-500',
  imported:          'bg-gray-300 dark:bg-slate-600',
}

// Combined activity feed: rich-text comments + system events, queried
// from v_driver_purchase_activity. Composer pinned at the top, list
// scrolls inside the parent's sticky viewport.
export default function ActivityFeed({ purchaseId, focusCommentId }) {
  const { profile, user } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!purchaseId) return
    setLoading(true)
    const { data } = await supabase
      .from('v_driver_purchase_activity')
      .select('*')
      .eq('driver_purchase_id', purchaseId)
      .order('at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }, [purchaseId])

  useEffect(() => { load() }, [load])

  // Realtime: refresh whenever a comment or event lands for this purchase.
  useEffect(() => {
    if (!purchaseId) return
    const ch = supabase
      .channel(`activity-${purchaseId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'driver_purchase_comments', filter: `driver_purchase_id=eq.${purchaseId}` },
        () => load())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'driver_purchase_events', filter: `driver_purchase_id=eq.${purchaseId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [purchaseId, load])

  // After load, if a focusCommentId is in the URL, scroll to it.
  useEffect(() => {
    if (!focusCommentId || loading) return
    const el = document.querySelector(`[data-comment-id="${focusCommentId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [focusCommentId, loading, items.length])

  return (
    <div className={`${S.card} p-4 flex flex-col gap-3 lg:max-h-[calc(100vh-1rem)]`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 shrink-0">Activity</p>

      {/* Composer pinned to the top of the activity column */}
      <div className="shrink-0">
        <CommentComposer purchaseId={purchaseId} onSubmitted={load} />
      </div>

      {/* Feed */}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {loading ? (
          <p className="text-xs text-gray-400 dark:text-slate-600">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-slate-600 italic py-2">No activity yet</p>
        ) : (
          <ul className="space-y-3">
            {items.map(it =>
              it.activity_type === 'comment' ? (
                <CommentItem
                  key={`c-${it.id}`}
                  row={it}
                  currentUserId={user?.id}
                  isAdmin={isAdmin}
                  highlight={focusCommentId === it.id}
                />
              ) : (
                <EventRow key={`e-${it.id}`} row={it} />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

// Compact event row — colored dot + tag + meta + description. Less
// visual weight than a full comment, per spec.
function EventRow({ row }) {
  return (
    <li className="flex items-start gap-2.5">
      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${EVENT_DOT[row.event_type] || EVENT_DOT.imported}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide bg-gray-100 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300">
            {formatEventType(row.event_type)}
          </span>
          <span className="text-[11px] text-gray-400 dark:text-slate-500" title={fmtDateTime(row.at)}>
            {fmtRelative(row.at)}
          </span>
          {row.created_by_name && (
            <span className="text-[11px] text-gray-400 dark:text-slate-500">· {row.created_by_name}</span>
          )}
        </div>
        {row.body_text && (
          <p className="text-sm text-gray-700 dark:text-slate-300 mt-0.5 break-words">{row.body_text}</p>
        )}
      </div>
    </li>
  )
}
