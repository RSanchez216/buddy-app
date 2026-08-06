// Credit events — the third kind of broker flag.
//
// The two standing flags (identity theft, nonpayment) describe what a broker IS.
// A credit event describes what is true RIGHT NOW between MANAS and Apex, and it
// expires. That difference drives everything here: it sorts above the standing
// flags, it carries an age, and it goes quiet once it's stale.
//
// Attribution is always "Accounting", never a person — broker_credit_events.source
// defaults to it and nothing here overrides that.
//
// Components only. The copy, the date and amount formatters and the glyph
// tooltip live in brokerCreditData.js, because a file that exports both
// components and plain functions breaks fast refresh.

import { isNoCredit, creditCopy, fmtEventDate } from './brokerCreditData'

// An open event. Stale ones render muted with their age — Accounting posts the
// lifts, and a missed post must not shout forever, but it must not vanish
// either. Somewhere between active and gone.
export default function CreditEvent({ credit, compact }) {
  if (!credit) return null
  const { title, body } = creditCopy(credit)
  const stale = !!credit.is_stale

  const tone = stale
    ? 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03]'
    : isNoCredit(credit)
      ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10'
      : 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10'
  const titleTone = stale
    ? 'text-gray-600 dark:text-slate-300'
    : isNoCredit(credit)
      ? 'text-rose-800 dark:text-rose-300'
      : 'text-amber-800 dark:text-amber-300'

  return (
    <div className={`rounded-lg border p-2.5 text-[11px] leading-snug ${tone}`}>
      <div className="flex items-center gap-1.5">
        <PauseGlyph className={`w-3 h-3 shrink-0 ${stale ? 'text-gray-400 dark:text-slate-500' : isNoCredit(credit) ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`} />
        <p className={`font-semibold ${titleTone}`}>{title}</p>
      </div>
      <p className="mt-0.5 text-gray-600 dark:text-slate-300">{body}</p>

      {stale ? (
        <p className="mt-1 text-gray-500 dark:text-slate-400">
          Open since {fmtEventDate(credit.active_from)} · {credit.days_active} days — may no longer be current, check with Accounting
        </p>
      ) : (
        <p className="mt-1 text-gray-500 dark:text-slate-400">
          Open since {fmtEventDate(credit.active_from)}{credit.days_active != null ? ` · ${credit.days_active} day${credit.days_active === 1 ? '' : 's'}` : ''}
        </p>
      )}

      {!compact && credit.reason && (
        <p className="mt-1 text-gray-500 dark:text-slate-400 italic">“{credit.reason}”</p>
      )}
      {!compact && credit.source && (
        <p className="mt-1 text-[10px] text-gray-400 dark:text-slate-500">{credit.source}</p>
      )}
    </div>
  )
}

// The pause bars — a hold, not a warning. Shared with the board's marker gutter
// so the block and the row glyph read as the same thing.
export function PauseGlyph({ className = 'w-3.5 h-3.5', title }) {
  return (
    <svg aria-hidden={!title} role={title ? 'img' : undefined} viewBox="0 0 20 20" className={`${className} fill-current`}>
      {title && <title>{title}</title>}
      <rect x="5" y="3" width="4" height="14" rx="1" />
      <rect x="11" y="3" width="4" height="14" rx="1" />
    </svg>
  )
}
