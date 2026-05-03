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

  // Receivable = sum of current_balance among active contracts
  const totalReceivable = active.reduce((acc, r) => acc + Number(r.current_balance || 0), 0)

  // This week / month — Phase 1 has no reconciliation data, so collected = 0
  // Expected this week = sum of weekly + biweekly/2 contracts' payment_amount
  const weeklyExpected = active
    .filter(r => r.payment_frequency === 'weekly')
    .reduce((acc, r) => acc + Number(r.payment_amount || 0), 0)
  const biweeklyExpected = active
    .filter(r => r.payment_frequency === 'biweekly')
    .reduce((acc, r) => acc + Number(r.payment_amount || 0), 0) / 2
  const monthlyExpected = active
    .filter(r => r.payment_frequency === 'monthly')
    .reduce((acc, r) => acc + Number(r.payment_amount || 0), 0)

  const weekExpected  = weeklyExpected + biweeklyExpected
  const monthExpected = weeklyExpected * 4 + biweeklyExpected * 2 + monthlyExpected

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

      <Card label="This week" big={`${fmt(0)} / ${fmt(weekExpected)}`}>
        <ProgressBar pct={0} />
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
          {fmt(0)} collected · awaiting reconciliation
        </p>
      </Card>

      <Card label="This month" big={`${fmt(0)} / ${fmt(monthExpected)}`}>
        <ProgressBar pct={0} />
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
          {fmt(0)} collected · awaiting reconciliation
        </p>
      </Card>
    </div>
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

function ProgressBar({ pct = 0 }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden mt-2">
      <div className="h-full bg-cyan-500" style={{ width: `${clamped}%` }} />
    </div>
  )
}
