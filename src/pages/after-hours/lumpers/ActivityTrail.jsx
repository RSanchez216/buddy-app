import { useEffect, useState } from 'react'
import { fetchLumperActivity, money, fmtDate, todayChicago, statusLabel } from './lumperData'

// Read-only activity trail for a lumper (get_lumper_activity, newest-first).
// The trigger writes it; the client only reads and re-fetches after a save.
// Historical rows store the raw status ('unpaid'); render through statusLabel so
// they show "Other Payment Method" too.

const STATUS_DOT = { open: '#94A3B8', pending: '#F59E0B', paid: '#16A34A', unpaid: '#64748B' }
const FIELD_LABELS = {
  amount: 'Amount paid', efs_fee: 'EFS check fee', revised_rc_number: 'Revised rate con #',
  event_date: 'Date paid', load_number: 'Octopus load number', driver_name: 'Driver',
  broker_name: 'Broker', category: 'Category',
}
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s)
const chargeLabel = (c) => ({ driver: 'Driver', company: 'Company', dispatcher: 'Dispatcher' }[c] || cap(c))
const Strong = ({ children }) => <span className="font-semibold text-gray-800 dark:text-slate-200">{children}</span>

function fmtActivityTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(d)
  if (dateStr === todayChicago()) return `Today, ${time} CT`
  const dt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(d)
  return `${dt}, ${time} CT`
}

function fmtFieldVal(field, v) {
  if (v == null) return '—'
  if (field === 'amount' || field === 'efs_fee') return money(Number(v))
  if (field === 'event_date') return fmtDate(v, true)
  if (field === 'category') return v
  return v
}

const OCTOPUS_FIELDS = new Set(['receipt_in_octopus', 'revised_rate_con_in_octopus'])
function dotColor(e) {
  if (e.kind === 'created') return '#F97316'
  if (e.kind === 'status') return STATUS_DOT[e.new_value] || '#CBD2DA'
  if (e.kind === 'document' && OCTOPUS_FIELDS.has(e.field)) return '#6366F1' // marked as in Octopus
  return '#CBD2DA'
}

// → { node: JSX sentence, muted: bool, note: string|null }
function describe(e) {
  const det = e.detail || {}
  switch (e.kind) {
    case 'created':
      return { node: <>recorded the lumper · <Strong>{money(det.total)}</Strong>{det.category ? <> · {det.category}</> : null}</> }
    case 'status': {
      const statusChanged = e.old_value !== e.new_value
      if (!statusChanged && det.old_charge_to !== det.charge_to) {
        return { node: <>changed the charge to <Strong>{chargeLabel(det.charge_to)}</Strong></> }
      }
      if (e.new_value === 'unpaid') {
        return { node: <>moved <Strong>{statusLabel(e.old_value)}</Strong> → <Strong>{statusLabel('unpaid')}</Strong> · paid by <Strong>{chargeLabel(det.charge_to)}</Strong></> }
      }
      return { node: <>moved <Strong>{statusLabel(e.old_value)}</Strong> → <Strong>{statusLabel(e.new_value)}</Strong></> }
    }
    case 'note': {
      const which = e.field === 'accounting_notes' ? 'an accounting note' : 'a note from the dock'
      if (e.new_value == null) return { node: <>removed {which}</>, muted: true }
      return { node: <>{e.old_value != null ? 'edited' : 'added'} {which}</>, note: e.new_value }
    }
    case 'document': {
      // Marking as in Octopus is an assertion, not a file — keep it distinct
      // from uploads in the history, even though they look alike on screen.
      if (OCTOPUS_FIELDS.has(e.field)) {
        const doc = e.field === 'receipt_in_octopus' ? 'the receipt' : 'the revised rate con'
        return e.new_value === 'true' || e.new_value === true
          ? { node: <>marked {doc} as already in Octopus</> }
          : { node: <>removed the Octopus mark on {doc}</>, muted: true }
      }
      const which = e.field === 'receipt' ? 'a receipt' : 'a revised rate con'
      if (e.new_value == null) return { node: <>removed {which}</>, muted: true }
      return { node: <>{e.old_value != null ? 'replaced' : 'uploaded'} {which}</> }
    }
    case 'field': {
      const label = FIELD_LABELS[e.field] || cap(e.field)
      const muted = e.new_value == null
      return { node: <>changed <Strong>{label}</Strong> {fmtFieldVal(e.field, e.old_value)} → {fmtFieldVal(e.field, e.new_value)}</>, muted }
    }
    default:
      return { node: <>{e.field || e.kind}</> }
  }
}

function NoteQuote({ text }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 120 || text.includes('\n')
  return (
    <div className="mt-1 rounded-[7px] px-2.5 py-1.5 text-[11px] bg-[#FAFBFC] dark:bg-white/5 border border-[#EEF0F2] dark:border-white/10">
      <p className={`whitespace-pre-wrap text-gray-600 dark:text-slate-300 ${open ? '' : 'line-clamp-3'}`}>{text}</p>
      {long && <button type="button" onClick={() => setOpen(o => !o)} className="text-[10px] font-medium text-orange-600 dark:text-orange-400 mt-0.5">{open ? 'less' : 'more'}</button>}
    </div>
  )
}

function EntryBody({ e }) {
  const { node, muted, note } = describe(e)
  return (
    <div className="min-w-0">
      <p className={`text-xs leading-snug ${muted ? 'text-gray-400 dark:text-slate-500' : 'text-gray-600 dark:text-slate-400'}`}>
        <span className="font-semibold text-gray-800 dark:text-slate-200">{e.actor_name || 'Unknown'}</span>{' '}{node}
      </p>
      {note && <NoteQuote text={note} />}
      <p className="text-[10.5px] mt-0.5" style={{ color: '#A3A9B2' }}>{fmtActivityTime(e.created_at)}</p>
    </div>
  )
}

export default function ActivityTrail({ lumperId, refetchTick }) {
  const [entries, setEntries] = useState(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!lumperId) return // nothing to load; the component renders null anyway
    let stale = false
    fetchLumperActivity(lumperId)
      .then(rows => { if (!stale) setEntries(rows) })
      .catch(() => { if (!stale) setEntries([]) })
    return () => { stale = true }
  }, [lumperId, refetchTick])

  if (!lumperId) return null

  const n = entries?.length || 0

  return (
    <div className="mt-4">
      <div className="border-t border-dashed border-gray-300 dark:border-white/10 mb-3" />
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">
          Activity{expanded && n > 0 ? ` · ${n} ${n === 1 ? 'entry' : 'entries'}` : ''}
        </p>
        {expanded && n > 0 && (
          <button type="button" onClick={() => setExpanded(false)} className="text-[11px] font-medium text-orange-600 dark:text-orange-400">Collapse ▴</button>
        )}
      </div>

      {entries == null ? (
        <div className="h-10 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
      ) : n === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-slate-500 italic">No activity recorded yet. Changes from here on will be listed.</p>
      ) : !expanded ? (
        <>
          <div className="rounded-lg border border-gray-200 dark:border-white/10 p-2.5 flex items-start gap-2">
            <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: dotColor(entries[0]) }} />
            <EntryBody e={entries[0]} />
          </div>
          {n > 1 && (
            <button type="button" onClick={() => setExpanded(true)} className="mt-1.5 text-[11px] font-medium text-orange-600 dark:text-orange-400">Show all {n} ▾</button>
          )}
        </>
      ) : (
        <div className="relative">
          <div className="absolute left-[3px] top-1.5 bottom-1.5 w-px bg-[#EAECEF] dark:bg-white/10" />
          <div className="space-y-3">
            {entries.map(e => (
              <div key={e.id} className="relative pl-5">
                <span className="absolute left-0 top-1 w-2 h-2 rounded-full ring-[3px] ring-white dark:ring-[#0E1626]" style={{ background: dotColor(e) }} />
                <EntryBody e={e} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
