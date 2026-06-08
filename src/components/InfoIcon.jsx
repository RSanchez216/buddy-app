// Small "i" badge for surfacing a tooltip. Renders as a focusable
// inline span so keyboard users can land on it; the browser shows the
// `tip` via the native title attribute on focus / hover. Sized to sit
// next to text labels and table headers without disrupting baseline.

export default function InfoIcon({ tip, className = '' }) {
  if (!tip) return null
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={tip}
      title={tip}
      className={`ml-1 inline-flex items-center justify-center w-3 h-3 text-[8px] rounded-full border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 cursor-help align-middle ${className}`}
    >
      i
    </span>
  )
}

// Plain-language explanation of the monthly⇄weekly conversion. Reused
// everywhere those numbers appear so the copy stays in one place.
export const COST_PERIOD_TOOLTIP = (
  'Monthly and weekly convert through a full year — 12 months, 52 weeks. '
  + 'Weekly = monthly × 12 ÷ 52; monthly = weekly × 52 ÷ 12 (about ÷ or × 4.333). '
  + 'The period you enter is stored exactly; the other is calculated.'
)
