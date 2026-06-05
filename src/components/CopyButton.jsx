import { useEffect, useRef, useState } from 'react'

// Small copy-to-clipboard button. Drop it next to a cell value to give
// the user a one-click copy of the full underlying string (the visible
// text may be truncated; this button always copies the full `value`).
//
// Lives in a parent table row that is itself click-to-navigate, so the
// click handler stops propagation + prevents default. Without that the
// row's <Link> wrapper would fire and the user would lose their place.
//
// Visual model:
//   * Muted by default; brightens to the app's orange accent on
//     row-hover (parent table row uses the `group` class) AND on
//     direct hover/focus.
//   * After a successful copy: swaps to a check icon for ~1.5s then
//     reverts. Failure (no clipboard API) falls back to a brief
//     "—" state so the click still feels responsive.
//   * No layout shift on hover — the button always occupies its
//     ~18×18 slot.

const COPY_ICON = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
    <rect x="9" y="9" width="11" height="11" rx="2" ry="2" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
)

const CHECK_ICON = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

export default function CopyButton({ value, label = 'Copy', className = '' }) {
  const [state, setState] = useState('idle') // 'idle' | 'copied' | 'error'
  const timerRef = useRef(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  async function handleClick(e) {
    // Critical for rows wrapped in <Link>: keep the row's navigation
    // from firing when the user is trying to copy.
    e.stopPropagation()
    e.preventDefault()
    if (!value) return
    try {
      await navigator.clipboard.writeText(String(value))
      setState('copied')
    } catch {
      // Older browsers / non-secure contexts: fall back to the legacy
      // textarea trick so the button still does something useful.
      try {
        const ta = document.createElement('textarea')
        ta.value = String(value)
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setState('copied')
      } catch {
        setState('error')
      }
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setState('idle'), 1500)
  }

  const isCopied = state === 'copied'
  const tone = isCopied
    ? 'text-orange-600 dark:text-orange-400'
    // Muted by default; brightens to the app's orange accent on parent
    // row hover (group-hover) AND on direct hover / focus. Always
    // visible — never opacity-0 — so the button doesn't appear and
    // disappear in busy tables and remains discoverable on touch.
    : 'text-gray-300 dark:text-slate-600 group-hover:text-gray-500 dark:group-hover:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 focus:text-orange-600 dark:focus:text-orange-400'

  return (
    <button
      type="button"
      onClick={handleClick}
      title={isCopied ? 'Copied' : label}
      aria-label={isCopied ? 'Copied' : label}
      className={`inline-flex items-center justify-center w-[18px] h-[18px] shrink-0 align-middle transition-colors focus:outline-none ${tone} ${className}`}
    >
      {isCopied ? CHECK_ICON : COPY_ICON}
    </button>
  )
}
