import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import RecordPaymentModal from './RecordPaymentModal'
import { fmtMoney, fmtDate } from '../utils/format'

const SOURCE_LABEL = {
  generated:      'Generated',
  manual:         'Manual',
  payroll_import: 'Payroll',
  reversal:       'Reversal',
}

const METHOD_LABEL = {
  manual:  'Manual',
  cash:    'Cash',
  wire:    'Wire',
  check:   'Check',
  payroll: 'Payroll',
  other:   'Other',
}

// Variance traffic-lights: green ≥ 0, amber for small shorts, red for >$100 short.
function varianceClass(v) {
  const n = Number(v || 0)
  if (n >= 0) return 'text-emerald-600 dark:text-emerald-400'
  if (n > -100) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

// Row tint: missed (expected > 0, actual = 0, period ended) → red wash;
// reversal (actual < 0) → blue wash; everything else neutral.
function rowTint(p) {
  const actual = Number(p.actual_amount || 0)
  if (actual < 0) return 'bg-blue-50/50 dark:bg-blue-500/5'
  const ended = p.period_end && new Date(p.period_end + 'T00:00:00') < new Date()
  if (actual === 0 && Number(p.expected_amount || 0) > 0 && ended) return 'bg-red-50/50 dark:bg-red-500/5'
  return ''
}

export default function PaymentHistorySection({ purchase, canEdit, onChange }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRow, setEditRow] = useState(null)

  const load = useCallback(async () => {
    if (!purchase) return
    setLoading(true)
    const { data } = await supabase
      .from('driver_purchase_payments')
      .select('*')
      .eq('driver_purchase_id', purchase.id)
      .order('period_end', { ascending: false })
      .limit(100)
    setRows(data || [])
    setLoading(false)
  }, [purchase])

  useEffect(() => { load() }, [load])

  function openNew() { setEditRow(null); setShowModal(true) }
  function openEdit(row) { if (!canEdit) return; setEditRow(row); setShowModal(true) }
  function onModalClose() { setShowModal(false); setEditRow(null) }
  function onRecorded() {
    setShowModal(false); setEditRow(null)
    load()
    onChange?.()
  }

  return (
    <div className={`${S.card} p-5 space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Payment history</h3>
        {canEdit && (
          <button
            onClick={openNew}
            className="px-3 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors"
          >
            + Record payment
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 dark:text-slate-600">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-600 italic py-2">
          No payment history yet. {canEdit ? 'Click + Record payment to log the first one.' : ''}
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 dark:border-white/5">
              <tr className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                <th className="text-left py-2 pr-3">Period</th>
                <th className="text-right py-2 px-3">Expected</th>
                <th className="text-right py-2 px-3">Actual</th>
                <th className="text-right py-2 px-3">Variance</th>
                <th className="text-left py-2 px-3">Method</th>
                <th className="text-left py-2 px-3">Source</th>
                <th className="text-center py-2 px-3">Reconciled</th>
                <th className="text-left py-2 pl-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr
                  key={p.id}
                  onClick={() => openEdit(p)}
                  className={`border-b border-gray-50 dark:border-white/[0.03] ${rowTint(p)} ${
                    canEdit ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]' : ''
                  }`}
                  title={canEdit ? 'Click to edit' : undefined}
                >
                  <td className="py-1.5 pr-3 whitespace-nowrap text-xs text-gray-700 dark:text-slate-300">
                    {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-xs text-gray-700 dark:text-slate-300">
                    {fmtMoney(p.expected_amount)}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-xs text-gray-900 dark:text-slate-200">
                    {fmtMoney(p.actual_amount)}
                  </td>
                  <td className={`py-1.5 px-3 text-right font-mono text-xs font-semibold ${varianceClass(p.variance)}`}>
                    {Number(p.variance) >= 0 ? '+' : ''}{fmtMoney(p.variance)}
                  </td>
                  <td className="py-1.5 px-3 text-xs text-gray-500 dark:text-slate-400">
                    {METHOD_LABEL[p.payment_method] || p.payment_method || '—'}
                  </td>
                  <td className="py-1.5 px-3 text-[11px]">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">
                      {SOURCE_LABEL[p.payment_source] || p.payment_source}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-center text-xs">
                    {p.reconciled
                      ? <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                      : <span className="text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="py-1.5 pl-3 text-xs text-gray-500 dark:text-slate-400 max-w-[14rem] truncate" title={p.reason || ''}>
                    {p.reason || (Number(p.actual_amount || 0) === 0 && Number(p.expected_amount || 0) > 0
                      ? <span className="italic text-red-600/80 dark:text-red-400/80">Missed</span>
                      : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordPaymentModal
        open={showModal}
        onClose={onModalClose}
        purchase={purchase}
        existingPayment={editRow}
        onRecorded={onRecorded}
      />
    </div>
  )
}
