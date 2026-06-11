import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { fmtMoneyShort } from '../calendarUtils'
import { niceTicks } from './lifelineEngine'

// The Lifeline curve. Always rendered on the dark "cinema" canvas (the panel
// itself is dark in both themes — the page chrome around it adapts).
//
// Animation strategy:
//  - Initial reveal: the whole drawn scene sits inside a clipPath whose rect
//    scales 0 → 1 left-to-right (CSS keyframes, ~1.8s) — the EKG draw-on —
//    so the dashed assumption stroke never fights a dash-offset trick.
//  - Dial morphs: the *data series* tweens (rAF, cubic-out, ~320ms) and the
//    path d updates each frame — no re-mounts, just attribute updates on a
//    handful of nodes. ~84 points, far under the 16ms frame budget.
//  - prefers-reduced-motion collapses both to instant states (CSS overrides
//    the reveal; the tween snaps).

function prefersReduced() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

// Tween an array of numbers toward `target`. Snaps when length changes
// (horizon switch) or reduced motion. All setState happens in rAF callbacks.
function useAnimatedSeries(target, duration = 320) {
  const [series, setSeries] = useState(target)
  const liveRef = useRef(target)
  useEffect(() => {
    const from = (liveRef.current && liveRef.current.length === target.length) ? liveRef.current : target
    const snap = from === target || prefersReduced()
    let raf, start
    const step = (now) => {
      if (start == null) start = now
      const t = snap ? 1 : Math.min(1, (now - start) / duration)
      const e = 1 - Math.pow(1 - t, 3)
      const vals = t >= 1 ? target : target.map((v, i) => from[i] + (v - from[i]) * e)
      liveRef.current = vals
      setSeries(vals)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    // Hidden-tab fail-safe: rAF pauses in background tabs — land the final
    // series anyway so the curve isn't stale when the tab is shown.
    const failSafe = setTimeout(() => { liveRef.current = target; setSeries(target) }, duration + 400)
    return () => { cancelAnimationFrame(raf); clearTimeout(failSafe) }
  }, [target, duration])
  return series.length === target.length ? series : target
}

// fmtMoneyShort drops the sign by design (chip usage) — balances need it back.
function fmtShortSigned(n) {
  return `${n < 0 ? '−' : ''}${fmtMoneyShort(Math.abs(n))}`
}

const W = 1000
const H = 420
const PAD = { top: 34, right: 24, bottom: 46, left: 76 }

export default function LifelineChart({ ledger, startCash, selectedWeek, onSelectWeek }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const { days, weeks, breach } = ledger

  const targetBalances = useMemo(() => days.map(d => d.balance), [days])
  const targetFloor = useMemo(() => days.map(d => d.floorBalance), [days])
  const balances = useAnimatedSeries(targetBalances)
  const floor = useAnimatedSeries(targetFloor)

  // Y domain covers both series plus zero, padded so the curve breathes.
  const { yMin, yMax } = useMemo(() => {
    let lo = Math.min(0, ...balances, ...floor)
    let hi = Math.max(startCash, ...balances)
    const pad = (hi - lo) * 0.12 || 1
    return { yMin: lo - pad, yMax: hi + pad }
  }, [balances, floor, startCash])

  const x = (i) => PAD.left + (i / Math.max(1, days.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom)
  const y0 = y(0)

  // Paths recompute every render — ~84 points of string-building is far
  // cheaper than memo bookkeeping, and the morph updates them per frame anyway.
  const linePath = balances.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('')
  const floorPath = floor.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('')
  // Area fills from the curve down to the $0 waterline (not the chart floor):
  // what's "under water" is genuinely below zero.
  const areaPath = `${linePath}L${x(balances.length - 1).toFixed(2)},${y0.toFixed(2)}L${x(0).toFixed(2)},${y0.toFixed(2)}Z`

  // Living gradient: deep teal while healthy → amber as the curve thins →
  // ember below the waterline. Stops are positioned against y(0) so the
  // color story tracks the actual dollar scale, not fixed percentages.
  const zeroPct = Math.min(100, Math.max(0, ((y0 - PAD.top) / (H - PAD.top - PAD.bottom)) * 100))
  const amberPct = Math.max(0, zeroPct - 18)

  const ticks = useMemo(() => niceTicks(yMin, yMax, 5), [yMin, yMax])
  const breachX = breach ? x(breach.dayIdx) : null
  const todayLabel = days[0]?.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img"
      aria-label="Projected cash position by day across the horizon. Scheduled obligations are real data; collections are user assumptions.">
      <defs>
        <linearGradient id={`area-${uid}`} x1="0" y1={PAD.top} x2="0" y2={H - PAD.bottom} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.34" />
          <stop offset={`${amberPct}%`} stopColor="#f59e0b" stopOpacity="0.22" />
          <stop offset={`${zeroPct}%`} stopColor="#f59e0b" stopOpacity="0.10" />
          <stop offset={`${zeroPct}%`} stopColor="#ef4444" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.42" />
        </linearGradient>
        <linearGradient id={`stroke-${uid}`} x1="0" y1={PAD.top} x2="0" y2={H - PAD.bottom} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset={`${amberPct}%`} stopColor="#fbbf24" />
          <stop offset={`${zeroPct}%`} stopColor="#f87171" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        {/* The reveal: everything data-drawn is clipped by a rect that sweeps
            left → right on mount. Reduced motion shows it instantly. */}
        <clipPath id={`reveal-${uid}`}>
          <rect className="lifeline-reveal" x="0" y="0" width={W} height={H} />
        </clipPath>
        {/* Only the region below the waterline — the submerged red glow. */}
        <clipPath id={`under-${uid}`}>
          <rect x="0" y={y0} width={W} height={Math.max(0, H - y0)} />
        </clipPath>
      </defs>

      {/* Y grid + labels */}
      {ticks.map(t => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
            stroke="#ffffff" strokeOpacity={t === 0 ? 0 : 0.05} />
          <text x={PAD.left - 10} y={y(t) + 4} textAnchor="end" fontSize="12"
            fill="#94a3b8" fillOpacity="0.8" className="font-mono">{fmtShortSigned(t)}</text>
        </g>
      ))}

      {/* Week boundaries + labels + click bands */}
      {weeks.map((w, i) => {
        const x1 = x(days.findIndex(d => d.weekIdx === w.idx))
        const lastIdx = days.map(d => d.weekIdx).lastIndexOf(w.idx)
        const x2 = Math.min(W - PAD.right, x(lastIdx) + (x(1) - x(0)) / 2)
        const selected = selectedWeek === w.idx
        return (
          <g key={w.idx}>
            {i > 0 && <line x1={x1} x2={x1} y1={PAD.top} y2={H - PAD.bottom} stroke="#ffffff" strokeOpacity="0.05" />}
            <text x={(x1 + x2) / 2} y={H - PAD.bottom + 22} textAnchor="middle" fontSize="12"
              fill={selected ? '#5eead4' : '#94a3b8'} fillOpacity={selected ? 1 : 0.75}>{w.label}</text>
            <rect x={x1} y={PAD.top} width={Math.max(0, x2 - x1)} height={H - PAD.top - PAD.bottom}
              fill={selected ? 'rgba(45,212,191,0.07)' : 'transparent'}
              className={`cursor-pointer transition-[fill] duration-150 ${selected ? '' : 'hover:fill-white/[0.04]'}`}
              onClick={() => onSelectWeek(selected ? null : w.idx)}>
              <title>{`Week of ${w.label} — ends ${fmtShortSigned(w.endBalance)} · real outflows ${fmtMoneyShort(w.outflow + w.catchup)} · assumed inflows ${fmtMoneyShort(w.inflow)} (click for detail)`}</title>
            </rect>
          </g>
        )
      })}

      <g clipPath={`url(#reveal-${uid})`}>
        {/* Living area under the curve */}
        <path d={areaPath} fill={`url(#area-${uid})`} />
        {/* Submerged region pulses softly — dread, not alarm */}
        <path d={areaPath} fill="#ef4444" fillOpacity="0.3" clipPath={`url(#under-${uid})`} className="lifeline-submerged" />

        {/* Honesty floor: obligations only, zero collections — solid because
            it is the real, deterministic trajectory */}
        <path d={floorPath} fill="none" stroke="#94a3b8" strokeOpacity="0.45" strokeWidth="1.5" />

        {/* The lifeline: glow underlayer + crisp dashed top stroke (dashed =
            it embodies the collection assumptions) */}
        <path d={linePath} fill="none" stroke={`url(#stroke-${uid})`} strokeWidth="7" strokeOpacity="0.35" filter={`url(#glow-${uid})`} />
        <path d={linePath} fill="none" stroke={`url(#stroke-${uid})`} strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />
      </g>

      {/* $0 waterline — drawn over the curve so the crossing reads instantly */}
      <line x1={PAD.left} x2={W - PAD.right} y1={y0} y2={y0} stroke="#f87171" strokeOpacity="0.55" strokeWidth="1.25" strokeDasharray="2 4" />
      <text x={W - PAD.right} y={y0 - 6} textAnchor="end" fontSize="11" fill="#f87171" fillOpacity="0.8">$0 waterline</text>

      {/* Today: heartbeat point */}
      <g className="lifeline-fade-in">
        <circle cx={x(0)} cy={y(balances[0] ?? startCash)} r="5" fill="#2dd4bf" />
        <circle cx={x(0)} cy={y(balances[0] ?? startCash)} r="5" fill="none" stroke="#2dd4bf" className="lifeline-beat" />
        <text x={x(0)} y={PAD.top - 12} textAnchor="start" fontSize="11" fill="#5eead4">Today · {todayLabel}</text>
      </g>

      {/* Breach beacon at the first zero-crossing */}
      {breach && (
        <g className="lifeline-fade-in-late">
          <line x1={breachX} x2={breachX} y1={PAD.top} y2={H - PAD.bottom} stroke="#ef4444" strokeOpacity="0.7" strokeWidth="1.5" />
          <circle cx={breachX} cy={y0} r="4.5" fill="#ef4444" />
          <circle cx={breachX} cy={y0} r="4.5" fill="none" stroke="#ef4444" className="lifeline-beat" />
          <g transform={`translate(${Math.min(breachX + 10, W - 280)}, ${PAD.top + 6})`}>
            <text fontSize="12" fill="#fca5a5" fontWeight="600">
              Breach · week of {breach.weekLabel}
            </text>
            <text y="17" fontSize="11" fill="#fda4af" fillOpacity="0.9">
              {fmtMoneyShort(breach.obligations)} obligations vs {fmtMoneyShort(breach.expected)} expected collections
            </text>
          </g>
        </g>
      )}
    </svg>
  )
}
