import { useLayoutEffect, useRef, useState } from 'react'

// Wraps the rich-text body of a comment so a runaway 70-line paste
// can't blow the activity rail's height past the rest of the page.
//
// Behavior:
// - Measures the wrapped content's scrollHeight on mount and on resize.
// - If content fits within COLLAPSED_HEIGHT_PX it renders as-is.
// - Otherwise renders capped at the threshold with a fade gradient and
//   a "Show more" button. Expanded view is capped at 60vh and becomes
//   internally scrollable past that — the surrounding rail stays put.
//
// Attachments are deliberately rendered OUTSIDE this wrapper so they're
// always visible regardless of collapse state.

const COLLAPSED_HEIGHT_PX = 176 // ~8 lines at the comment body line-height

export default function CollapsibleBody({ children }) {
  const innerRef = useRef(null)
  const [isLong, setIsLong] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Re-measure when content changes (edit) or window resizes. Comparing
  // scrollHeight against the threshold tells us whether the truncation
  // would actually cut anything off. A tiny buffer (4px) prevents flicker
  // when content is right at the threshold.
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const measure = () => setIsLong(el.scrollHeight > COLLAPSED_HEIGHT_PX + 4)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro) ro.observe(el)
    return () => { if (ro) ro.disconnect() }
  }, [children])

  // Short comment — render plainly. Avoids the wrapper div + extra style.
  if (!isLong) {
    return <div ref={innerRef}>{children}</div>
  }

  return (
    <div className="relative">
      <div
        ref={innerRef}
        className={expanded ? 'overflow-y-auto' : 'overflow-hidden'}
        style={{
          maxHeight: expanded ? '60vh' : `${COLLAPSED_HEIGHT_PX}px`,
          transition: 'max-height 150ms ease',
        }}
      >
        {children}
      </div>
      {!expanded && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-white dark:to-[#0d0d1f]"
        />
      )}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="mt-1 text-[11px] font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}
