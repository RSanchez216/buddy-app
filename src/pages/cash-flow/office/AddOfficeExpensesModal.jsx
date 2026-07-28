import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { useExpenseCategories } from '../../../hooks/useExpenseCategories'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import {
  rateFor, listExpenses, periodRange, stepPeriod,
  todayISO, rate2, usd2, local0,
} from './officeData'

// Add one or more office expenses. Expenses are entered in LOCAL currency; the
// USD value is derived from the transfer rate that applies to each row's date
// (office_rate_for), stamped as fx_rate + rate_transfer_id at insert time.
// amount_usd is a GENERATED column — never written. The whole batch inserts in
// a single statement (all-or-nothing).

const emptyRow = (date) => ({ expense_date: date, category: '', description: '', amount_local: '' })

export default function AddOfficeExpensesModal({ open, office, defaultDate, periodLabel, onClose, onSaved }) {
  const { user } = useAuth()
  const toast = useToast()
  const { activeOffice: categories } = useExpenseCategories()
  const [rows, setRows] = useState([emptyRow(defaultDate || todayISO())])
  const [rateCache, setRateCache] = useState({}) // dateISO → { fx_rate, transfer_id, is_inherited } | null
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ccy = office?.currency_code || ''

  useEffect(() => {
    if (!open) return
    setRows([emptyRow(defaultDate || todayISO())])
    setRateCache({}); setError('')
  }, [open, defaultDate])

  // Resolve the applicable rate for every distinct row date (once each).
  useEffect(() => {
    if (!open || !office) return
    let cancelled = false
    const need = [...new Set(rows.map(r => r.expense_date).filter(Boolean))]
      .filter(d => !(d in rateCache))
    if (!need.length) return
    ;(async () => {
      const next = {}
      for (const d of need) {
        try { next[d] = await rateFor(office.id, d) } catch { next[d] = null }
      }
      if (!cancelled) setRateCache(prev => ({ ...prev, ...next }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, office, rows])

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, emptyRow(rs[rs.length - 1]?.expense_date || defaultDate || todayISO())])
  const removeRow = (i) => setRows(rs => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)

  // Rate that applies to the modal's default date — shown in the strip.
  const headRate = defaultDate ? rateCache[defaultDate] : null

  // Copy last month's expenses into rows, re-dated to this period's start.
  async function copyLastMonth() {
    if (!office) return
    setCopying(true); setError('')
    try {
      const prevAnchor = stepPeriod('month', defaultDate || todayISO(), -1)
      const pr = periodRange('month', prevAnchor)
      const prev = await listExpenses(office.id, pr.from, pr.to)
      if (!prev.length) { setError(`No expenses found for ${pr.label} to copy`); setCopying(false); return }
      const date = defaultDate || todayISO()
      setRows(prev.map(e => ({
        expense_date: date,
        category: e.category || '',
        description: e.description || '',
        amount_local: e.amount_local != null ? String(e.amount_local) : '',
      })))
    } catch (e) {
      setError(e.message || 'Copy failed')
    } finally {
      setCopying(false)
    }
  }

  const usdFor = (r) => {
    const info = rateCache[r.expense_date]
    const amt = Number(r.amount_local)
    if (!info?.fx_rate || !amt) return null
    return amt / Number(info.fx_rate)
  }

  const totalLocal = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount_local) || 0), 0), [rows])

  async function save() {
    // Validate every row before touching the DB (all-or-nothing). A missing
    // rate is NO LONGER a blocker — rows without a rate save as pending.
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.expense_date) return setError(`Row ${i + 1}: date is required`)
      if (!r.category) return setError(`Row ${i + 1}: choose a category`)
      const amt = Number(r.amount_local)
      if (!amt || amt <= 0) return setError(`Row ${i + 1}: ${ccy} amount must be greater than 0`)
    }

    setSaving(true); setError('')
    const payload = rows.map(r => {
      const info = rateCache[r.expense_date]
      const base = {
        office_id: office.id,
        category: r.category,
        description: r.description.trim() || null,
        expense_date: r.expense_date,
        amount_local: Number(r.amount_local),
        created_by: user?.id || null,
      }
      // Rated → stamp fx_rate + transfer. Pending → OMIT fx_rate entirely (never
      // send 0; the > 0 check rejects it). The DB trigger fills it later.
      if (info?.fx_rate) {
        base.fx_rate = Number(info.fx_rate)
        base.rate_transfer_id = info.transfer_id || null
        base.rate_is_manual = false
      }
      return base
    })
    const { error: e } = await supabase.from('office_expenses').insert(payload)
    if (e) { setError(`Couldn't save: ${e.message || 'unknown error'}`); toast.error("Couldn't save expenses", e); setSaving(false); return }
    const pend = payload.filter(p => p.fx_rate == null).length
    toast.success(`${payload.length} expense${payload.length === 1 ? '' : 's'} added${pend ? ` · ${pend} pending a rate` : ''}`)
    setSaving(false)
    onSaved?.()
    onClose?.()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add expenses — ${office?.name || ''}`} size="3xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {/* Rate strip — informational. Without a rate, expenses still save (as
            pending); the USD fills in automatically once a transfer is recorded. */}
        {headRate?.fx_rate ? (
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-cyan-50 dark:bg-cyan-500/5 border border-cyan-200 dark:border-cyan-500/20">
            <div className="text-xs font-medium text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">Rate for {periodLabel || 'this period'}</div>
            <div className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">
              1 USD = {rate2(headRate.fx_rate)} {ccy}{headRate.is_inherited && <span className="ml-2 text-[11px] font-normal opacity-70">(inherited)</span>}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/[0.08] border border-amber-200 dark:border-amber-500/20">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">No rate yet for {periodLabel || 'this period'}</div>
            <div className="text-xs text-amber-700 dark:text-amber-400">Expenses save as <span className="font-semibold">pending</span> — USD fills in when a transfer is recorded.</div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button type="button" onClick={copyLastMonth} disabled={copying} className={S.btnSecondary}>
            {copying ? 'Copying…' : 'Copy last month'}
          </button>
          <button type="button" onClick={addRow} className={S.btnSecondary}>+ Add row</button>
        </div>

        {/* Rows */}
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-1 text-[11px] font-semibold text-gray-500 dark:text-slate-500 uppercase tracking-wide">
            <div className="col-span-2">Date</div>
            <div className="col-span-3">Category</div>
            <div className="col-span-3">Description</div>
            <div className="col-span-2">{ccy}</div>
            <div className="col-span-1 text-right">USD</div>
            <div className="col-span-1" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input type="date" className={`${S.input} col-span-2`} value={r.expense_date}
                onChange={e => setRow(i, { expense_date: e.target.value })} />
              <select className={`${S.input} col-span-3`} value={r.category}
                onChange={e => setRow(i, { category: e.target.value })}>
                <option value="">— Category —</option>
                {categories.map(c => <option key={c.name} value={c.name}>{c.display_label}</option>)}
              </select>
              <input className={`${S.input} col-span-3`} value={r.description}
                onChange={e => setRow(i, { description: e.target.value })} placeholder="Optional" />
              <input type="number" step="0.01" min="0" className={`${S.input} col-span-2`} value={r.amount_local}
                onChange={e => setRow(i, { amount_local: e.target.value })} placeholder="0" />
              <div className="col-span-1 text-right text-sm tabular-nums">
                {Number(r.amount_local) > 0
                  ? (usdFor(r) != null
                    ? <span className="text-gray-600 dark:text-slate-400">{usd2(usdFor(r))}</span>
                    : <span className="text-amber-600 dark:text-amber-400 text-xs">pending</span>)
                  : <span className="text-gray-400 dark:text-slate-500">—</span>}
              </div>
              <div className="col-span-1 flex justify-end">
                {rows.length > 1 && (
                  <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500 px-1 py-2" title="Remove row">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-baseline justify-between pt-3 border-t border-gray-100 dark:border-white/5">
          <span className="text-sm text-gray-500 dark:text-slate-400">
            <span className="font-semibold text-gray-700 dark:text-slate-300">Total:</span> {local0(totalLocal, ccy)}
          </span>
          <div className={S.modalFooter}>
            <button onClick={onClose} className={S.btnCancel}>Cancel</button>
            <button onClick={save} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : `Save ${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
