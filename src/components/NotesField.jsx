import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { S } from '../lib/styles'

// Auto-growing notes field with two render modes:
//   • read   — plain pre-wrap text inside the surrounding card. No
//              textarea chrome. Click anywhere in the content to edit.
//              Empty + editable → shows a muted "Add a note" placeholder.
//   • edit   — textarea sized to its scrollHeight. No max-height, no
//              internal scrollbar. Min-height ~5 lines. On blur, calls
//              onSave with the new value (only if it changed) and flips
//              back to read mode.
//
// The parent provides the persisted value and the save handler — this
// component does NOT do the network call itself, so it's reusable.
export default function NotesField({
  value,
  onSave,
  canEdit = false,
  saving = false,
  placeholder = 'Add a note…',
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const ref = useRef(null)

  // Keep draft synced with the persisted value when not actively editing
  // (so an external save / refetch propagates in cleanly).
  useEffect(() => {
    if (!editing) setDraft(value || '')
  }, [value, editing])

  // Auto-grow on every draft change. useLayoutEffect avoids a one-frame
  // scrollbar flash on the very first render after enter-edit.
  useLayoutEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [draft, editing])

  function enterEdit() {
    if (!canEdit || saving) return
    setDraft(value || '')
    setEditing(true)
    // Focus + caret-to-end on the next tick once the textarea is mounted.
    setTimeout(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 0)
  }

  async function commit() {
    const next = draft.trim()
    const prev = (value || '').trim()
    setEditing(false)
    if (next === prev) return
    await onSave?.(next || null)
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setDraft(value || ''); setEditing(false) }
  }

  // ── Read mode ────────────────────────────────────────────────────────
  if (!editing) {
    const text = (value || '').trim()
    return (
      <div
        onClick={enterEdit}
        className={`text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words ${
          canEdit ? 'cursor-text hover:bg-gray-50 dark:hover:bg-white/[0.02] rounded transition-colors -mx-1 px-1 py-1' : ''
        }`}
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onKeyDown={(e) => { if (canEdit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); enterEdit() } }}
      >
        {text || (
          <span className="text-gray-400 dark:text-slate-500 italic">
            {canEdit ? `${placeholder} (click to add)` : 'No notes yet.'}
          </span>
        )}
      </div>
    )
  }

  // ── Edit mode ────────────────────────────────────────────────────────
  return (
    <textarea
      ref={ref}
      className={`${S.textarea} block w-full overflow-hidden`}
      style={{ minHeight: '8rem', resize: 'none' }}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={saving}
    />
  )
}
