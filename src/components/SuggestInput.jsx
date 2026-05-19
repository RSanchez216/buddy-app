import { useEffect, useRef, useState } from 'react'
import { S } from '../lib/styles'

// Free-text input with an inline suggestion popover. The user can type
// anything (so it stays a "free-text" field semantically), but recent
// suggestions appear in a small white-background dropdown beneath the
// trigger — same visual treatment as the native <Select> wrapper in
// the app, just hand-built since we need the create-new behavior.
//
// Click a suggestion to fill the input and close the popover. Esc or
// click-outside closes without selecting. Arrow keys not wired in this
// pass; can add later if it becomes operationally important.
export default function SuggestInput({
  value, onChange, suggestions = [], placeholder, className = '', disabled,
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  // Filter suggestions by what the user has typed so far. Case-insensitive
  // substring match — close enough for the small lists this field serves.
  const filtered = (suggestions || [])
    .filter(s => s && (!value || s.toLowerCase().includes(String(value).toLowerCase())))
    .slice(0, 10)

  useEffect(() => {
    if (!open) return
    function onAway(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onAway)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onAway)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        type="text"
        className={S.input}
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange?.(e.target.value); if (!open) setOpen(true) }}
      />
      {open && filtered.length > 0 && (
        <ul
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-lg py-1"
        >
          {filtered.map(s => (
            <li
              key={s}
              onMouseDown={e => { e.preventDefault(); onChange?.(s); setOpen(false) }}
              className="px-3 py-1.5 text-sm text-gray-700 dark:text-slate-200 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 cursor-pointer"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
