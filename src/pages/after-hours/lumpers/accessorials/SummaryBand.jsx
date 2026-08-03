import { money } from '../lumperData'

// Six cards. Awaiting is the hero because it is the money actually outstanding;
// the three sub-tiles age it from event_date (the load's DELIVERY date), which
// is what a broker will argue about — not when the claim was typed.

const AGING = [
  { key: 'd0_7',     label: '0–7 days',  cls: 'text-gray-700 dark:text-slate-300' },
  { key: 'd8_21',    label: '8–21 days', cls: 'text-amber-600 dark:text-amber-400' },
  { key: 'd21_plus', label: '21+ days',  cls: 'text-red-600 dark:text-red-400' },
]

export default function SummaryBand({ summary, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${i === 0 ? 'sm:col-span-2' : ''} h-28 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse`} />
        ))}
      </div>
    )
  }
  const s = summary || {}
  const aging = s.aging || {}
  const filing = s.filing || {}

  const cards = [
    { label: 'Claimed',   amount: s.claimed_amount,   count: s.claimed_count,   tone: 'plain' },
    { label: 'Approved',  amount: s.approved_amount,  count: s.approved_count,  tone: 'blue' },
    { label: 'Collected', amount: s.collected_amount, count: s.collected_count, tone: 'green' },
    { label: 'Denied',    amount: s.denied_amount,    count: s.denied_count,    tone: 'red' },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
        {/* Hero — awaiting broker, with its aging split */}
        <div className="sm:col-span-2 rounded-2xl border-2 border-orange-300 dark:border-orange-500/40 bg-gradient-to-br from-orange-50 to-orange-100/60 dark:from-orange-500/[0.12] dark:to-orange-500/[0.04] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-orange-700/80 dark:text-orange-400/80">Awaiting broker</p>
          <p className="text-3xl font-black text-orange-600 dark:text-orange-400 font-mono tabular-nums leading-tight mt-1">{money(s.awaiting_amount)}</p>
          <p className="text-[11px] text-orange-700/70 dark:text-orange-400/70">{Number(s.awaiting_count) || 0} claim{Number(s.awaiting_count) === 1 ? '' : 's'} outstanding</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {AGING.map(a => (
              <div key={a.key} className="rounded-lg bg-white/70 dark:bg-white/[0.06] border border-orange-200/70 dark:border-orange-500/20 px-2 py-1.5">
                <p className={`text-xs font-bold font-mono tabular-nums leading-none ${a.cls}`}>{money(aging[a.key], 0)}</p>
                <p className="text-[9px] text-gray-500 dark:text-slate-400 mt-1 whitespace-nowrap">{a.label}</p>
              </div>
            ))}
          </div>
        </div>

        {cards.map(c => <Card key={c.label} {...c} />)}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* The chase list — approved by the broker but the money hasn't landed */}
        <div className="rounded-2xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/60 dark:bg-blue-500/[0.07] px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700/80 dark:text-blue-400/80">Approved, awaiting payment</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300 font-mono tabular-nums">{money(s.approved_awaiting_payment)}</p>
            <span className="text-[11px] text-blue-600/70 dark:text-blue-400/70">the chase list</span>
          </div>
        </div>

        {/* Filing performance — how promptly claims are being raised */}
        <div className={'rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0d0d1f] px-4 py-3'}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Filing performance</p>
          <div className="flex items-baseline gap-2 mt-1 flex-wrap">
            <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
              Filed same day {Number(filing.same_day_pct) || 0}%
            </p>
            <span className="text-[11px] text-gray-500 dark:text-slate-400 tabular-nums">· avg {Number(filing.avg_lag_days) || 0} days</span>
          </div>
          <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">Measured from the load&apos;s delivery date. Claims filed before delivery are excluded from the average.</p>
        </div>
      </div>
    </div>
  )
}

const TONE = {
  plain: 'text-gray-900 dark:text-white',
  blue:  'text-blue-700 dark:text-blue-300',
  green: 'text-emerald-600 dark:text-emerald-400',
  red:   'text-red-600 dark:text-red-400',
}

function Card({ label, amount, count, tone }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0d0d1f] px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className={`text-xl font-bold font-mono tabular-nums leading-tight mt-1 ${TONE[tone] || TONE.plain}`}>{money(amount)}</p>
      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{Number(count) || 0} claim{Number(count) === 1 ? '' : 's'}</p>
    </div>
  )
}
