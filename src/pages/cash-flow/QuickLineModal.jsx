// Quick line-add modal for the Payment Calendar toolbar.
//
// One parameterized component for all three flow types — the table-of-rows
// pattern is identical, only the row schema and insert path differ. Each
// modal row is its own normalized entry (no batch_id, no shared identity);
// the BatchCard rendering in Phase 1 is the only thing that groups them
// visually on the day column.
//
// Existing modals (AddIncomeModal / AddExpenseModal / AddTransferModal)
// remain for chip edit flows. This is the lighter toolbar entry path.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import SuggestInput from '../../components/SuggestInput'
import { CF, fmtMoney, fmtMoneyExact } from './calendarUtils'
import { useFactors, formatFeeRate } from '../../hooks/useFactors'

const SURFACE = 'payment_calendar_quick_line_add'

const KIND_LABEL = {
  income:   { title: 'Add income lines',   verb: 'income',   accent: 'emerald' },
  expense:  { title: 'Add expense lines',  verb: 'expense',  accent: 'red'     },
  transfer: { title: 'Add transfer lines', verb: 'transfer', accent: 'cyan'    },
}

function emptyIncomeRow(date)   {
  return {
    source_type: 'other',
    amount: '', source: '',
    factor_id: '', gross_amount: '',
    funding_account_id: '', expected_date: date || '', notes: '',
  }
}
function emptyExpenseRow(date)  { return { amount: '', description: '', category: '', funding_account_id: '', planned_pay_date: date || '', cash_impacting: true } }
function emptyTransferRow(date) { return { from_funding_account_id: '', to_funding_account_id: '', amount: '', debit_date: date || '', credit_date: date || '' } }

function emptyRow(kind, date) {
  if (kind === 'income')   return emptyIncomeRow(date)
  if (kind === 'transfer') return emptyTransferRow(date)
  return emptyExpenseRow(date)
}

function rowDate(row, kind) {
  if (kind === 'income')   return row.expected_date
  if (kind === 'transfer') return row.debit_date
  return row.planned_pay_date
}

function fmtAccountOption(a) {
  return a.bank_name ? `${a.name} (${a.bank_name})` : a.name
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

// Per-row validation. Returns { isValid, errors } where errors is keyed by
// the field name that failed. Field names match the row keys so the render
// can red-flag the right input.
function validateRow(row, kind, factorsById) {
  const errors = {}
  if (kind === 'income') {
    if (!row.funding_account_id) errors.funding_account_id = 'Required'
    if (!row.expected_date)      errors.expected_date = 'Required'
    if (row.source_type === 'factor') {
      if (!row.factor_id)         errors.factor_id = 'Required'
      const gross = Number(row.gross_amount)
      if (!row.gross_amount || Number.isNaN(gross) || gross <= 0) errors.gross_amount = 'Gross must be > 0'
      // Factor must still exist (defensive — if user picked one then it
      // got archived in a parallel tab, the dropdown still shows it but
      // a sanity-check here surfaces the issue early).
      if (row.factor_id && factorsById && !factorsById.get(row.factor_id)) errors.factor_id = 'Pick a factor'
    } else {
      const amt = Number(row.amount)
      if (!row.amount || Number.isNaN(amt) || amt <= 0) errors.amount = 'Amount must be > 0'
      if (!row.source?.trim()) errors.source = 'Required'
    }
    return { isValid: Object.keys(errors).length === 0, errors }
  }
  const amt = Number(row.amount)
  if (!row.amount || Number.isNaN(amt) || amt <= 0) errors.amount = 'Amount must be > 0'
  if (kind === 'expense') {
    if (!row.description?.trim())  errors.description = 'Required'
    if (!row.category?.trim())     errors.category = 'Required'
    if (!row.funding_account_id)   errors.funding_account_id = 'Required'
    if (!row.planned_pay_date)     errors.planned_pay_date = 'Required'
  } else if (kind === 'transfer') {
    if (!row.from_funding_account_id) errors.from_funding_account_id = 'Required'
    if (!row.to_funding_account_id)   errors.to_funding_account_id = 'Required'
    if (row.from_funding_account_id && row.to_funding_account_id
        && row.from_funding_account_id === row.to_funding_account_id) {
      errors.to_funding_account_id = 'From and To must differ'
    }
    if (!row.debit_date)  errors.debit_date = 'Required'
    if (!row.credit_date) errors.credit_date = 'Required'
    if (row.debit_date && row.credit_date && row.credit_date < row.debit_date) {
      errors.credit_date = 'Credit on/after debit'
    }
  }
  return { isValid: Object.keys(errors).length === 0, errors }
}

export default function QuickLineModal({ open, kind, focusedDate, onClose, onSaved }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const { active: activeFactors, byId: factorsById } = useFactors()
  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [knownSources, setKnownSources] = useState([])
  const [knownCategories, setKnownCategories] = useState([])
  const [rowErrors, setRowErrors] = useState({}) // { [index]: { field: msg } }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Initial / reset state when the modal opens (or kind changes).
  useEffect(() => {
    if (!open || !kind) return
    setRows([emptyRow(kind, focusedDate)])
    setRowErrors({})
    setError('')
    let cancelled = false
    ;(async () => {
      const tasks = [
        supabase.from('funding_accounts')
          .select('id, name, bank_name')
          .eq('is_active', true)
          .order('name'),
      ]
      if (kind === 'income') {
        // Source suggestions are the prior 'other' sources only — factor
        // entries have their source synthesized from the factor name, so
        // surfacing them as autocomplete suggestions would just clutter
        // the picker.
        tasks.push(
          supabase.from('expected_inflows')
            .select('source')
            .not('source', 'is', null)
            .eq('source_type', 'other')
        )
      }
      if (kind === 'expense') {
        tasks.push(
          supabase.from('custom_outflows').select('category').not('category', 'is', null)
        )
      }
      const results = await Promise.all(tasks)
      if (cancelled) return
      setAccounts(results[0].data || [])
      if (kind === 'income') {
        const sources = [...new Set((results[1].data || []).map(r => r.source).filter(Boolean))].sort()
        setKnownSources(sources)
      } else if (kind === 'expense') {
        const cats = [...new Set((results[1].data || []).map(r => r.category).filter(Boolean))].sort()
        setKnownCategories(cats)
      }
    })()
    return () => { cancelled = true }
  }, [open, kind, focusedDate])

  const meta = kind ? KIND_LABEL[kind] : null

  function addRow() {
    setRows(prev => {
      // New rows inherit the first row's date — the user is filling THIS
      // day's batch, not today's by default.
      const firstDate = prev[0] ? rowDate(prev[0], kind) : focusedDate
      return [...prev, emptyRow(kind, firstDate)]
    })
  }
  function removeRow(i) {
    setRows(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))
    // Drop any error entry for the removed row and re-index the rest.
    setRowErrors(prev => {
      const next = {}
      for (const k of Object.keys(prev)) {
        const idx = Number(k)
        if (idx === i) continue
        next[idx > i ? idx - 1 : idx] = prev[k]
      }
      return next
    })
  }
  function updateRow(i, field, value) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
    // Clear field-level error as soon as the user touches the field.
    if (rowErrors[i]?.[field]) {
      setRowErrors(prev => {
        const next = { ...prev }
        const { [field]: _, ...rest } = next[i] || {}
        if (Object.keys(rest).length === 0) delete next[i]
        else next[i] = rest
        return next
      })
    }
  }

  const totalAmount = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows]
  )

  async function writeAuditLogEntries(tableName, recordIds, total) {
    // Best-effort audit batch. If this fails the user's save still
    // succeeded — log to console and move on.
    if (!recordIds.length) return
    const entries = recordIds.map((id, idx) => ({
      table_name: tableName,
      record_id: id,
      action: 'insert',
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: { surface: SURFACE, line_index: idx, line_total: total },
    }))
    const { error: e } = await supabase.from('audit_log').insert(entries)
    if (e) console.warn('[QuickLineModal] audit_log batch insert failed:', e.message)
  }

  async function saveIncome() {
    // Per row, compute the net amount + synthesized source for factor
    // entries. Both branches collapse to a (parent expected_inflows,
    // child expected_inflow_deposit) pair, matching the existing
    // single-deposit-per-inflow pattern.
    const parents = rows.map(r => {
      if (r.source_type === 'factor') {
        const factor = factorsById.get(r.factor_id)
        const gross = round2(Number(r.gross_amount))
        const net   = round2(gross * (1 - Number(factor?.fee_rate || 0)))
        return {
          source: `Factor — ${factor?.name || ''}`,
          source_type: 'factor',
          factor_id: r.factor_id,
          gross_amount: gross,
          amount: net,
          expected_date: r.expected_date,
          description: r.notes?.trim() || null,
          status: 'pending',
          created_by: user?.id || null,
        }
      }
      return {
        source: r.source.trim(),
        source_type: 'other',
        factor_id: null,
        gross_amount: null,
        amount: Number(r.amount),
        expected_date: r.expected_date,
        description: r.notes?.trim() || null,
        status: 'pending',
        created_by: user?.id || null,
      }
    })

    const { data: inserted, error: pErr } = await supabase
      .from('expected_inflows')
      .insert(parents)
      .select('id')
    if (pErr || !inserted) throw new Error(pErr?.message || 'Failed to create inflow rows')
    const ids = inserted.map(p => p.id)

    const deposits = rows.map((r, i) => {
      const netAmount = r.source_type === 'factor'
        ? round2(Number(r.gross_amount) * (1 - Number(factorsById.get(r.factor_id)?.fee_rate || 0)))
        : Number(r.amount)
      return {
        expected_inflow_id: ids[i],
        funding_account_id: r.funding_account_id,
        amount: netAmount,
        position: 0,
      }
    })
    const { error: dErr } = await supabase.from('expected_inflow_deposits').insert(deposits)
    if (dErr) {
      await supabase.from('expected_inflows').delete().in('id', ids)
      throw new Error(dErr.message)
    }

    // Per-row audit metadata captures the factor distinction so future
    // reporting can filter by surface + source_type.
    const auditMeta = rows.map((r, idx) => ({
      surface: SURFACE,
      line_index: idx,
      line_total: rows.length,
      source_type: r.source_type,
      factor_id: r.source_type === 'factor' ? r.factor_id : null,
    }))
    await supabase.from('audit_log').insert(ids.map((id, i) => ({
      table_name: 'expected_inflows',
      record_id: id,
      action: 'insert',
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: auditMeta[i],
    })))
    return ids
  }

  async function saveExpense() {
    const payload = rows.map(r => ({
      due_date: r.planned_pay_date,
      planned_pay_date: r.planned_pay_date,
      description: r.description.trim(),
      amount: Number(r.amount),
      category: r.category.trim(),
      funding_account_id: r.funding_account_id,
      cash_impacting: !!r.cash_impacting,
      status: 'planned',
      created_by: user?.id || null,
    }))
    const { data: inserted, error: e } = await supabase
      .from('custom_outflows')
      .insert(payload)
      .select('id')
    if (e || !inserted) throw new Error(e?.message || 'Failed to create expense rows')
    const ids = inserted.map(r => r.id)
    await writeAuditLogEntries('custom_outflows', ids, rows.length)
    return ids
  }

  async function saveTransfer() {
    const payload = rows.map(r => ({
      from_funding_account_id: r.from_funding_account_id,
      to_funding_account_id: r.to_funding_account_id,
      amount: Number(r.amount),
      debit_date: r.debit_date,
      credit_date: r.credit_date,
      created_by: user?.id || null,
    }))
    const { data: inserted, error: e } = await supabase
      .from('funding_account_transfers')
      .insert(payload)
      .select('id')
    if (e || !inserted) throw new Error(e?.message || 'Failed to create transfer rows')
    const ids = inserted.map(r => r.id)
    await writeAuditLogEntries('funding_account_transfers', ids, rows.length)
    return ids
  }

  async function handleSave() {
    setError('')
    // All-or-nothing validation: collect errors for every row, abort if any.
    const allErrors = {}
    rows.forEach((r, i) => {
      const { isValid, errors } = validateRow(r, kind, factorsById)
      if (!isValid) allErrors[i] = errors
    })
    if (Object.keys(allErrors).length) {
      setRowErrors(allErrors)
      setError(`Fix ${Object.keys(allErrors).length} row${Object.keys(allErrors).length === 1 ? '' : 's'} before saving.`)
      return
    }
    setSaving(true)
    try {
      if (kind === 'income')   await saveIncome()
      else if (kind === 'expense')  await saveExpense()
      else if (kind === 'transfer') await saveTransfer()
      toast.success(`${rows.length} ${meta.verb} line${rows.length === 1 ? '' : 's'} saved`)
      setSaving(false)
      onSaved?.()
      onClose?.()
    } catch (e) {
      console.error('[QuickLineModal] save failed:', e)
      setError(e?.message || 'Save failed')
      toast.error(`Couldn't save ${meta.verb} lines`, e)
      setSaving(false)
    }
  }

  if (!open || !kind) return null

  return (
    <Modal open={open} onClose={onClose} title={meta.title} size="xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div className="space-y-2">
          {rows.map((row, i) => (
            <LineRow
              key={i}
              kind={kind}
              index={i}
              row={row}
              errors={rowErrors[i] || {}}
              accounts={accounts}
              knownSources={knownSources}
              knownCategories={knownCategories}
              activeFactors={activeFactors}
              factorsById={factorsById}
              isFirst={i === 0}
              showLabels={i === 0}
              canRemove={rows.length > 1}
              onChange={(field, value) => updateRow(i, field, value)}
              onChangeRow={(patch) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))}
              onRemove={() => removeRow(i)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="w-full py-2 text-sm font-medium text-orange-600 dark:text-orange-400 border border-dashed border-orange-300 dark:border-orange-500/30 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-500/5 transition-colors"
        >
          + Add another line
        </button>

        <div className="flex items-baseline justify-between pt-3 border-t border-gray-100 dark:border-white/5">
          <span className="text-sm text-gray-500 dark:text-slate-400">
            <span className="font-semibold text-gray-700 dark:text-slate-300">Total:</span> {fmtMoney(totalAmount)}
            <span className="ml-3 text-xs text-gray-400 dark:text-slate-500">
              {rows.length} {rows.length === 1 ? 'line' : 'lines'}
            </span>
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={CF.btnSave}>
              {saving ? 'Saving…' : `Save ${rows.length} ${meta.verb} line${rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function LineRow({
  kind, index, row, errors, accounts, knownSources, knownCategories,
  activeFactors, factorsById,
  isFirst, showLabels, canRemove, onChange, onChangeRow, onRemove,
}) {
  void isFirst, index
  const trashButton = canRemove && (
    <button
      onClick={onRemove}
      className="text-gray-400 hover:text-red-500 px-1 py-2 shrink-0"
      title="Remove this line"
      type="button"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )

  // Income rows render a Type toggle row on top + a conditional field
  // block below. The expense/transfer kinds stay in the original 14-col
  // single-row grid.
  if (kind === 'income') {
    return (
      <div className="p-2 rounded-xl bg-gray-50 dark:bg-white/[0.02] flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {incomeFields({ row, errors, accounts, knownSources, activeFactors, factorsById, showLabels, onChange, onChangeRow })}
        </div>
        <div className="pt-3">{trashButton}</div>
      </div>
    )
  }

  return (
    <div
      className="grid gap-2 items-end p-2 rounded-xl bg-gray-50 dark:bg-white/[0.02]"
      style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}
    >
      {kind === 'expense'  && expenseFields(row, errors, accounts, knownCategories, showLabels, onChange)}
      {kind === 'transfer' && transferFields(row, errors, accounts, showLabels, onChange)}
      <div className="col-span-1 flex justify-end">{trashButton}</div>
    </div>
  )
}

function errClass(hasError) {
  return hasError ? 'ring-2 ring-red-400/60 border-red-400/60' : ''
}

function FieldLabel({ show, children }) {
  if (!show) return null
  return <label className={S.label}>{children}</label>
}

function incomeFields({ row, errors, accounts, knownSources, activeFactors, factorsById, showLabels, onChange, onChangeRow }) {
  const isFactor = row.source_type === 'factor'

  // Toggling Type preserves common fields (funding account / expected
  // date / notes) and resets type-specific fields so stale values from
  // the other mode don't sneak into the save payload.
  function switchType(nextType) {
    if (nextType === row.source_type) return
    if (nextType === 'factor') {
      onChangeRow({ source_type: 'factor', amount: '', source: '', factor_id: '', gross_amount: '' })
    } else {
      onChangeRow({ source_type: 'other',  amount: '', source: '', factor_id: '', gross_amount: '' })
    }
  }

  const factor = isFactor && row.factor_id ? factorsById.get(row.factor_id) : null
  const grossNum = isFactor ? Number(row.gross_amount) : 0
  const feeRate = factor ? Number(factor.fee_rate) : 0
  const fee = isFactor && grossNum > 0 ? round2(grossNum * feeRate) : 0
  const net = isFactor && grossNum > 0 ? round2(grossNum - fee) : 0

  return (
    <>
      {/* Type toggle — always visible at the top of the income row */}
      <div className="flex items-center gap-1.5 mb-2">
        <TypePill active={!isFactor} onClick={() => switchType('other')}>Other</TypePill>
        <TypePill active={isFactor}  onClick={() => switchType('factor')}>Factor</TypePill>
      </div>

      {/* Conditional fields */}
      {isFactor ? (
        <div className="grid gap-2 items-end" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
          <div className="col-span-3">
            <FieldLabel show={showLabels}>Factor *</FieldLabel>
            <Select
              value={row.factor_id || ''}
              onChange={e => onChange('factor_id', e.target.value)}
              className={errors.factor_id ? errClass(true) : ''}
            >
              <option value="">— Select —</option>
              {activeFactors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              {row.factor_id
                && !activeFactors.find(f => f.id === row.factor_id)
                && factorsById.get(row.factor_id) && (
                <option value={row.factor_id}>{factorsById.get(row.factor_id).name} (archived)</option>
              )}
            </Select>
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Gross *</FieldLabel>
            <input
              type="number" step="0.01"
              className={`${S.input} ${errClass(errors.gross_amount)}`}
              value={row.gross_amount}
              placeholder="0.00"
              onChange={e => onChange('gross_amount', e.target.value)}
            />
          </div>
          <div className="col-span-1">
            <FieldLabel show={showLabels}>Fee %</FieldLabel>
            <div className="px-2 py-2 text-xs font-mono text-gray-600 dark:text-slate-400">
              {factor ? formatFeeRate(factor.fee_rate) : '—'}
            </div>
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Fee</FieldLabel>
            <div className="px-2 py-2 text-xs font-mono text-red-600 dark:text-red-400">
              {factor && grossNum > 0 ? `− ${fmtMoneyExact(fee)}` : '—'}
            </div>
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Net</FieldLabel>
            <div className="px-2 py-1">
              <div className="text-sm font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {factor && grossNum > 0 ? fmtMoneyExact(net) : '—'}
              </div>
              <div className="text-[10px] text-gray-500 dark:text-slate-500">This is what hits the bank.</div>
            </div>
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Funding account *</FieldLabel>
            <Select
              value={row.funding_account_id}
              onChange={e => onChange('funding_account_id', e.target.value)}
              className={errors.funding_account_id ? errClass(true) : ''}
            >
              <option value="">— Select —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
            </Select>
          </div>
          <div className="col-span-1">
            <FieldLabel show={showLabels}>Date *</FieldLabel>
            <input
              type="date"
              className={`${S.input} ${errClass(errors.expected_date)}`}
              value={row.expected_date}
              onChange={e => onChange('expected_date', e.target.value)}
            />
          </div>
          <div className="col-span-1">
            <FieldLabel show={showLabels}>Notes</FieldLabel>
            <input
              className={S.input}
              value={row.notes}
              placeholder="—"
              onChange={e => onChange('notes', e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-2 items-end" style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Amount *</FieldLabel>
            <input
              type="number" step="0.01"
              className={`${S.input} ${errClass(errors.amount)}`}
              value={row.amount}
              placeholder="0.00"
              onChange={e => onChange('amount', e.target.value)}
            />
          </div>
          <div className="col-span-4">
            <FieldLabel show={showLabels}>Source *</FieldLabel>
            <SuggestInput
              value={row.source}
              suggestions={knownSources}
              placeholder="e.g. RTS Financial"
              onChange={v => onChange('source', v)}
              className={errors.source ? errClass(true) : ''}
            />
          </div>
          <div className="col-span-4">
            <FieldLabel show={showLabels}>Funding account *</FieldLabel>
            <Select
              value={row.funding_account_id}
              onChange={e => onChange('funding_account_id', e.target.value)}
              className={errors.funding_account_id ? errClass(true) : ''}
            >
              <option value="">— Select —</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
            </Select>
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Expected date *</FieldLabel>
            <input
              type="date"
              className={`${S.input} ${errClass(errors.expected_date)}`}
              value={row.expected_date}
              onChange={e => onChange('expected_date', e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <FieldLabel show={showLabels}>Notes</FieldLabel>
            <input
              className={S.input}
              value={row.notes}
              placeholder="—"
              onChange={e => onChange('notes', e.target.value)}
            />
          </div>
        </div>
      )}
    </>
  )
}

function TypePill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
        active
          ? 'bg-orange-500 text-white shadow-sm'
          : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function expenseFields(row, errors, accounts, knownCategories, showLabels, onChange) {
  return (
    <>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Amount *</FieldLabel>
        <input
          type="number" step="0.01"
          className={`${S.input} ${errClass(errors.amount)}`}
          value={row.amount}
          placeholder="0.00"
          onChange={e => onChange('amount', e.target.value)}
        />
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>Description *</FieldLabel>
        <input
          className={`${S.input} ${errClass(errors.description)}`}
          value={row.description}
          placeholder="e.g. Telematics fee"
          onChange={e => onChange('description', e.target.value)}
        />
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Category *</FieldLabel>
        <input
          list="quickline-categories"
          className={`${S.input} ${errClass(errors.category)}`}
          value={row.category}
          placeholder="Payroll / Insurance / …"
          onChange={e => onChange('category', e.target.value)}
        />
        <datalist id="quickline-categories">
          {knownCategories.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>Funding account *</FieldLabel>
        <Select
          value={row.funding_account_id}
          onChange={e => onChange('funding_account_id', e.target.value)}
        >
          <option value="">— Select —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
        </Select>
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Planned date *</FieldLabel>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.planned_pay_date)}`}
          value={row.planned_pay_date}
          onChange={e => onChange('planned_pay_date', e.target.value)}
        />
      </div>
      <div className="col-span-1 flex items-center">
        <FieldLabel show={showLabels}>Cash</FieldLabel>
        <label className="flex items-center gap-1 mt-1">
          <input
            type="checkbox"
            checked={!!row.cash_impacting}
            onChange={e => onChange('cash_impacting', e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-gray-500 dark:text-slate-400">impact</span>
        </label>
      </div>
    </>
  )
}

function transferFields(row, errors, accounts, showLabels, onChange) {
  return (
    <>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>From *</FieldLabel>
        <Select
          value={row.from_funding_account_id}
          onChange={e => onChange('from_funding_account_id', e.target.value)}
        >
          <option value="">— Select —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
        </Select>
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>To *</FieldLabel>
        <Select
          value={row.to_funding_account_id}
          onChange={e => onChange('to_funding_account_id', e.target.value)}
        >
          <option value="">— Select —</option>
          {accounts
            .filter(a => a.id !== row.from_funding_account_id)
            .map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
        </Select>
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Amount *</FieldLabel>
        <input
          type="number" step="0.01"
          className={`${S.input} ${errClass(errors.amount)}`}
          value={row.amount}
          placeholder="0.00"
          onChange={e => onChange('amount', e.target.value)}
        />
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Debit date *</FieldLabel>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.debit_date)}`}
          value={row.debit_date}
          onChange={e => onChange('debit_date', e.target.value)}
        />
      </div>
      <div className="col-span-3">
        <FieldLabel show={showLabels}>Credit date *</FieldLabel>
        <input
          type="date"
          className={`${S.input} ${errClass(errors.credit_date)}`}
          value={row.credit_date}
          onChange={e => onChange('credit_date', e.target.value)}
        />
      </div>
    </>
  )
}
