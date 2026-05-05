import { S } from '../../../lib/styles'

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function KpiCards({ rows = [] }) {
  // Active = is_active_state from view
  const active = rows.filter(r => r.is_active_state)
  const weeklyCount  = active.filter(r => r.payment_frequency === 'weekly').length
  const biweeklyCount = active.filter(r => r.payment_frequency === 'biweekly').length
  const monthlyCount = active.filter(r => r.payment_frequency === 'monthly').length

  const totalReceivable = active.reduce((acc, r) => acc + Number(r.current_balance || 0), 0)

  // Live numbers — sourced from the Phase 3A view fields
  // (expected_this_week, collected_this_week, expected_this_month,
  // collected_this_month). The view aggregates from
  // driver_purchase_payments, so these reflect actual recorded
  // payments + generated expected rows.
  const weekExpected  = sum(rows, 'expected_this_week')
  const weekCollected = sum(rows, 'collected_this_week')
  const monthExpected = sum(rows, 'expected_this_month')
  const monthCollected = sum(rows, 'collected_this_month')

  // "N missed" — count of contracts behind (per view's is_behind).
  const missedCount = rows.filter(r => r.is_behind).length

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <Card label="Active contracts" big={`${active.length}`}>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
          {weeklyCount} weekly · {biweeklyCount} biweekly · {monthlyCount} monthly
        </p>
      </Card>

      <Card label="Total receivable" big={fmt(totalReceivable)}>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
          Across {active.length} active contract{active.length === 1 ? '' : 's'}
        </p>
      </Card>

      <PeriodCard
        label="This week"
        collected={weekCollected}
        expected={weekExpected}
        missedCount={missedCount}
      />

      <PeriodCard
        label="This month"
        collected={monthCollected}
        expected={monthExpected}
        missedCount={missedCount}
      />
    </div>
  )
}

function PeriodCard({ label, collected, expected, missedCount }) {
  const pct = expected > 0 ? Math.round((collected / expected) * 100) : 0
  const variance = collected - expected
  const onTrack = Math.abs(variance) <= Math.max(50, expected * 0.01)

  let barClass = 'bg-cyan-500'
  if (variance < 0 && !onTrack) barClass = 'bg-amber-500'
  if (variance > 0 && !onTrack) barClass = 'bg-emerald-500'

  return (
    <Card label={label} big={`${fmt(collected)} / ${fmt(expected)}`}>
      <ProgressBar pct={pct} className={barClass} />
      <div className="text-[11px] mt-1 flex items-baseline justify-between gap-2">
        <span className="text-gray-400 dark:text-slate-500">
          {expected === 0 ? 'No expected payments' : `${pct}% of expected`}
        </span>
        {expected > 0 && (
          onTrack ? (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">On track</span>
          ) : variance < 0 ? (
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              ▼ {fmt(Math.abs(variance))}
              {missedCount > 0 ? ` · ${missedCount} missed` : ''}
            </span>
          ) : (
            <span className="text-cyan-600 dark:text-cyan-400 font-medium">
              ▲ {fmt(variance)} catch-up
            </span>
          )
        )}
      </div>
    </Card>
  )
}

function Card({ label, big, children }) {
  return (
    <div className={`${S.card} p-4`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 dark:text-white font-mono mt-1.5">{big}</p>
      {children}
    </div>
  )
}

function ProgressBar({ pct = 0, className = 'bg-cyan-500' }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mt-2">
      <div className={`h-full ${className}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

function sum(rows, key) {
  return rows.reduce((acc, r) => acc + Number(r[key] || 0), 0)
}
