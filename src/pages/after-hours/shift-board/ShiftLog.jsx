import { useState } from 'react'
import { fmtClock } from './shiftBoardData'

// Shift log — running notes that aren't tied to a load.
//
// Work happens during a shift that has no row on the board: a broker call about
// nothing in particular, a systems outage, a message passed on from Accounting.
// Before this the only place to put any of it was the single end-of-shift field
// in the hand-off modal, by which time it had usually been forgotten.
//
// Stored as ordinary shift_activities rows — activity_type 'note' with a NULL
// load_id. Nothing new in the schema.
//
// Collapsed by default: on a quiet night this is a one-line header, and the
// count is the whole signal. It carries the same removal contract as Logged
// activity — confirm-gated ✕, and a 10s inline undo after a save — because it
// is the same job and a second interaction for it would be one to learn twice.

const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500'

export default function ShiftLog({ notes = [], canAdd, onAdd, onRemove, undo, onUndo }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const trimmed = text.trim()

  async function add() {
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onAdd?.(trimmed)
      setText('') // only on success — a failed save must not eat what was typed
    } catch { /* the page toasts; keep the text so it can be retried */ }
    finally { setSaving(false) }
  }

  // Ctrl/Cmd+Enter saves. Plain Enter has to stay a newline: these are free-text
  // notes and multi-line ones are normal.
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add() }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/[0.03] rounded-xl transition-colors"
      >
        <svg className={`w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-semibold text-gray-800 dark:text-slate-200">
          Shift log{notes.length ? ` (${notes.length})` : ''}
        </span>
        {!open && notes.length === 0 && (
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Nothing logged yet</span>
        )}
        {/* The undo lives in the header so it stays reachable after the card is
            collapsed — the save that armed it may well be the last thing done
            before closing it. */}
        {undo && (
          <span
            role="presentation"
            onClick={e => { e.stopPropagation() }}
            className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-slate-400"
          >
            Note added
            <button type="button" onClick={e => { e.stopPropagation(); onUndo?.() }}
              className="font-semibold text-orange-600 dark:text-orange-400 hover:underline">
              Undo
            </button>
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-3.5 space-y-3">
          {canAdd ? (
            <div className="space-y-1.5">
              <textarea
                rows={2}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Something worth passing on — a broker call, an outage, a message from Accounting…"
                className="w-full text-sm rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-800/60 text-gray-700 dark:text-slate-200 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-2 resize-y min-h-[56px] focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={add}
                  disabled={!trimmed || saving}
                  className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-lg transition-all"
                >
                  {saving ? 'Adding…' : 'Add note'}
                </button>
                <span className="text-[11px] text-gray-400 dark:text-slate-500">Goes into the handoff under SHIFT LOG.</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-slate-500 italic">
              Start a shift to add notes.
            </p>
          )}

          {notes.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-slate-500 italic">No notes on this shift yet.</p>
          ) : (
            <div className="space-y-1.5 border-t border-gray-100 dark:border-white/5 pt-2.5">
              <p className={EYEBROW}>This shift</p>
              {notes.map(n => <NoteRow key={n.id} n={n} onRemove={onRemove} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Newest first, set by the query. whitespace-pre-wrap so a multi-line note reads
// the way it was typed — the handoff generator preserves those breaks too.
function NoteRow({ n, onRemove }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    setBusy(true)
    try { await onRemove?.(n) } finally { setBusy(false) }
  }
  return (
    <div className="flex items-start gap-2 text-[12px] group">
      <span className="shrink-0 tabular-nums text-gray-400 dark:text-slate-500 pt-px">{fmtClock(n.at)}</span>
      <span className="flex-1 min-w-0 text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words">{n.note}</span>
      {n.author && <span className="shrink-0 text-gray-400 dark:text-slate-500 pt-px">{n.author}</span>}
      <span className="shrink-0 pt-px">
        {confirming ? (
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-500 dark:text-slate-400">Remove?</span>
            <button type="button" onClick={remove} disabled={busy}
              className="font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">
              {busy ? 'Removing…' : 'Yes'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}
              className="text-gray-500 dark:text-slate-400 hover:underline">No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} title="Remove this note"
            className="text-gray-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 text-xs">✕</button>
        )}
      </span>
    </div>
  )
}
