import { useMemo, useRef, useState } from 'react'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import usTopo from './usStatesAlbers.json'
import { WIDTH_RANGE } from './laneData'
import { fmtMoney, fmtNum, fmtRpm } from '../spotlight/spotlightShared'

// SVG US map with freight arcs. The us-atlas topology is pre-projected to
// a 975×610 AlbersUSA frame, so states render with a bare geoPath() and
// cities go through the matching geoAlbersUsa() projection (same scale/
// translate us-atlas used). Everything is plain SVG — no map library.

const W = 975, H = 610
const projection = geoAlbersUsa().scale(1300).translate([W / 2, H / 2])
const statePath = geoPath()
const STATES_OUTLINE = statePath(mesh(usTopo, usTopo.objects.states, (a, b) => a !== b))
const NATION_OUTLINE = statePath(feature(usTopo, usTopo.objects.nation))

// Quadratic arc bowing toward the top of the map — reads as a flight path
// and keeps direction unambiguous together with the dash-flow animation.
// `lift` fans same-corridor arcs apart (type-split lanes share endpoints).
function arcPath(a, b, lift = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const dist = Math.hypot(dx, dy)
  if (dist < 2) return null // same-city move; rendered as a loop ring instead
  let px = -dy / dist, py = dx / dist
  if (py > 0) { px = -px; py = -py }
  const k = dist * (0.18 + 0.06 * lift)
  return `M${a[0]},${a[1]} Q${(a[0] + b[0]) / 2 + px * k},${(a[1] + b[1]) / 2 + py * k} ${b[0]},${b[1]}`
}

// laneColorFor (whole-lane → color) and typeColorFor (trailer type → color)
// are optional; without them the canvas behaves exactly as before.
export default function LaneMapCanvas({ lanes, cities, colorFor, widthFor, selectedKey, onSelect, laneColorFor, typeColorFor }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null) // { key, x, y }

  // Project once per lane set; lanes that don't land on the AlbersUSA frame
  // are dropped here (defensive — all coords are US already).
  const drawn = useMemo(() => {
    const out = []
    for (const lane of lanes) {
      if (!lane.geocoded) continue
      const a = projection([lane.oCoord[1], lane.oCoord[0]])
      const b = projection([lane.dCoord[1], lane.dCoord[0]])
      if (!a || !b) continue
      out.push({ lane, a, b, d: arcPath(a, b, lane.typeIndex || 0) })
    }
    // Thin lanes first so the money lanes draw on top.
    return out.sort((x, y) => x.lane.revenue - y.lane.revenue)
  }, [lanes])

  const cityDots = useMemo(() => {
    const out = []
    for (const c of cities) {
      const p = projection([c.coord[1], c.coord[0]])
      if (p) out.push({ ...c, p })
    }
    const maxRev = Math.max(...out.map(c => c.revenue), 1)
    for (const c of out) c.r = 1.1 + Math.sqrt(c.revenue / maxRev) * 3.6
    const labeled = new Set([...out].sort((a, b) => b.revenue - a.revenue).slice(0, 8).map(c => c.city))
    return { dots: out, labeled }
  }, [cities])

  const hoveredLane = hover ? drawn.find(d => d.lane.key === hover.key)?.lane : null
  const dimmed = (key) => (selectedKey && key !== selectedKey) || (!selectedKey && hover && hover.key !== key)

  // Container width is captured here (event time) so render never touches
  // the ref — the tooltip clamp uses the stored value.
  function move(e, key) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({ key, x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width })
  }

  return (
    <div ref={wrapRef} className="relative">
      <style>{`@keyframes laneFlow { to { stroke-dashoffset: -56; } }`}</style>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block select-none" role="img" aria-label="US map of freight lanes">
        {/* Land */}
        <path d={NATION_OUTLINE} className="fill-gray-100 dark:fill-white/[0.025]" />
        <path d={STATES_OUTLINE} fill="none" strokeWidth="0.75" className="stroke-gray-300 dark:stroke-white/[0.07]" />
        <path d={NATION_OUTLINE} fill="none" strokeWidth="1" className="stroke-gray-300 dark:stroke-white/[0.12]" />

        {/* Arcs */}
        {drawn.map(({ lane, a, d }) => {
          const w = widthFor(lane)
          const color = laneColorFor ? laneColorFor(lane) : colorFor(lane.rpm)
          const active = lane.key === selectedKey || lane.key === hover?.key
          // Heavy lanes draw near-solid; the long tail of one-load lanes
          // fades back so the picture reads as hierarchy, not spaghetti.
          const t = (w - WIDTH_RANGE[0]) / (WIDTH_RANGE[1] - WIDTH_RANGE[0])
          const baseOpacity = dimmed(lane.key) ? 0.07 : 0.2 + t * 0.72
          if (!d) {
            // Same-city move: a small ring at the city instead of an arc.
            return (
              <circle key={lane.key} cx={a[0]} cy={a[1]} r={6} fill="none" stroke={color} strokeWidth={w}
                opacity={baseOpacity} className="transition-opacity duration-200" />
            )
          }
          return (
            <g key={lane.key}>
              <path d={d} fill="none" stroke={color} strokeWidth={active ? w + 0.75 : w} strokeLinecap="round"
                opacity={active ? 1 : baseOpacity} className="transition-opacity duration-200"
                style={active ? { filter: `drop-shadow(0 0 6px ${color})` } : undefined} />
              {active && (
                <path d={d} fill="none" strokeWidth={Math.max(1, w * 0.4)} strokeLinecap="round"
                  strokeDasharray="7 21" opacity="0.9" className="stroke-gray-900/60 dark:stroke-white"
                  style={{ animation: 'laneFlow 1.1s linear infinite' }} />
              )}
              {/* Fat invisible hit area */}
              <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(11, w + 8)} className="cursor-pointer"
                onMouseMove={e => move(e, lane.key)} onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(lane.key === selectedKey ? null : lane.key)} />
            </g>
          )
        })}

        {/* City dots + top-city labels */}
        {cityDots.dots.map(c => (
          <g key={c.city} pointerEvents="none">
            <circle cx={c.p[0]} cy={c.p[1]} r={c.r} className="fill-gray-500 dark:fill-slate-300" opacity="0.5" />
            {cityDots.labeled.has(c.city) && (
              <text x={c.p[0]} y={c.p[1] - c.r - 4} textAnchor="middle" strokeWidth="3"
                className="fill-gray-500 dark:fill-slate-400 stroke-white dark:stroke-[#0a0a18] text-[11px] font-medium"
                style={{ paintOrder: 'stroke' }}>
                {c.city.split(',')[0]}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredLane && hover && (
        <div
          className="pointer-events-none absolute z-20 rounded-xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-[#12132e]/95 backdrop-blur px-3 py-2 shadow-2xl"
          style={{ left: Math.min(hover.x + 14, (hover.w || 600) - 215), top: Math.max(hover.y - 64, 6), width: 205 }}
        >
          <p className="text-xs font-semibold text-gray-900 dark:text-white leading-snug">{hoveredLane.origin} <span className="text-orange-500">→</span> {hoveredLane.destination}</p>
          <div className="mt-1 flex items-baseline justify-between text-[11px] text-gray-500 dark:text-slate-400">
            <span>{hoveredLane.loads} load{hoveredLane.loads === 1 ? '' : 's'} · {fmtNum(hoveredLane.miles)} mi</span>
            <span className="font-mono">{fmtMoney(hoveredLane.revenue)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-400 dark:text-slate-500">$/mile</span>
            <span className="font-mono font-semibold" style={{ color: colorFor(hoveredLane.rpm) }}>{fmtRpm(hoveredLane.rpm)}{hoveredLane.rpm != null && '/mi'}</span>
          </div>
          {hoveredLane.trailerType && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-400 dark:text-slate-500">Trailer</span>
              <span className="font-medium text-gray-700 dark:text-slate-300 inline-flex items-center gap-1.5">
                {typeColorFor && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: typeColorFor(hoveredLane.trailerType) }} />}
                {hoveredLane.trailerType}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
