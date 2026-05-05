import { Link } from 'react-router-dom'

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// "3 wks · $3,000" for weekly/biweekly contracts; "2 mo · $5,108" for monthly.
// Falls back to just the dollar amount if periods_behind is unknown.
function behindSecondary(r) {
  const amt = fmt(r.amount_behind || 0)
  const n = Number(r.periods_behind || 0)
  if (n <= 0) return amt
  const unit = r.payment_frequency === 'monthly' ? (n === 1 ? 'mo' : 'mo') : (n === 1 ? 'wk' : 'wks')
  return `${n} ${unit} · ${amt}`
}

export default function WarningPanels({ behindRows = [], underwaterRows = [] }) {
  // Phase 1: no reconciliation data → behind is always empty.
  // Underwater can populate from the view as soon as records exist.
  const showBehind = behindRows.length > 0
  const showUnderwater = underwaterRows.length > 0
  if (!showBehind && !showUnderwater) return null

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
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
    </div>
  )
}

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
    <div className={`${tones.bg} border ${tones.border} rounded-2xl p-4`}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className={`text-xs font-bold uppercase tracking-wide ${tones.text}`}>{title}</p>
        <span className={`text-xs font-mono font-semibold ${tones.text}`}>{count}</span>
      </div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.id || r.primary}>
            <Row tone={tones} row={r} />
          </li>
        ))}
        {rest > 0 && (
          <li className={`${tones.sub} text-[11px] italic px-2 pt-1`}>+{rest} more</li>
        )}
      </ul>
    </div>
  )
}

// Each row is a Link to the driver purchase detail page when an id is
// present (always true for both panels today). Falls back to a plain
// span if id is missing — keeps the shape resilient if a future caller
// passes synthetic / aggregated rows.
function Row({ tone, row }) {
  const inner = (
    <div className="flex items-baseline justify-between gap-2 text-xs px-2 py-1 rounded-md group">
      <span className={`${tone.text} truncate`}>{row.primary}</span>
      <span className="flex items-baseline gap-1 shrink-0 whitespace-nowrap">
        <span className={`${tone.sub} font-mono`}>{row.secondary}</span>
        <svg className={`w-3 h-3 ${tone.sub} opacity-0 group-hover:opacity-100 transition-opacity translate-x-0 group-hover:translate-x-0.5`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </span>
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
