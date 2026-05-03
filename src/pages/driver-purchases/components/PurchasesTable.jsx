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
  if (rows.length === 0) {
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
            <tr key={r.id} className={S.tableRow}>
              <td className={S.td}>
                <div className="font-medium text-gray-900 dark:text-slate-200">{r.driver_name}</div>
                <div className="text-xs text-gray-500 dark:text-slate-500 font-mono">
                  {r.truck_number || '—'}
                  {r.driver_internal_id && <span className="ml-2 text-gray-400">#{r.driver_internal_id}</span>}
                </div>
              </td>
              <td className={S.td}>
                <StatusPill name={r.status_name} colorHex={r.status_color} />
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
