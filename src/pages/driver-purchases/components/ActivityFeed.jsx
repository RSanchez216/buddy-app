import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import CommentComposer from './CommentComposer'
import CommentItem from './CommentItem'
import { formatEventType } from '../utils/events'
import { fmtDateTime, fmtRelative } from '../utils/format'
import { useToast } from '../../../contexts/ToastContext'

const EVENT_DOT = {
  created:           'bg-emerald-500',
  updated:           'bg-blue-500',
  status_changed:    'bg-purple-500',
  title_released:    'bg-emerald-500',
  document_added:        'bg-gray-400 dark:bg-slate-500',
  document_removed:      'bg-gray-400 dark:bg-slate-500',
  document_type_changed: 'bg-blue-500',
  equipment_linked:  'bg-teal-500',
  equipment_unlinked:'bg-amber-500',
  driver_updated:    'bg-orange-500',
  imported:          'bg-gray-300 dark:bg-slate-600',
  payment_reconciled:   'bg-emerald-500',
  payment_unreconciled: 'bg-amber-500',
  payment_recorded:     'bg-cyan-500',
  payment_record_undone:'bg-amber-500',
  payment_edited:       'bg-blue-500',
  payment_skipped:      'bg-indigo-500',
  payment_skip_undone:  'bg-amber-500',
}

// Combined activity feed: rich-text comments + system events, queried
// from v_driver_purchase_activity. The panel fills the right column's height
// (matched to the left column via the parent grid); the composer is pinned at
// the top and the full feed scrolls internally.
export default function ActivityFeed({ purchaseId, focusCommentId }) {
  const { profile, user } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const toast = useToast()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  // Bridge for child CommentItem's onToast({ kind, text }) callback —
  // forwards into the global toast system.
  function emitToast(t) {
    if (!t?.text) return
    if (t.kind === 'error') toast.error(t.text)
    else toast.success(t.text)
  }

  const load = useCallback(async () => {
    if (!purchaseId) return
    setLoading(true)
    const { data } = await supabase
      .from('v_driver_purchase_activity')
      .select('*')
      .eq('driver_purchase_id', purchaseId)
      .order('at', { ascending: false })
    // Filter out soft-deleted comments. The view intentionally exposes
    // is_deleted so future admin/audit tooling can surface them — for
    // the regular feed we just hide them. Events have no is_deleted
    // concept so they always pass through.
    const visible = (data || []).filter(it => it.activity_type !== 'comment' || !it.is_deleted)
    setItems(visible)
    setLoading(false)
  }, [purchaseId])

  useEffect(() => { load() }, [load])

  // Realtime: refresh whenever a comment or event lands for this purchase.
  // Per-mount nonce on the channel name avoids supabase-js's name-based
  // channel cache, which otherwise raises "cannot add postgres_changes
  // callbacks after subscribe()" on remount.
  useEffect(() => {
    if (!purchaseId) return
    const nonce = Math.random().toString(36).slice(2, 10)
    const ch = supabase
      .channel(`activity-${purchaseId}-${nonce}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'driver_purchase_comments', filter: `driver_purchase_id=eq.${purchaseId}` },
        () => load())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'driver_purchase_events', filter: `driver_purchase_id=eq.${purchaseId}` },
        () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [purchaseId, load])

  // After load, if a focusCommentId is in the URL, scroll to it. The full feed
  // is always rendered (in the internal scroll area), so the target is present.
  useEffect(() => {
    if (!focusCommentId || loading) return
    const el = document.querySelector(`[data-comment-id="${focusCommentId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [focusCommentId, loading, items])

  return (
    // At lg+ the parent <aside> is a stretched grid cell; this panel fills it
    // absolutely (lg:absolute lg:inset-0) so its own — potentially very long —
    // content doesn't grow the grid row past the left column. The composer is
    // pinned at the top; the events list is the only part that scrolls. Below
    // lg the panel flows normally (single column, page scroll).
    <div className="flex flex-col gap-3 min-w-0 lg:absolute lg:inset-0">
      {/* Header + composer — pinned at the top of the panel. */}
      <div className="shrink-0">
        <div className={`${S.card} p-3 space-y-2`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Activity</p>
          <CommentComposer purchaseId={purchaseId} onSubmitted={load} />
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 dark:text-slate-600 px-2">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-600 italic py-2 px-2">No activity yet</p>
      ) : (
        // Fills the remaining height and scrolls internally when the feed is
        // longer than the column; shows everything (with bottom space) when
        // it's shorter. min-h-0 lets the flex child actually shrink to scroll.
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <ul className="space-y-2">
            {items.map(it =>
              it.activity_type === 'comment' ? (
                <li key={`c-${it.id}`} className={`${S.card} p-3`}>
                  <CommentItem
                    row={it}
                    currentUserId={user?.id}
                    isAdmin={isAdmin}
                    highlight={focusCommentId === it.id}
                    onToast={emitToast}
                  />
                </li>
              ) : (
                <EventRow key={`e-${it.id}`} row={it} />
              ),
            )}
          </ul>
        </div>
      )}

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
