import { money } from './lumperData'

// Five-card stats band from lumper_summary. Outstanding is the hero — orange,
// ~1.4× the others (col-span-2), with the three aging buckets as sub-tiles.
// Written off is red (an absorbed cost reads as a loss).
export default function StatsBand({ summary, rangeDays }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`${i === 0 ? 'lg:col-span-2' : 'lg:col-span-1'} h-28 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse`} />
        ))}
      </div>
    )
  }

  const aging = summary.aging || {}
  const advanced = Number(summary.advanced_amount) || 0
  const paid = Number(summary.paid_amount) || 0
  const efs = Number(summary.efs_fees) || 0
  const efsCount = Math.round(efs / 2)
  const paidPct = advanced > 0 ? Math.round((paid / advanced) * 100) : 0
  const annualized = rangeDays > 0 ? efs * (365 / rangeDays) : 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
      {/* HERO — Outstanding */}
      <div className="sm:col-span-2 lg:col-span-2 rounded-2xl border-2 border-orange-300 dark:border-orange-500/40 bg-gradient-to-br from-orange-50 to-orange-100/60 dark:from-orange-500/[0.12] dark:to-orange-500/[0.04] p-5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-orange-700/80 dark:text-orange-400/80">Outstanding</p>
          <p className="text-xs font-semibold text-orange-700/70 dark:text-orange-400/70 tabular-nums">{summary.open_count} open</p>
        </div>
        <p className="text-4xl font-black text-orange-600 dark:text-orange-400 font-mono tabular-nums leading-tight mt-1">{money(summary.open_amount, 2)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <AgingTile label="0–14 days" value={aging.d0_14} tone="neutral" />
          <AgingTile label="15–30 days" value={aging.d15_30} tone="amber" />
          <AgingTile label="30+ days" value={aging.d30_plus} tone="red" />
        </div>
      </div>

      <StatCard label="Advanced" value={money(summary.advanced_amount, 0)} sub={`${summary.advanced_count} records`} />
      <StatCard
        label="Reimbursed" tone="green"
        value={money(summary.paid_amount, 0)}
        sub={`${summary.paid_count} · ${paidPct}% of advanced`}
      />
      <StatCard
        label="Written off" tone="red"
        value={money(summary.writeoff_amount, 0)}
        sub={`${summary.writeoff_count} absorbed`}
      />
      <StatCard
        label="EFS check fees"
        value={money(efs, 0)}
        sub={`${efsCount} × $2.00`}
        note={`≈ ${money(annualized, 0)}/yr run-rate`}
      />
    </div>
  )
}

function AgingTile({ label, value, tone }) {
  const tones = {
    neutral: 'bg-white/60 dark:bg-white/5 text-gray-700 dark:text-slate-300 border-gray-200 dark:border-white/10',
    amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
    red: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  }
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${tones[tone]}`}>
      <p className="text-[9px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-sm font-bold font-mono tabular-nums leading-tight mt-0.5">{money(value, 0)}</p>
    </div>
  )
}

function StatCard({ label, value, sub, note, tone }) {
  const valueTone = tone === 'green'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'red'
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-900 dark:text-white'
  const border = tone === 'red'
    ? 'border-red-200 dark:border-red-500/20 bg-red-50/40 dark:bg-red-500/[0.05]'
    : tone === 'green'
      ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-500/[0.05]'
      : 'border-gray-300 dark:border-white/5 bg-white dark:bg-[#0d0d1f]'
  return (
    <div className={`lg:col-span-1 rounded-2xl border p-4 ${border}`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className={`text-xl font-bold font-mono tabular-nums leading-tight mt-1 ${valueTone}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{sub}</p>}
      {note && <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{note}</p>}
    </div>
  )
}
