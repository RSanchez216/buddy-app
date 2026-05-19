// Cover-with-transfer modal for the Payment Calendar shortfall block.
//
// Two entry surfaces, one modal:
//   * Cover with transfer → opens with initialTargetId set, jumps straight
//     into "cover" mode targeting the biggest shortfall.
//   * View all → opens with initialTargetId = null, starts on a list of
//     negative-EOD accounts and lets the user pick which to cover. After a
//     pick, the modal switches to cover mode for that account.
//
// Cover mode supports a single From account by default, with a toggle for
// split-across-multiple-accounts. Same-day debit + credit is the default per
// Rebeca's call ("any transfer happens today, regardless of focused day");
// dates are still editable in the UI.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { CF, fmtMoney, fmtMoneyExact } from './calendarUtils'

const SURFACE = 'payment_calendar_cover_action'

// Always round UP to the nearest $10 so the transfer leaves a small buffer.
function roundUpToTen(value) {
  const abs = Math.abs(Number(value) || 0)
  if (abs === 0) return 0
  return Math.ceil(abs / 10) * 10
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function surplusOf(row) {
  return Math.max(0, Number(row?.projEod) || 0)
}

// Proportional split across checked unlocked rows.
//
// Given the cover amount and current splitRows ({accountId, amount, locked,
// selected}), redistributes the unlocked-checked-rows' amounts proportionally
// to each account's surplus. Locked rows are left alone. If everyone's
// surplus is zero, falls back to equal shares of the remainder.
function redistributeSplit(splitRows, accountsWithEod, coverAmount) {
  const target = Number(coverAmount) || 0
  const eodById = Object.fromEntries(accountsWithEod.map(r => [r.account.id, r]))

  const lockedTotal = splitRows
    .filter(r => r.selected && r.locked)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const remaining = round2(target - lockedTotal)

  const unlocked = splitRows.filter(r => r.selected && !r.locked)
  if (unlocked.length === 0) return splitRows
  if (remaining <= 0) {
    return splitRows.map(r =>
      (r.selected && !r.locked) ? { ...r, amount: '0' } : r
    )
  }

  const unlockedSurplusTotal = unlocked.reduce(
    (s, r) => s + surplusOf(eodById[r.accountId]),
    0
  )

  return splitRows.map(r => {
    if (!r.selected || r.locked) return r
    let share
    if (unlockedSurplusTotal > 0) {
      const own = surplusOf(eodById[r.accountId])
      share = round2((own / unlockedSurplusTotal) * remaining)
    } else {
      share = round2(remaining / unlocked.length)
    }
    return { ...r, amount: share > 0 ? String(share) : '0' }
  })
}

function sumSplitAmounts(splitRows) {
  return splitRows
    .filter(r => r.selected)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0)
}

export default function CoverTransferModal({
  open,
  initialTargetId,           // string|null — null = list view, uuid = cover view
  accountsWithEod = [],      // [{ account, projEod }] for active accounts
  todayISO,                  // Chicago-local today, set at open time
  onClose,
  onSaved,
}) {
  const { user, profile } = useAuth()
  const toast = useToast()

  // mode: 'list' → user picks which negative account to cover next.
  //       'cover' → main pre-fill state targeting `targetId`.
  const [mode, setMode] = useState('cover')
  const [targetId, setTargetId] = useState(null)
  const [amount, setAmount] = useState('')
  const [debitDate, setDebitDate] = useState('')
  const [creditDate, setCreditDate] = useState('')
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [singleFromId, setSingleFromId] = useState('')
  const [splitRows, setSplitRows] = useState([])  // [{ accountId, amount, locked, selected }]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset on open. The initialTargetId decides whether we start in list mode
  // (View all) or jump straight into cover mode for a specific account.
  useEffect(() => {
    if (!open) return
    setError('')
    setSaving(false)
    setSplitEnabled(false)
    setSingleFromId('')
    setSplitRows([])
    if (initialTargetId) {
      setMode('cover')
      setTargetId(initialTargetId)
      const tgt = accountsWithEod.find(r => r.account.id === initialTargetId)
      const eod = tgt?.projEod
      setAmount(eod != null ? String(roundUpToTen(eod)) : '')
      setDebitDate(todayISO)
      setCreditDate(todayISO)
    } else {
      setMode('list')
      setTargetId(null)
      setAmount('')
      setDebitDate(todayISO)
      setCreditDate(todayISO)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTargetId])

  // Derived: target account, sorted picker rows
  const target = useMemo(
    () => accountsWithEod.find(r => r.account.id === targetId)?.account || null,
    [accountsWithEod, targetId]
  )
  const targetEod = useMemo(
    () => accountsWithEod.find(r => r.account.id === targetId)?.projEod ?? null,
    [accountsWithEod, targetId]
  )

  // Picker rows = all active accounts EXCEPT the target, sorted by projEod DESC.
  // Nulls (balance not set) sink to the bottom.
  const pickerRows = useMemo(() => {
    return accountsWithEod
      .filter(r => r.account.id !== targetId)
      .slice()
      .sort((a, b) => (b.projEod ?? -Infinity) - (a.projEod ?? -Infinity))
  }, [accountsWithEod, targetId])

  const surplusRows = useMemo(
    () => pickerRows.filter(r => (r.projEod ?? 0) > 0),
    [pickerRows]
  )
  const hasSurplus = surplusRows.length > 0

  const negativeRows = useMemo(
    () => accountsWithEod
      .filter(r => r.projEod != null && r.projEod < 0)
      .slice()
      .sort((a, b) => (a.projEod ?? 0) - (b.projEod ?? 0)), // most negative first
    [accountsWithEod]
  )

  // ── Single-mode helpers
  function pickSingleFrom(accountId) {
    setSingleFromId(accountId)
  }

  // ── Split-mode helpers
  function ensureSplitRowsInitialized() {
    if (splitRows.length === 0) {
      setSplitRows(pickerRows.map(r => ({
        accountId: r.account.id,
        amount: '0',
        locked: false,
        selected: false,
      })))
    }
  }

  function toggleSplit(enabled) {
    setSplitEnabled(enabled)
    if (enabled) {
      // Seed split rows from the current picker, pre-seeding the single
      // pick (if any) as the first checked row with proportional amount.
      const seed = pickerRows.map(r => ({
        accountId: r.account.id,
        amount: '0',
        locked: false,
        selected: r.account.id === singleFromId,
      }))
      const balanced = redistributeSplit(seed, accountsWithEod, Number(amount) || 0)
      setSplitRows(balanced)
    }
    // Turning split off — leave splitRows as-is; the single picker reads
    // singleFromId, so the user effectively reverts to whichever account
    // they had before enabling split.
  }

  function toggleSplitRow(accountId, checked) {
    ensureSplitRowsInitialized()
    const next = splitRows.map(r =>
      r.accountId === accountId
        ? { ...r, selected: checked, locked: checked ? r.locked : false, amount: checked ? r.amount : '0' }
        : r
    )
    setSplitRows(redistributeSplit(next, accountsWithEod, Number(amount) || 0))
  }

  function editSplitAmount(accountId, value) {
    // Manual edit locks the row. Remaining unlocked rows re-balance.
    const next = splitRows.map(r =>
      r.accountId === accountId
        ? { ...r, amount: value, locked: true, selected: true }
        : r
    )
    setSplitRows(redistributeSplit(next, accountsWithEod, Number(amount) || 0))
  }

  function unlockSplitRow(accountId) {
    const next = splitRows.map(r =>
      r.accountId === accountId ? { ...r, locked: false } : r
    )
    setSplitRows(redistributeSplit(next, accountsWithEod, Number(amount) || 0))
  }

  // Amount change re-balances unlocked split rows to match the new target.
  function handleAmountChange(value) {
    setAmount(value)
    if (splitEnabled && splitRows.length) {
      setSplitRows(prev => redistributeSplit(prev, accountsWithEod, Number(value) || 0))
    }
  }

  // ── Target change (To dropdown). Re-pre-fills amount to the new
  // target's rounded-up shortfall. Resets From picks since the picker
  // composition changes.
  function handleTargetChange(newId) {
    setTargetId(newId)
    const row = accountsWithEod.find(r => r.account.id === newId)
    const eod = row?.projEod
    setAmount(eod != null ? String(roundUpToTen(eod)) : '')
    setSingleFromId('')
    setSplitRows([])
  }

  // ── Split totals + balance-to logic
  const splitTotal = useMemo(() => round2(sumSplitAmounts(splitRows)), [splitRows])
  const targetAmount = useMemo(() => round2(Number(amount) || 0), [amount])
  const splitOff = round2(splitTotal - targetAmount)
  const splitBalanced = Math.abs(splitOff) < 0.01

  // Find which row "Balance to" should adjust: last unlocked checked row,
  // else first checked row. Returns accountId or null.
  const balanceToRow = useMemo(() => {
    const checked = splitRows.filter(r => r.selected)
    if (checked.length === 0) return null
    const unlocked = checked.filter(r => !r.locked)
    if (unlocked.length > 0) return unlocked[unlocked.length - 1].accountId
    return checked[0].accountId
  }, [splitRows])

  function balanceToClick() {
    if (!balanceToRow) return
    setSplitRows(prev => {
      const others = prev
        .filter(r => r.accountId !== balanceToRow && r.selected)
        .reduce((s, r) => s + (Number(r.amount) || 0), 0)
      const fix = round2(targetAmount - others)
      return prev.map(r => r.accountId === balanceToRow
        ? { ...r, amount: fix > 0 ? String(fix) : '0', locked: true, selected: true }
        : r)
    })
  }

  // ── Save
  async function save() {
    setError('')
    if (!targetId || !target) return setError('Pick an account to cover.')
    if (!targetAmount || targetAmount <= 0) return setError('Amount must be > 0.')
    if (!debitDate || !creditDate) return setError('Both dates are required.')
    if (creditDate < debitDate) return setError('Credit date must be on or after debit date.')

    const originatingShortfall = {
      account_id: targetId,
      account_name: target.name,
      amount: Math.abs(Number(targetEod) || 0),
    }

    setSaving(true)
    try {
      if (splitEnabled) {
        const checked = splitRows.filter(r => r.selected && Number(r.amount) > 0)
        if (checked.length === 0) {
          setSaving(false); setError('Check at least one From account.'); return
        }
        if (!splitBalanced) {
          setSaving(false); setError(`Split total ${fmtMoney(splitTotal)}. Target ${fmtMoney(targetAmount)}. Off by ${fmtMoney(Math.abs(splitOff))}.`); return
        }
        const payload = checked.map(r => ({
          from_funding_account_id: r.accountId,
          to_funding_account_id: targetId,
          amount: Number(r.amount),
          debit_date: debitDate,
          credit_date: creditDate,
          created_by: user?.id || null,
        }))
        const { data: inserted, error: e } = await supabase
          .from('funding_account_transfers')
          .insert(payload)
          .select('id')
        if (e || !inserted) throw new Error(e?.message || 'Insert failed')
        const auditEntries = inserted.map((row, i) => ({
          table_name: 'funding_account_transfers',
          record_id: row.id,
          action: 'transfer_create',
          performed_by: user?.id || null,
          performed_by_email: profile?.email || null,
          metadata: {
            surface: SURFACE,
            originating_shortfall_account: originatingShortfall.account_name,
            originating_shortfall_amount: originatingShortfall.amount,
            cover_strategy: 'split',
            split_count: inserted.length,
            split_index: i,
          },
        }))
        const auditRes = await supabase.from('audit_log').insert(auditEntries)
        if (auditRes.error) console.warn('[CoverTransferModal] audit_log batch failed:', auditRes.error.message)
        toast.success(`${inserted.length} transfers created`)
      } else {
        if (!singleFromId) {
          setSaving(false); setError('Pick a From account.'); return
        }
        if (singleFromId === targetId) {
          setSaving(false); setError('From and To must differ.'); return
        }
        const payload = {
          from_funding_account_id: singleFromId,
          to_funding_account_id: targetId,
          amount: targetAmount,
          debit_date: debitDate,
          credit_date: creditDate,
          created_by: user?.id || null,
        }
        const { data: inserted, error: e } = await supabase
          .from('funding_account_transfers')
          .insert(payload)
          .select('id')
          .single()
        if (e || !inserted) throw new Error(e?.message || 'Insert failed')
        const auditRes = await supabase.from('audit_log').insert({
          table_name: 'funding_account_transfers',
          record_id: inserted.id,
          action: 'transfer_create',
          performed_by: user?.id || null,
          performed_by_email: profile?.email || null,
          metadata: {
            surface: SURFACE,
            originating_shortfall_account: originatingShortfall.account_name,
            originating_shortfall_amount: originatingShortfall.amount,
            cover_strategy: 'single',
          },
        })
        if (auditRes.error) console.warn('[CoverTransferModal] audit_log failed:', auditRes.error.message)
        toast.success('Transfer created')
      }
      setSaving(false)
      onSaved?.()
      onClose?.()
    } catch (e) {
      console.error('[CoverTransferModal] save failed:', e)
      setError(e?.message || 'Save failed')
      toast.error("Couldn't save cover transfer", e)
      setSaving(false)
    }
  }

  if (!open) return null

  // ── List view (entry from "View all")
  if (mode === 'list') {
    return (
      <Modal open={open} onClose={onClose} title="Cover negative accounts" size="md">
        <div className={S.modalBody}>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Pick the account to cover first. After save, the cover block will
            recompute and you can return for any others still negative.
          </p>
          {negativeRows.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 py-6 text-center">
              No accounts are negative on this day.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/5 border border-gray-200 dark:border-white/5 rounded-xl">
              {negativeRows.map(({ account, projEod }) => (
                <li key={account.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-slate-300 truncate">{account.name}</p>
                    <p className="text-xs font-mono text-red-700 dark:text-red-400">{fmtMoneyExact(projEod)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetId(account.id)
                      setAmount(String(roundUpToTen(projEod)))
                      setDebitDate(todayISO)
                      setCreditDate(todayISO)
                      setSplitEnabled(false)
                      setSingleFromId('')
                      setSplitRows([])
                      setMode('cover')
                    }}
                    className={CF.btnSave}
                  >
                    Cover
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={S.modalFooter}>
            <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── Cover view
  const title = target ? `Cover ${target.name}` : 'Cover with transfer'
  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {/* Cover header — To/Amount/dates */}
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-4">
            <label className={S.label}>To account *</label>
            <Select value={targetId || ''} onChange={e => handleTargetChange(e.target.value)}>
              <option value="">— Select —</option>
              {accountsWithEod.map(({ account, projEod }) => (
                <option key={account.id} value={account.id}>
                  {account.name}{projEod != null ? ` · ${fmtMoneyExact(projEod)}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <label className={S.label}>Amount *</label>
            <input
              type="number" step="0.01"
              className={S.input}
              value={amount}
              onChange={e => handleAmountChange(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="col-span-3">
            <label className={S.label}>Debit date *</label>
            <input type="date" className={S.input} value={debitDate} onChange={e => setDebitDate(e.target.value)} />
          </div>
          <div className="col-span-3">
            <label className={S.label}>Credit date *</label>
            <input type="date" className={S.input} value={creditDate} onChange={e => setCreditDate(e.target.value)} />
          </div>
        </div>

        {targetEod != null && (
          <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2">
            <span className="font-semibold">{target?.name}</span> projects{' '}
            <span className="font-mono text-red-700 dark:text-red-400">{fmtMoneyExact(targetEod)}</span>{' '}
            at end of day. Amount rounded up to nearest $10.
          </p>
        )}

        {/* Split toggle */}
        <div className="flex items-baseline justify-between border-t border-gray-100 dark:border-white/5 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">From</p>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 cursor-pointer">
            <input type="checkbox" checked={splitEnabled} onChange={e => toggleSplit(e.target.checked)} className="rounded" />
            Split across multiple accounts
          </label>
        </div>

        {!hasSurplus && (
          <div className="rounded-xl p-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-400">
            No accounts have surplus today. Any transfer will move the shortfall.
          </div>
        )}

        {/* Picker — single or multi mode */}
        <div className="border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden">
          <div className={`grid ${splitEnabled ? 'grid-cols-[auto_1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-x-3 px-3 py-1.5 bg-gray-50 dark:bg-white/[0.02] text-[9px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500`}>
            {splitEnabled && <span>Use</span>}
            <span>Account</span>
            <span className="text-right">Current EOD</span>
            <span className="text-right">{splitEnabled ? 'Amount' : 'If picked'}</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-white/5 max-h-72 overflow-y-auto">
            {pickerRows.map(({ account, projEod }) => {
              const split = splitRows.find(r => r.accountId === account.id)
              const selected = splitEnabled ? !!split?.selected : singleFromId === account.id
              const useAmount = splitEnabled
                ? (Number(split?.amount) || 0)
                : (selected ? targetAmount : 0)
              const newEod = projEod != null ? round2(projEod - useAmount) : null
              const wouldGoNegative = projEod != null && useAmount > 0 && (projEod - useAmount) < 0
              return (
                <li
                  key={account.id}
                  onClick={() => !splitEnabled && pickSingleFrom(account.id)}
                  className={`grid ${splitEnabled ? 'grid-cols-[auto_1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-x-3 items-baseline px-3 py-1.5 text-xs ${
                    !splitEnabled ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]' : ''
                  } ${selected && !splitEnabled ? 'bg-orange-50/60 dark:bg-orange-500/5' : ''}`}
                >
                  {splitEnabled && (
                    <input
                      type="checkbox"
                      checked={!!split?.selected}
                      onChange={e => toggleSplitRow(account.id, e.target.checked)}
                      className="rounded"
                    />
                  )}
                  <span className="text-gray-700 dark:text-slate-300 truncate">{account.name}</span>
                  <span className={`font-mono text-right ${projEod != null && projEod < 0 ? 'text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-slate-400'}`}>
                    {projEod == null ? '—' : fmtMoneyExact(projEod)}
                  </span>
                  {splitEnabled ? (
                    <span className="flex items-center justify-end gap-1.5">
                      <input
                        type="number" step="0.01"
                        className={`${S.input} text-right ${split?.selected ? '' : 'opacity-40'}`}
                        style={{ width: 100, padding: '4px 8px' }}
                        value={split?.selected ? (split?.amount ?? '') : ''}
                        placeholder="—"
                        disabled={!split?.selected}
                        onChange={e => editSplitAmount(account.id, e.target.value)}
                      />
                      {split?.selected && split?.locked && (
                        <button
                          type="button"
                          onClick={() => unlockSplitRow(account.id)}
                          title="Unlock — let this row re-balance"
                          className="text-gray-400 hover:text-orange-600"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c1.1 0 2 .9 2 2v3a2 2 0 11-4 0v-3c0-1.1.9-2 2-2zm6-3V7a6 6 0 10-12 0v1a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2z" />
                          </svg>
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className={`font-mono text-right ${wouldGoNegative ? 'text-red-700 dark:text-red-400' : 'text-gray-600 dark:text-slate-400'}`}>
                      {newEod == null ? '—' : fmtMoneyExact(newEod)}
                    </span>
                  )}
                  <span className="text-right">
                    {wouldGoNegative && (
                      <span className="inline-block text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        would go negative
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        {/* Split-mode balance banner */}
        {splitEnabled && splitRows.some(r => r.selected) && !splitBalanced && (
          <div className="rounded-xl p-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-400 flex items-baseline justify-between gap-2">
            <span>
              Split total <span className="font-mono">{fmtMoney(splitTotal)}</span>. Target{' '}
              <span className="font-mono">{fmtMoney(targetAmount)}</span>. Off by{' '}
              <span className="font-mono">{fmtMoney(Math.abs(splitOff))}</span>.
            </span>
            {balanceToRow && (
              <button
                type="button"
                onClick={balanceToClick}
                className="text-xs font-semibold underline hover:no-underline"
              >
                Balance to {accountsWithEod.find(r => r.account.id === balanceToRow)?.account.name || ''}
              </button>
            )}
          </div>
        )}

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={CF.btnSave}>
            {saving
              ? 'Saving…'
              : splitEnabled
                ? `Save ${splitRows.filter(r => r.selected).length} transfers`
                : 'Save transfer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
