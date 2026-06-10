import { useCallback, useEffect, useRef } from 'react'

// Generic cover-flow shell — knows nothing about drivers. Lays `items` out
// as a centered deck (focused card front, neighbors peeking at a reduced
// scale with a slight Y-rotation), and moves focus via the ◀ ▶ buttons,
// keyboard arrows, or a horizontal swipe. Per-truck / per-dispatcher /
// per-broker spotlights reuse this shell with a different renderCard.
//
// Cards beyond ±2 of focus aren't rendered at all — with ~100 drivers only
// 5 cards are ever in the DOM.

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function slotStyle(offset) {
  const abs = Math.abs(offset)
  const scale = abs === 0 ? 1 : abs === 1 ? 0.78 : 0.62
  const x = offset * 54 // % of card width per step
  const rot = offset === 0 ? 0 : offset < 0 ? 9 : -9
  return {
    transform: `translateX(-50%) translateX(${x}%) scale(${scale}) rotateY(${rot}deg)`,
    opacity: abs === 0 ? 1 : abs === 1 ? 0.45 : 0.14,
    zIndex: 30 - abs * 10,
    filter: abs === 0 ? 'none' : 'saturate(0.7) brightness(0.85)',
    transition: `transform 560ms ${EASE}, opacity 560ms ease, filter 560ms ease`,
  }
}

export default function SpotlightDeck({ items, focus, onFocusChange, renderCard, getKey }) {
  // Track the latest focus in a ref so held-down arrow keys (which can fire
  // faster than React re-renders) step once per event instead of once per
  // render.
  const focusRef = useRef(focus)
  useEffect(() => { focusRef.current = focus }, [focus])
  const step = useCallback((d) => {
    const next = Math.min(items.length - 1, Math.max(0, focusRef.current + d))
    if (next !== focusRef.current) {
      focusRef.current = next
      onFocusChange(next)
    }
  }, [items.length, onFocusChange])

  // Keyboard ◀ ▶ — skipped while typing in a control (e.g. the jump box).
  useEffect(() => {
    function onKey(e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  // Swipe: a mostly-horizontal drag of 60px+ slides the deck. Anything
  // shorter falls through as a normal click/scroll inside the card.
  const drag = useRef(null)
  function onPointerDown(e) { drag.current = { x: e.clientX, y: e.clientY } }
  function onPointerUp(e) {
    const d = drag.current
    drag.current = null
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1)
  }

  const atStart = focus <= 0
  const atEnd = focus >= items.length - 1

  return (
    <div className="relative" style={{ perspective: '1800px' }} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="relative h-[680px]" style={{ transformStyle: 'preserve-3d' }}>
        {items.map((item, i) => {
          const offset = i - focus
          if (Math.abs(offset) > 2) return null
          return (
            <div
              key={getKey(item)}
              className="absolute left-1/2 top-2 w-[min(860px,94vw)] will-change-transform"
              style={slotStyle(offset)}
              onClick={offset !== 0 ? () => onFocusChange(i) : undefined}
              role={offset !== 0 ? 'button' : undefined}
              aria-hidden={offset !== 0}
            >
              <div className={offset !== 0 ? 'cursor-pointer pointer-events-auto' : ''}>
                {renderCard(item, { focused: offset === 0, offset })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ◀ ▶ navigation */}
      <button
        onClick={() => step(-1)}
        disabled={atStart}
        aria-label="Previous"
        className="absolute left-1 sm:left-4 top-1/2 -translate-y-1/2 z-40 w-11 h-11 rounded-full flex items-center justify-center border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-[#11122b]/90 backdrop-blur text-gray-700 dark:text-slate-200 shadow-lg hover:scale-110 hover:border-orange-400/60 active:scale-95 disabled:opacity-25 disabled:hover:scale-100 disabled:cursor-default transition-all"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
      </button>
      <button
        onClick={() => step(1)}
        disabled={atEnd}
        aria-label="Next"
        className="absolute right-1 sm:right-4 top-1/2 -translate-y-1/2 z-40 w-11 h-11 rounded-full flex items-center justify-center border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-[#11122b]/90 backdrop-blur text-gray-700 dark:text-slate-200 shadow-lg hover:scale-110 hover:border-orange-400/60 active:scale-95 disabled:opacity-25 disabled:hover:scale-100 disabled:cursor-default transition-all"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  )
}
