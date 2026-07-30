import { useEffect, useMemo, useRef, useState } from 'react'
import { PHASE_RADII, trackPath, PHASE_STATUS_LABEL } from './roadmapData'

// Theme-aware neutral classes for SVG fills/strokes (line colours stay inline hex).
const CARD_FILL = 'fill-white dark:fill-[#0d0d1f]'
const INK_STROKE = 'stroke-gray-900 dark:stroke-white'
const MUTED_FILL = 'fill-gray-400 dark:fill-slate-500'
const MUTED_STROKE = 'stroke-gray-400 dark:stroke-slate-600'
const LABEL_FILL = 'fill-gray-800 dark:fill-slate-200'
const LABEL_MUTED = 'fill-gray-400 dark:fill-slate-500'

const outerRadius = (phaseCount) => PHASE_RADII[Math.min(phaseCount, PHASE_RADII.length) - 1] || PHASE_RADII[0]

// Wrap a subtitle to two centred lines by balancing word length (no delimiter
// splitting, so any text works). Short strings stay on one line.
function balanceTwoLines(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (words.length <= 3) return words.length ? [words.join(' ')] : []
  const total = words.join(' ').length
  let acc = 0, cut = words.length
  for (let i = 0; i < words.length; i++) {
    acc += words[i].length + 1
    if (acc >= total / 2) { cut = i + 1; break }
  }
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')].filter(Boolean)
}

// Map a pointer event to SVG user-space x (handles scaling/letterboxing).
function svgX(svg, clientX, clientY) {
  const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY
  const m = svg.getScreenCTM()
  if (!m) return null
  return pt.matrixTransform(m.inverse()).x
}

export default function RoadmapMap({
  layout, initiatives, selectedId, onSelect, canEdit, dimmed, svgRef, onDragEnd,
  hubTitle = 'THE FULL PICTURE', hubSubtitle = '', onHubClick,
}) {
  const { ordered, laneYById, hubX, hubY, vbWidth, vbHeight } = layout
  const wrapRef = useRef(null)
  const [drag, setDrag] = useState(null)   // { id, x }
  const [hover, setHover] = useState(null)  // { it, left, top }
  const dragInfo = useRef(null)             // { id, offset }
  const movedRef = useRef(false)            // true when the last pointer gesture was a drag
  const hubLines = balanceTwoLines(hubSubtitle)

  const byId = useMemo(() => new Map(initiatives.map(it => [it.id, it])), [initiatives])
  const posX = (it) => (drag && drag.id === it.id ? drag.x : Number(it.pos_x) || 0)

  // "Building" stations orbit a slow arc. Freeze it when the viewer prefers
  // reduced motion, or when there are so many building at once (>6) that spinners
  // become noise rather than signal.
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  const buildingCount = useMemo(() => initiatives.filter(it => it.status === 'building' && it.flag !== 'parked').length, [initiatives])
  const staticArc = reduced || buildingCount > 6

  // Appearances: one per line the station touches.
  const appearances = useMemo(() => {
    const out = []
    for (const it of initiatives) {
      const lineIds = [it.primary_line_id, ...(it.extra_line_ids || [])].filter(id => laneYById[id] != null)
      for (const lineId of lineIds) out.push({ it, lineId, y: laneYById[lineId] })
    }
    return out
  }, [initiatives, laneYById])

  const lineColor = (id) => ordered.find(l => l.id === id)?.color || '#94a3b8'

  // ── drag (horizontal only) ─────────────────────────────────────────────────
  function startDrag(e, it) {
    if (!canEdit) return
    e.stopPropagation()
    const svg = svgRef.current
    const ux = svgX(svg, e.clientX, e.clientY)
    if (ux == null) return
    movedRef.current = false
    dragInfo.current = { id: it.id, offset: (Number(it.pos_x) || 0) - ux, startX: ux }
    setDrag({ id: it.id, x: Number(it.pos_x) || 0 })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }
  function onMove(e) {
    const info = dragInfo.current
    const svg = svgRef.current
    if (!info || !svg) return
    const ux = svgX(svg, e.clientX, e.clientY)
    if (ux == null) return
    if (Math.abs(ux - info.startX) > 4) movedRef.current = true  // distinguish drag from click
    let x = ux + info.offset
    x = Math.round(x / 10) * 10                       // snap to 10px grid
    x = Math.max(40, Math.min(hubX - 60, x))          // clamp
    setDrag({ id: info.id, x })
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    const info = dragInfo.current
    dragInfo.current = null
    setDrag((d) => {
      if (info && d && d.id === info.id) onDragEnd?.(info.id, d.x)
      return null
    })
  }

  function showHover(e, it) {
    const g = e.currentTarget
    const wrap = wrapRef.current
    if (!wrap) return
    const gr = g.getBoundingClientRect(), wr = wrap.getBoundingClientRect()
    setHover({ it, left: gr.left - wr.left + gr.width / 2, top: gr.top - wr.top })
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      {/* Orbit keyframes — the class rotates the arc <g> around its own centre.
          Reduced motion halts it here too, as a backstop to the JS check. */}
      <style>{`@keyframes roadmap-orbit{to{transform:rotate(360deg)}}.roadmap-orbit{animation:roadmap-orbit 4s linear infinite;transform-box:fill-box;transform-origin:center}@media (prefers-reduced-motion:reduce){.roadmap-orbit{animation:none}}`}</style>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        className="w-full h-auto select-none"
        style={{ touchAction: 'pan-y' }}
      >
        {/* Tracks */}
        {ordered.map((l) => (
          <path key={l.id} d={trackPath(l, laneYById[l.id], hubX, hubY)}
            fill="none" stroke={l.color} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round"
            opacity={l.is_active === false ? 0.4 : 1} />
        ))}

        {/* Dependency links (behind stations) */}
        {initiatives.flatMap((it) => (it.depends_on || []).map((depId) => {
          const dep = byId.get(depId)
          if (!dep) return null
          const x1 = posX(dep), y1 = laneYById[dep.primary_line_id]
          const x2 = posX(it), y2 = laneYById[it.primary_line_id]
          if (y1 == null || y2 == null) return null
          return <path key={`${depId}-${it.id}`} d={depPath(x1, y1, x2, y2)} fill="none"
            className={MUTED_STROKE} strokeWidth={2} strokeDasharray="6 6" strokeLinecap="round" opacity={0.4} />
        }))}

        {/* Interchange connectors (behind stations) */}
        {initiatives.map((it) => {
          const ys = [it.primary_line_id, ...(it.extra_line_ids || [])].map(id => laneYById[id]).filter(v => v != null)
          if (ys.length < 2) return null
          const x = posX(it)
          return <line key={`ix-${it.id}`} x1={x} y1={Math.min(...ys)} x2={x} y2={Math.max(...ys)}
            className={MUTED_STROKE} strokeWidth={2.5} opacity={0.3} />
        })}

        {/* Hub — editable title/subtitle from settings */}
        <g style={{ cursor: onHubClick ? 'pointer' : 'default' }}
          onClick={onHubClick ? (e) => { e.stopPropagation(); onHubClick() } : undefined}>
          <circle cx={hubX} cy={hubY} r={27} className={`${CARD_FILL} ${INK_STROKE}`} strokeWidth={5} />
          <circle cx={hubX} cy={hubY} r={13} fill="#F97316" />
          <text x={hubX} y={hubY + 47} textAnchor="middle" className="fill-gray-900 dark:fill-white"
            style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '.05em' }}>{hubTitle}</text>
          {hubLines.map((ln, i) => (
            <text key={i} x={hubX} y={hubY + 64 + i * 14} textAnchor="middle" className={LABEL_MUTED} style={{ fontSize: 11 }}>{ln}</text>
          ))}
        </g>

        {/* Stations */}
        {appearances.map(({ it, lineId, y }) => (
          <Station
            key={`${it.id}-${lineId}`}
            it={it} x={posX(it)} y={y} color={lineColor(lineId)}
            selected={selectedId === it.id}
            dim={dimmed ? dimmed(it) : false}
            draggable={canEdit} staticArc={staticArc}
            onPointerDown={(e) => startDrag(e, it)}
            onClick={(e) => { e.stopPropagation(); if (movedRef.current) { movedRef.current = false; return } onSelect?.(it.id) }}
            onMouseEnter={(e) => showHover(e, it)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hover && <HoverCard hover={hover} />}
    </div>
  )
}

// 45°-only dependency routing: horizontal, then a 45° diagonal, then horizontal.
function depPath(x1, y1, x2, y2) {
  if (y1 === y2) return `M ${x1} ${y1} H ${x2}`
  const dir = x2 >= x1 ? 1 : -1
  const diag = Math.abs(y2 - y1)
  const midX = x2 - dir * diag
  return `M ${x1} ${y1} H ${midX} L ${x2} ${y2}`
}

// Polar point with 0° at the top (12 o'clock), clockwise.
function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)] }
function arcPath(cx, cy, r, startDeg, sweepDeg) {
  const [x0, y0] = polar(cx, cy, r, startDeg)
  const [x1, y1] = polar(cx, cy, r, startDeg + sweepDeg)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

// A ~100° arc with an arrowhead, orbiting just outside the outer ring — the
// "being built right now" marker. An invisible full circle anchors the group's
// bounding box on the station so `transform-box: fill-box` orbits the centre.
function BuildingArc({ x, y, r, color, animate }) {
  const rr = r + 7
  const start = -50, sweep = 100
  const end = start + sweep
  const [ex, ey] = polar(x, y, rr, end)
  const a = (end - 90) * Math.PI / 180
  const tang = [-Math.sin(a), Math.cos(a)] // clockwise tangent (direction of travel)
  const norm = [Math.cos(a), Math.sin(a)]  // outward radius
  const s = 5
  const tip = [ex + tang[0] * s, ey + tang[1] * s]
  const b1 = [ex + norm[0] * s * 0.7, ey + norm[1] * s * 0.7]
  const b2 = [ex - norm[0] * s * 0.7, ey - norm[1] * s * 0.7]
  const pts = [tip, b1, b2].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  return (
    <g className={animate ? 'roadmap-orbit' : undefined} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
      {/* radius clears the arrowhead so the bbox stays centred on the station */}
      <circle cx={x} cy={y} r={rr + 6} fill="none" stroke="none" />
      <path d={arcPath(x, y, rr, start, sweep)} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" opacity={0.9} />
      <polygon points={pts} fill={color} opacity={0.9} />
    </g>
  )
}

function Station({ it, x, y, color, selected, dim, draggable, staticArc, onPointerDown, onClick, onMouseEnter, onMouseLeave }) {
  const phases = [...(it.phases || [])].sort((a, b) => a.phase_no - b.phase_no)
  const count = phases.length || 1
  const shown = Math.min(count, PHASE_RADII.length)
  const R = outerRadius(count)
  const parked = it.flag === 'parked'
  const dash = parked ? '3.6 3.2' : undefined

  const rings = []
  // Outermost first so inner paints on top.
  for (let i = shown - 1; i >= 0; i--) {
    const r = PHASE_RADII[i]
    const ph = phases[i]
    const done = ph?.status === 'done'
    if (i === 0) {
      rings.push(
        <circle key="core" cx={x} cy={y} r={r}
          fill={done ? color : undefined} className={done ? '' : CARD_FILL}
          stroke={color} strokeWidth={done ? 0 : 2} strokeOpacity={done ? 1 : 0.5}
          strokeDasharray={!done ? dash : undefined} />,
      )
    } else {
      rings.push(
        <circle key={`r${i}`} cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={4}
          strokeOpacity={done ? 1 : 0.22} strokeDasharray={!done ? dash : undefined} />,
      )
    }
  }

  const labelLines = String(it.short_label || it.name || '').split('\n')
  const live = it.status === 'live'

  return (
    <g
      style={{ cursor: draggable ? 'grab' : 'pointer', opacity: dim ? 0.28 : 1, transition: 'opacity .2s' }}
      onPointerDown={onPointerDown} onClick={onClick}
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
    >
      {selected && <circle cx={x} cy={y} r={R + 12} fill={color} opacity={0.15} />}
      {rings}

      {/* Building marker — below the badges in z-order so needs-fix paints on top.
          Parked is 'building [parked]': keep the dashed rings, but stop the motion. */}
      {it.status === 'building' && it.flag !== 'parked' && <BuildingArc x={x} y={y} r={R} color={color} animate={!staticArc} />}

      {/* >4 phases → count badge at lower-right of the outer ring */}
      {count > PHASE_RADII.length && (
        <g>
          <circle cx={x + R * 0.72} cy={y + R * 0.72} r={7} fill={color} />
          <text x={x + R * 0.72} y={y + R * 0.72 + 3} textAnchor="middle" fill="#fff" style={{ fontSize: 9, fontWeight: 700 }}>{count}</text>
        </g>
      )}

      {/* needs_fix flag */}
      {it.flag === 'needs_fix' && (
        <g>
          <circle cx={x + R * 0.72} cy={y - R * 0.72} r={5.8} fill="#DC2626" />
          <text x={x + R * 0.72} y={y - R * 0.72 + 3} textAnchor="middle" fill="#fff" style={{ fontSize: 8.5, fontWeight: 800 }}>!</text>
        </g>
      )}

      {/* Labels — always below the track */}
      <text x={x} y={y + R + 20} textAnchor="middle"
        className={parked ? LABEL_MUTED : LABEL_FILL}
        style={{ fontSize: 14.5, fontWeight: live ? 600 : 400 }}>
        {labelLines.map((ln, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 14.5}>{ln}</tspan>)}
      </text>
    </g>
  )
}

const PH_STATUS_CLR = { done: 'text-emerald-600 dark:text-emerald-400', building: 'text-amber-600 dark:text-amber-400', planned: 'text-gray-400 dark:text-slate-500' }

function HoverCard({ hover }) {
  const { it, left, top } = hover
  const phases = [...(it.phases || [])].sort((a, b) => a.phase_no - b.phase_no)
  return (
    <div
      className="pointer-events-none absolute z-30 w-max max-w-xs -translate-x-1/2 -translate-y-full rounded-lg bg-gray-900 dark:bg-black text-white shadow-2xl px-3 py-2.5 text-xs"
      style={{ left, top: top - 10 }}
    >
      <div className="font-semibold text-[13px] mb-1">{it.name}</div>
      {phases.length <= 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-slate-300">{phases[0]?.name || 'Phase 1'}</span>
          <span className={`ml-auto ${PH_STATUS_CLR[phases[0]?.status] || 'text-slate-400'}`}>{PHASE_STATUS_LABEL[phases[0]?.status] || '—'}</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {phases.map((p) => (
            <div key={p.id} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-semibold">{p.phase_no}</span>
              <div className="min-w-0">
                <div className="leading-tight">{p.name}</div>
                {p.description && <div className="text-slate-400 leading-tight">{p.description}</div>}
              </div>
              <span className={`ml-auto shrink-0 ${PH_STATUS_CLR[p.status] || 'text-slate-400'}`}>{PHASE_STATUS_LABEL[p.status]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
