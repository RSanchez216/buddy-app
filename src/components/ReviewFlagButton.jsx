// Email-star-style "under review" flag toggle. The flag is shared per subject
// (visible to everyone). Managers get a clickable toggle (stopPropagation so a
// clickable row's own handler doesn't fire); non-managers see a read-only
// indicator that still reflects the shared state. Flagged = orange question-mark
// on a light-orange chip; unflagged = muted gray. Used on Driver Purchases and
// Idle review so the affordance stays pixel-identical across pages.
export default function ReviewFlagButton({ flagged, canEdit, onToggle }) {
  const icon = (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M8.228 9c.549-1.165 1.847-2 3.372-2 2.021 0 3.5 1.343 3.5 3 0 1.243-.87 2.11-2.006 2.66C13.05 12.99 12 13.79 12 15m0 3h.01M12 21a9 9 0 100-18 9 9 0 000 18z" />
    </svg>
  )
  const flaggedCls = 'text-orange-500 bg-[#FFF3EB] dark:bg-orange-500/15'
  const base = 'inline-flex items-center justify-center rounded-md p-1 shrink-0 transition-colors'

  if (!canEdit) {
    // Read-only indicator for non-managers — reflects state, no affordance.
    return (
      <span
        className={`${base} ${flagged ? flaggedCls : 'text-gray-300 dark:text-slate-600'}`}
        title={flagged ? 'Under review' : ''}
        aria-label={flagged ? 'Under review' : ''}
      >
        {icon}
      </span>
    )
  }

  const label = flagged ? 'Under review — click to remove' : 'Flag for review'
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      title={label}
      aria-label={label}
      aria-pressed={flagged}
      className={`${base} ${
        flagged
          ? `${flaggedCls} hover:brightness-95 dark:hover:bg-orange-500/25`
          : 'text-gray-400 dark:text-slate-500 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-600 dark:hover:text-slate-300'
      }`}
    >
      {icon}
    </button>
  )
}
