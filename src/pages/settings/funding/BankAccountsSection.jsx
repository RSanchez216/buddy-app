// Bank Accounts section of the Funding & Sources page. Reads from
// v_funding_accounts_with_balance so the balance + as-of-date come
// from the latest funding_account_balance_entries row per account.
// Account metadata (name, bank, last_four, notes) is edited inline;
// balance changes go through the Record Balance modal which writes
// a time-series entry.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import RecordBalanceEntryModal from './RecordBalanceEntryModal'
import AdjustmentDetailsModal from './AdjustmentDetailsModal'
import NeedsReviewPill from './NeedsReviewPill'

// Account-metadata form (everything BUT balance — balance now lives in
// funding_account_balance_entries via the Record Balance modal).
const empty = { name: '', bank_name: '', last_four: '', notes: '' }

// Stale pill thresholds (days since the most recent recorded balance):
//   0..2 → green / fresh
//   3..7 → amber / aging
//   8+   → red / overdue for reconciliation
//   null → "no balance recorded yet" gray
function stalenessTone(days) {
  if (days == null) return { dot: 'bg-gray-300 dark:bg-slate-600', text: 'text-gray-500 dark:text-slate-500', label: 'No balance recorded yet — record one' }
  if (days <= 2)    return { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: `${days}d old` }
  if (days <= 7)    return { dot: 'bg-amber-500',   text: 'text-amber-700 dark:text-amber-400',     label: `${days}d old` }
  return                    { dot: 'bg-red-500',    text: 'text-red-700 dark:text-red-400',        label: `${days}d old` }
}

function fmtCurrency(n) {
  if (n === null || n === undefined || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtAsOfShort(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BankAccountsSection() {
  const { isAdmin } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  // Record-balance modal target (null when closed).
  const [recordingAccount, setRecordingAccount] = useState(null)
  // Adjustment classification modal target (adjustment id or null).
  const [adjustmentId, setAdjustmentId] = useState(null)
  // Inline status banner after recording a balance (variance hint).
  const [statusBanner, setStatusBanner] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    // v_funding_accounts_with_balance joins funding_accounts with the
    // latest balance entry per account. Field names balance /
    // balance_as_of_date / days_since_balance come from the view.
    const { data } = await supabase
      .from('v_funding_accounts_with_balance')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name')
    setItems(data || []); setLoading(false)
  }

  const visibleItems = useMemo(
    () => showInactive ? items : items.filter(it => it.is_active),
    [items, showInactive]
  )

  function openAdd() { setEditItem(null); setForm(empty); setError(''); setShowModal(true) }
  function openEdit(it) {
    setEditItem(it)
    setForm({
      name: it.name,
      bank_name: it.bank_name || '',
      last_four: it.last_four || '',
      notes: it.notes || '',
    })
    setError(''); setShowModal(true)
  }

  // Account-metadata save only. Balance moved to the Record Balance
  // modal (writes to funding_account_balance_entries).
  async function save() {
    if (!form.name.trim()) return setError('Name is required')
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      bank_name: form.bank_name.trim() || null,
      last_four: form.last_four.trim() || null,
      notes: form.notes.trim() || null,
    }
    const res = editItem
      ? await supabase.from('funding_accounts').update(payload).eq('id', editItem.id)
      : await supabase.from('funding_accounts').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); load() }
    setSaving(false)
  }

  async function toggleActive(it) {
    await supabase.from('funding_accounts').update({ is_active: !it.is_active }).eq('id', it.id)
    load()
  }

  async function remove(it) {
    if (!confirm(`Delete "${it.name}"? This will fail if loans reference it.`)) return
    const { error: e } = await supabase.from('funding_accounts').delete().eq('id', it.id)
    if (e) alert(e.message)
    else load()
  }

  if (loading) {
    return (
      <SectionCard title="Bank Accounts" subtitle="Bank accounts that fund loan payments">
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
      </SectionCard>
    )
  }

  const activeCount = items.filter(it => it.is_active).length
  const inactiveCount = items.length - activeCount

  return (
    <SectionCard
      title="Bank Accounts"
      subtitle="Bank accounts that fund loan payments"
      headerRight={isAdmin && (
        <button onClick={openAdd} className={S.btnPrimary}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add Account
        </button>
      )}
    >
      {/* Filter bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-slate-500">
          {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show inactive
        </label>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <th className={S.th}>Name</th>
                <th className={S.th}>Bank</th>
                <th className={S.th}>Last 4</th>
                <th className={S.th}>Balance</th>
                <th className={S.th}>Status</th>
                <th className={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">{items.length === 0 ? 'No funding accounts yet' : 'No accounts match this filter'}</td></tr>
              ) : visibleItems.map(it => {
                const muted = !it.is_active
                const tone = stalenessTone(it.days_since_balance)
                return (
                  <tr key={it.id} className={`${S.tableRow} ${muted ? 'opacity-55' : ''}`}>
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.name}</td>
                    <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{it.bank_name || '—'}</td>
                    <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>{it.last_four || '—'}</td>
                    <td className={`${S.td} whitespace-nowrap`}>
                      <div className="font-mono text-gray-900 dark:text-slate-200">{fmtCurrency(it.balance)}</div>
                      {it.balance_as_of_date ? (
                        <div className={`text-[11px] mt-0.5 inline-flex items-center gap-1.5 ${tone.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                          as of {fmtAsOfShort(it.balance_as_of_date)} · {tone.label}
                        </div>
                      ) : (
                        <div className={`text-[11px] mt-0.5 inline-flex items-center gap-1.5 ${tone.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                          {tone.label}
                        </div>
                      )}
                    </td>
                    <td className={S.td}>
                      <div className="flex flex-col items-start gap-1.5">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                          it.is_active
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                            : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
                        }`}>{it.is_active ? 'Active' : 'Inactive'}</span>
                        {it.unclassified_adjustments_count > 0 && (
                          <NeedsReviewPill
                            fundingAccountId={it.id}
                            count={it.unclassified_adjustments_count}
                            total={it.unclassified_adjustments_total}
                            onSelectAdjustment={(id) => setAdjustmentId(id)}
                          />
                        )}
                      </div>
                    </td>
                    <td className={`${S.td} text-right`}>
                      <div className="flex items-center justify-end gap-3">
                        {isAdmin && it.is_active && (
                          <button
                            onClick={() => setRecordingAccount(it)}
                            className="text-xs font-medium px-2 py-1 rounded-md bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20 hover:bg-orange-100 dark:hover:bg-orange-500/15 transition-colors whitespace-nowrap"
                            title="Record today's actual bank balance"
                          >
                            Record balance
                          </button>
                        )}
                        <button onClick={() => openEdit(it)} className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors" title="Edit">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        {isAdmin && (
                          <button onClick={() => toggleActive(it)} className={`text-xs font-medium transition-colors ${it.is_active ? 'text-gray-400 hover:text-red-500' : 'text-gray-400 hover:text-emerald-600'}`}>
                            {it.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                        {isAdmin && (
                          <button onClick={() => remove(it)} className="text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Account' : 'Add Account'} size="md">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Name *</label>
            <input className={S.input} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Operating Account" />
          </div>
          <div>
            <label className={S.label}>Bank Name</label>
            <input className={S.input} value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="e.g. Chase" />
          </div>
          <div>
            <label className={S.label}>Last 4 Digits</label>
            <input className={S.input} value={form.last_four} onChange={e => setForm(f => ({ ...f, last_four: e.target.value }))} placeholder="1234" />
          </div>

          <div className="pt-2 border-t border-gray-100 dark:border-white/5">
            <p className="text-xs text-gray-500 dark:text-slate-500">
              Balance is no longer edited here. Use <span className="font-medium text-orange-700 dark:text-orange-400">Record balance</span> on the row to log an actual bank reading; the Payment Calendar projects forward from the most recent entry.
            </p>
          </div>

          <div>
            <label className={S.label}>Notes</label>
            <textarea className={S.textarea} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={save} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>

      <RecordBalanceEntryModal
        open={!!recordingAccount}
        account={recordingAccount}
        onClose={() => setRecordingAccount(null)}
        onSaved={(result) => {
          setRecordingAccount(null)
          load()
          // Variance feedback. If an adjustment was created, surface it
          // inline at the section header — the user is already on the
          // Bank Accounts page, so a click goes straight to classify.
          if (result?.adjustment) {
            const sign = Number(result.adjustment.amount) >= 0 ? '+' : '−'
            const abs = Math.abs(Number(result.adjustment.amount || 0))
            const fmt = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
            setStatusBanner({
              tone: 'amber',
              message: `Variance of ${sign}${fmt} created an adjustment on ${result.adjustment.adjustment_date}.`,
              actionLabel: 'Classify →',
              onClick: () => { setAdjustmentId(result.adjustment.id); setStatusBanner(null) },
            })
          } else if (result?.entryId) {
            setStatusBanner({ tone: 'emerald', message: 'Recorded balance matched projection — no variance.' })
          }
          setTimeout(() => setStatusBanner(null), 12000)
        }}
      />
      <AdjustmentDetailsModal
        open={!!adjustmentId}
        adjustmentId={adjustmentId}
        onClose={() => setAdjustmentId(null)}
        onSaved={() => { setAdjustmentId(null); load() }}
      />
      {statusBanner && (
        <div className={`fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 ${
          statusBanner.tone === 'amber'
            ? 'border-amber-300 dark:border-amber-500/40'
            : 'border-emerald-200 dark:border-emerald-500/30'
        }`}>
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
            statusBanner.tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
          }`} />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            <span>{statusBanner.message}</span>
            {statusBanner.onClick && statusBanner.actionLabel && (
              <>
                {' '}
                <button onClick={statusBanner.onClick} className="text-orange-600 dark:text-orange-400 hover:underline font-semibold">
                  {statusBanner.actionLabel}
                </button>
              </>
            )}
          </div>
          <button onClick={() => setStatusBanner(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </SectionCard>
  )
}

// Shared section card layout (also used by FactorsSection —
// duplicated locally to keep components self-contained).
function SectionCard({ title, subtitle, headerRight, children }) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children}
    </section>
  )
}
