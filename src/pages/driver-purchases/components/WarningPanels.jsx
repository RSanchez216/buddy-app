import { useState } from 'react'
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
          rows={behindRows.map(r => ({
            id: r.id,
            primary: `${r.driver_name}${r.truck_number ? ' · ' + r.truck_number : ''}`,
            secondary: behindSecondary(r),
          }))}
        />
      )}

      {showUnderwater && (
        <Panel
          tone="red"
          title="Underwater contracts"
          rows={underwaterRows.map(r => ({
            id: r.id,
            primary: `${r.driver_name}${r.truck_number ? ' · ' + r.truck_number : ''}`,
            secondary: `Gap ${fmt(r.coverage_gap)}`,
          }))}
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
// Shows first 5 rows by default; a "Show all N" / "Show less" button
// toggles inline expansion. No navigation, no modal. Matches the
// TitleReleasePanel expand/collapse pattern for cross-panel consistency.
function Panel({ tone, title, rows }) {
  const [expanded, setExpanded] = useState(false)
  const total = rows.length
  const visible = expanded ? rows : rows.slice(0, 5)
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
        <span className={`text-xs font-mono font-semibold ${tones.text}`}>{total}</span>
      </div>
      <ul className="space-y-0.5">
        {visible.map(r => (
          <li key={r.id || r.primary}><Row tone={tones} row={r} /></li>
        ))}
      </ul>
      {total > 5 && (
        <ExpandToggle tone={tones} expanded={expanded} total={total} onToggle={() => setExpanded(v => !v)} />
      )}
    </div>
  )
}

// Shared inline expand/collapse affordance. Plain text (no arrows), tone-
// matched color, underline on hover, padded for a comfortable hit target.
function ExpandToggle({ tone, expanded, total, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`mt-1 px-2 py-1 text-[11px] font-medium ${tone.sub} hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-current/30 rounded`}
    >
      {expanded ? 'Show less' : `Show all ${total}`}
    </button>
  )
}

// ── Title Release panel ────────────────────────────────────────────────
// Visually distinct from the standard panels: 4px amber-500 left bar +
// pulsing KeyRound icon. Inline expand/collapse via the shared
// ExpandToggle so wording matches the generic Panel ("Show all N" /
// "Show less", no arrow glyphs that imply navigation).
function TitleReleasePanel({ rows }) {
  const [expanded, setExpanded] = useState(false)
  const tone = {
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/20',
    text: 'text-amber-700 dark:text-amber-400',
    sub: 'text-amber-700/80 dark:text-amber-400/80',
    hover: 'hover:bg-amber-100/70 dark:hover:bg-amber-500/15',
  }
  const total = rows.length
  const visible = expanded ? rows : rows.slice(0, 5)

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
        {visible.map(r => (
          <li key={r.id || r.primary}><Row tone={tone} row={r} /></li>
        ))}
      </ul>

      {total > 5 && (
        <ExpandToggle tone={tone} expanded={expanded} total={total} onToggle={() => setExpanded(v => !v)} />
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
