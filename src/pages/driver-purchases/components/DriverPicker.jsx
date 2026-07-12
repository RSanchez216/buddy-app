import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import NewDriverModal from './NewDriverModal'

// Search-as-you-type driver picker with inline "+ Create new driver".
// Controlled — parent stores driver_id and the resolved driver row.
export default function DriverPicker({ value, driver, onChange, placeholder = 'Search driver…', excludeIds = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const containerRef = useRef(null)

  // Close dropdown on click outside
  useEffect(() => {
    function onClick(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Debounced search
  useEffect(() => {
    if (!open) return
    const handle = setTimeout(async () => {
      setLoading(true)
      const q = query.trim()
      let req = supabase.from('drivers').select('id, full_name, internal_id, phone').limit(10)
      if (q) {
        req = req.or(`full_name.ilike.%${q}%,internal_id.eq.${q}`)
      }
      req = req.order('full_name')
      const { data } = await req
      // Drop drivers already listed on the contract — you can't add a dup.
      setResults((data || []).filter(d => !excludeIds.includes(d.id)))
      setLoading(false)
    }, 250)
    return () => clearTimeout(handle)
  }, [query, open, excludeIds])

  function pick(d) {
    onChange?.(d.id, d)
    setQuery('')
    setOpen(false)
  }

  function clear() {
    onChange?.(null, null)
    setQuery('')
  }

  return (
    <div className="relative" ref={containerRef}>
      {value && driver ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white dark:bg-slate-800/80 border border-cyan-300 dark:border-cyan-500/30 rounded-xl">
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">{driver.full_name}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400 font-mono">
              {driver.internal_id ? `#${driver.internal_id}` : ''}{driver.internal_id && driver.phone ? ' · ' : ''}{driver.phone || ''}
            </div>
          </div>
          <button onClick={clear} className="text-gray-400 hover:text-red-500 shrink-0" title="Clear">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <input
          className={S.input}
          placeholder={placeholder}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
      )}

      {open && !value && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-xl max-h-72 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-3 text-xs text-gray-400 dark:text-slate-500">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400 dark:text-slate-500">
              {query ? 'No drivers match' : 'Type to search'}
            </div>
          ) : results.map(r => (
            <button
              key={r.id}
              onClick={() => pick(r)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">{r.full_name}</div>
              <div className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                {r.internal_id ? `#${r.internal_id}` : ''}{r.internal_id && r.phone ? ' · ' : ''}{r.phone || ''}
              </div>
            </button>
          ))}

          <button
            onClick={() => { setOpen(false); setShowCreate(true) }}
            className="w-full text-left px-3 py-2 border-t border-gray-100 dark:border-white/5 text-cyan-600 dark:text-cyan-400 text-sm font-medium hover:bg-cyan-50 dark:hover:bg-cyan-500/5 transition-colors"
          >
            + Create new driver
          </button>
        </div>
      )}

      <NewDriverModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        prefillName={query.trim()}
        onCreated={d => { setShowCreate(false); pick(d) }}
      />
    </div>
  )
}
