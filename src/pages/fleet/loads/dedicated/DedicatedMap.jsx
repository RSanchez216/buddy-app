import { useMemo, useState } from 'react'
import { MAP_W, MAP_H, projection, STATES_OUTLINE, NATION_OUTLINE } from '../lanes/mapShared'
import { LANE_STATUS, HOME_YARD_HEX } from '../../../../data/dedicatedLanesMock'

// Facility map — the same AlbersUSA frame as the Lane Flow Map, but the story
// here is *where trailers sit*, not where loads move. One marker per dedicated
// lane (size = staged trailers, color = P&L status), plus the neutral Home
// Yard marker (the true-idle bucket). Soft supply arcs trace Home Yard → each
// facility so the network reads as one system.

const ENTER_STAGGER_MS = 90

// Quadratic arc between two projected points, lifted perpendicular to the
// chord — same visual language as the Lane Flow Map's route arcs.
function arcPath(a, b) {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const lift = Math.min(48, len * 0.18)
  const cx = mx - (dy / len) * lift
  const cy = my + (dx / len) * lift
  return `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`
}

export default function DedicatedMap({ lanes, homeYard, selectedId, onSelect }) {
  const [hoverId, setHoverId] = useState(null)

  const pins = useMemo(() => {
    const out = []
    for (const lane of lanes) {
      const p = projection([lane.facility.lng, lane.facility.lat])
      if (!p) continue
      out.push({
        lane, p,
        r: 11 + lane.metrics.trailers * 2.4,
        aging: lane.trailers.filter(t => (t.flags || []).includes('AGING')).length,
      })
    }
    return out
  }, [lanes])

  const home = useMemo(() => {
    const p = projection([homeYard.lng, homeYard.lat])
    return p ? { p, r: 10 + homeYard.count * 0.8 } : null
  }, [homeYard])

  const anySelected = selectedId != null
  const dim = id => anySelected && selectedId !== id && hoverId !== id

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
        @media (prefers-reduced-motion: reduce) {
          .dl-pin { animation: none; }
          .dl-ring { animation: none; }
          .dl-arc-dash { animation: none !important; }
        }
      `}</style>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full block select-none" role="img"
        aria-label="US map of dedicated lane facilities">
        {/* Land */}
        <path d={NATION_OUTLINE} className="fill-gray-100 dark:fill-white/[0.025]" />
        <path d={STATES_OUTLINE} fill="none" strokeWidth="0.75" className="stroke-gray-300 dark:stroke-white/[0.07]" />
        <path d={NATION_OUTLINE} fill="none" strokeWidth="1" className="stroke-gray-300 dark:stroke-white/[0.12]" />

        {/* Supply arcs: Home Yard → each facility. Quiet by default; the
            selected lane's arc lights up and flows. */}
        {home && pins.map(({ lane, p }) => {
          const active = selectedId === lane.id || hoverId === lane.id
          const color = LANE_STATUS[lane.status].hex
          return (
            <g key={`arc-${lane.id}`} pointerEvents="none">
              <path d={arcPath(home.p, p)} fill="none" stroke={color}
                strokeWidth={active ? 1.8 : 1} strokeLinecap="round"
                opacity={active ? 0.85 : dim(lane.id) ? 0.06 : 0.18}
                className="transition-opacity duration-300" />
              {active && (
                <path d={arcPath(home.p, p)} fill="none" stroke={color} strokeWidth="1.8"
                  strokeLinecap="round" strokeDasharray="2 18" opacity="0.9"
                  className="dl-arc-dash" style={{ animation: 'dlArcFlow 1.2s linear infinite' }} />
              )}
            </g>
          )
        })}

        {/* Home Yard — deliberately NOT a status-colored circle: a neutral
            rotated-square "yard" so it can't be misread as a lane. */}
        {home && (
          <g className={`dl-pin ${selectedId === 'home' ? 'sel' : ''}`}
            style={{ animationDelay: '0ms' }}
            opacity={dim('home') ? 0.35 : 1}
            onClick={() => onSelect(selectedId === 'home' ? null : 'home')}
            onMouseEnter={() => setHoverId('home')} onMouseLeave={() => setHoverId(null)}
            role="button" tabIndex={0} aria-label={`Home Yard, ${homeYard.city}, ${homeYard.state} — ${homeYard.count} trailers, true idle`}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selectedId === 'home' ? null : 'home') } }}>
            {selectedId === 'home' && (
              <rect className="dl-ring" x={home.p[0] - home.r - 7} y={home.p[1] - home.r - 7}
                width={(home.r + 7) * 2} height={(home.r + 7) * 2}
                fill="none" stroke={HOME_YARD_HEX} strokeWidth="1.6" strokeDasharray="5 4"
                transform={`rotate(45 ${home.p[0]} ${home.p[1]})`} />
            )}
            <g className="dl-pin-core">
              <rect x={home.p[0] - home.r} y={home.p[1] - home.r} width={home.r * 2} height={home.r * 2}
                rx="4" fill={HOME_YARD_HEX} stroke="#fff" strokeWidth="2"
                transform={`rotate(45 ${home.p[0]} ${home.p[1]})`}
                className="dark:stroke-[#0d0d1f]" />
              <text x={home.p[0]} y={home.p[1] + 4} textAnchor="middle"
                className="fill-white font-bold" fontSize="12">{homeYard.count}</text>
            </g>
            <text x={home.p[0]} y={home.p[1] - home.r - 18} textAnchor="middle"
              className="fill-slate-700 dark:fill-slate-200 font-bold" fontSize="11">Home Yard</text>
            <text x={home.p[0]} y={home.p[1] - home.r - 7} textAnchor="middle"
              className="fill-slate-400 dark:fill-slate-500 font-medium" fontSize="9">
              {homeYard.city}, {homeYard.state} · true idle
            </text>
          </g>
        )}

        {/* Lane markers */}
        {pins.map(({ lane, p, r, aging }, i) => {
          const color = LANE_STATUS[lane.status].hex
          const sel = selectedId === lane.id
          return (
            <g key={lane.id} className={`dl-pin ${sel ? 'sel' : ''}`}
              style={{ animationDelay: `${(i + 1) * ENTER_STAGGER_MS}ms` }}
              opacity={dim(lane.id) ? 0.35 : 1}
              onClick={() => onSelect(sel ? null : lane.id)}
              onMouseEnter={() => setHoverId(lane.id)} onMouseLeave={() => setHoverId(null)}
              role="button" tabIndex={0}
              aria-label={`${lane.name}, ${lane.facility.city}, ${lane.facility.state} — ${lane.metrics.trailers} trailers, ${LANE_STATUS[lane.status].label}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sel ? null : lane.id) } }}>
              {/* soft halo */}
              <circle cx={p[0]} cy={p[1]} r={r + 12} fill={color} opacity={sel ? 0.16 : 0.07}
                className="transition-opacity duration-300" />
              {sel && (
                <circle className="dl-ring" cx={p[0]} cy={p[1]} r={r + 7} fill="none"
                  stroke={color} strokeWidth="1.8" strokeDasharray="6 5" />
              )}
              <g className="dl-pin-core">
                <circle cx={p[0]} cy={p[1]} r={r} fill={color} stroke="#fff" strokeWidth="2.5"
                  className="dark:stroke-[#0d0d1f]" style={sel ? { filter: `drop-shadow(0 0 8px ${color})` } : undefined} />
                <text x={p[0]} y={p[1] + 4.5} textAnchor="middle" className="fill-white font-bold" fontSize="13">
                  {lane.metrics.trailers}
                </text>
                {/* aging badge — money-losers visible from orbit */}
                {aging > 0 && (
                  <g pointerEvents="none">
                    <circle cx={p[0] + r * 0.78} cy={p[1] - r * 0.78} r="6.5" fill="#ef4444"
                      stroke="#fff" strokeWidth="1.5" className="dark:stroke-[#0d0d1f]" />
                    <text x={p[0] + r * 0.78} y={p[1] - r * 0.78 + 3} textAnchor="middle"
                      className="fill-white font-bold" fontSize="8.5">{aging}</text>
                  </g>
                )}
              </g>
              <text x={p[0]} y={p[1] - r - 19} textAnchor="middle"
                className="fill-slate-700 dark:fill-slate-200 font-bold" fontSize="11.5">{lane.name}</text>
              <text x={p[0]} y={p[1] - r - 8} textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500 font-medium" fontSize="9">
                {lane.facility.city}, {lane.facility.state}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
