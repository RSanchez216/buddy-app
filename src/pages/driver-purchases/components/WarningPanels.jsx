import { Link } from 'react-router-dom'

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// "3 wks · $3,000" / "2 mo · $5,108". Falls back to dollar amount only.
function behindSecondary(r) {
  const amt = fmt(r.amount_behind || 0)
  const n = Number(r.periods_behind || 0)
  if (n <= 0) return amt
  const unit = r.payment_frequency === 'monthly' ? 'mo' : (n === 1 ? 'wk' : 'wks')
  return `${n} ${unit} · ${amt}`
}

// "Paid off 4 months ago" from fully_paid_date; "Marked paid recently"
// from updated_at as a soft fallback; null if neither is usable.
function paidOffPhrase(r) {
  const candidates = [r.fully_paid_date, r.updated_at].filter(Boolean)
  if (candidates.length === 0) return null
  const d = new Date(candidates[0].length === 10 ? `${candidates[0]}T00:00:00` : candidates[0])
  if (Number.isNaN(d.getTime())) return null
  const diffDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
  const usingFallback = !r.fully_paid_date
  if (usingFallback && diffDays < 14) return 'Marked paid recently'
  if (diffDays < 7) return 'Paid off this week'
  if (diffDays < 30) return `Paid off ${Math.floor(diffDays / 7)} ${Math.floor(diffDays / 7) === 1 ? 'week' : 'weeks'} ago`
  if (diffDays < 365) {
    const m = Math.floor(diffDays / 30)
    return `Paid off ${m} ${m === 1 ? 'month' : 'months'} ago`
  }
  const y = Math.floor(diffDays / 365)
  return `Paid off ${y} ${y === 1 ? 'year' : 'years'} ago`
}

export default function WarningPanels({
  behindRows = [],
  underwaterRows = [],
  titlePendingRows = [],
}) {
  const showBehind = behindRows.length > 0
  const showUnderwater = underwaterRows.length > 0
  const showTitlePending = titlePendingRows.length > 0
  if (!showBehind && !showUnderwater && !showTitlePending) return null

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {showBehind && (
        <Panel
          tone="amber"
          title="Behind on payments"
          count={behindRows.length}
          rows={behindRows.slice(0, 5).map(r => ({
            id: r.id,
            primary: `${r.driver_name}${r.truck_number ? ' · ' + r.truck_number : ''}`,
            secondary: behindSecondary(r),
          }))}
          rest={Math.max(0, behindRows.length - 5)}
        />
      )}

      {showUnderwater && (
        <Panel
          tone="red"
          title="Underwater contracts"
          count={underwaterRows.length}
          rows={underwaterRows.slice(0, 5).map(r => ({
            id: r.id,
            primary: `${r.driver_name}${r.truck_number ? ' · ' + r.truck_number : ''}`,
            secondary: `Gap ${fmt(r.coverage_gap)}`,
          }))}
          rest={Math.max(0, underwaterRows.length - 5)}
        />
      )}

      {showTitlePending && (
        <TitleReleasePanel
          rows={titlePendingRows.map(r => ({
            id: r.id,
            primary: `${r.driver_name}${r.truck_number ? ' · ' + r.truck_number : ''}`,
            secondary: paidOffPhrase(r),
          }))}
        />
      )}
    </div>
  )
}

// ── Generic panel (Behind / Underwater) ────────────────────────────────
function Panel({ tone, title, count, rows, rest }) {
  const tones = {
    amber: {
      bg: 'bg-amber-50 dark:bg-amber-500/10',
      border: 'border-amber-200 dark:border-amber-500/20',
      text: 'text-amber-700 dark:text-amber-400',
      sub: 'text-amber-700/80 dark:text-amber-400/80',
      hover: 'hover:bg-amber-100/70 dark:hover:bg-amber-500/15',
    },
    red: {
      bg: 'bg-red-50 dark:bg-red-500/10',
      border: 'border-red-200 dark:border-red-500/20',
      text: 'text-red-700 dark:text-red-400',
      sub: 'text-red-700/80 dark:text-red-400/80',
      hover: 'hover:bg-red-100/70 dark:hover:bg-red-500/15',
    },
  }[tone]

  return (
    <div className={`${tones.bg} border ${tones.border} rounded-2xl p-4 min-w-0`}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className={`text-xs font-bold uppercase tracking-wide ${tones.text}`}>{title}</p>
        <span className={`text-xs font-mono font-semibold ${tones.text}`}>{count}</span>
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.id || r.primary}><Row tone={tones} row={r} /></li>
        ))}
        {rest > 0 && (
          <li className={`${tones.sub} text-[11px] italic px-2 pt-1`}>+{rest} more</li>
        )}
      </ul>
    </div>
  )
}

// ── Title Release panel ────────────────────────────────────────────────
// Visually distinct from the standard panels: 4px amber-500 left bar +
// pulsing KeyRound icon. "Show all N" expands inline (no separate page).
function TitleReleasePanel({ rows }) {
  const tone = {
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/20',
    text: 'text-amber-700 dark:text-amber-400',
    sub: 'text-amber-700/80 dark:text-amber-400/80',
    hover: 'hover:bg-amber-100/70 dark:hover:bg-amber-500/15',
  }
  const total = rows.length

  // Show first 5 by default, then "Show all N" expands inline.
  // Local state via a simple useState would require lifting; using a
  // <details>/<summary> is simpler and accessible.
  const head = rows.slice(0, 5)
  const tail = rows.slice(5)

  return (
    <div
      className={`${tone.bg} rounded-2xl border ${tone.border} p-4 min-w-0 relative overflow-hidden`}
      style={{ borderLeftWidth: 4, borderLeftColor: '#F59E0B' }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${tone.text}`}>
          <KeyIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 animate-soft-pulse" />
          Awaiting title release
        </p>
        <span className={`text-xs font-mono font-semibold ${tone.text}`}>{total}</span>
      </div>

      <ul className="space-y-0.5">
        {head.map(r => (
          <li key={r.id || r.primary}><Row tone={tone} row={r} /></li>
        ))}
      </ul>

      {tail.length > 0 && (
        <details className="mt-1 group">
          <summary className={`cursor-pointer list-none ${tone.sub} text-[11px] font-medium px-2 pt-1 select-none hover:underline`}>
            <span className="group-open:hidden">Show all {total} →</span>
            <span className="hidden group-open:inline">Show fewer ↑</span>
          </summary>
          <ul className="space-y-0.5 mt-0.5">
            {tail.map(r => (
              <li key={r.id || r.primary}><Row tone={tone} row={r} /></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ── Shared row ─────────────────────────────────────────────────────────
function Row({ tone, row }) {
  const inner = (
    <div className="flex items-baseline justify-between gap-2 text-xs px-2 py-1 rounded-md group">
      <span className={`${tone.text} truncate`}>{row.primary}</span>
      {row.secondary && (
        <span className="flex items-baseline gap-1 shrink-0 whitespace-nowrap">
          <span className={`${tone.sub} font-mono`}>{row.secondary}</span>
          <svg className={`w-3 h-3 ${tone.sub} opacity-0 group-hover:opacity-100 transition-opacity translate-x-0 group-hover:translate-x-0.5`}
               fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>
      )}
    </div>
  )
  if (!row.id) return inner
  return (
    <Link
      to={`/financial-controls/driver-purchases/${row.id}`}
      className={`block rounded-md ${tone.hover} transition-colors`}
      title="Open driver purchase"
    >
      {inner}
    </Link>
  )
}

// Lucide-style KeyRound icon (no extra dependency).
function KeyIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  )
}
