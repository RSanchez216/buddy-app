import { supabase } from '../../../lib/supabase'

// Insert a row into driver_purchase_events. Best-effort — failures are
// logged to console but don't block the action that triggered them.
export async function logEvent(purchaseId, eventType, description, metadata = {}, userId = null) {
  if (!purchaseId || !eventType) return
  const { error } = await supabase.from('driver_purchase_events').insert({
    driver_purchase_id: purchaseId,
    event_type: eventType,
    description: description || null,
    metadata: metadata || {},
    created_by: userId || null,
  })
  if (error) console.warn('logEvent failed:', error.message, { eventType, description })
}

// Diff two flat objects and return which keys changed, with old/new values.
// Used by the edit flow to record meaningful update events.
export function diffFields(before, after, watch) {
  const changes = {}
  for (const key of watch) {
    const a = before?.[key]
    const b = after?.[key]
    if (normalize(a) !== normalize(b)) changes[key] = { old: a ?? null, new: b ?? null }
  }
  return changes
}

function normalize(v) {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v === 'number') return String(v)
  return String(v)
}

// Pretty label for an event_type — used by EventsLog
const EVENT_LABELS = {
  created:           'Created',
  updated:           'Updated',
  status_changed:    'Status changed',
  title_released:    'Title released',
  document_added:        'Document added',
  document_removed:      'Document removed',
  document_type_changed: 'Document type changed',
  equipment_linked:  'Equipment linked',
  equipment_unlinked:'Equipment unlinked',
  driver_updated:    'Driver updated',
  payment_reconciled:   'Payment reconciled',
  payment_unreconciled: 'Payment unreconciled',
  payment_recorded:     'Payment recorded',
  payment_record_undone:'Recording undone',
  payment_edited:       'Payment edited',
}
export function formatEventType(t) {
  return EVENT_LABELS[t] || (t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
