import { useMemo, useState } from 'react'
import { MAP_W, MAP_H, projection, STATES_OUTLINE, NATION_OUTLINE } from '../lanes/mapShared'
import { LANE_STATUS, HOME_YARD_HEX } from './dedicatedData'

// Facility map — same AlbersUSA frame as the Lane Flow Map. Each dedicated lane
// is a warehouse-to-warehouse route: an origin marker and a destination marker
// joined by one connecting line, colored by P&L status, each marker sized by the
// trailers parked there. Home Yard is a neutral rotated square (the true-idle
// bucket) — NOT a lane, draws no routes. Selecting a lane isolates it.

const ENTER_STAGGER_MS = 70
// BUDDY orange — ring/ping accent for the neutral Home Yard (not a P&L status).
const HOME_RING_HEX = '#F97316'
// Facility identity key (name+address+city+state, normalized) — shared by the
// map dedupe and the selected-lane onboarding chip.
const norm = (s) => (s || '').trim().toLowerCase()
const facilityKey = (f) => `${norm(f.name)}|${norm(f.address)}|${norm(f.city)}|${norm(f.state)}`

// Radar ping — a continuous sonar that pulses while the marker is selected. Two
// rings offset by half the cycle (.p2) so a new pulse starts as the prior fades,
// each expanding to 1.7× while fading out. Mounted only while selected, so the
// loop stops (element removed) on deselect and restarts on selection change.
function RadarPing({ cx, cy, r, color }) {
  return (
    <g pointerEvents="none" aria-hidden="true">
      <circle className="dl-ping" cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="2.5" />
      <circle className="dl-ping p2" cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="2.5" />
    </g>
  )
}

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

// Worst P&L status wins when one facility is shared by several lanes, so a
// problem lane's yard still flags red even if another lane using it is fine.
const STATUS_SEVERITY = { underwater: 3, watch: 2, profitable: 1, inactive: 0 }

// A single facility marker. `fac` is a deduped facility: one physical yard that
// may be the endpoint of several lanes (trailers/aging summed across them).
function FacilityMarker({ fac, color, sel, showLabel, onSelect, delay, pingKey, chip }) {
  const { p, trailers, aging, role, f } = fac
  const r = markerR(trailers)
  const roleUpper = role.toUpperCase()
  const chipW = chip ? chip.length * 6.1 + 14 : 0
  return (
    <g className={`dl-pin ${sel ? 'sel' : ''}`} onClick={onSelect} style={delay ? { animationDelay: delay } : undefined}
      role="button" tabIndex={0} aria-label={`${f.name || `${f.city}, ${f.state}`} — ${role}, ${trailers} trailers`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}>
      <circle cx={p[0]} cy={p[1]} r={r + 11} fill={color} opacity={sel ? 0.16 : 0.06} className="transition-opacity duration-300" />
      {sel && (
        <>
          <circle className="dl-ring" cx={p[0]} cy={p[1]} r={r + 6} fill="none" stroke={color} strokeWidth="1.8" strokeDasharray="5 4" />
          <RadarPing key={pingKey} cx={p[0]} cy={p[1]} r={r + 6} color={color} />
        </>
      )}
      <g className="dl-pin-core">
        <circle cx={p[0]} cy={p[1]} r={r} fill={color} stroke="#fff" strokeWidth="2.5" className="dark:stroke-[#0d0d1f]"
          style={sel ? { filter: `drop-shadow(0 0 8px ${color})` } : undefined} />
        <text x={p[0]} y={p[1] + 4.5} textAnchor="middle" className="fill-white font-bold" fontSize="13">{trailers || 0}</text>
        {aging > 0 && (
          <g pointerEvents="none">
            <circle cx={p[0] + r * 0.78} cy={p[1] - r * 0.78} r="6.5" fill="#ef4444" stroke="#fff" strokeWidth="1.5" className="dark:stroke-[#0d0d1f]" />
            <text x={p[0] + r * 0.78} y={p[1] - r * 0.78 + 3} textAnchor="middle" className="fill-white font-bold" fontSize="8.5">{aging}</text>
          </g>
        )}
      </g>
      {/* Onboarding chip (selected lane's origin) — staged of broker target. */}
      {chip && (
        <g pointerEvents="none">
          <rect x={p[0] - chipW / 2} y={p[1] + r + 4} width={chipW} height="16" rx="8" fill={color} stroke="#fff" strokeWidth="1.5" className="dark:stroke-[#0d0d1f]" />
          <text x={p[0]} y={p[1] + r + 15.5} textAnchor="middle" className="fill-white font-bold" fontSize="9.5">{chip}</text>
        </g>
      )}
      {showLabel && (
        <>
          <text x={p[0]} y={p[1] - r - 18} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200 font-bold" fontSize="11">
            {f.name || `${f.city}, ${f.state}`}
          </text>
          <text x={p[0]} y={p[1] - r - 7} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300 font-medium" fontSize="10">
            {/* Role word emphasized so ORIGIN / DESTINATION reads at a glance. */}
            <tspan className="font-semibold" fontSize="11">{roleUpper}</tspan>
            <tspan> · {f.city}, {f.state}</tspan>
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

  // Dedupe facilities across all lanes so each physical yard renders once, even
  // when it's the shared origin/destination of several lanes. Keyed by identity
  // (name + address + city + state), NOT id, so the legacy triplicate rows that
  // share an identity collapse to one marker. Trailer counts and aging badges
  // sum across the lanes that use it; color = worst lane status.
  const facilities = useMemo(() => {
    const byId = new Map()
    routes.forEach(({ lane }) => {
      const status = lane.status
      ;[['origin', lane.origin], ['destination', lane.destination]].forEach(([role, f]) => {
        const id = facilityKey(f)
        let acc = byId.get(id)
        if (!acc) {
          const p = projection([Number(f.lng), Number(f.lat)])
          if (!p) return
          acc = { id, f, p, trailers: 0, aging: 0, roles: new Set(), laneIds: new Set(), status: 'inactive' }
          byId.set(id, acc)
        }
        acc.trailers += Number(f.trailers) || 0
        acc.aging += agingAt(lane, role)
        acc.roles.add(role)
        acc.laneIds.add(lane.lane_id)
        if ((STATUS_SEVERITY[status] ?? 0) > (STATUS_SEVERITY[acc.status] ?? 0)) acc.status = status
      })
    })
    // Neutral label when a facility is origin for one lane but destination for another.
    return [...byId.values()].map(a => ({ ...a, role: a.roles.size > 1 ? 'origin / destination' : [...a.roles][0] }))
  }, [routes])

  const home = useMemo(() => {
    const p = projection([Number(homeYard.lng), Number(homeYard.lat)])
    return p ? { p, r: 10 + Math.min(homeYard.count || 0, 40) * 0.35 } : null
  }, [homeYard])

  const anySelected = selectedId != null
  // A specific lane selected → isolate it (hide/dim everything else).
  const laneSelected = anySelected && selectedId !== 'home'
  // Selected lane's origin identity → drives the onboarding chip on that marker.
  const selLane = laneSelected ? (lanes || []).find(l => l.lane_id === selectedId) : null
  const selOriginKey = selLane?.origin ? facilityKey(selLane.origin) : null
  const dimLane = id => (laneSelected && selectedId !== id && hoverId !== id) || (selectedId === 'home')
  const dimHome = laneSelected

  return (
    <div className="relative w-full aspect-[975/610]">
      <style>{`
        @keyframes dlPinPop { 0% { opacity: 0; transform: scale(0); } 70% { transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes dlArcFlow { to { stroke-dashoffset: -40; } }
        @keyframes dlPing { from { transform: scale(1); opacity: .5; } to { transform: scale(1.7); opacity: 0; } }
        .dl-pin { cursor: pointer; animation: dlPinPop .5s cubic-bezier(.22,1.4,.36,1) both; transform-box: fill-box; transform-origin: center; outline: none; }
        .dl-pin:focus-visible .dl-pin-core { transform: scale(1.12); }
        .dl-pin-core { transition: transform .25s cubic-bezier(.22,1.4,.36,1); transform-box: fill-box; transform-origin: center; }
        .dl-pin:hover .dl-pin-core, .dl-pin.sel .dl-pin-core { transform: scale(1.12); }
        /* Persistent selected ring — static, appears in place (no fly-in). */
        /* Radar ping — loops while selected (element unmounts on deselect, so it
           stops). Two rings offset by half the 2s cycle for a continuous sonar. */
        .dl-ping { transform-box: fill-box; transform-origin: center; opacity: 0; animation: dlPing 2s ease-out infinite; pointer-events: none; }
        .dl-ping.p2 { animation-delay: 1s; }
        @media (prefers-reduced-motion: reduce) { .dl-pin { animation: none; } .dl-ping { display: none; } .dl-arc-dash { animation: none !important; } }
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
              <>
                <rect className="dl-ring" x={home.p[0] - home.r - 7} y={home.p[1] - home.r - 7} width={(home.r + 7) * 2} height={(home.r + 7) * 2}
                  fill="none" stroke={HOME_RING_HEX} strokeWidth="1.6" strokeDasharray="5 4" transform={`rotate(45 ${home.p[0]} ${home.p[1]})`} />
                <RadarPing cx={home.p[0]} cy={home.p[1]} r={home.r + 7} color={HOME_RING_HEX} />
              </>
            )}
            <g className="dl-pin-core">
              <rect x={home.p[0] - home.r} y={home.p[1] - home.r} width={home.r * 2} height={home.r * 2} rx="4"
                fill={HOME_YARD_HEX} stroke="#fff" strokeWidth="2" transform={`rotate(45 ${home.p[0]} ${home.p[1]})`} className="dark:stroke-[#0d0d1f]" />
              <text x={home.p[0]} y={home.p[1] + 4} textAnchor="middle" className="fill-white font-bold" fontSize="12">{homeYard.count}</text>
            </g>
            <text x={home.p[0]} y={home.p[1] - home.r - 18} textAnchor="middle" className="fill-slate-700 dark:fill-slate-200 font-bold uppercase" fontSize="11">Home Yard</text>
            <text x={home.p[0]} y={home.p[1] - home.r - 7} textAnchor="middle" className="fill-slate-600 dark:fill-slate-300 font-medium uppercase" fontSize="10">
              {homeYard.city}, {homeYard.state} · true idle
            </text>
          </g>
        )}

        {/* Facility markers — one per unique yard (deduped across lanes). Labels
            always on for the selected lane's endpoints; on overview when nothing
            is selected. Selecting/hovering a lane still isolates its two yards. */}
        {facilities.map((fac, i) => {
          const sel = laneSelected && fac.laneIds.has(selectedId)
          const dim = selectedId === 'home' ? true : (laneSelected && !fac.laneIds.has(selectedId))
          const show = !anySelected || sel
          const color = (LANE_STATUS[fac.status] || LANE_STATUS.inactive).hex
          // Click toggles: deselect if already showing this yard's lane, else pick one of its lanes.
          const handle = () => onSelect(sel ? null : [...fac.laneIds][0])
          // Onboarding chip on the selected lane's origin marker: staged / target.
          const chip = selOriginKey && fac.id === selOriginKey
            ? (selLane.required_trailers ? `${selLane.staged_count || 0}/${selLane.required_trailers} staged` : `${selLane.staged_count || 0} staged`)
            : null
          return (
            <g key={`fac-${fac.id}`} opacity={dim ? 0.3 : 1}
              onMouseEnter={() => setHoverId(fac.laneIds.size === 1 ? [...fac.laneIds][0] : null)} onMouseLeave={() => setHoverId(null)}>
              <FacilityMarker fac={fac} color={color} sel={sel} showLabel={show} onSelect={handle}
                delay={`${(i + 1) * ENTER_STAGGER_MS}ms`} pingKey={selectedId} chip={chip} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
