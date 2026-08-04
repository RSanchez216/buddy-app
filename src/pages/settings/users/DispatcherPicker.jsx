import { useEffect, useRef, useState } from 'react'
import { S } from '../../../lib/styles'
import { searchDispatchers, stripNickname } from './dispatcherLink'

// Picker for the dispatcher record behind a login. Controlled: it reports the
// chosen record and lets the parent persist it — the invite form defers until
// the user row exists, the profile writes immediately.
//
// With 52 records and shared first names, the driver and load counts are how you
// confirm you have the right person, so they are part of every row rather than a
// detail view.

const HELPER = 'Links this login to a dispatcher in the fleet data. Required for "My drivers" and for requests to be attributed correctly. Leave empty for non-dispatch staff.'

export default function DispatcherPicker({ selected, onSelect, onClear, disabled, error, driverCount }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [includeLinked, setIncludeLinked] = useState(false) // Unlinked is the default scope
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const boxRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!open) return
    let stale = false
    const run = async () => {
      setLoading(true); setLoadError('')
      try {
        const d = await searchDispatchers(debounced, includeLinked, 25)
        if (!stale) setRows(d)
      } catch (e) {
        if (!stale) setLoadError(e?.message || 'Could not load dispatcher records.')
      } finally {
        if (!stale) setLoading(false)
      }
    }
    run()
    return () => { stale = true }
  }, [open, debounced, includeLinked])

  // Click-away closes the results.
  useEffect(() => {
    if (!open) return
    const onAway = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onAway)
    return () => document.removeEventListener('mousedown', onAway)
  }, [open])

  function choose(r) {
    if (!r.selectable) return
    onSelect?.({ id: r.id, name: r.name, nickname: r.nickname, driver_count: r.driver_count, loads_30d: r.loads_30d })
    setOpen(false); setQuery('')
  }

  // ── Linked state — the confirmation card ──────────────────────────────────
  if (selected && !open) {
    const drivers = driverCount ?? selected.driver_count
    return (
      <div>
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/[0.08] px-3 py-2.5">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{stripNickname(selected.name)}</span>
                {selected.nickname && <NicknameChip>{selected.nickname}</NicknameChip>}
              </div>
              {drivers != null && (
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                  {drivers} driver{drivers === 1 ? '' : 's'} on recent loads
                </p>
              )}
            </div>
            {!disabled && (
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline">Change</button>
                <button type="button" onClick={() => onClear?.()} className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400">Unlink</button>
              </div>
            )}
          </div>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    )
  }

  // ── Search state ──────────────────────────────────────────────────────────
  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        <input
          className={S.input}
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}
          placeholder="Search by name or nickname — try “kent”"
        />
        {selected && (
          <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-gray-500 dark:text-slate-400 hover:underline shrink-0">Cancel</button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-xl overflow-hidden">
          {/* Scope — Unlinked by default; All reveals who holds a record */}
          <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-100 dark:border-white/5">
            {[[false, 'Unlinked'], [true, 'All']].map(([v, l]) => (
              <button key={l} type="button" onClick={() => setIncludeLinked(v)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                  includeLinked === v
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
                }`}>{l}</button>
            ))}
            <span className="ml-auto text-[10px] text-gray-400 dark:text-slate-500">busiest first</span>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {loadError ? (
              <p className="px-3 py-4 text-xs text-red-600 dark:text-red-400">{loadError}</p>
            ) : loading ? (
              <p className="px-3 py-4 text-xs text-gray-400 dark:text-slate-500">Searching…</p>
            ) : rows.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 dark:text-slate-500">
                {query.trim() ? `No dispatcher record matches “${query.trim()}”.` : 'No dispatcher records available.'}
                {!includeLinked && ' Try the All scope — it may already be linked.'}
              </p>
            ) : rows.map(r => <Row key={r.id} r={r} onChoose={choose} />)}
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}

function Row({ r, onChoose }) {
  const locked = !r.selectable
  return (
    <button type="button" onClick={() => onChoose(r)} disabled={locked}
      title={locked ? `Already linked to ${r.linked_user_name}` : undefined}
      className={`w-full text-left px-3 py-2 border-b border-gray-50 dark:border-white/[0.03] last:border-0 transition-colors ${
        locked ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-white/5'
      }`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{stripNickname(r.name)}</span>
        {r.nickname && <NicknameChip>{r.nickname}</NicknameChip>}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
        {r.driver_count} driver{r.driver_count === 1 ? '' : 's'}
        <span className="mx-1">·</span>
        {r.loads_30d} load{r.loads_30d === 1 ? '' : 's'} in 30 days
        {locked && <span className="ml-1.5 text-gray-500 dark:text-slate-400">· linked to {r.linked_user_name}</span>}
      </p>
    </button>
  )
}

function NicknameChip({ children }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-white/10">
      {children}
    </span>
  )
}

function ErrorNote({ children }) {
  return (
    <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-700 dark:text-red-400">
      <svg className="w-4 h-4 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export { HELPER as DISPATCHER_HELPER }
