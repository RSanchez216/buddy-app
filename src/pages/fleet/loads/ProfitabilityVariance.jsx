import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'

function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtMoney2(n) {
  if (n == null) return '—'
  const v = Number(n)
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtNum(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtPct(n) {
  if (n == null || n === 0) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function DeltaCell({ value, isNegativeBad = false }) {
  if (value == null || value === 0) return <span className="text-gray-400 dark:text-slate-500">—</span>
  const isNegative = value < 0
  const color = isNegativeBad
    ? isNegative ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
    : isNegative ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
  return <span className={`font-mono ${color}`}>{isNegative ? '−' : '+'}{fmtMoney2(Math.abs(value))}</span>
}

export default function ProfitabilityVariance({ from, to, basis = 'delivery' }) {
  const toast = useToast()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const { data: variance, error } = await supabase.rpc('driver_settlement_variance', {
          p_from: from,
          p_to: to,
          p_basis: basis,
        })
        if (error) throw error
        setData(variance || [])
      } catch (err) {
        toast.error('Failed to load variance data', err)
        console.error(err)
        setData([])
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [from, to, basis, toast])

  const sorted = useMemo(
    () => [...data].sort((a, b) => (Number(b.est_company_contribution || 0) + Number(b.act_company_contribution || 0)) - (Number(a.est_company_contribution || 0) + Number(a.act_company_contribution || 0))),
    [data]
  )

  // Totals
  const totals = useMemo(() => {
    const t = {
      est_loads: 0, est_revenue: 0, est_driver_pay: 0, est_company_contribution: 0,
      act_miles: 0, act_driver_pay: 0, act_fuel: 0, act_settlement: 0, act_company_contribution: 0,
      pay_delta: 0, contribution_delta: 0,
    }
    for (const row of data) {
      t.est_loads += Number(row.est_loads || 0)
      t.est_revenue += Number(row.est_revenue || 0)
      t.est_driver_pay += Number(row.est_driver_pay || 0)
      t.est_company_contribution += Number(row.est_company_contribution || 0)
      t.act_miles += Number(row.act_miles || 0)
      t.act_driver_pay += Number(row.act_driver_pay || 0)
      t.act_fuel += Number(row.act_fuel || 0)
      t.act_settlement += Number(row.act_settlement || 0)
      t.act_company_contribution += Number(row.act_company_contribution || 0)
      t.pay_delta += Number(row.pay_delta || 0)
      t.contribution_delta += Number(row.contribution_delta || 0)
    }
    return t
  }, [data])

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={`${S.card} p-3`}>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">Est. total pay</div>
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400 font-mono mt-0.5">{fmtMoney(totals.est_driver_pay)}</div>
        </div>
        <div className={`${S.card} p-3`}>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">Act. total pay</div>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">{fmtMoney(totals.act_driver_pay)}</div>
        </div>
        <div className={`${S.card} p-3`}>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">Pay delta</div>
          <DeltaCell value={totals.pay_delta} isNegativeBad />
        </div>
        <div className={`${S.card} p-3`}>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 dark:text-slate-500">Contrib. delta</div>
          <DeltaCell value={totals.contribution_delta} isNegativeBad={false} />
        </div>
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#0d0d1f]">
              <tr>
                <th className={`${S.th} min-w-[160px]`}>Driver · type</th>
                {/* Estimate */}
                <th className={`${S.th} text-right text-blue-600 dark:text-blue-400`}>Est. loads</th>
                <th className={`${S.th} text-right text-blue-600 dark:text-blue-400`}>Est. revenue</th>
                <th className={`${S.th} text-right text-blue-600 dark:text-blue-400`}>Est. driver pay</th>
                <th className={`${S.th} text-right text-blue-600 dark:text-blue-400`} title="Revenue − est. driver pay">Est. comp.</th>
                {/* Actual */}
                <th className={`${S.th} text-right text-emerald-600 dark:text-emerald-400`}>Act. miles</th>
                <th className={`${S.th} text-right text-emerald-600 dark:text-emerald-400`}>Act. driver pay</th>
                <th className={`${S.th} text-right text-emerald-600 dark:text-emerald-400`}>Fuel</th>
                <th className={`${S.th} text-right text-emerald-600 dark:text-emerald-400`}>Settlement</th>
                <th className={`${S.th} text-right text-emerald-600 dark:text-emerald-400`} title="Settlement − fuel − adjustment">Comp.</th>
                {/* Delta */}
                <th className={`${S.th} text-right text-gray-600 dark:text-slate-400`}>Pay Δ</th>
                <th className={`${S.th} text-right text-gray-600 dark:text-slate-400`}>Comp. Δ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-xs">No settlement data imported yet for this period.</td></tr>
              ) : sorted.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                  {/* Driver name */}
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                    <div>{row.driver_name || '—'}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {row.driver_type && <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">{row.driver_type}</span>}
                      {!row.has_estimate && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">no estimate</span>}
                      {!row.has_actual && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">no settlement</span>}
                    </div>
                  </td>

                  {/* Estimate */}
                  <td className={`${S.td} text-right font-mono text-blue-700 dark:text-blue-300`}>{fmtNum(row.est_loads)}</td>
                  <td className={`${S.td} text-right font-mono text-blue-700 dark:text-blue-300`}>{fmtMoney(row.est_revenue)}</td>
                  <td className={`${S.td} text-right font-mono text-blue-700 dark:text-blue-300`}>{fmtMoney(row.est_driver_pay)}</td>
                  <td className={`${S.td} text-right font-mono text-blue-600 dark:text-blue-400 font-semibold`}>{fmtMoney(row.est_company_contribution)}</td>

                  {/* Actual */}
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300`}>{fmtNum(row.act_miles)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300`}>{fmtMoney(row.act_driver_pay)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300`}>{fmtMoney(row.act_fuel)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300`}>{fmtMoney(row.act_settlement)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold`}>{fmtMoney(row.act_company_contribution)}</td>

                  {/* Delta */}
                  <td className={`${S.td} text-right`}><DeltaCell value={row.pay_delta} isNegativeBad /></td>
                  <td className={`${S.td} text-right`}><DeltaCell value={row.contribution_delta} isNegativeBad={false} /></td>
                </tr>
              ))}
            </tbody>
            {!loading && sorted.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.02] font-medium">
                  <td className={`${S.td} text-xs text-gray-600 dark:text-slate-300`}>Total · {sorted.length} drivers</td>
                  <td className={`${S.td} text-right font-mono text-blue-700 dark:text-blue-300 text-xs`}>{fmtNum(totals.est_loads)}</td>
                  <td className={`${S.td} text-right font-mono text-blue-700 dark:text-blue-300 text-xs`}>{fmtMoney(totals.est_revenue)}</td>
                  <td className={`${S.td} text-right font-mono text-blue-700 dark:text-blue-300 text-xs`}>{fmtMoney(totals.est_driver_pay)}</td>
                  <td className={`${S.td} text-right font-mono text-blue-600 dark:text-blue-400 text-xs font-semibold`}>{fmtMoney(totals.est_company_contribution)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300 text-xs`}>{fmtNum(totals.act_miles)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300 text-xs`}>{fmtMoney(totals.act_driver_pay)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300 text-xs`}>{fmtMoney(totals.act_fuel)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-700 dark:text-emerald-300 text-xs`}>{fmtMoney(totals.act_settlement)}</td>
                  <td className={`${S.td} text-right font-mono text-emerald-600 dark:text-emerald-400 text-xs font-semibold`}>{fmtMoney(totals.act_company_contribution)}</td>
                  <td className={`${S.td} text-right text-xs`}><DeltaCell value={totals.pay_delta} isNegativeBad /></td>
                  <td className={`${S.td} text-right text-xs`}><DeltaCell value={totals.contribution_delta} isNegativeBad={false} /></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Legend */}
      <p className="text-[11px] text-blue-700 dark:text-blue-400 px-4 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 space-y-1">
        <div><strong>Estimated</strong> (blue) — driver pay from compensation rate; loaded dates by delivery date in window</div>
        <div><strong>Actual</strong> (green) — settled driver pay + fuel from import; loaded by settlement date</div>
        <div><strong>Delta</strong> — actual − estimated. Negative = paid less/earned less than estimate.</div>
        <div><strong>"No estimate"</strong> = no loads in BUDDY for this driver in the period. <strong>"No settlement"</strong> = no settlement imported yet.</div>
      </p>
    </div>
  )
}
