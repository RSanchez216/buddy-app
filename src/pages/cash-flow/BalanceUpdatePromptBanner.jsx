import { Link } from 'react-router-dom'

// Soft-blue banner that sits below the (amber) Unassigned Items panel
// and above the calendar's filter chips. Both panels are "needs
// attention" — but Unassigned is "fix this data" (amber, missing
// metadata), while this is "do this routine task" (blue, stale
// reconciliation). Different palettes so they don't muddle.
//
// Renders nothing when accounts.length === 0 — no "all clear ✓"
// placeholder. The body itself is the click target (opens the Record
// Balance modal pre-filled with the first account); the right-aligned
// secondary link goes to the Bank Accounts page for full-list
// navigation.

function fmtDay(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function BalanceUpdatePromptBanner({
  accounts,
  isDayMode,
  dayISO,
  onOpenModal,
}) {
  if (!accounts || accounts.length === 0) return null

  const n = accounts.length
  const pluralAccounts = n === 1 ? 'account' : 'accounts'
  const headline = isDayMode
    ? `Funding update needed for ${fmtDay(dayISO)} — ${n} ${pluralAccounts}`
    : `Funding update needed this week — ${n} ${pluralAccounts}`

  // Click on the body opens the modal for the first account. After
  // save, the hook refetches and (if work remains) the banner
  // re-renders with the next first-in-list. User clicks again to
  // chain. Intentional: no auto-advance.
  const firstAccount = accounts[0]

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-4 py-3">
      <button
        type="button"
        onClick={() => onOpenModal?.(firstAccount)}
        className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm text-blue-900 dark:text-blue-200 hover:text-blue-700 dark:hover:text-blue-100 transition-colors"
      >
        <svg className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v4l3 2" />
          <circle cx="12" cy="12" r="10" />
        </svg>
        <span className="font-medium truncate">{headline}</span>
        <span className="text-[11px] text-blue-700/70 dark:text-blue-300/70 truncate">
          · click to record {firstAccount.name}
        </span>
      </button>
      <Link
        to="/settings/funding-accounts"
        className="shrink-0 text-[11px] font-medium text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap"
      >
        View all bank accounts →
      </Link>
    </div>
  )
}
