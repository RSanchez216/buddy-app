import { S } from '../lib/styles'

// Shared loading / error / empty states — one kit reused across pages so the
// three states read consistently (matches the Dispatcher Scorecard pattern):
//   loading → skeleton / spinner
//   error   → short message + Retry (never a blank panel)
//   empty   → its own copy (an empty result must never look like "still loading")

// The app's standard orange spinner.
export function Spinner({ className = 'h-8 w-8' }) {
  return <div className={`animate-spin rounded-full border-b-2 border-orange-500 ${className}`} />
}

// Centered spinner in a fixed-height box — the simplest loading fallback.
export function SpinnerBox({ className = 'h-64' }) {
  return <div className={`flex items-center justify-center ${className}`}><Spinner /></div>
}

// One shimmer bar. Compose these into layout-mirroring skeletons so data
// landing doesn't jump the layout.
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-gray-200 dark:bg-white/10 ${className}`} />
}

// Table-body skeleton inside a card — N rows of shimmer cells.
export function TableSkeleton({ rows = 6, cols = 5 }) {
  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="divide-y divide-gray-100 dark:divide-white/5">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={`h-4 ${c === 0 ? 'w-40' : 'flex-1'}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// Card-grid skeleton — N shimmer cards, for KPI strips / card layouts.
export function CardGridSkeleton({ count = 4, className = 'grid grid-cols-2 sm:grid-cols-4 gap-4', height = 'h-24' }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${S.card} p-4`}><Skeleton className={`w-full ${height}`} /></div>
      ))}
    </div>
  )
}

// Error state with a Retry control — never a blank table/panel.
export function ErrorRetry({ message = "Couldn't load this — please retry.", onRetry }) {
  return (
    <div className={`${S.card} p-10 text-center`}>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">{message}</p>
      {onRetry && <button onClick={onRetry} className={S.btnSecondary}>Retry</button>}
    </div>
  )
}

// Empty (loaded, genuinely no rows) — distinct copy so it never reads as
// "still loading".
export function EmptyState({ children, className = '' }) {
  return <div className={`${S.card} p-10 text-center text-sm text-gray-400 dark:text-slate-600 ${className}`}>{children}</div>
}
