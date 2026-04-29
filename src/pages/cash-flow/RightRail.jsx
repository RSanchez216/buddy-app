import { fmtMoney } from './calendarUtils'
import { CF } from './calendarUtils'

export default function RightRail({ weekStart, startingCash, inflowSum, outflowSum, onEditCash }) {
  const net = (inflowSum || 0) - (outflowSum || 0)
  const projected = (Number(startingCash) || 0) + net
  const positive = net >= 0
  const projPositive = projected >= 0

  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <aside className="space-y-3 sticky top-2 self-start">
      <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">This Week</span>
          <span className="text-[10px] text-gray-400 dark:text-slate-600">{startStr}</span>
        </div>

        <Row
          label="Starting cash"
          value={startingCash != null ? fmtMoney(startingCash) : '—'}
          mono
          action={
            <button
              onClick={onEditCash}
              title="Edit starting cash"
              className="text-gray-400 dark:text-slate-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 20h9" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </button>
          }
        />

        <Row label="▲ Inflow expected" value={fmtMoney(inflowSum)} mono color="text-emerald-600 dark:text-emerald-400" />
        <Row label="▼ Outflow scheduled" value={fmtMoney(outflowSum)} mono color="text-red-600 dark:text-red-400" />

        <div className="border-t border-gray-100 dark:border-white/5 pt-3">
          <Row
            label="Net"
            value={(positive ? '+ ' : '− ') + fmtMoney(Math.abs(net)).replace('$', '$')}
            mono
            color={positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
            bold
          />
        </div>

        <div className={`rounded-xl p-3 ${
          projPositive
            ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20'
            : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20'
        }`}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">Projected end of week</p>
          <p className={`text-lg font-bold font-mono ${projPositive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
            {fmtMoney(projected)}
          </p>
        </div>
      </div>

      {/* Color legend */}
      <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-3">Legend</p>
        <ul className="space-y-2 text-xs">
          <Legend swatchClass="bg-[#EAF3DE] dark:bg-[#1d2e0e]" textClass="text-[#27500A] dark:text-emerald-300" label="Inflow" />
          <Legend swatchClass="bg-[#FAEEDA] dark:bg-[#3a2710]" textClass="text-[#633806] dark:text-orange-300" label="Loan payment (locked)" />
          <Legend swatchClass="bg-[#E6F1FB] dark:bg-[#0f2233]" textClass="text-[#0C447C] dark:text-sky-300" label="AP bill" />
          <Legend swatchClass="bg-[#FCEBEB] dark:bg-[#371616]" textClass="text-[#791F1F] dark:text-red-300" label="Custom expense" />
          <li className="flex items-center gap-2 pt-1">
            <span className="inline-block w-4 h-4 rounded bg-[#FCEBEB] dark:bg-[#371616]" style={{ borderLeft: '2px dashed #E24B4A' }} />
            <span className="text-gray-600 dark:text-slate-400">Recurring (dashed left)</span>
          </li>
        </ul>
      </div>
    </aside>
  )
}

function Row({ label, value, mono, color, bold, action }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
        {action}
      </div>
      <span className={`${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : 'font-semibold'} text-sm ${color || 'text-gray-700 dark:text-slate-300'}`}>
        {value}
      </span>
    </div>
  )
}

function Legend({ swatchClass, textClass, label }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`inline-block w-4 h-4 rounded ${swatchClass}`} />
      <span className={`${textClass} font-medium`}>{label}</span>
    </li>
  )
}
