import { useMemo, useRef, useState } from 'react'
import { lerpHex, quantile } from './laneData'
import { MAP_W as W, MAP_H as H, NATION_OUTLINE, projection, STATES_OUTLINE } from './mapShared'
import { fmtMoney, fmtNum, fmtRpm } from '../spotlight/spotlightShared'

// Heat view: the same filtered legs as the arc view, binned into a square
// grid over the same AlbersUSA frame and blurred into a glowing density
// field — no mapping dependency beyond what the arcs already use. Each leg
// contributes its geocoded origin and destination point; off-map legs are
// excluded exactly as in the arc view.

const CELL = 26 // grid cell size in the 975×610 projected frame

// Classic bright thermal ramp (green → yellow → orange → red) — saturated
// enough to read on the light theme, where pastels wash out. When a single
// trailer type is isolated, the ramp is rebuilt around that type's
// categorical color (pale → type color → deep) so screenshots are
// self-identifying.
const DEFAULT_STOPS = ['#22c55e', '#facc15', '#f97316', '#ef4444']
function rampStops(tintColor) {
  if (!tintColor) return DEFAULT_STOPS
  return [lerpHex(tintColor, '#ffffff', 0.5), tintColor, lerpHex(tintColor, '#1e293b', 0.45)]
}
function rampColor(stops, t) {
  const n = stops.length - 1
  const x = Math.min(1, Math.max(0, t)) * n
  const i = Math.min(n - 1, Math.floor(x))
  return lerpHex(stops[i], stops[i + 1], x - i)
}

const METRIC_META = {
  revenue: { label: 'Revenue touching the area', fmt: fmtMoney },
  loads: { label: 'Loads touching the area', fmt: fmtNum },
  rpm: { label: 'Avg $/mile (revenue-weighted)', fmt: (v) => `${fmtRpm(v)}/mi` },
}

export default function LaneHeatCanvas({ lanes, metric, tintColor }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null) // { key, x, y, w }

  const grid = useMemo(() => {
    const cells = new Map()
    for (const lane of lanes) {
      if (!lane.geocoded) continue
      const o = projection([lane.oCoord[1], lane.oCoord[0]])
      const d = projection([lane.dCoord[1], lane.dCoord[0]])
      if (!o || !d) continue
      for (const leg of lane.legs) {
        const revenue = Number(leg.leg_revenue) || 0
        const miles = Number(leg.leg_total_miles) || 0
        const rpm = miles > 0 ? revenue / miles : null
        for (const [p, city] of [[o, lane.origin], [d, lane.destination]]) {
          const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL)
          const key = `${cx},${cy}`
          let c = cells.get(key)
          if (!c) { c = { key, cx, cy, revenue: 0, loads: 0, wNum: 0, wDen: 0, cities: new Map() }; cells.set(key, c) }
          c.revenue += revenue
          c.loads++
          // $/mile is an average, never a sum: revenue-weighted so one hot
          // load outweighs many cheap ones, and unpriced legs don't drag.
          if (rpm != null) { c.wNum += rpm * revenue; c.wDen += revenue }
          c.cities.set(city, (c.cities.get(city) || 0) + revenue)
        }
      }
    }
    const list = [...cells.values()]
    for (const c of list) {
      c.rpm = c.wDen > 0 ? c.wNum / c.wDen : null
      c.topCity = [...c.cities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    }
    return list
  }, [lanes])

  const scale = useMemo(() => {
    const vals = grid.map(c => (metric === 'rpm' ? c.rpm : c[metric])).filter(v => v != null && v > 0).sort((a, b) => a - b)
    if (!vals.length) return null
    // Sums clamp at p95 so one mega-hub doesn't flatten the rest of the map;
    // the $/mile average uses a p10–p90 domain like the arc color scale.
    const lo = metric === 'rpm' ? quantile(vals, 0.1) : 0
    const hi = metric === 'rpm' ? quantile(vals, 0.9) : quantile(vals, 0.95)
    const clamped = vals[vals.length - 1] > hi
    return { lo, hi, clamped, t: (v) => (hi <= lo ? 0.5 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)))) }
  }, [grid, metric])

  const stops = rampStops(tintColor)
  const meta = METRIC_META[metric] || METRIC_META.revenue
  const valOf = (c) => (metric === 'rpm' ? c.rpm : c[metric])
  const drawn = scale ? grid.filter(c => valOf(c) != null && valOf(c) > 0) : []
  const hovered = hover ? drawn.find(c => c.key === hover.key) : null

  function move(e, key) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ key, x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width })
  }

  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block select-none" role="img" aria-label="US map of freight density">
        <defs>
          <filter id="laneHeatBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={CELL * 0.22} />
          </filter>
        </defs>

        {/* Land */}
        <path d={NATION_OUTLINE} className="fill-gray-100 dark:fill-white/[0.025]" />
        <path d={STATES_OUTLINE} fill="none" strokeWidth="0.75" className="stroke-gray-300 dark:stroke-white/[0.07]" />
        <path d={NATION_OUTLINE} fill="none" strokeWidth="1" className="stroke-gray-300 dark:stroke-white/[0.12]" />

        {/* Solid heat cells — full-strength color like the arc view (the soft
            translucent look washed out on the light theme); a light blur only
            smooths the cell edges, and hotter cells draw on top. */}
        <g filter="url(#laneHeatBlur)">
          {[...drawn].sort((a, b) => scale.t(valOf(a)) - scale.t(valOf(b))).map(c => {
            const t = scale.t(valOf(c))
            return (
              <rect key={c.key} x={c.cx * CELL} y={c.cy * CELL} width={CELL} height={CELL}
                fill={rampColor(stops, t)} />
            )
          })}
        </g>

        {/* Invisible hit cells for the tooltip (drawn unblurred, on top) */}
        {drawn.map(c => (
          <rect key={`hit-${c.key}`} x={c.cx * CELL} y={c.cy * CELL} width={CELL} height={CELL}
            fill="transparent" className="cursor-pointer"
            onMouseMove={e => move(e, c.key)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>

      {/* Legend — always shows the actual ramp range */}
      {scale && (
        <div className="absolute left-4 bottom-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white/85 dark:bg-[#12132e]/85 backdrop-blur px-2.5 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{meta.label}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-slate-400">
            <span className="font-mono">{meta.fmt(scale.lo)}</span>
            <span className="h-1.5 w-20 rounded-full" style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }} />
            <span className="font-mono">{meta.fmt(scale.hi)}{scale.clamped ? '+' : ''}</span>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hovered && hover && (
        <div
          className="pointer-events-none absolute z-20 rounded-xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-[#12132e]/95 backdrop-blur px-3 py-2 shadow-2xl"
          style={{ left: Math.min(hover.x + 14, (hover.w || 600) - 215), top: Math.max(hover.y - 64, 6), width: 205 }}
        >
          {hovered.topCity && <p className="text-xs font-semibold text-gray-900 dark:text-white leading-snug">{hovered.topCity}</p>}
          <div className="mt-1 flex items-baseline justify-between text-[11px] text-gray-500 dark:text-slate-400">
            <span>{fmtNum(hovered.loads)} load touch{hovered.loads === 1 ? '' : 'es'}</span>
            <span className="font-mono">{fmtMoney(hovered.revenue)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-400 dark:text-slate-500">Avg $/mile</span>
            <span className="font-mono font-semibold text-gray-700 dark:text-slate-200">{hovered.rpm != null ? `${fmtRpm(hovered.rpm)}/mi` : '—'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
