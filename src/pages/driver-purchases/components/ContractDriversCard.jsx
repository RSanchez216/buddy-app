import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'
import { fmtDate } from '../utils/format'
import DriverPicker from './DriverPicker'

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/)
  return (((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '')).toUpperCase() || '?'
}

function Avatar({ name }) {
  return (
    <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600/40">
      {initials(name)}
    </div>
  )
}

function Tag({ children, tone = 'gray', title }) {
  const cls = {
    gray:  'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-600/30',
    blue:  'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
  }[tone]
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {children}
    </span>
  )
}

// "Drivers on this contract" — the purchaser plus everyone assigned to the
// contract's truck (with drove-dates) and any manually-added associations.
// Fed by get_contract_drivers(); manual rows are add/removable. This is the
// set a future TMS-adjustments importer will match deductions against.
export default function ContractDriversCard({ purchaseId, canEdit }) {
  const { user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!purchaseId) return
    setLoading(true)
    const { data, error } = await supabase.rpc('get_contract_drivers', { p_dp_id: purchaseId })
    if (error) { console.error('get_contract_drivers failed', error); setRows([]) }
    else setRows(data || [])
    setLoading(false)
  }, [purchaseId])

  useEffect(() => { load() }, [load])

  const purchaser = rows.find(r => r.is_purchaser)
  const others = rows.filter(r => !r.is_purchaser)
  const listedIds = rows.map(r => r.driver_id)

  async function addDriver(driverId) {
    if (!driverId || busy) return
    setBusy(true)
    const { error } = await supabase
      .from('driver_purchase_associated_drivers')
      .insert({ driver_purchase_id: purchaseId, driver_id: driverId, added_by: user?.id || null })
    setBusy(false)
    if (error) { toast.error("Couldn't add driver", error); return }
    toast.success('Driver associated')
    setAdding(false)
    load()
  }

  async function removeManual(driverId) {
    if (busy) return
    setBusy(true)
    const { error } = await supabase
      .from('driver_purchase_associated_drivers')
      .delete()
      .eq('driver_purchase_id', purchaseId)
      .eq('driver_id', driverId)
    setBusy(false)
    if (error) { toast.error("Couldn't remove association", error); return }
    toast.success('Association removed')
    load()
  }

  return (
    <div className={`${S.card} p-5 space-y-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Drivers on this contract</h3>
        {canEdit && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            + Add associated driver
          </button>
        )}
      </div>

      {canEdit && adding && (
        <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-slate-400">Add associated driver</span>
            <button onClick={() => setAdding(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">Cancel</button>
          </div>
          <DriverPicker value={null} driver={null} onChange={(id) => addDriver(id)} excludeIds={listedIds} placeholder="Search driver to associate…" />
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 dark:text-slate-600">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-600 italic">No drivers found.</p>
      ) : (
        <ul className="space-y-2.5">
          {purchaser && <DriverRow key={purchaser.driver_id} row={purchaser} canEdit={canEdit} busy={busy} onRemove={removeManual} />}
          {others.map(r => <DriverRow key={r.driver_id} row={r} canEdit={canEdit} busy={busy} onRemove={removeManual} />)}
        </ul>
      )}

      <p className="text-[11px] text-gray-400 dark:text-slate-500 pt-2 border-t border-gray-100 dark:border-white/5">
        On import, a deduction is matched to this contract if it&apos;s under the purchaser or any driver listed here.
      </p>
    </div>
  )
}

function DriverRow({ row, canEdit, busy, onRemove }) {
  const current = row.is_assigned && row.drove_end == null
  return (
    <li className="flex items-start gap-3">
      <Avatar name={row.full_name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">{row.full_name}</span>
          {row.internal_id && <span className="font-mono text-xs text-gray-500 dark:text-slate-500">#{row.internal_id}</span>}
          {row.is_purchaser && current && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
              Current
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-0.5">
          {row.is_purchaser ? 'Purchaser · responsible for payments' : 'Associated · deductions may post under this driver'}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          {row.is_assigned && (
            <Tag title="Assigned to the contract's truck for this window">
              drove {fmtDate(row.drove_start)} – {row.drove_end ? fmtDate(row.drove_end) : 'present'}
            </Tag>
          )}
          {row.is_manual && <Tag tone="blue" title="Manually associated">Manual</Tag>}
          {row.is_manual && canEdit && (
            <button
              onClick={() => onRemove(row.driver_id)}
              disabled={busy}
              title="Remove manual association"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-transparent hover:border-red-200 dark:hover:border-red-500/20 disabled:opacity-50 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              remove
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
