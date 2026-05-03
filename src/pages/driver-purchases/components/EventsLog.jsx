import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { formatEventType } from '../utils/events'
import { fmtDateTime, fmtRelative } from '../utils/format'

// Pill colors (background + text). Per-event-type so the activity feed
// reads at a glance.
const EVENT_COLORS = {
  created:           'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  updated:           'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
  status_changed:    'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400',
  title_released:    'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  document_added:    'bg-gray-100 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300',
  document_removed:  'bg-gray-100 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300',
  equipment_linked:  'bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400',
  equipment_unlinked:'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
  driver_updated:    'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400',
  imported:          'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400',
}

// Solid dot color per event type — used as the left-side timeline marker.
const DOT_COLORS = {
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

export default function EventsLog({ purchaseId, refreshKey }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!purchaseId) return
    load()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [purchaseId, refreshKey])

  async function load() {
    setLoading(true)
    // Phase 1's FKs target auth.users, so PostgREST embeds via public.users
    // are unreliable. Fetch events plain, then look up creator names from
    // public.users in a follow-up query.
    const { data: evs } = await supabase
      .from('driver_purchase_events')
      .select('id, event_type, description, metadata, occurred_at, created_by')
      .eq('driver_purchase_id', purchaseId)
      .order('occurred_at', { ascending: false })

    const ids = Array.from(new Set((evs || []).map(e => e.created_by).filter(Boolean)))
    let nameById = {}
    if (ids.length) {
      const { data: users } = await supabase.from('users').select('id, full_name').in('id', ids)
      for (const u of (users || [])) nameById[u.id] = u.full_name
    }
    setEvents((evs || []).map(e => ({ ...e, creator_name: nameById[e.created_by] || null })))
    setLoading(false)
  }

  return (
    <div className={`${S.card} p-4 space-y-3`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Activity</p>
      {loading ? (
        <p className="text-xs text-gray-400 dark:text-slate-600">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-600 italic py-2">No events yet</p>
      ) : (
        <ul className="space-y-3">
          {events.map(ev => (
            <li key={ev.id} className="flex items-start gap-2.5">
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT_COLORS[ev.event_type] || DOT_COLORS.imported}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${EVENT_COLORS[ev.event_type] || EVENT_COLORS.updated}`}>
                    {formatEventType(ev.event_type)}
                  </span>
                  <span className="text-[11px] text-gray-400 dark:text-slate-500" title={fmtDateTime(ev.occurred_at)}>
                    {fmtRelative(ev.occurred_at)}
                  </span>
                </div>
                {ev.description && <p className="text-sm text-gray-700 dark:text-slate-300 mt-0.5 break-words">{ev.description}</p>}
                {ev.creator_name && <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{ev.creator_name}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
