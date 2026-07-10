import { useMemo, useState } from 'react'
import { MAP_W, MAP_H, projection, STATES_OUTLINE, NATION_OUTLINE } from '../lanes/mapShared'
import { LANE_STATUS, HOME_YARD_HEX } from './dedicatedData'

// Facility map — same AlbersUSA frame as the Lane Flow Map. Each dedicated lane
// is a warehouse-to-warehouse route: an origin marker and a destination marker
// joined by one connecting line, colored by P&L status, each marker sized by the
// trailers parked there. Home Yard is a neutral rotated square (the true-idle
// bucket) — NOT a lane, draws no routes. Selecting a lane isolates it.

const ENTER_STAGGER_MS = 70

// Quadratic arc between two projected points, lifted perpendicular to the chord.
function arcPath(a, b) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const lift = Math.min(48, len * 0.16)
  return `M${a[0]},${a[1]} Q${mx - (dy / len) * lift},${my + (dx / len) * lift} ${b[0]},${b[1]}`
}
const markerR = (n) => 9 + Math.min(Number(n) || 0, 12) * 1.7

function agingAt(lane, position) {
  return (lane.trailers || []).filter(t => t.position === position && t.aging).length
}

// A single facility marker (origin/destination endpoint of a lane).
function FacilityMarker({ f, color, sel, aging, showLabel, onSelect, laneName, position }) {
  const p = projection([Number(f.lng), Number(f.lat)])
  if (!p) return null
  const r = markerR(f.trailers)
  return (
    <g className={`dl-pin ${sel ? 'sel' : ''}`} onClick={onSelect}
      role="button" tabIndex={0} aria-label={`${laneName} ${position} — ${f.name || `${f.city}, ${f.state}`}, ${f.trailers} trailers`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}>
      <circle cx={p[0]} cy={p[1]} r={r + 11} fill={color} opacity={sel ? 0.16 : 0.06} className="transition-opacity duration-300" />
      {sel && <circle className="dl-ring" cx={p[0]} cy={p[1]} r={r + 6} fill="none" stroke={color} strokeWidth="1.8" strokeDasharray="6 5" />}
      <g className="dl-pin-core">
        <circle cx={p[0]} cy={p[1]} r={r} fill={color} stroke="#fff" strokeWidth="2.5" className="dark:stroke-[#0d0d1f]"
          style={sel ? { filter: `drop-shadow(0 0 8px ${color})` } : undefined} />
        <text x={p[0]} y={p[1] + 4.5} textAnchor="middle" className="fill-white font-bold" fontSize="13">{f.trailers || 0}</text>
        {aging > 0 && (
          <g pointerEvents="none">
            <circle cx={p[0] + r * 0.78} cy={p[1] - r * 0.78} r="6.5" fill="#ef4444" stroke="#fff" strokeWidth="1.5" className="dark:stroke-[#0d0d1f]" />
            <text x={p[0] + r * 0.78} y={p[1] - r * 0.78 + 3} textAnchor="middle" className="fill-white font-bold" fontSize="8.5">{aging}</text>
          </g>
        )}
      </g>
      {showLabel && (
        <>
          <text x={p[0]} y={p[1] - r - 18} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200 font-bold" fontSize="11">
            {f.name || `${f.city}, ${f.state}`}
          </text>
          <text x={p[0]} y={p[1] - r - 7} textAnchor="middle" className="fill-slate-400 dark:fill-slate-500 font-medium" fontSize="9">
            {position} · {f.city}, {f.state}
          </text>
        </>
      )}
    </g>
  )
}

export default function DedicatedMap({ lanes, homeYard, selectedId, onSelect }) {
  const [hoverId, setHoverId] = useState(null)

  const routes = useMemo(() =>
    (lanes || []).map(lane => {
      const o = projection([Number(lane.origin.lng), Number(lane.origin.lat)])
      const d = projection([Number(lane.destination.lng), Number(lane.destination.lat)])
      if (!o || !d) return null
      return { lane, o, d, color: (LANE_STATUS[lane.status] || LANE_STATUS.inactive).hex }
    }).filter(Boolean), [lanes])

  const home = useMemo(() => {
    const p = projection([Number(homeYard.lng), Number(homeYard.lat)])
    return p ? { p, r: 10 + Math.min(homeYard.count || 0, 40) * 0.35 } : null
  }, [homeYard])

  const anySelected = selectedId != null
  // A specific lane selected → isolate it (hide/dim everything else).
  const laneSelected = anySelected && selectedId !== 'home'
  const dimLane = id => (laneSelected && selectedId !== id && hoverId !== id) || (selectedId === 'home')
  const dimHome = laneSelected

  return (
    <div className="relative w-full aspect-[975/610]">
      <style>{`
        @keyframes dlPinPop { 0% { opacity: 0; transform: scale(0); } 70% { transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes dlArcFlow { to { stroke-dashoffset: -40; } }
        @keyframes dlRingSpin { to { transform: rotate(360deg); } }
        .dl-pin { cursor: pointer; animation: dlPinPop .5s cubic-bezier(.22,1.4,.36,1) both; transform-box: fill-box; transform-origin: center; outline: none; }
        .dl-pin:focus-visible .dl-pin-core { transform: scale(1.12); }
        .dl-pin-core { transition: transform .25s cubic-bezier(.22,1.4,.36,1); transform-box: fill-box; transform-origin: center; }
        .dl-pin:hover .dl-pin-core, .dl-pin.sel .dl-pin-core { transform: scale(1.12); }
        .dl-ring { animation: dlRingSpin 14s linear infinite; transform-box: fill-box; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) { .dl-pin, .dl-ring { animation: none; } .dl-arc-dash { animation: none !important; } }
      `}</style>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full block select-none" role="img" aria-label="US map of dedicated lane routes">
        <path d={NATION_OUTLINE} className="fill-gray-100 dark:fill-white/[0.025]" />
        <path d={STATES_OUTLINE} fill="none" strokeWidth="0.75" className="stroke-gray-300 dark:stroke-white/[0.07]" />
        <path d={NATION_OUTLINE} fill="none" strokeWidth="1" className="stroke-gray-300 dark:stroke-white/[0.12]" />

        {/* Warehouse-to-warehouse route lines (origin ↔ destination), one per lane. */}
        {routes.map(({ lane, o, d, color }) => {
          const active = selectedId === lane.lane_id || hoverId === lane.lane_id
          return (
            <g key={`route-${lane.lane_id}`} pointerEvents="none">
              <path d={arcPath(o, d)} fill="none" stroke={color} strokeWidth={active ? 2 : 1.2} strokeLinecap="round"
                opacity={active ? 0.9 : dimLane(lane.lane_id) ? 0.05 : 0.35} className="transition-opacity duration-300" />
              {active && (
                <path d={arcPath(o, d)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"
                  strokeDasharray="2 18" opacity="0.9" className="dl-arc-dash" style={{ animation: 'dlArcFlow 1.2s linear infinite' }} />
              )}
            </g>
          )
        })}

        {/* Home Yard — neutral rotated square, true-idle bucket. No routes. */}
        {home && (
          <g className={`dl-pin ${selectedId === 'home' ? 'sel' : ''}`} opacity={dimHome ? 0.3 : 1}
            onClick={() => onSelect(selectedId === 'home' ? null : 'home')}
            onMouseEnter={() => setHoverId('home')} onMouseLeave={() => setHoverId(null)}
            role="button" tabIndex={0} aria-label={`Home Yard, ${homeYard.city}, ${homeYard.state} — ${homeYard.count} trailers, true idle`}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selectedId === 'home' ? null : 'home') } }}>
            {selectedId === 'home' && (
              <rect className="dl-ring" x={home.p[0] - home.r - 7} y={home.p[1] - home.r - 7} width={(home.r + 7) * 2} height={(home.r + 7) * 2}
                fill="none" stroke={HOME_YARD_HEX} strokeWidth="1.6" strokeDasharray="5 4" transform={`rotate(45 ${home.p[0]} ${home.p[1]})`} />
            )}
            <g className="dl-pin-core">
              <rect x={home.p[0] - home.r} y={home.p[1] - home.r} width={home.r * 2} height={home.r * 2} rx="4"
                fill={HOME_YARD_HEX} stroke="#fff" strokeWidth="2" transform={`rotate(45 ${home.p[0]} ${home.p[1]})`} className="dark:stroke-[#0d0d1f]" />
              <text x={home.p[0]} y={home.p[1] + 4} textAnchor="middle" className="fill-white font-bold" fontSize="12">{homeYard.count}</text>
            </g>
            <text x={home.p[0]} y={home.p[1] - home.r - 18} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200 font-bold" fontSize="11">Home Yard</text>
            <text x={home.p[0]} y={home.p[1] - home.r - 7} textAnchor="middle" className="fill-slate-400 dark:fill-slate-500 font-medium" fontSize="9">
              {homeYard.city}, {homeYard.state} · true idle
            </text>
          </g>
        )}

        {/* Facility markers — origin + destination per lane. Labels always on for
            the selected lane; on overview only when nothing is selected. */}
        {routes.map(({ lane, color }, i) => {
          const sel = selectedId === lane.lane_id
          const show = sel || !anySelected
          return (
            <g key={`ends-${lane.lane_id}`} style={{ animationDelay: `${(i + 1) * ENTER_STAGGER_MS}ms` }}
              opacity={dimLane(lane.lane_id) ? 0.3 : 1}
              onMouseEnter={() => setHoverId(lane.lane_id)} onMouseLeave={() => setHoverId(null)}>
              <FacilityMarker f={lane.origin} color={color} sel={sel} aging={agingAt(lane, 'origin')} showLabel={show}
                laneName={lane.name} position="origin" onSelect={() => onSelect(sel ? null : lane.lane_id)} />
              <FacilityMarker f={lane.destination} color={color} sel={sel} aging={agingAt(lane, 'destination')} showLabel={show}
                laneName={lane.name} position="destination" onSelect={() => onSelect(sel ? null : lane.lane_id)} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
