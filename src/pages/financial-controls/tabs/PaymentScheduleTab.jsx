import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import MarkPaidModal from '../../cash-flow/MarkPaidModal'
import { FC, PAYMENT_STATUSES, STATUS_LABELS, paymentStatusPill, fmtMoney, fmtDate } from '../loanUtils'
import { useToast } from '../../../contexts/ToastContext'

export default function PaymentScheduleTab({ loanId, loan, canEdit, onChange }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editRow, setEditRow] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [showRegen, setShowRegen] = useState(false)
  const [regenRunning, setRegenRunning] = useState(false)
  const [regenToast, setRegenToast] = useState('')
  // Mark Paid modal target — the loan_payments row to mark when the user
  // clicks the action button inside the NEXT PAYMENT DUE tile.
  const [markPaidRow, setMarkPaidRow] = useState(null)

  // Sort: 'asc' (oldest first) or 'desc' (most recent first, default).
  // Loans approaching maturity have many paid rows; recent + current months
  // sit at the top so the user doesn't scroll past historical entries.
  const [sortDir, setSortDir] = useState('desc')
  // Quick filter: 'all' | 'past_due' | 'pending' | 'paid'
  const [quickFilter, setQuickFilter] = useState('all')

  // Reset per-loan visit
  useEffect(() => { setSortDir('desc'); setQuickFilter('all') }, [loanId])

  useEffect(() => { load() /* eslint-disable-line */ }, [loanId])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('loan_payments').select('*').eq('loan_id', loanId).order('due_date', { ascending: true })
    setRows(data || [])
    setLoading(false)
  }

  // Quick inline status change from the Payment Schedule row. Default
  // paid_date on this surface is the row's due_date — the user's mental
  // model is "marking from the Debt Schedule means it was paid on the
  // agreed day." Stamps paid_at on transition to paid; clears it on
  // transition away. Writes an audit_log entry tagged surface=debt_schedule.
  async function quickStatus(row, status) {
    if (!canEdit) return
    const nowIso = new Date().toISOString()
    const wasPaid = row.status === 'paid' || row.status === 'partial'
    const goingPaid = status === 'paid' || status === 'partial'
    const patch = {
      status,
      updated_at: nowIso,
    }
    if (goingPaid) {
      if (!row.paid_amount) patch.paid_amount = row.scheduled_amount
      if (!row.paid_date) patch.paid_date = row.due_date || nowIso.slice(0, 10)
      patch.paid_at = nowIso
    } else {
      // Leaving paid/partial — clear the paid metadata so time-aware
      // projection and the dashboard don't read a stale anchor.
      patch.paid_date = null
      patch.paid_at = null
      patch.paid_amount = null
    }
    const { error: upErr } = await supabase.from('loan_payments').update(patch).eq('id', row.id)
    if (upErr) { toast.error("Couldn't change payment status", upErr); return }

    toast.success(
      status === 'paid' ? 'Payment marked paid'
      : status === 'partial' ? 'Payment marked partial'
      : status === 'skipped' ? 'Payment skipped'
      : status === 'pending' ? (wasPaid ? 'Payment reverted to pending' : 'Payment set to pending')
      : `Payment status — ${STATUS_LABELS[status] || status}`
    )

    await supabase.from('audit_log').insert({
      table_name: 'loan_payments',
      record_id: row.id,
      action: goingPaid ? 'paid_status_set' : (wasPaid ? 'paid_status_reverted' : 'status_changed'),
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        surface: 'debt_schedule',
        from_status: row.status,
        to_status: status,
        due_date: row.due_date || null,
        paid_date: goingPaid ? (patch.paid_date || row.paid_date) : null,
        paid_at: goingPaid ? nowIso : null,
        paid_amount: goingPaid ? (patch.paid_amount ?? row.paid_amount ?? row.scheduled_amount) : null,
        loan_id: row.loan_id,
      },
    })

    load()
  }

  function openEdit(row) {
    setEditRow(row)
    setForm({
      due_date: row.due_date || '',
      scheduled_amount: row.scheduled_amount ?? '',
      status: row.status,
      paid_amount: row.paid_amount ?? '',
      paid_date: row.paid_date || '',
      payment_method: row.payment_method || '',
      reference_number: row.reference_number || '',
      notes: row.notes || '',
    })
  }

  async function saveEdit() {
    setSaving(true)
    const nowIso = new Date().toISOString()
    const wasPaid = editRow.status === 'paid' || editRow.status === 'partial'
    const goingPaid = form.status === 'paid' || form.status === 'partial'
    const patch = {
      due_date: form.due_date || null,
      scheduled_amount: form.scheduled_amount === '' ? null : Number(form.scheduled_amount),
      status: form.status,
      paid_amount: form.paid_amount === '' ? null : Number(form.paid_amount),
      paid_date: form.paid_date || null,
      payment_method: form.payment_method.trim() || null,
      reference_number: form.reference_number.trim() || null,
      notes: form.notes.trim() || null,
      updated_at: nowIso,
    }
    // paid_at follows the same rules as quickStatus: stamp on transition to
    // paid/partial, clear on transition away. Existing paid_at is preserved
    // when status stays paid (no churn).
    if (goingPaid && !wasPaid) patch.paid_at = nowIso
    else if (!goingPaid && wasPaid) patch.paid_at = null

    const { error: upErr } = await supabase.from('loan_payments').update(patch).eq('id', editRow.id)
    if (upErr) { setSaving(false); toast.error("Couldn't update payment", upErr); return }
    toast.success('Payment updated')

    // Only log when status transitioned. Edits that just touch notes or
    // payment method don't need a dedicated audit row (updated_at captures it).
    if (goingPaid !== wasPaid) {
      await supabase.from('audit_log').insert({
        table_name: 'loan_payments',
        record_id: editRow.id,
        action: goingPaid ? 'paid_status_set' : 'paid_status_reverted',
        performed_by: user?.id || null,
        performed_by_email: profile?.email || null,
        metadata: {
          surface: 'debt_schedule',
          from_status: editRow.status,
          to_status: form.status,
          due_date: editRow.due_date || null,
          paid_date: form.paid_date || null,
          paid_at: goingPaid ? nowIso : null,
          paid_amount: form.paid_amount === '' ? null : Number(form.paid_amount),
          loan_id: editRow.loan_id,
        },
      })
    }
    setSaving(false); setEditRow(null); load()
  }

  async function deleteRow(row) {
    if (!confirm(`Delete payment for ${fmtDate(row.due_date)}?`)) return
    const { error } = await supabase.from('loan_payments').delete().eq('id', row.id)
    if (error) toast.error("Couldn't delete payment", error)
    else toast.success(`Payment deleted — ${fmtDate(row.due_date)}`)
    load()
  }

  async function addBlankRow() {
    if (!canEdit) return
    const last = rows[rows.length - 1]
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const nextDate = last?.due_date
      ? (() => {
          const d = new Date(`${last.due_date}T00:00:00`); d.setMonth(d.getMonth() + 1)
          return d.toISOString().slice(0, 10)
        })()
      : today.toISOString().slice(0, 10)
    const nextDueMonth = `${nextDate.slice(0, 7)}-01`
    const { error } = await supabase.from('loan_payments').insert({
      loan_id: loanId,
      due_month: nextDueMonth,
      due_date: nextDate,
      scheduled_amount: last?.scheduled_amount ?? 0,
      status: 'pending',
    })
    if (error) toast.error("Couldn't add payment row", error)
    else toast.success(`Payment row added — ${fmtDate(nextDate)}`)
    load()
  }

  async function runRegenerate() {
    if (!canRegen || regenRunning) return
    setRegenRunning(true)
    const { data, error } = await supabase.rpc('regenerate_loan_schedule', { p_loan_id: loanId })
    setRegenRunning(false)
    if (error) { toast.error("Couldn't regenerate schedule", error); return }
    const result = Array.isArray(data) ? data[0] : data
    const inserted = result?.rows_inserted ?? 0
    const total = result?.total_rows ?? 0
    await supabase.from('audit_log').insert({
      table_name: 'loans',
      record_id: loanId,
      action: 'loan_schedule_regenerated',
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        loan_id: loanId,
        rows_inserted: inserted,
        total_rows: total,
        term_months: loan?.term_months || null,
      },
    })
    setShowRegen(false)
    toast.success(`Schedule updated — ${inserted} row${inserted === 1 ? '' : 's'} added`, {
      description: `Schedule now has ${total} payment${total === 1 ? '' : 's'}.`,
    })
    setRegenToast(`Added ${inserted} pending row${inserted === 1 ? '' : 's'}. Schedule now has ${total} payment${total === 1 ? '' : 's'}.`)
    setTimeout(() => setRegenToast(''), 5000)
    await load()
    onChange?.()
  }

  const canRegen = !!(loan?.first_payment_date && loan?.term_months && loan?.monthly_payment)
  const projectedAdd = loan?.term_months && rows.length >= 0
    ? Math.max(0, Number(loan.term_months) - rows.length)
    : 0

  // Running totals
  const totals = useMemo(() => {
    const yearStart = new Date(); yearStart.setMonth(0, 1); yearStart.setHours(0, 0, 0, 0)
    let paidYTD = 0, skippedYTD = 0, remaining = 0, pendingCount = 0
    let nextDue = null  // earliest pending/partial row — keep the full row
                        // so the tile button + the table highlight share an id.
    for (const r of rows) {
      const due = r.due_date ? new Date(`${r.due_date}T00:00:00`) : null
      if (r.status === 'paid' && due >= yearStart) paidYTD += Number(r.paid_amount || r.scheduled_amount || 0)
      if (r.status === 'skipped' && due >= yearStart) skippedYTD += Number(r.scheduled_amount || 0)
      if (r.status === 'pending' || r.status === 'partial') {
        remaining += Number(r.scheduled_amount || 0) - Number(r.paid_amount || 0)
        pendingCount++
        if (r.due_date && (!nextDue || r.due_date < nextDue.due_date)) {
          nextDue = r
        }
      }
    }
    return { paidYTD, skippedYTD, remaining, pendingCount, nextDue }
  }, [rows])

  // Apply quick filter + sort
  const visibleRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    let out = rows
    if (quickFilter === 'past_due') {
      out = out.filter(r => (r.status === 'pending' || r.status === 'partial') && r.due_date && r.due_date < today)
    } else if (quickFilter === 'pending') {
      out = out.filter(r => r.status === 'pending' || r.status === 'partial')
    } else if (quickFilter === 'paid') {
      out = out.filter(r => r.status === 'paid')
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...out].sort((a, b) => {
      const ad = a.due_date || ''
      const bd = b.due_date || ''
      if (ad < bd) return -1 * dir
      if (ad > bd) return  1 * dir
      return 0
    })
  }, [rows, quickFilter, sortDir])

  const filterCounts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return {
      all: rows.length,
      past_due: rows.filter(r => (r.status === 'pending' || r.status === 'partial') && r.due_date && r.due_date < today).length,
      pending: rows.filter(r => r.status === 'pending' || r.status === 'partial').length,
      paid: rows.filter(r => r.status === 'paid').length,
    }
  }, [rows])

  if (loading) return <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Paid YTD" value={fmtMoney(totals.paidYTD)} accent="green" />
        <Stat label="Skipped YTD" value={fmtMoney(totals.skippedYTD)} accent="red" />
        <Stat
          label="Remaining To Pay"
          value={fmtMoney(totals.remaining)}
          subtitle={`${totals.pendingCount} payment${totals.pendingCount === 1 ? '' : 's'}`}
          accent="orange"
        />
        <NextPaymentDueTile
          nextDue={totals.nextDue}
          canEdit={canEdit}
          onMarkPaid={() => totals.nextDue && setMarkPaidRow(totals.nextDue)}
        />
      </div>

      {/* Quick filter pills + sort toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          <FilterPill active={quickFilter === 'all'}      onClick={() => setQuickFilter('all')}      label="All months"      count={filterCounts.all} />
          <FilterPill active={quickFilter === 'past_due'} onClick={() => setQuickFilter('past_due')} label="Past due only"   count={filterCounts.past_due} tone="red" />
          <FilterPill active={quickFilter === 'pending'}  onClick={() => setQuickFilter('pending')}  label="Pending only"    count={filterCounts.pending} />
          <FilterPill active={quickFilter === 'paid'}     onClick={() => setQuickFilter('paid')}     label="Paid only"       count={filterCounts.paid} tone="green" />
        </div>
        <button
          onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-gray-200 dark:border-slate-700/50 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        >
          {sortDir === 'asc' ? 'Sort: Oldest first ↓' : 'Sort: Most recent first ↑'}
        </button>
      </div>

      {canEdit && (
        <div className="flex justify-end gap-2 items-center">
          {regenToast && (
            <span className="text-xs text-emerald-700 dark:text-emerald-400 mr-auto">✓ {regenToast}</span>
          )}
          <button
            onClick={() => setShowRegen(true)}
            disabled={!canRegen || regenRunning}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={canRegen
              ? 'Fill in any missing pending months — existing rows untouched.'
              : 'Set term (months), first payment date, and monthly payment on the Overview tab first.'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Regenerate Schedule
          </button>
          <button onClick={addBlankRow} className={FC.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Payment Row
          </button>
        </div>
      )}

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Month', 'Due Date', 'Scheduled', 'Status', 'Paid', 'Paid Date', 'Notes', 'Last Updated', canEdit && ''].filter(h => h !== false).map((h, i) => (
                  <th key={i} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">{rows.length === 0 ? 'No payments scheduled' : 'No payments match this filter'}</td></tr>
              ) : visibleRows.map(r => (
                <tr
                  key={r.id}
                  className={`${S.tableRow} ${
                    totals.nextDue && r.id === totals.nextDue.id
                      ? 'bg-amber-50/60 dark:bg-amber-500/[0.07]'
                      : ''
                  }`}
                >
                  <td className={`${S.td} text-gray-700 dark:text-slate-300 font-medium whitespace-nowrap`}>
                    {r.due_month ? new Date(`${r.due_month}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(r.due_date)}</td>
                  <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(r.scheduled_amount)}</td>
                  <td className={S.td}>
                    {canEdit ? (
                      <div className="flex gap-1">
                        {PAYMENT_STATUSES.map(s => (
                          <button key={s} onClick={() => quickStatus(r, s)}
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-all ${
                              r.status === s
                                ? paymentStatusPill(s)
                                : 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-white/5 hover:bg-gray-100 dark:hover:bg-white/10'
                            }`}>
                            {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusPill(r.status)}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    )}
                  </td>
                  <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{r.paid_amount != null ? fmtMoney(r.paid_amount) : '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(r.paid_date)}</td>
                  <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400 max-w-[180px] truncate`} title={r.notes || ''}>{r.notes || '—'}</td>
                  <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap`} title={r.updated_at ? new Date(r.updated_at).toLocaleString('en-US') : ''}>
                    {fmtRelativeDate(r.updated_at)}
                  </td>
                  {canEdit && (
                    <td className={`${S.td} text-right whitespace-nowrap`}>
                      <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 mr-3" title="Edit">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => deleteRow(r)} className="text-gray-400 hover:text-red-500" title="Delete">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showRegen} onClose={() => !regenRunning && setShowRegen(false)} title="Regenerate Schedule" size="md">
        <div className={S.modalBody}>
          <p className="text-sm text-gray-700 dark:text-slate-300">
            Regenerate schedule for <span className="font-semibold">{loan?.task_name || loan?.loan_id_external || 'this loan'}</span>?
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Fills in any missing monthly payment rows between <strong>{fmtDate(loan?.first_payment_date)}</strong> and the term's last month.
            Existing paid, partial, and skipped rows are not touched.
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className={`${S.card} p-3`}>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-1">Expected after</p>
              <p className="text-base font-bold font-mono text-gray-900 dark:text-slate-200">{loan?.term_months ?? '—'}</p>
            </div>
            <div className={`${S.card} p-3`}>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-1">Current rows</p>
              <p className="text-base font-bold font-mono text-gray-900 dark:text-slate-200">{rows.length}</p>
            </div>
            <div className={`${S.card} p-3`}>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-1">Will add (est.)</p>
              <p className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-400">{projectedAdd}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-slate-500">
            Estimate is based on the count gap. Actual inserts depend on which specific dates are already present.
          </p>
          <div className={S.modalFooter}>
            <button onClick={() => setShowRegen(false)} disabled={regenRunning} className={S.btnCancel}>Cancel</button>
            <button onClick={runRegenerate} disabled={regenRunning} className={FC.btnSave}>
              {regenRunning ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </div>
      </Modal>

      <MarkPaidModal
        open={!!markPaidRow}
        kind="loan"
        mode="paid"
        surface="debt_schedule"
        record={markPaidRow
          ? {
              ...markPaidRow,
              loan: {
                loan_id_external: loan?.loan_id_external || null,
                lender: { name: loan?.lender_name || null },
              },
            }
          : null}
        headerSubtitle={loan ? `${loan.lender_name || 'Loan'} · ${loan.loan_id_external || ''}` : undefined}
        onClose={() => setMarkPaidRow(null)}
        onSaved={() => { setMarkPaidRow(null); load(); onChange?.() }}
      />

      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Payment" size="md">
        {editRow && (
          <div className={S.modalBody}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Due Date">
                <input className={S.input} type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </Field>
              <Field label="Scheduled Amount ($)">
                <input className={S.input} type="number" step="0.01" value={form.scheduled_amount} onChange={e => setForm(f => ({ ...f, scheduled_amount: e.target.value }))} />
              </Field>
              <Field label="Status">
                <select className={S.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </Field>
              <Field label="Paid Amount ($)">
                <input className={S.input} type="number" step="0.01" value={form.paid_amount} onChange={e => setForm(f => ({ ...f, paid_amount: e.target.value }))} />
              </Field>
              <Field label="Paid Date">
                <input className={S.input} type="date" value={form.paid_date} onChange={e => setForm(f => ({ ...f, paid_date: e.target.value }))} />
              </Field>
              <Field label="Payment Method">
                <input className={S.input} value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} />
              </Field>
              <Field label="Reference #">
                <input className={S.input} value={form.reference_number} onChange={e => setForm(f => ({ ...f, reference_number: e.target.value }))} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
            <div className={S.modalFooter}>
              <button onClick={() => setEditRow(null)} className={S.btnCancel}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} className={FC.btnSave}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// NEXT PAYMENT DUE — actionable tile. Shares the Stat shell but the subtitle
// row holds the scheduled amount + a primary Mark Paid button. Empty state
// (no pending rows) shows "Fully paid" in gray with no button.
function NextPaymentDueTile({ nextDue, canEdit, onMarkPaid }) {
  if (!nextDue) {
    return (
      <div className={`${S.card} p-4`}>
        <p className="text-[11px] font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide mb-1">Next Payment Due</p>
        <p className="text-lg font-bold font-mono text-gray-500 dark:text-slate-400">Fully paid</p>
      </div>
    )
  }
  return (
    <div className={`${S.card} p-4`}>
      <p className="text-[11px] font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide mb-1">Next Payment Due</p>
      <p className="text-lg font-bold font-mono text-cyan-600 dark:text-cyan-400">{fmtDate(nextDue.due_date)}</p>
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-[11px] text-gray-500 dark:text-slate-500 font-mono">{fmtMoney(nextDue.scheduled_amount)}</p>
        {canEdit && (
          <button
            onClick={onMarkPaid}
            className="px-2.5 py-1 text-[11px] font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors whitespace-nowrap"
            title={`Mark the ${fmtDate(nextDue.due_date)} payment paid (defaulted to due date)`}
          >
            Mark Paid
          </button>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, subtitle, accent }) {
  const colors = {
    green:  'text-emerald-600 dark:text-emerald-400',
    red:    'text-red-600 dark:text-red-400',
    orange: 'text-orange-600 dark:text-orange-400',
    cyan:   'text-cyan-600 dark:text-cyan-400',
    gray:   'text-gray-500 dark:text-slate-400',
  }
  return (
    <div className={`${S.card} p-4`}>
      <p className="text-[11px] font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${colors[accent]}`}>{value}</p>
      {subtitle && (
        <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-0.5">{subtitle}</p>
      )}
    </div>
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

// Relative-date label for the Last Updated column. Within a week we say
// "Today" / "Yesterday" / "N days ago"; further back we fall to the
// absolute short date. Tooltip on the cell shows the full timestamp.
function fmtRelativeDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function FilterPill({ active, onClick, label, count, tone = 'gray' }) {
  const tones = {
    gray:  active ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-500/30'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-slate-200',
    red:   active ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-300 dark:border-red-500/30'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-slate-200',
    green: active ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/30'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-slate-200',
  }
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${tones[tone]}`}
    >
      {label}
      {count != null && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          active ? 'bg-white/40 dark:bg-black/20' : 'bg-gray-100 dark:bg-slate-700/50'
        }`}>{count}</span>
      )}
    </button>
  )
}
