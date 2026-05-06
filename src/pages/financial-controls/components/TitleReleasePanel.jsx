import { Link } from 'react-router-dom'

// Amber alert panel surfaced on the Debt Schedule list page when one or
// more paid-off loans still have outstanding titles. Mirrors the
// driver-side Awaiting Title Release panel for cross-module visual
// consistency: amber surface + 4px amber-500 left bar + pulsing
// KeyRound icon (animate-soft-pulse defined in src/index.css).
//
// Each row: loan label · entity · lender on the left, "X of N titles
// received" in the middle, "Paid off X ago" on the right. Whole row
// links to the loan detail page.
export default function TitleReleasePanel({ rows = [] }) {
  if (rows.length === 0) return null
  const head = rows.slice(0, 5)
  const tail = rows.slice(5)

  return (
    <div
      className="rounded-2xl border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 p-4 min-w-0 relative overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: '#F59E0B' }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          <KeyIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-soft-pulse" />
          Awaiting title release
        </p>
        <span className="text-xs font-mono font-semibold text-amber-700 dark:text-amber-400">
          {rows.length}
        </span>
      </div>

      <ul className="space-y-0.5">
        {head.map(r => <li key={r.id}><Row r={r} /></li>)}
      </ul>

      {tail.length > 0 && (
        <details className="mt-1 group">
          <summary className="cursor-pointer list-none text-amber-700/80 dark:text-amber-400/80 text-[11px] font-medium px-2 pt-1 select-none hover:underline">
            <span className="group-open:hidden">Show all {rows.length} →</span>
            <span className="hidden group-open:inline">Show fewer ↑</span>
          </summary>
          <ul className="space-y-0.5 mt-0.5">
            {tail.map(r => <li key={r.id}><Row r={r} /></li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

function Row({ r }) {
  const label = r.loan_id_external || r.task_name || r.contract_number || 'Loan'
  const subBits = [r.entity_name, r.lender_name].filter(Boolean).join(' · ')
  const total = (r.title_received_count || 0) + (r.title_pending_count || 0)
  const fraction = `${r.title_received_count || 0} of ${total} ${total === 1 ? 'title' : 'titles'}`
  const paidOff = paidOffPhrase(r)

  return (
    <Link
      to={`/financial-controls/debt-schedule/${r.id}`}
      className="block rounded-md hover:bg-amber-100/70 dark:hover:bg-amber-500/15 transition-colors group"
      title="Open loan"
    >
      <div className="grid grid-cols-12 gap-2 items-baseline px-2 py-1 text-xs">
        <div className="col-span-12 sm:col-span-6 min-w-0">
          <div className="text-amber-800 dark:text-amber-300 font-medium truncate">{label}</div>
          {subBits && (
            <div className="text-amber-700/70 dark:text-amber-400/70 text-[11px] truncate">{subBits}</div>
          )}
        </div>
        <div className="col-span-6 sm:col-span-3 text-amber-700/80 dark:text-amber-400/80 font-mono whitespace-nowrap">
          {fraction}
        </div>
        <div className="col-span-6 sm:col-span-3 text-amber-700/80 dark:text-amber-400/80 text-right whitespace-nowrap flex items-baseline justify-end gap-1">
          {paidOff && <span>{paidOff}</span>}
          <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"
               fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  )
}

// Best-effort "Paid off X ago" phrase. We don't have a status_change
// event log on loans yet, so fall back to updated_at (loans don't have
// fully_paid_date). Returns null if unparseable so the row simply
// omits the phrase rather than render a placeholder.
function paidOffPhrase(r) {
  const candidate = r.updated_at
  if (!candidate) return null
  const d = new Date(candidate.length === 10 ? `${candidate}T00:00:00` : candidate)
  if (Number.isNaN(d.getTime())) return null
  const diffDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
  if (diffDays < 7) return 'Paid off this week'
  if (diffDays < 30) {
    const w = Math.floor(diffDays / 7)
    return `Paid off ${w} ${w === 1 ? 'week' : 'weeks'} ago`
  }
  if (diffDays < 365) {
    const m = Math.floor(diffDays / 30)
    return `Paid off ${m} ${m === 1 ? 'month' : 'months'} ago`
  }
  const y = Math.floor(diffDays / 365)
  return `Paid off ${y} ${y === 1 ? 'year' : 'years'} ago`
}

function KeyIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  )
}
