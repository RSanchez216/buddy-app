import { useMemo, useRef, useState } from 'react'
import { S } from '../../../../lib/styles'

// Searchable single-select filter (driver or dispatcher), styled exactly like
// the Lane Map's original "Filter dispatchers…" control. The selection is
// CONTROLLED via value/onChange so it can live in page-level shared state —
// that's what keeps two instances (heat map + region/state map) in sync and
// lets one pick drive every view. The type-ahead query and open state are
// LOCAL (transient typing), so each instance keeps its own dropdown. Renders
// nothing when there's 0/1 option to pick from (mirrors the old length > 1 gate).
//
// items: [{ id, name }] — distinct people in the current dataset
// value:  the selected id (or null = everyone)
export default function PersonFilter({
  items,
  value,
  onChange,
  placeholder,
  allLabel,
  clearTitle,
  clearAriaLabel,
  searchTitle,
  width = 'w-32',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const selected = value ? items.find(i => i.id === value) : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, query])

  function clear(reopen) {
    onChange(null)
    setQuery('')
    setOpen(!!reopen)
    if (reopen) inputRef.current?.focus()
  }
  function pick(id) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  if (items.length <= 1) return null
  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={selected ? selected.name : query}
        onChange={e => {
          // Editing while a person is selected turns the text into a fresh
          // search — emptying the box can never leave a stale filter behind.
          if (selected) onChange(null)
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') clear(false) }}
        placeholder={placeholder}
        className={`${S.input} ${width} text-xs ${selected ? 'pr-7 ring-2 ring-orange-400/50' : ''}`}
        title={searchTitle}
      />
      {selected && (
        <button
          onMouseDown={e => { e.preventDefault(); clear(true) }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-[10px] leading-none text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-white/10"
          title={clearTitle}
          aria-label={clearAriaLabel}
        >✕</button>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-48 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg overflow-hidden">
          <button
            onMouseDown={e => { e.preventDefault(); pick(null) }}
            className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-slate-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 border-b border-gray-100 dark:border-white/[0.06]"
          >
            {allLabel}
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {filtered.map(i => (
                <button
                  key={i.id}
                  onMouseDown={e => { e.preventDefault(); pick(i.id) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-orange-50 dark:hover:bg-orange-500/10 ${value === i.id ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}
                >
                  {i.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
