import { useState, useRef, useEffect } from 'react'

/**
 * Searchable combobox for single-select with optional subtitle per option.
 * options: [{ id, name, subtitle? }]
 * value: selected id (string)
 * onChange: (id: string) => void
 * onAddNew: optional () => void — shown when no results found
 */
export default function ComboBox({ options = [], value, onChange, placeholder = 'Select…', onAddNew }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef()
  const inputRef = useRef()

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find(o => o.id === value)

  const filtered = query.trim()
    ? options.filter(o =>
        o.name.toLowerCase().includes(query.toLowerCase()) ||
        (o.subtitle && o.subtitle.toLowerCase().includes(query.toLowerCase()))
      )
    : options

  function openDropdown() {
    setOpen(true)
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function selectOption(id) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  function clearSelection(e) {
    e.stopPropagation()
    onChange('')
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <div
        onClick={openDropdown}
        className="w-full min-h-[38px] px-3 py-2 pr-16 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 rounded-xl text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500/40 transition-all flex items-center"
      >
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-transparent outline-none text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 min-w-0"
            placeholder="Search vendors…"
          />
        ) : selected ? (
          <span className="text-gray-900 dark:text-slate-100 flex-1 truncate">{selected.name}</span>
        ) : (
          <span className="text-gray-400 dark:text-slate-500 flex-1">{placeholder}</span>
        )}

        {/* Clear button */}
        {selected && !open && (
          <button
            type="button"
            onClick={clearSelection}
            className="absolute right-8 text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Chevron */}
        <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
          <svg className="w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
          </svg>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-4">
                <p className="text-sm text-gray-400 dark:text-slate-500">No vendor found for "{query}"</p>
                {onAddNew && (
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setQuery(''); onAddNew() }}
                    className="mt-2 text-xs font-semibold text-cyan-500 hover:text-cyan-400 transition-colors"
                  >
                    Add new vendor →
                  </button>
                )}
              </div>
            ) : filtered.map(o => (
              <div
                key={o.id}
                onClick={() => selectOption(o.id)}
                className={`px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${o.id === value ? 'bg-cyan-50 dark:bg-cyan-500/10' : ''}`}
              >
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{o.name}</p>
                {o.subtitle && (
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{o.subtitle}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
