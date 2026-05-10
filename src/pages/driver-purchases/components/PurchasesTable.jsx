import { useNavigate } from 'react-router-dom'
import { S } from '../../../lib/styles'
import StatusPill from './StatusPill'

function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtFreq(f) {
  if (!f) return ''
  if (f === 'weekly') return '/wk'
  if (f === 'biweekly') return '/2wk'
  if (f === 'monthly') return '/mo'
  return ''
}

export default function PurchasesTable({ rows = [] }) {
  const navigate = useNavigate()
  if (rows.length === 0) {
    return (
      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Driver / unit</th>
              <th className={S.th}>Status</th>
              <th className={S.th}>Payment</th>
              <th className={S.th}>Balance</th>
              <th className={S.th}>Last charged</th>
              <th className={S.th}>Linked</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-slate-600">
                No driver purchases yet. Phase 2 will import historical records from ClickUp.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={`${S.card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className={S.tableHead}>
          <tr>
            <th className={S.th}>Driver / truck</th>
            <th className={S.th}>Status</th>
            <th className={S.th}>Payment</th>
            <th className={S.th}>Balance</th>
            <th className={S.th}>Last charged</th>
            <th className={S.th}>Linked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => navigate(`/financial-controls/driver-purchases/${r.id}`)}
              className={`${S.tableRow} cursor-pointer`}
            >
              <td className={S.td}>
                <div className="font-medium text-gray-900 dark:text-slate-200">
                  {r.driver_internal_id && (
                    <span className="text-gray-500 dark:text-slate-500 font-mono font-normal mr-1.5">#{r.driver_internal_id}</span>
                  )}
                  {r.driver_internal_id && <span className="text-gray-400 dark:text-slate-600 font-normal mr-1.5">·</span>}
                  {r.driver_name}
                </div>
                {r.truck_number && (
                  <div className="text-xs text-gray-500 dark:text-slate-500 font-mono">
                    Unit - {r.truck_number}
                  </div>
                )}
              </td>
              <td className={S.td}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusPill name={r.status_name} colorHex={r.status_color} />
                  {r.title_release_pending && <TitlePendingBadge />}
                </div>
              </td>
              <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300`}>
                {r.payment_amount ? fmtMoney(r.payment_amount) : '—'}
                <span className="text-xs text-gray-400 dark:text-slate-500">{fmtFreq(r.payment_frequency)}</span>
              </td>
              <td className={`${S.td} font-mono text-gray-900 dark:text-slate-200`}>
                {fmtMoney(r.current_balance)}
              </td>
              <td className={`${S.td} text-xs text-gray-400 dark:text-slate-500 italic`}>
                Phase 3
              </td>
              <td className={S.td}>
                {r.underlying_loan_id ? (
                  <div className="text-xs">
                    <div className="text-gray-700 dark:text-slate-300">{r.underlying_lender_name || '—'}</div>
                    <div className="font-mono text-gray-400 dark:text-slate-500">{r.underlying_loan_number || ''}</div>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-slate-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Compact amber pill — KeyRound icon + "Title pending" — shown next to
// the StatusPill on rows where the driver is paid off but the physical
// title hand-off hasn't been recorded yet. Spottable while scrolling
// without needing to filter.
function TitlePendingBadge() {
  return (
    <span
      title="Driver fully paid — title not yet handed over"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 whitespace-nowrap"
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7.5" cy="15.5" r="5.5" />
        <path d="m21 2-9.6 9.6" />
        <path d="m15.5 7.5 3 3L22 7l-3-3" />
      </svg>
      Title pending
    </span>
  )
}
