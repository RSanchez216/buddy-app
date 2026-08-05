// Shared compact metric strip — a single horizontal row inside one rounded
// container: a tinted lead cell on the left (heavier right divider), then equal
// cells split by thin dividers, each a large value over a tiny uppercase label.
// Extracted from the Shift Board's week/shift bands so the board, the shift band
// and the Shift Reports strip are one visual pattern with no duplicated styles.
//
// Compose it: <MetricStrip tone><StripLead/> [<StripHero/>] <StripCells>
// <StripCell/>…</StripCells> [<StripTrailing/>]</MetricStrip>.

const TONE = {
  orange: {
    wrap: 'border-orange-100 dark:border-white/10 from-[#FFF8F3] to-white dark:from-orange-500/[0.05] dark:to-transparent',
    leadBorder: 'border-orange-400 dark:border-orange-500/40',
    eyebrow: 'text-orange-600 dark:text-orange-400',
    divider: 'border-orange-100/70 dark:border-white/5',
    heroDivider: 'border-orange-100 dark:border-white/5',
  },
  emerald: {
    wrap: 'border-emerald-100 dark:border-white/10 from-emerald-50/70 to-white dark:from-emerald-500/[0.04] dark:to-transparent',
    leadBorder: 'border-emerald-400 dark:border-emerald-500/40',
    eyebrow: 'text-emerald-600 dark:text-emerald-400',
    divider: 'border-emerald-100/70 dark:border-white/5',
    heroDivider: 'border-emerald-100 dark:border-white/5',
  },
}
const toneOf = (t) => TONE[t] || TONE.orange

export function MetricStrip({ tone = 'orange', children }) {
  return <div className={`flex items-stretch rounded-2xl border overflow-hidden bg-gradient-to-r ${toneOf(tone).wrap}`}>{children}</div>
}

// The wider tinted lead cell — a heavier right border sets it apart from the row.
export function StripLead({ tone = 'orange', children }) {
  return <div className={`flex flex-col justify-center px-4 py-2 border-r-2 ${toneOf(tone).leadBorder} shrink-0`}>{children}</div>
}

export function StripEyebrow({ tone = 'orange', children }) {
  return <span className={`text-[10px] font-bold uppercase tracking-widest ${toneOf(tone).eyebrow}`}>{children}</span>
}

// A second fixed-width lead-ish cell (the Shift band's "drivers reviewed" hero).
export function StripHero({ tone = 'orange', title, className = '', children }) {
  return <div title={title} className={`flex flex-col justify-center px-4 py-2 border-r ${toneOf(tone).heroDivider} shrink-0 ${className}`}>{children}</div>
}

export function StripCells({ children }) {
  return <div className="flex-1 flex items-stretch">{children}</div>
}

// One value/label cell. `value` is a node so a composite ("$0 / $0") can colour
// its parts. `valueCls` carries the size + colour; `badge`/`sublabel` are optional.
export function StripCell({ tone = 'orange', first, value, valueCls = 'text-[19px] text-gray-900 dark:text-white', label, sublabel, badge, title }) {
  return (
    <div title={title} className={`flex-1 flex flex-col items-center justify-center px-1 py-2 cursor-default ${first ? '' : 'border-l ' + toneOf(tone).divider}`}>
      <span className={`font-bold leading-none tabular-nums ${valueCls}`}>{value}</span>
      <span className="mt-1 flex items-center gap-1">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</span>
        {badge}
      </span>
      {sublabel && <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-gray-300 dark:text-slate-600">{sublabel}</span>}
    </div>
  )
}

// A trailing cell separated by a thin divider (the Copy-week button).
export function StripTrailing({ tone = 'orange', children }) {
  return <div className={`flex items-center px-3 shrink-0 border-l ${toneOf(tone).divider}`}>{children}</div>
}
