function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
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
            primary: `${r.driver_name}${r.truck_number ? ' · ' + r.truck_number : ''}`,
            secondary: 'Behind',
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
    },
    red: {
      bg: 'bg-red-50 dark:bg-red-500/10',
      border: 'border-red-200 dark:border-red-500/20',
      text: 'text-red-700 dark:text-red-400',
      sub: 'text-red-700/80 dark:text-red-400/80',
    },
  }[tone]

  return (
    <div className={`${tones.bg} border ${tones.border} rounded-2xl p-4`}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className={`text-xs font-bold uppercase tracking-wide ${tones.text}`}>{title}</p>
        <span className={`text-xs font-mono font-semibold ${tones.text}`}>{count}</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
            <span className={tones.text + ' truncate'}>{r.primary}</span>
            <span className={`${tones.sub} font-mono whitespace-nowrap`}>{r.secondary}</span>
          </li>
        ))}
        {rest > 0 && (
          <li className={`${tones.sub} text-[11px] italic`}>+{rest} more</li>
        )}
      </ul>
    </div>
  )
}
