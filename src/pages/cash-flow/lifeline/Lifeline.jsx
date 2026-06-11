import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { addDays, fmtMoneyExact, fmtMoneyShort, startOfWeek, toISO } from '../calendarUtils'
import {
  buildLedger, collectionsDefault, filterForwardOutflows, recoveryDefaults, runwayWeeks,
} from './lifelineEngine'
import LifelineChart from './LifelineChart'

// Lifeline — the 8-week cash-runway simulator. One glowing curve: today's
// real cash, falling with real scheduled obligations, rising with collection
// assumptions the owner controls. The fact/assumption split is the product:
// outflows are data, inflows are dials, and the UI never blurs the two.

const HORIZONS = [4, 8, 12]
const CATCHUP_CHOICES = [4, 8, 12, 16]

// ── Count-up (Boardroom pattern: rAF-only setState, reduced-motion collapse,
// hidden-tab fail-safe). Used only for the static "cash today" hero — the
// dial-driven numbers update instantly instead of re-sweeping on every drag.
function CountUp({ value, format, duration = 1300 }) {
  const [anim, setAnim] = useState({ target: null, t: 0 })
  useEffect(() => {
    if (value == null) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    let raf, start
    const step = (now) => {
      if (start == null) start = now
      const t = reduced ? 1 : Math.min(1, (now - start) / duration)
      setAnim({ target: value, t })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    const failSafe = setTimeout(() => setAnim({ target: value, t: 1 }), duration + 500)
    return () => { cancelAnimationFrame(raf); clearTimeout(failSafe) }
  }, [value, duration])
  if (value == null) return <>—</>
  const eased = anim.target === value ? 1 - Math.pow(1 - anim.t, 3) : 0
  return <>{format ? format(value * eased) : Math.round(value * eased).toLocaleString()}</>
}

// "$-84.2k" style compact signed money for hero/dock readouts.
function fmtSigned(n) {
  if (n == null) return '—'
  return `${n < 0 ? '−' : ''}${fmtMoneyShort(Math.abs(n))}`
}

const ASSUMPTION_BADGE = (
  <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300 border border-amber-400/20">
    assumption
  </span>
)

export default function Lifeline() {
  // Anchor "today" once per visit — every date computation hangs off this.
  const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t }, [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  // The dials — initialized from computed defaults once data lands.
  const [collections, setCollections] = useState(0)
  const [recoveryPct, setRecoveryPct] = useState(0)
  const [catchUp, setCatchUp] = useState(false)
  const [catchUpWeeks, setCatchUpWeeks] = useState(8)
  const [horizon, setHorizon] = useState(8)
  const [scenario, setScenario] = useState('base')
  const [selectedWeek, setSelectedWeek] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const week0 = startOfWeek(today)
      const todayISO = toISO(today)
      const histStart = toISO(addDays(week0, -42))      // 6 full weeks back
      const week0ISO = toISO(week0)
      const horizonEnd = toISO(addDays(week0, 12 * 7))  // fetch max horizon once

      // One round of queries; the sliders only ever re-run client math.
      const [accRes, outRes, inRes, dppRes, legsRes, kpiRes] = await Promise.all([
        supabase.from('v_funding_accounts_with_balance')
          .select('balance, days_since_balance, is_active').eq('is_active', true),
        supabase.from('v_cash_flow_events')
          .select('event_id, event_date, direction, category, amount, label, entity_name, status, reference_type')
          .eq('direction', 'outflow').gte('event_date', todayISO).lt('event_date', horizonEnd),
        supabase.from('v_cash_flow_events')
          .select('event_date, direction, category, amount, status, reference_type')
          .eq('direction', 'inflow').gte('event_date', histStart).lte('event_date', todayISO),
        supabase.from('driver_purchase_payments')
          .select('period_end, expected_amount, actual_amount')
          .gte('period_end', histStart).lt('period_end', week0ISO),
        supabase.from('v_load_leg_profit')
          .select('leg_revenue, delivery_date, is_projected')
          .gte('delivery_date', toISO(addDays(week0, -28))).lte('delivery_date', toISO(addDays(week0, 6))),
        supabase.rpc('debt_schedule_kpi_summary').single(),
      ])
      if (cancelled) return

      // Cash + scheduled obligations are the backbone — fail loudly without them.
      if (accRes.error || outRes.error) {
        setError(accRes.error?.message || outRes.error?.message)
        setLoading(false)
        return
      }

      const startCash = (accRes.data || []).reduce((s, a) => s + Number(a.balance || 0), 0)
      const maxStale = Math.max(0, ...(accRes.data || []).map(a => Number(a.days_since_balance || 0)))
      const outflowEvents = filterForwardOutflows(outRes.data, todayISO)

      const inflowRows = inRes.data || []
      const history = inflowRows.filter(r => r.event_date < week0ISO)
      const recordedThisWeek = inflowRows
        .filter(r => r.event_date >= week0ISO && r.category !== 'transfer'
          && r.reference_type !== 'transfer_in' && r.reference_type !== 'adjustment')
        .reduce((s, r) => s + Number(r.amount || 0), 0)

      // Realized (non-projected) billed freight per week — the sanity clamp.
      const realizedByWeek = new Map()
      for (const leg of (legsRes.data || [])) {
        if (leg.is_projected || !leg.delivery_date || leg.delivery_date >= week0ISO) continue
        const wk = toISO(startOfWeek(new Date(`${leg.delivery_date}T00:00:00`)))
        realizedByWeek.set(wk, (realizedByWeek.get(wk) || 0) + Number(leg.leg_revenue || 0))
      }
      const realizedWeeklyRevenueMax = Math.max(0, ...realizedByWeek.values())
      const bookedThisWeek = (legsRes.data || [])
        .filter(l => l.delivery_date >= week0ISO)
        .reduce((s, l) => s + Number(l.leg_revenue || 0), 0)

      const collectionsDef = collectionsDefault({ inflowHistory: history, weeks: 6, realizedWeeklyRevenueMax })
      const recovery = recoveryDefaults(dppRes.error ? [] : dppRes.data, 6)
      const pastDue = kpiRes.error ? null : Number(kpiRes.data?.past_due_amount || 0)

      setData({
        startCash, maxStale, outflowEvents, recordedThisWeek, bookedThisWeek,
        collectionsDef, recoveryExpectedWeekly: recovery.expectedWeekly,
        recoveryDefPct: recovery.defaultPct, pastDue,
        recoveryVisible: !dppRes.error && (dppRes.data || []).length > 0,
        historyTotal: history.filter(r => r.category !== 'transfer' && r.reference_type !== 'transfer_in' && r.reference_type !== 'transfer_out' && r.reference_type !== 'adjustment').reduce((s, r) => s + Number(r.amount || 0), 0),
      })
      setCollections(collectionsDef)
      setRecoveryPct(recovery.defaultPct)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [today])

  const ledger = useMemo(() => {
    if (!data) return null
    return buildLedger({
      startCash: data.startCash,
      outflowEvents: data.outflowEvents,
      horizonWeeks: horizon,
      collectionsPerWeek: collections,
      recoveryPct,
      expectedRecoveryWeekly: data.recoveryExpectedWeekly,
      catchUp,
      catchUpWeeks,
      pastDueTotal: data.pastDue || 0,
      today,
    })
  }, [data, horizon, collections, recoveryPct, catchUp, catchUpWeeks, today])

  function applyScenario(key) {
    if (!data) return
    setScenario(key)
    if (key === 'base') {
      setCollections(data.collectionsDef)
      setRecoveryPct(data.recoveryDefPct)
      setCatchUp(false)
    } else if (key === 'stress') {
      setCollections(Math.round(data.collectionsDef * 0.8 / 500) * 500)
      setRecoveryPct(data.recoveryDefPct)
      setCatchUp(false)
    } else if (key === 'plan') {
      setCollections(data.collectionsDef)
      setRecoveryPct(100)
      setCatchUp(true)
      setCatchUpWeeks(8)
    }
  }
  // Any manual dial movement detaches from the named scenario.
  function dial(setter) {
    return (value) => { setter(value); setScenario('custom') }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-400" />
        <p className="text-sm text-gray-500 dark:text-slate-500">Reading the ledger…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="max-w-2xl">
        <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-sm">
          Couldn't load cash-flow data: {error}
        </div>
      </div>
    )
  }

  const breach = ledger.breach
  const runway = runwayWeeks(breach, today)
  const worst = ledger.worst
  const worstWeek = ledger.weeks.find(w => w.idx === worst.weekIdx)
  const collectionsMax = Math.max(Math.ceil((data.collectionsDef * 2) / 5000) * 5000, 300000)
  const catchupPerWeek = catchUp && data.pastDue ? data.pastDue / catchUpWeeks : 0
  const week = selectedWeek != null ? ledger.weeks.find(w => w.idx === selectedWeek) : null

  return (
    <div className="space-y-5 max-w-[1280px]">
      {/* Page header — theme-adaptive chrome around the dark cinema panel */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Cash Flow
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lifeline</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Do we make it through the next {horizon} weeks — and if not, which week breaks, and why?
          </p>
        </div>
        {data.maxStale > 0 && (
          <Link to="/cash-flow/payment-calendar"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 dark:bg-amber-400/10 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-400/25 hover:bg-amber-100 dark:hover:bg-amber-400/20 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-soft-pulse" />
            Balances last updated up to {data.maxStale}d ago — update for accuracy
          </Link>
        )}
      </div>

      {/* ── The cinema panel — deliberately dark in both themes ─────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-gray-300 dark:border-white/10 bg-[#050514] text-slate-200 shadow-2xl shadow-black/30">
        {/* faint vignette so the curve floats */}
        <div aria-hidden className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(120% 90% at 50% 0%, rgba(45,212,191,0.07), transparent 55%), radial-gradient(90% 70% at 80% 100%, rgba(239,68,68,0.06), transparent 60%)' }} />

        <div className="relative p-5 sm:p-7 space-y-6">
          {/* Hero row */}
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Cash today</p>
                <p className="font-mono font-semibold text-4xl lg:text-5xl tracking-tight text-teal-300 mt-1.5 leading-none">
                  <CountUp value={data.startCash} format={(n) => fmtMoneyShort(n)} />
                </p>
                <p className="text-[11px] text-slate-500 mt-1.5">{fmtMoneyExact(data.startCash)} across active accounts · real</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Runway</p>
                <p className={`font-mono font-semibold text-4xl lg:text-5xl tracking-tight mt-1.5 leading-none ${breach ? 'text-red-400' : 'text-teal-300'}`}>
                  {breach ? `${runway} wks` : `${horizon}+ wks`}
                </p>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  {breach
                    ? `first breach ${breach.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · under these assumptions`
                    : 'clear horizon · under these assumptions'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Next pinch</p>
                <p className={`font-mono font-semibold text-4xl lg:text-5xl tracking-tight mt-1.5 leading-none ${worst.balance < 0 ? 'text-red-400' : 'text-amber-300'}`}>
                  {fmtSigned(worst.balance)}
                </p>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  lowest point · week of {worstWeek?.label}
                  {worstWeek && ` · ${fmtMoneyShort(worstWeek.outflow + worstWeek.catchup)} obligations due`}
                </p>
              </div>
            </div>
            {/* Horizon */}
            <div className="flex items-center gap-1.5">
              {HORIZONS.map(h => (
                <button key={h} type="button" onClick={() => { setHorizon(h); setSelectedWeek(null) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${horizon === h
                    ? 'bg-teal-400/15 text-teal-300 border-teal-400/40'
                    : 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                  {h} wk
                </button>
              ))}
            </div>
          </div>

          {/* The curve — pannable on narrow screens so labels stay legible */}
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[640px]">
              <LifelineChart ledger={ledger} startCash={data.startCash}
                selectedWeek={selectedWeek} onSelectWeek={setSelectedWeek} />
            </div>
          </div>

          {/* Legend — the honesty split, always visible */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-slate-400 -mt-2">
            <span className="flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="#2dd4bf" strokeWidth="2.5" strokeDasharray="6 4" /></svg>
              with your collection assumptions <span className="text-amber-300/90">(dashed = assumed)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="#94a3b8" strokeWidth="1.5" /></svg>
              if nothing collects — scheduled obligations only <span className="text-slate-500">(real)</span>
            </span>
            <span className="text-slate-500">click any week for the receipts</span>
          </div>

          {/* ── Forensics — the week under the microscope ─────────────────── */}
          <div className={`grid transition-all duration-300 ease-out ${week ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
            <div className="overflow-hidden">
              {week && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Week of {week.start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                        {week.idx === 0 && <span className="ml-2 text-[10px] font-semibold text-slate-400">(partial — from today)</span>}
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        starts {fmtSigned(week.startBalance)} → ends {fmtSigned(week.endBalance)}
                        {week.minBalance < Math.min(week.startBalance, week.endBalance) - 1 && ` · dips to ${fmtSigned(week.minBalance)} mid-week`}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSelectedWeek(null)}
                      className="text-slate-500 hover:text-slate-200 text-lg leading-none px-1" aria-label="Close week detail">×</button>
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                        Scheduled obligations · real <span className="text-slate-500">({week.events.length})</span>
                      </p>
                      <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                        {week.events.length === 0 && <p className="text-xs text-slate-500">No scheduled outflows this week.</p>}
                        {week.events.map(ev => (
                          <div key={ev.event_id} className="flex items-baseline justify-between gap-3 text-xs">
                            <span className="truncate text-slate-300">
                              {ev.label || ev.entity_name || ev.category}
                              {ev.entity_name && ev.label && <span className="text-slate-500"> · {ev.entity_name}</span>}
                              <span className={`ml-1.5 text-[9px] font-semibold uppercase ${ev.category === 'loan' ? 'text-orange-300/80' : 'text-slate-500'}`}>{ev.category}</span>
                            </span>
                            <span className="font-mono text-red-300/90 shrink-0">−{fmtMoneyExact(ev.amount)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-xs font-semibold border-t border-white/10 mt-2 pt-2">
                        <span className="text-slate-300">Total real outflows</span>
                        <span className="font-mono text-red-300">−{fmtMoneyExact(week.outflow)}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Inflows · assumed</p>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-slate-300 flex items-center gap-1.5">Freight collections {ASSUMPTION_BADGE}</span>
                          <span className="font-mono text-teal-300 shrink-0">
                            +{fmtMoneyExact(week.inflow * (collections / Math.max(1, collections + (recoveryPct / 100) * data.recoveryExpectedWeekly)))}
                          </span>
                        </div>
                        {data.recoveryVisible && (
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-slate-300 flex items-center gap-1.5">Driver-purchase recovery · {recoveryPct}% of schedule {ASSUMPTION_BADGE}</span>
                            <span className="font-mono text-teal-300 shrink-0">
                              +{fmtMoneyExact(week.inflow * (((recoveryPct / 100) * data.recoveryExpectedWeekly) / Math.max(1, collections + (recoveryPct / 100) * data.recoveryExpectedWeekly)))}
                            </span>
                          </div>
                        )}
                        {week.catchup > 0 && (
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-slate-300">
                              Past-due catch-up
                              <span className="ml-1.5 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-red-400/10 text-red-300 border border-red-400/20">scenario</span>
                            </span>
                            <span className="font-mono text-red-300/90 shrink-0">−{fmtMoneyExact(week.catchup)}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex justify-between text-xs font-semibold border-t border-white/10 mt-2 pt-2">
                        <span className="text-slate-300">Net for the week</span>
                        <span className={`font-mono ${week.net < 0 ? 'text-red-300' : 'text-teal-300'}`}>{week.net < 0 ? '−' : '+'}{fmtMoneyExact(Math.abs(week.net))}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── The dials — glass dock ────────────────────────────────────── */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-md p-4 sm:p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
                Your assumptions <span className="normal-case font-medium text-slate-500 tracking-normal">— the future re-shapes as you drag</span>
              </p>
              <div className="flex items-center gap-1.5">
                {[['base', 'Base'], ['stress', 'Stress −20%'], ['plan', 'Recovery plan']].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => applyScenario(key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${scenario === key
                      ? 'bg-teal-400/15 text-teal-300 border-teal-400/40'
                      : 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                    {label}
                  </button>
                ))}
                {scenario === 'custom' && (
                  <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-fuchsia-400/10 text-fuchsia-300 border border-fuchsia-400/30">Custom</span>
                )}
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-x-8 gap-y-5">
              {/* Freight collections */}
              <div>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <label htmlFor="lifeline-collections" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    Expected collections / week {ASSUMPTION_BADGE}
                  </label>
                  <input
                    type="number" min="0" max={collectionsMax} step="1000" value={collections}
                    onChange={(e) => dial(setCollections)(Math.max(0, Number(e.target.value) || 0))}
                    className="w-28 px-2 py-1 text-right font-mono text-sm rounded-lg bg-white/10 border border-white/10 text-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
                    aria-label="Expected collections per week, dollars"
                  />
                </div>
                <input id="lifeline-collections" type="range" min="0" max={collectionsMax} step="1000" value={collections}
                  onChange={(e) => dial(setCollections)(Number(e.target.value))}
                  className="w-full accent-teal-400 cursor-pointer" />
                <p className="text-[11px] text-slate-500 mt-1">
                  Your assumption, not a forecast. Recorded inflows averaged {fmtMoneyShort(data.historyTotal / 6)}/wk over the last 6 wks (lumpy — batch-recorded).
                  {data.bookedThisWeek > 0 && <> Booked freight this week: {fmtMoneyShort(data.bookedThisWeek)}.</>}
                  {data.recordedThisWeek > 0 && <> Already recorded this week: {fmtMoneyShort(data.recordedThisWeek)} (pending).</>}
                </p>
              </div>

              {/* Driver-purchase recovery */}
              <div>
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <label htmlFor="lifeline-recovery" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    Driver-purchase recovery {ASSUMPTION_BADGE}
                  </label>
                  <span className="font-mono text-sm text-teal-300">
                    {recoveryPct}% · {fmtMoneyShort((recoveryPct / 100) * data.recoveryExpectedWeekly)}/wk
                  </span>
                </div>
                <input id="lifeline-recovery" type="range" min="0" max="100" step="1" value={recoveryPct}
                  onChange={(e) => dial(setRecoveryPct)(Number(e.target.value))}
                  disabled={!data.recoveryVisible}
                  className="w-full accent-teal-400 cursor-pointer disabled:opacity-40" />
                <p className="text-[11px] text-slate-500 mt-1">
                  {data.recoveryVisible
                    ? <>Schedule expects ~{fmtMoneyShort(data.recoveryExpectedWeekly)}/wk; actual collection ran {data.recoveryDefPct}% over the last 6 wks — the default is the recent reality, not the contract.</>
                    : 'Driver-purchase schedule not visible for this account — recovery held at $0.'}
                </p>
              </div>
            </div>

            {/* Past-due catch-up scenario */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 border-t border-white/10">
              <button type="button" role="switch" aria-checked={catchUp}
                onClick={() => dial(setCatchUp)(!catchUp)}
                disabled={data.pastDue == null}
                className="flex items-center gap-2.5 disabled:opacity-40">
                <span className={`relative w-9 h-5 rounded-full transition-colors ${catchUp ? 'bg-teal-400/80' : 'bg-white/15'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${catchUp ? 'translate-x-4' : ''}`} />
                </span>
                <span className="text-xs font-semibold text-slate-200">Catch up past-due debt</span>
              </button>
              {data.pastDue != null ? (
                <>
                  <span className="text-[11px] text-slate-400">
                    <Link to="/financial-controls/debt-schedule" className="text-red-300/90 hover:text-red-200 hover:underline font-semibold">
                      {fmtMoneyExact(data.pastDue)} past due
                    </Link> (Debt Schedule) spread over
                  </span>
                  <span className="flex items-center gap-1">
                    {CATCHUP_CHOICES.map(n => (
                      <button key={n} type="button" onClick={() => { dial(setCatchUpWeeks)(n); if (!catchUp) setCatchUp(true) }}
                        className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition-colors ${catchUp && catchUpWeeks === n
                          ? 'bg-red-400/15 text-red-300 border-red-400/40'
                          : 'border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                        {n} wk
                      </button>
                    ))}
                  </span>
                  {catchUp && <span className="text-[11px] font-mono text-red-300/90">adds {fmtMoneyShort(catchupPerWeek)}/wk to outflows</span>}
                </>
              ) : (
                <span className="text-[11px] text-slate-500">Past-due total not visible for this account.</span>
              )}
            </div>
          </div>

          {/* The permanent honesty caption */}
          <p className="text-[11px] leading-relaxed text-slate-500 text-center">
            Scheduled obligations are real BUDDY data. Collections are assumptions you control.
            Lifeline shows consequences, not guarantees.
          </p>
        </div>
      </div>
    </div>
  )
}
