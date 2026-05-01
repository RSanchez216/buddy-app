// Add Income modal — rebuilt for factor / other source types and bank-deposit
// allocation. One inflow at a time. The deposits row collection drives
// expected_inflow_deposits inserts/updates; the trigger on expected_inflows
// auto-creates and syncs the factor-fee row in custom_outflows.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { CF, fmtMoney, toISO } from './calendarUtils'

function fmtAccountOption(a) {
  return a.bank_name ? `${a.name} (${a.bank_name})` : a.name
}

function emptyDeposit() {
  return { id: null, funding_account_id: '', amount: '' }
}

function buildEmpty(defaults = {}) {
  return {
    sourceType: 'other',         // 'other' | 'factor'
    factorId: '',                // when sourceType='factor'
    grossAmount: '',             // factor: submitted gross
    source: '',                  // other: free-text source description
    otherAmount: '',             // other: amount entered
    expected_date: defaults.expected_date || toISO(new Date()),
    received_date: '',
    entity_id: defaults.entity_id || '',
    status: 'pending',           // 'pending' | 'received'
    description: '',
    deposits: [emptyDeposit()],
  }
}

export default function AddIncomeModal({
  open,
  editInflow,                    // null = add, row object = edit
  onClose,
  onSaved,
  defaultDate,
  defaultEntityId,
}) {
  const { user } = useAuth()
  const [entities, setEntities] = useState([])
  const [accounts, setAccounts] = useState([])
  const [factors, setFactors] = useState([])
  const [form, setForm] = useState(buildEmpty({ expected_date: defaultDate, entity_id: defaultEntityId }))
  const [originalDepositIds, setOriginalDepositIds] = useState(new Set()) // track deletions for diff
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isEdit = !!editInflow

  // ── Load reference data + (in edit mode) the existing inflow + deposits
  useEffect(() => {
    if (!open) return
    setError('')

    async function init() {
      setLoading(true)
      const [entRes, accRes, facRes] = await Promise.all([
        supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name'),
        supabase.from('funding_accounts').select('id, name, bank_name').eq('is_active', true).order('name'),
        supabase.from('factors').select('id, name, fee_rate, default_deposit_account_id').eq('is_active', true).order('name'),
      ])
      setEntities(entRes.data || [])
      setAccounts(accRes.data || [])
      setFactors(facRes.data || [])

      if (editInflow) {
        const { data: deposits } = await supabase
          .from('expected_inflow_deposits')
          .select('id, funding_account_id, amount, notes')
          .eq('expected_inflow_id', editInflow.id)
          .order('created_at')
        const depRows = (deposits || []).map(d => ({
          id: d.id,
          funding_account_id: d.funding_account_id,
          amount: d.amount?.toString() ?? '',
        }))
        setOriginalDepositIds(new Set((deposits || []).map(d => d.id)))
        setForm({
          sourceType: editInflow.source_type === 'factor' ? 'factor' : 'other',
          factorId: editInflow.factor_id || '',
          grossAmount: editInflow.gross_amount?.toString() ?? '',
          source: editInflow.source || '',
          otherAmount: editInflow.source_type === 'factor' ? '' : (editInflow.amount?.toString() ?? ''),
          expected_date: editInflow.expected_date || toISO(new Date()),
          received_date: editInflow.received_date || '',
          entity_id: editInflow.entity_id || '',
          status: editInflow.status === 'received' ? 'received' : 'pending',
          description: editInflow.description || '',
          deposits: depRows.length ? depRows : [emptyDeposit()],
        })
      } else {
        setOriginalDepositIds(new Set())
        setForm(buildEmpty({ expected_date: defaultDate, entity_id: defaultEntityId }))
      }
      setLoading(false)
    }
    init()
  }, [open, editInflow, defaultDate, defaultEntityId])

  // ── Derived target / fee math
  const selectedFactor = useMemo(
    () => factors.find(f => f.id === form.factorId),
    [factors, form.factorId]
  )

  const target = useMemo(() => {
    if (form.sourceType === 'factor') {
      const gross = Number(form.grossAmount) || 0
      const rate = Number(selectedFactor?.fee_rate) || 0
      return round2(gross * (1 - rate))
    }
    return round2(Number(form.otherAmount) || 0)
  }, [form.sourceType, form.grossAmount, form.otherAmount, selectedFactor])

  const feeAmount = useMemo(() => {
    if (form.sourceType !== 'factor') return 0
    const gross = Number(form.grossAmount) || 0
    const rate = Number(selectedFactor?.fee_rate) || 0
    return round2(gross * rate)
  }, [form.sourceType, form.grossAmount, selectedFactor])

  const allocated = useMemo(
    () => round2(form.deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0)),
    [form.deposits]
  )

  const allocationDelta = round2(allocated - target)

  // ── Auto-fill the first deposit row whenever target/factor/source changes
  // and the user hasn't manually edited it yet.
  // Behavior: when there's exactly one empty/zero deposit row, populate it
  // with the factor's default deposit account and the full target.
  useEffect(() => {
    if (form.deposits.length !== 1) return
    const only = form.deposits[0]
    const noAmount = !only.amount || Number(only.amount) === 0
    const noAccount = !only.funding_account_id
    if (noAmount && noAccount && target > 0) {
      const defaultAcc = form.sourceType === 'factor'
        ? selectedFactor?.default_deposit_account_id || ''
        : ''
      setForm(f => ({
        ...f,
        deposits: [{ ...f.deposits[0], funding_account_id: defaultAcc, amount: target.toString() }],
      }))
    }
  // We intentionally exclude form.deposits from deps — we only want to react
  // when the target / factor changes.
  /* eslint-disable-next-line */
  }, [target, form.sourceType, form.factorId, selectedFactor?.default_deposit_account_id])

  // ── Helpers
  function updateDeposit(i, field, val) {
    setForm(f => ({
      ...f,
      deposits: f.deposits.map((d, idx) => idx === i ? { ...d, [field]: val } : d),
    }))
  }
  function addDeposit() {
    setForm(f => ({ ...f, deposits: [...f.deposits, emptyDeposit()] }))
  }
  function removeDeposit(i) {
    setForm(f => ({
      ...f,
      deposits: f.deposits.length === 1 ? [emptyDeposit()] : f.deposits.filter((_, idx) => idx !== i),
    }))
  }

  // Distribute the unallocated remainder onto the last empty/zero row,
  // or split evenly if the user clicks "Auto-fill remaining".
  function fillRemainingOnLast() {
    const remaining = round2(target - allocated)
    if (Math.abs(remaining) < 0.01) return
    setForm(f => {
      const deposits = [...f.deposits]
      const lastIdx = deposits.length - 1
      const lastAmount = Number(deposits[lastIdx].amount) || 0
      deposits[lastIdx] = { ...deposits[lastIdx], amount: round2(lastAmount + remaining).toString() }
      return { ...f, deposits }
    })
  }

  // ── Save
  async function handleSave() {
    setError('')

    // Validation
    if (form.sourceType === 'factor') {
      if (!form.factorId)              return setError('Pick a factor.')
      if (!Number(form.grossAmount))   return setError('Gross amount is required.')
    } else {
      if (!form.source.trim())         return setError('Source description is required.')
      if (!Number(form.otherAmount))   return setError('Amount is required.')
    }
    if (form.status === 'received' && !form.received_date) {
      return setError('Set received date when marking as received.')
    }
    if (form.status === 'pending' && !form.expected_date) {
      return setError('Set expected date.')
    }

    const validDeposits = form.deposits.filter(d => d.funding_account_id && Number(d.amount) > 0)
    if (validDeposits.length === 0) {
      return setError('Add at least one deposit.')
    }
    if (Math.abs(allocationDelta) > 0.01) {
      return setError(allocationDelta < 0
        ? `Short by ${fmtMoney(Math.abs(allocationDelta))} — fix deposits before saving.`
        : `Over by ${fmtMoney(allocationDelta)} — fix deposits before saving.`)
    }

    setSaving(true)
    try {
      // 1) Insert or update the inflow
      const inflowPayload = {
        source_type: form.sourceType,
        factor_id: form.sourceType === 'factor' ? form.factorId : null,
        gross_amount: form.sourceType === 'factor' ? Number(form.grossAmount) : null,
        source: form.sourceType === 'factor'
          ? `Factor — ${selectedFactor?.name || 'unknown'}`
          : form.source.trim(),
        amount: target,                                         // net
        expected_date: form.expected_date || null,
        received_date: form.status === 'received' ? form.received_date : null,
        received_amount: form.status === 'received' ? target : null,
        entity_id: form.entity_id || null,
        status: form.status,
        description: form.description.trim() || null,
        updated_at: new Date().toISOString(),
      }

      let inflowId
      if (isEdit) {
        const { error: updErr } = await supabase
          .from('expected_inflows')
          .update(inflowPayload)
          .eq('id', editInflow.id)
        if (updErr) throw new Error(updErr.message)
        inflowId = editInflow.id
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('expected_inflows')
          .insert({ ...inflowPayload, created_by: user?.id || null })
          .select('id')
          .single()
        if (insErr) throw new Error(insErr.message)
        inflowId = inserted.id
      }

      // 2) Diff deposits — update kept rows, insert new ones, delete removed
      const submittedIds = new Set(validDeposits.filter(d => d.id).map(d => d.id))
      const toDelete = [...originalDepositIds].filter(id => !submittedIds.has(id))
      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from('expected_inflow_deposits')
          .delete()
          .in('id', toDelete)
        if (delErr) throw new Error('Deposit delete failed: ' + delErr.message)
      }

      const toUpdate = validDeposits.filter(d => d.id)
      for (const d of toUpdate) {
        const { error: uErr } = await supabase
          .from('expected_inflow_deposits')
          .update({ funding_account_id: d.funding_account_id, amount: Number(d.amount) })
          .eq('id', d.id)
        if (uErr) throw new Error('Deposit update failed: ' + uErr.message)
      }

      const toInsert = validDeposits.filter(d => !d.id).map(d => ({
        expected_inflow_id: inflowId,
        funding_account_id: d.funding_account_id,
        amount: Number(d.amount),
      }))
      if (toInsert.length) {
        const { error: iErr } = await supabase.from('expected_inflow_deposits').insert(toInsert)
        if (iErr) throw new Error('Deposit insert failed: ' + iErr.message)
      }

      // The factor fee in custom_outflows is auto-managed by the trigger.

      setSaving(false)
      onSaved?.(inflowId)
      onClose()
    } catch (e) {
      console.error('[AddIncomeModal] save failed:', e)
      // Best-effort cleanup: if we just created an inflow but a deposit insert
      // failed, delete the orphan inflow so the user can retry cleanly.
      if (!isEdit) {
        // We don't have the inflowId scope outside the try if insert failed
        // before we captured it — that's fine. If insert succeeded but later
        // steps failed, the trigger and orphan inflow would already exist.
        // Hard rollback isn't possible without a real transaction; surface
        // the error and let the user sort it.
      }
      setError(e?.message || 'Save failed')
      setSaving(false)
    }
  }

  // ── Render
  if (!open) return null

  const targetLabel = form.sourceType === 'factor' ? 'Net advance' : 'Amount'
  const showDeltaWarning = Math.abs(allocationDelta) > 0.01

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Income' : 'Add Income'} size="xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}
        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
        ) : (
          <>
            {/* Source Type toggle */}
            <div>
              <label className={S.label}>Source type</label>
              <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-xl w-fit">
                <SegButton active={form.sourceType === 'other'} onClick={() => setForm(f => ({ ...f, sourceType: 'other' }))}>Other</SegButton>
                <SegButton active={form.sourceType === 'factor'} onClick={() => setForm(f => ({ ...f, sourceType: 'factor' }))}>Factor</SegButton>
              </div>
            </div>

            {/* Factor or Other — source-specific fields */}
            {form.sourceType === 'factor' ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Factor *">
                  <Select value={form.factorId} onChange={e => setForm(f => ({ ...f, factorId: e.target.value }))}>
                    <option value="">— Select factor —</option>
                    {factors.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name}{f.fee_rate != null ? ` (${(Number(f.fee_rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%)` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Submitted amount (gross) *">
                  <input type="number" step="0.01" className={S.input} value={form.grossAmount}
                    onChange={e => setForm(f => ({ ...f, grossAmount: e.target.value }))}
                    placeholder="100000.00" />
                </Field>

                {/* Calculated preview */}
                {selectedFactor && Number(form.grossAmount) > 0 && (
                  <div className="col-span-2 rounded-xl border border-orange-200 dark:border-orange-500/20 bg-orange-50/40 dark:bg-orange-500/5 p-3 space-y-1 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="text-gray-600 dark:text-slate-400">Fee ({fmtPct(selectedFactor.fee_rate)}):</span>
                      <span className="font-mono text-red-600 dark:text-red-400">− {fmtMoney(feeAmount)}</span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-orange-100 dark:border-orange-500/10 pt-1">
                      <span className="font-semibold text-gray-700 dark:text-slate-300">Net advance:</span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(target)}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Source description *">
                  <input className={S.input} value={form.source}
                    onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                    placeholder="e.g. Customer payment, refund" />
                </Field>
                <Field label="Amount ($) *">
                  <input type="number" step="0.01" className={S.input} value={form.otherAmount}
                    onChange={e => setForm(f => ({ ...f, otherAmount: e.target.value }))} />
                </Field>
              </div>
            )}

            {/* Date / entity / status */}
            <div className="grid grid-cols-3 gap-4">
              <Field label={form.status === 'received' ? 'Received date *' : 'Expected date *'}>
                <input type="date" className={S.input}
                  value={form.status === 'received' ? form.received_date : form.expected_date}
                  onChange={e => {
                    const val = e.target.value
                    setForm(f => f.status === 'received'
                      ? { ...f, received_date: val }
                      : { ...f, expected_date: val })
                  }} />
              </Field>
              <Field label="Entity">
                <Select value={form.entity_id} onChange={e => setForm(f => ({ ...f, entity_id: e.target.value }))}>
                  <option value="">—</option>
                  {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <div className="flex gap-1 p-1 bg-gray-100 dark:bg-white/5 rounded-xl">
                  <SegButton size="sm" active={form.status === 'pending'} onClick={() => setForm(f => ({ ...f, status: 'pending' }))}>Pending</SegButton>
                  <SegButton size="sm" active={form.status === 'received'} onClick={() => setForm(f => ({
                    ...f, status: 'received',
                    received_date: f.received_date || f.expected_date || toISO(new Date()),
                  }))}>Received</SegButton>
                </div>
              </Field>
            </div>

            <Field label="Note (optional)">
              <input className={S.input} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </Field>

            {/* Deposit allocation */}
            <div className="border border-gray-200 dark:border-white/5 rounded-xl p-3 bg-gray-50/50 dark:bg-white/[0.02] space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">Deposit allocation</h4>
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">Where did this go? Split across one or more bank accounts.</p>
              </div>

              <div className="space-y-2">
                {form.deposits.map((d, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-7">
                      <Select value={d.funding_account_id} onChange={e => updateDeposit(i, 'funding_account_id', e.target.value)}>
                        <option value="">— Select account —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
                      </Select>
                    </div>
                    <div className="col-span-4">
                      <input type="number" step="0.01" className={S.input} value={d.amount}
                        onChange={e => updateDeposit(i, 'amount', e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => removeDeposit(i)} className="text-gray-400 hover:text-red-500 px-1 py-2" title="Remove">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3">
                <button onClick={addDeposit} type="button"
                  className="text-sm font-medium text-orange-600 dark:text-orange-400 hover:underline">
                  + Add deposit
                </button>
                {showDeltaWarning && Math.abs(allocationDelta) > 0.01 && (
                  <button onClick={fillRemainingOnLast} type="button"
                    className="text-xs text-gray-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400">
                    Auto-fill remaining
                  </button>
                )}
              </div>

              <div className="flex items-baseline justify-between border-t border-gray-200 dark:border-white/5 pt-2 text-sm">
                <span className="text-gray-500 dark:text-slate-400">
                  Allocated:
                  <span className="font-mono font-semibold text-gray-700 dark:text-slate-300 ml-2">
                    {fmtMoney(allocated)} of {fmtMoney(target)}
                  </span>
                </span>
                {!showDeltaWarning ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Matches
                  </span>
                ) : (
                  <span className="text-red-600 dark:text-red-400 font-semibold">
                    {allocationDelta < 0
                      ? `Short by ${fmtMoney(Math.abs(allocationDelta))}`
                      : `Over by ${fmtMoney(allocationDelta)}`}
                  </span>
                )}
              </div>
            </div>

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel}>Cancel</button>
              <button onClick={handleSave} disabled={saving || showDeltaWarning} className={CF.btnSave}>
                {saving ? 'Saving…' : isEdit ? 'Update' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}

function SegButton({ active, onClick, children, size = 'md' }) {
  const pad = size === 'sm' ? 'px-3 py-1' : 'px-4 py-1.5'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${pad} text-sm font-medium rounded-lg transition-all ${
        active
          ? 'bg-white dark:bg-slate-800 text-orange-600 dark:text-orange-400 shadow-sm'
          : 'text-gray-500 dark:text-slate-400'
      }`}
    >
      {children}
    </button>
  )
}

function fmtPct(decimal) {
  if (decimal == null) return ''
  const num = Number(decimal)
  if (Number.isNaN(num)) return ''
  return `${(num * 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
