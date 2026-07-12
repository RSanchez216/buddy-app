// "Possibly home" — when an idle driver's last delivery was within ~50 mi of
// their home, they might be home. Always a possibility, never a guarantee, so
// the label is exactly "Possibly home" (never "Home"). Fed by the
// driver_possibly_home() RPC row.

// Build the chip text; returns null when not possibly-home.
function possiblyHomeLabel(info) {
  if (!info?.possibly_home) return null
  const city = [info.home_city, info.home_state].filter(Boolean).join(', ')
  const dist = info.dist_from_home_mi == null ? null : Math.round(Number(info.dist_from_home_mi))
  if (!city) return 'Possibly home'
  if (dist != null && dist <= 5) return `Possibly home · in ${city}`
  if (dist != null) return `Possibly home · ~${dist} mi from ${city}`
  return 'Possibly home'
}

export default function PossiblyHomeChip({ info, className = '' }) {
  const label = possiblyHomeLabel(info)
  if (!label) return null
  return (
    <span
      title="Last delivery was within ~50 mi of the driver's home — they may be home. Not a guarantee."
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 whitespace-nowrap ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3 h-3 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />
      </svg>
      {label}
    </span>
  )
}
