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
import { CF, fmtMoney } from './calendarUtils'

const SURFACE = 'payment_calendar_quick_line_add'

const KIND_LABEL = {
  income:   { title: 'Add income lines',   verb: 'income',   accent: 'emerald' },
  expense:  { title: 'Add expense lines',  verb: 'expense',  accent: 'red'     },
  transfer: { title: 'Add transfer lines', verb: 'transfer', accent: 'cyan'    },
}

function emptyIncomeRow(date)   { return { amount: '', source: '', source_type: 'other', funding_account_id: '', expected_date: date || '', notes: '' } }
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

// Per-row validation. Returns { isValid, errors } where errors is keyed by
// the field name that failed. Field names match the row keys so the render
// can red-flag the right input.
function validateRow(row, kind) {
  const errors = {}
  const amt = Number(row.amount)
  if (!row.amount || Number.isNaN(amt) || amt <= 0) errors.amount = 'Amount must be > 0'
  if (kind === 'income') {
    if (!row.source?.trim())       errors.source = 'Required'
    if (!row.source_type)          errors.source_type = 'Required'
    if (!row.funding_account_id)   errors.funding_account_id = 'Required'
    if (!row.expected_date)        errors.expected_date = 'Required'
  } else if (kind === 'expense') {
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
        tasks.push(
          supabase.from('expected_inflows').select('source').not('source', 'is', null)
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
    // Insert parents first, then deposits (FK requires parent ids).
    const parents = rows.map(r => ({
      source: r.source.trim(),
      source_type: r.source_type,
      amount: Number(r.amount),
      expected_date: r.expected_date,
      description: r.notes?.trim() || null,
      status: 'pending',
      created_by: user?.id || null,
    }))
    const { data: inserted, error: pErr } = await supabase
      .from('expected_inflows')
      .insert(parents)
      .select('id')
    if (pErr || !inserted) throw new Error(pErr?.message || 'Failed to create inflow rows')
    const ids = inserted.map(p => p.id)

    const deposits = rows.map((r, i) => ({
      expected_inflow_id: ids[i],
      funding_account_id: r.funding_account_id,
      amount: Number(r.amount),
      position: 0,
    }))
    const { error: dErr } = await supabase.from('expected_inflow_deposits').insert(deposits)
    if (dErr) {
      // Best-effort rollback of the parent rows so the user can retry cleanly.
      await supabase.from('expected_inflows').delete().in('id', ids)
      throw new Error(dErr.message)
    }

    await writeAuditLogEntries('expected_inflows', ids, rows.length)
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
      const { isValid, errors } = validateRow(r, kind)
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
              isFirst={i === 0}
              showLabels={i === 0}
              canRemove={rows.length > 1}
              onChange={(field, value) => updateRow(i, field, value)}
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
  isFirst, showLabels, canRemove, onChange, onRemove,
}) {
  void isFirst, index
  return (
    <div
      className="grid gap-2 items-end p-2 rounded-xl bg-gray-50 dark:bg-white/[0.02]"
      style={{ gridTemplateColumns: 'repeat(14, minmax(0, 1fr))' }}
    >
      {kind === 'income'   && incomeFields(row, errors, accounts, knownSources, showLabels, onChange)}
      {kind === 'expense'  && expenseFields(row, errors, accounts, knownCategories, showLabels, onChange)}
      {kind === 'transfer' && transferFields(row, errors, accounts, showLabels, onChange)}
      <div className="col-span-1 flex justify-end">
        {canRemove && (
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-red-500 px-1 py-2"
            title="Remove this line"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
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

function incomeFields(row, errors, accounts, knownSources, showLabels, onChange) {
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
        <FieldLabel show={showLabels}>Source *</FieldLabel>
        <input
          list="quickline-sources"
          className={`${S.input} ${errClass(errors.source)}`}
          value={row.source}
          placeholder="e.g. RTS Financial"
          onChange={e => onChange('source', e.target.value)}
        />
        <datalist id="quickline-sources">
          {knownSources.map(s => <option key={s} value={s} />)}
        </datalist>
      </div>
      <div className="col-span-2">
        <FieldLabel show={showLabels}>Type *</FieldLabel>
        <Select
          value={row.source_type}
          onChange={e => onChange('source_type', e.target.value)}
        >
          <option value="other">Other</option>
          <option value="factor">Factor</option>
        </Select>
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
        <FieldLabel show={showLabels}>Expected date *</FieldLabel>
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
    </>
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
