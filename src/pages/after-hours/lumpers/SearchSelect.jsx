import { useMemo, useRef, useState } from 'react'
import { S } from '../../../lib/styles'

// Searchable single-select combobox over { id, name } options. Controlled via
// value (id) + onChange(id, option). Type-ahead filters the list; ✕ clears.
// Used for the drawer's editable Carrier / Driver / Dispatcher pickers.
export default function SearchSelect({ options, value, onChange, placeholder = 'Search…', disabled = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const selected = value ? options.find(o => o.id === value) : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? options.filter(o => (o.name || '').toLowerCase().includes(q)) : options
    return list.slice(0, 50)
  }, [options, query])

  function pick(o) {
    onChange(o ? o.id : null, o || null)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={open ? query : (selected ? selected.name : query)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => { setOpen(true); setQuery('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() } }}
        placeholder={selected ? selected.name : placeholder}
        className={`${S.input} ${selected && !open ? 'pr-7' : ''} disabled:opacity-60`}
      />
      {selected && !disabled && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); pick(null) }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-xs text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-white/10"
          aria-label="Clear"
        >✕</button>
      )}
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</p>
          ) : (
            filtered.map(o => (
              <button
                key={o.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(o) }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-orange-50 dark:hover:bg-orange-500/10 ${value === o.id ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-semibold' : 'text-gray-700 dark:text-slate-300'}`}
              >
                {o.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
