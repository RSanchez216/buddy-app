import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// Compact amber pill — clicking it opens a small popover listing the
// account's unclassified reconciliation adjustments. Each row in the
// popover calls onSelectAdjustment(id) so the parent can mount the
// AdjustmentDetailsModal.
//
// Total is pre-aggregated from v_funding_accounts_with_balance so the
// pill renders instantly. The per-item list is lazy — only queried
// when the popover opens.

function fmtMoney(n) {
  const num = Number(n || 0)
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}

export default function NeedsReviewPill({ fundingAccountId, count, total, onSelectAdjustment }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClickAway(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [open])

  useEffect(() => {
    if (!open || !fundingAccountId) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('funding_account_adjustments')
        .select('id, adjustment_date, amount')
        .eq('funding_account_id', fundingAccountId)
        .is('classification', null)
        .order('adjustment_date', { ascending: false })
      if (cancelled) return
      setRows(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open, fundingAccountId])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
        title="Reconciliation adjustments awaiting classification"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5 3a1 1 0 011-1h11a1 1 0 01.8 1.6L15 7l2.8 3.4A1 1 0 0117 12H7v9a1 1 0 01-2 0V3z" />
        </svg>
        {count} needs review · {fmtMoney(total)}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 right-0 w-72 rounded-xl bg-white dark:bg-[#0d0d1f] border border-amber-200 dark:border-amber-500/30 shadow-xl">
          <div className="px-3 py-2 border-b border-amber-100 dark:border-amber-500/20">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              Needs review
            </div>
            <div className="text-[10px] text-gray-500 dark:text-slate-500 mt-0.5">
              Click an item to classify
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-slate-500">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-slate-500 italic">
                No items.
              </div>
            ) : rows.map(r => {
              const signed = Number(r.amount) >= 0
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { setOpen(false); onSelectAdjustment?.(r.id) }}
                  className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
                >
                  <span className="text-xs text-gray-700 dark:text-slate-300">{fmtDate(r.adjustment_date)}</span>
                  <span className={`text-xs font-mono font-semibold ${signed ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                    {signed ? '+' : '−'}{fmtMoney(Math.abs(Number(r.amount || 0)))}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
