import { Link } from 'react-router-dom'
import { fmtMoney } from '../utils/format'

// Red "behind on Driver Purchases" chip. `href` deep-links the behind contract.
// compact → the shorter Idle-Review badge wording.
export default function BehindOnPurchaseChip({ href, totalPastDue, compact = false }) {
  const money = fmtMoney(totalPastDue)
  const cls = `inline-flex items-center gap-1 rounded font-semibold whitespace-nowrap bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'}`
  const inner = (
    <>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
      {compact ? <>behind on purchase · {money}</> : <>Falling behind on Driver Purchases · {money} past due</>}
    </>
  )
  return href ? <Link to={href} className={cls}>{inner}</Link> : <span className={cls}>{inner}</span>
}
