import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../../../contexts/ToastContext'
import { S } from '../../../../lib/styles'
import SpotlightDeck from './SpotlightDeck'
import DriverSpotlightCard from './DriverSpotlightCard'
import { fetchDriverDeck, fetchLanes, fetchTrendWeeks } from './spotlightData'
import { SORTS, formatRange, shiftYmd, spanDays, thisMonth, thisWeek } from './spotlightShared'

// Spotlight — a cover-flow deck of per-entity dossiers. Parameterized by
// dimension so the same shell can later power per-truck / per-dispatcher /
// per-broker decks; drivers ship first. Additive route — the existing
// Profitability page is untouched.
const DIMENSION_CONFIGS = {
  driver: {
    label: 'Driver Spotlight',
    noun: 'drivers',
    fetchDeck: fetchDriverDeck,
    fetchDetail: fetchLanes,
    Card: DriverSpotlightCard,
  },
}

const PRESET_LABEL = { week: 'This week', month: 'This month', custom: 'Custom' }

export default function Spotlight({ dimension = 'driver' }) {
  const config = DIMENSION_CONFIGS[dimension]
  const toast = useToast()

  const [preset, setPreset] = useState('week')
  const [range, setRange] = useState(thisWeek)
  const [basis, setBasis] = useState('delivery')
  const [sortKey, setSortKey] = useState('weakest')
  const [query, setQuery] = useState('')

  // Async results are stored together with the period key they were fetched
  // for, so a period/basis change invalidates them by derivation — no
  // synchronous reset-effects needed.
  const deckKey = `${dimension}|${range.from}|${range.to}|${basis}`
  const [deckState, setDeckState] = useState({ key: null, data: null })
  const [trendState, setTrendState] = useState({ key: null, data: null })
  const [detailMap, setDetailMap] = useState({}) // `${deckKey}|${entryId}` -> lanes[]
  const requested = useRef(new Set())

  // ── Deck load: one rollup pass per period; lanes hydrate per card ──
  useEffect(() => {
    let stale = false
    config.fetchDeck({ from: range.from, to: range.to, basis })
      .then(d => { if (!stale) setDeckState({ key: deckKey, data: d }) })
      .catch(err => {
        if (!stale) {
          toast.error("Couldn't load the spotlight deck", err)
          setDeckState({ key: deckKey, data: { entries: [], benchmarks: null, days: 0 } })
        }
      })
    // Trend is secondary — fetched in parallel, bars render when ready.
    fetchTrendWeeks({ to: range.to, basis })
      .then(t => { if (!stale) setTrendState({ key: deckKey, data: t }) })
      .catch(() => {})
    return () => { stale = true }
  }, [deckKey, range.from, range.to, basis, config, toast])

  const loading = deckState.key !== deckKey
  const deck = loading ? null : deckState.data
  const trend = trendState.key === deckKey ? trendState.data : null

  const sortDef = SORTS.find(s => s.key === sortKey) || SORTS[0]
  const sorted = useMemo(() => (deck ? [...deck.entries].sort(sortDef.fn) : []), [deck, sortDef])
  const rangeDays = spanDays(range.from, range.to)

  // Focus is keyed to (period, sort): a new order or window starts the deck
  // back at card #1 by derivation.
  const focusKey = `${deckKey}|${sortKey}`
  const [focusState, setFocusState] = useState({ key: null, index: 0 })
  const focus = focusState.key === focusKey
    ? Math.min(focusState.index, Math.max(sorted.length - 1, 0))
    : 0
  const setFocus = useCallback((index) => setFocusState({ key: focusKey, index }), [focusKey])

  // ── Lazy lane hydration: focused card + both neighbors ──
  useEffect(() => {
    if (!sorted.length) return
    for (const off of [0, 1, -1]) {
      const entry = sorted[focus + off]
      if (!entry) continue
      const dKey = `${deckKey}|${entry.id}`
      if (requested.current.has(dKey)) continue
      requested.current.add(dKey)
      config.fetchDetail({ driverId: entry.driverId, rawName: entry.rawName, from: range.from, to: range.to, basis })
        .then(rows => setDetailMap(m => ({ ...m, [dKey]: rows })))
        .catch(() => setDetailMap(m => ({ ...m, [dKey]: [] })))
    }
  }, [focus, sorted, deckKey, range.from, range.to, basis, config])

  function setPresetRange(p) {
    setPreset(p)
    if (p === 'week') setRange(thisWeek())
    else if (p === 'month') setRange(thisMonth())
  }
  const shiftRange = useCallback((dir) => {
    setRange(r => {
      const span = spanDays(r.from, r.to)
      return { from: shiftYmd(r.from, dir * span), to: shiftYmd(r.to, dir * span) }
    })
  }, [])

  // ── Jump box ──
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return sorted
      .map((e, i) => ({ entry: e, index: i }))
      .filter(({ entry }) => entry.name?.toLowerCase().includes(q) || String(entry.internalId || '').includes(q))
      .slice(0, 8)
  }, [query, sorted])
  function jumpTo(index) { setFocus(index); setQuery('') }

  const focusedEntry = sorted[focus]
  const periodLabel = `${PRESET_LABEL[preset]} · ${formatRange(range.from, range.to)}`

  // Plain function — the React Compiler handles memoization; a manual
  // useCallback here fights its inference of config.Card.
  const Card = config.Card
  const handleWeekSelect = useCallback((from, to) => {
    setPreset('custom')
    setRange({ from, to })
  }, [])
  const renderCard = (entry, { focused }) => (
    <Card
      entry={entry}
      lanes={detailMap[`${deckKey}|${entry.id}`]}
      trend={trend}
      rangeDays={rangeDays}
      effDays={deck?.effDays ?? rangeDays}
      periodLabel={formatRange(range.from, range.to)}
      basis={basis}
      focused={focused}
      rank={sorted.indexOf(entry) + 1}
      total={sorted.length}
      sortLabel={sortDef.label.toLowerCase()}
      activeWeekFrom={range.from}
      onWeekSelect={handleWeekSelect}
    />
  )

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{config.label}</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Flip through {config.noun} one by one — revenue, utilization, and a like-for-like trailer-type benchmark, live.
            <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 align-middle whitespace-nowrap" title="Fuel, insurance, and driver pay aren't in BUDDY yet — 'Weak' here is a revenue & utilization signal, not a profit verdict.">
              Revenue view — net margin pending cost layer
            </span>
          </p>
        </div>
      </div>

      {/* ── Controls: sort · jump · period ── */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center flex-wrap gap-2">
          <select value={sortKey} onChange={e => setSortKey(e.target.value)} className={`${S.select} text-xs`} title="Deck order">
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {/* Jump straight to a driver */}
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && matches.length) jumpTo(matches[0].index); if (e.key === 'Escape') setQuery('') }}
              placeholder="Jump to a driver…"
              className={`${S.input} w-52 text-xs`}
            />
            {matches.length > 0 && (
              <div className="absolute z-50 mt-1 w-64 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-2xl overflow-hidden">
                {matches.map(({ entry, index }) => (
                  <button
                    key={entry.id}
                    onClick={() => jumpTo(index)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-slate-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{entry.name}</span>
                    <span className="font-mono text-[10px] text-gray-400 dark:text-slate-500 shrink-0">#{index + 1} in deck</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => shiftRange(-1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Previous period">◀</button>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0">
              {[['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, lbl]) => (
                <button key={k} onClick={() => setPresetRange(k)} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${preset === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>{lbl}</button>
              ))}
            </div>
            <button onClick={() => shiftRange(1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Next period">▶</button>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0">
              <button onClick={() => setBasis('delivery')} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${basis === 'delivery' ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>By delivery</button>
              <button onClick={() => setBasis('pickup')} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${basis === 'pickup' ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>By pickup</button>
            </div>
            {preset === 'custom' && (
              <>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                <span className="text-gray-400 text-xs shrink-0">→</span>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
              </>
            )}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">{periodLabel} · by {basis} date · ◀ ▶ keys & swipe to flip</p>
        </div>
      </div>

      {/* ── Deck ── */}
      {loading ? (
        <div className="relative h-[680px]">
          <div className="absolute left-1/2 top-2 -translate-x-1/2 w-[min(860px,94vw)] h-[640px] rounded-3xl border border-gray-200 dark:border-white/10 bg-gradient-to-b from-white to-gray-50 dark:from-[#12132e] dark:to-[#0a0a18] animate-pulse" />
        </div>
      ) : sorted.length === 0 ? (
        <div className={`${S.card} p-16 text-center text-sm text-gray-400 dark:text-slate-500`}>
          No {config.noun} with activity in this window. Import loads first, then check the date range.
        </div>
      ) : (
        <>
          <SpotlightDeck
            items={sorted}
            focus={focus}
            onFocusChange={setFocus}
            getKey={e => e.id}
            renderCard={renderCard}
          />
          {/* Position: thin progress bar + counter */}
          <div className="flex items-center justify-center gap-3">
            <div className="w-56 h-1 rounded-full bg-gray-200 dark:bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-orange-500"
                style={{ width: `${((focus + 1) / sorted.length) * 100}%`, transition: 'width 560ms cubic-bezier(0.22,1,0.36,1)' }}
              />
            </div>
            <p className="text-[11px] font-mono text-gray-400 dark:text-slate-500 whitespace-nowrap">
              {focus + 1} / {sorted.length}
              {focusedEntry && <span className="ml-2 font-sans text-gray-500 dark:text-slate-400">{focusedEntry.name}</span>}
            </p>
          </div>
        </>
      )}

      {/* ── Honesty footer ── */}
      <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center max-w-3xl mx-auto">
        Revenue, miles, $/mile, lanes, utilization, the trailer-type benchmark, equipment carrying cost, and purchase
        deductions are live BUDDY data. Fuel, insurance, driver pay — and therefore true net margin — are not connected
        yet and are never estimated here.
      </p>
    </div>
  )
}
