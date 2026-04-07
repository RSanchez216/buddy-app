import { useState, useRef, useEffect } from 'react'

/**
 * Multi-select dropdown with checkboxes.
 * options: [{ id, label }]
 * value: string[] of selected ids
 * onChange: (ids: string[]) => void
 */
export default function MultiSelect({ options = [], value = [], onChange, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(id) {
    const next = value.includes(id) ? value.filter(v => v !== id) : [...value, id]
    onChange(next)
  }

  const selectedOptions = options.filter(o => value.includes(o.id))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full min-h-[38px] px-3 py-2 pr-8 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 rounded-xl text-sm text-left focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40 transition-all"
      >
        {selectedOptions.length === 0 ? (
          <span className="text-gray-400 dark:text-slate-500">{placeholder}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectedOptions.map(o => (
              <span key={o.id} className="inline-flex items-center px-2 py-0.5 rounded-lg bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 text-xs font-medium">
                {o.label}
              </span>
            ))}
          </div>
        )}
        <div className="pointer-events-none absolute top-2.5 right-2.5">
          <svg className="w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
          </svg>
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-52 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-400 dark:text-slate-500">No options available</p>
            ) : options.map(o => (
              <label key={o.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={value.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-cyan-500 focus:ring-cyan-500/40 bg-white dark:bg-slate-700"
                />
                <span className="text-sm text-gray-700 dark:text-slate-200">{o.label}</span>
              </label>
            ))}
          </div>
          {value.length > 0 && (
            <div className="border-t border-gray-100 dark:border-white/5 px-3 py-2">
              <button type="button" onClick={() => onChange([])} className="text-xs text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
