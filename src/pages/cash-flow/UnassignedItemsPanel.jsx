import { useEffect, useMemo, useReducer, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

// Warning panel listing actionable items that lack a funding_account_id.
// Lives above the Payment Calendar grid. Mirrors the Underwater
// Contracts panel from Driver Purchases (amber tone, grouped sections,
// inline action per row). Self-contained: owns its own fetch, dropdown
// query, toast, and audit-log writes — no prop drilling.
//
// When items.length === 0 the panel renders nothing (no "All clear"
// placeholder). When items.length <= 5 the panel auto-expands; larger
// lists default to collapsed.

const SECTION_LABELS = {
  loan:            'Loans',
  custom_outflow:  'Custom outflows',
  invoice:         'Invoices',
  expected_inflow: 'Inflows',
}

const SECTION_ORDER = ['loan', 'custom_outflow', 'invoice', 'expected_inflow']

// audit_log.table_name uses the source table for each kind. expected_inflow
// items write to expected_inflows (not expected_inflow_deposits) since the
// deposit is an internal implementation detail of the assignment.
const AUDIT_TABLE_NAME = {
  loan:            'loans',
  custom_outflow:  'custom_outflows',
  invoice:         'invoices',
  expected_inflow: 'expected_inflows',
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })
}

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function UnassignedItemsPanel({ onAssigned }) {
  const { user, profile, canEdit } = useAuth()
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  // Per-row dropdown selection (uncontrolled across renders so it
  // resets when the row is replaced after assignment).
  // Per-row busy flag to suppress double-clicks while a request is in
  // flight. Keyed by source_id.
  const [busyIds, setBusyIds] = useState(() => new Set())
  // Toast: single page-level slot. Same expiresAt + 1Hz forceTick
  // pattern as the payment-history toasts.
  const [toast, setToast] = useState(null)
  const [, forceTick] = useReducer(x => x + 1, 0)
  useEffect(() => {
    if (!toast) return
    const id = setInterval(forceTick, 1000)
    return () => clearInterval(id)
  }, [toast])
  function remainingSeconds(t) {
    if (!t?.expiresAt) return 0
    return Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 1000))
  }

  async function load() {
    setLoading(true)
    const [itemsRes, accountsRes] = await Promise.all([
      supabase
        .from('v_unassigned_funding_items')
        .select('*')
        .order('next_due_date', { ascending: true, nullsFirst: false })
        .order('source_type'),
      supabase
        .from('funding_accounts')
        .select('id, name, bank_name, last_four')
        .eq('is_active', true)
        .order('name'),
    ])
    setItems(itemsRes.data || [])
    setAccounts(accountsRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Auto-expand when ≤ 5 items; collapse for larger lists. Doesn't
  // override an explicit user toggle once they've interacted with the
  // chevron, but on first load reflects the size of the queue.
  useEffect(() => {
    if (!loading) setExpanded(items.length <= 5)
  }, [loading, items.length])

  // Group items by source_type for the rendered sections.
  const grouped = useMemo(() => {
    const map = {}
    for (const it of items) {
      const k = it.source_type
      if (!map[k]) map[k] = []
      map[k].push(it)
    }
    return map
  }, [items])

  const totalAmount = useMemo(
    () => items.reduce((s, it) => s + Number(it.amount || 0), 0),
    [items],
  )

  async function writeAuditLog({ sourceType, sourceId, action, metadata }) {
    // audit_log.performed_by_email is nullable; fill it from the
    // profile when available so historical queries don't require a
    // users-table join.
    await supabase.from('audit_log').insert({
      table_name: AUDIT_TABLE_NAME[sourceType],
      record_id: sourceId,
      action,
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata,
    })
  }

  async function assign(item, fundingAccountId) {
    if (!canEdit || !fundingAccountId || busyIds.has(item.source_id)) return
    const account = accounts.find(a => a.id === fundingAccountId)
    if (!account) return
    setBusyIds(s => { const next = new Set(s); next.add(item.source_id); return next })

    // The undo path needs to know exactly what to reverse. For the
    // three "tag the row" sources, reversal is UPDATE ... = NULL. For
    // expected_inflows the write is an INSERT into
    // expected_inflow_deposits, so we capture the created row id.
    let undoPayload = null
    let metadata = {
      funding_account_id: account.id,
      funding_account_name: account.name,
      source: 'unassigned_panel',
    }

    if (item.source_type === 'loan') {
      const { error } = await supabase
        .from('loans')
        .update({ funding_account_id: account.id })
        .eq('id', item.source_id)
      if (error) {
        setBusyIds(s => { const next = new Set(s); next.delete(item.source_id); return next })
        alert('Could not assign: ' + error.message)
        return
      }
      metadata.cascaded_payment_count = Number(item.pending_count || 0)
      undoPayload = { kind: 'unset_loan' }
    } else if (item.source_type === 'custom_outflow') {
      const { error } = await supabase
        .from('custom_outflows')
        .update({ funding_account_id: account.id })
        .eq('id', item.source_id)
      if (error) {
        setBusyIds(s => { const next = new Set(s); next.delete(item.source_id); return next })
        alert('Could not assign: ' + error.message)
        return
      }
      undoPayload = { kind: 'unset_custom_outflow' }
    } else if (item.source_type === 'invoice') {
      const { error } = await supabase
        .from('invoices')
        .update({ funding_account_id: account.id })
        .eq('id', item.source_id)
      if (error) {
        setBusyIds(s => { const next = new Set(s); next.delete(item.source_id); return next })
        alert('Could not assign: ' + error.message)
        return
      }
      undoPayload = { kind: 'unset_invoice' }
    } else if (item.source_type === 'expected_inflow') {
      // MVP: full-amount single deposit. To split across multiple
      // accounts the user opens the inflow detail page.
      const { data, error } = await supabase
        .from('expected_inflow_deposits')
        .insert({
          expected_inflow_id: item.source_id,
          funding_account_id: account.id,
          amount: Number(item.amount || 0),
          position: 0,
        })
        .select('id')
        .single()
      if (error || !data) {
        setBusyIds(s => { const next = new Set(s); next.delete(item.source_id); return next })
        alert('Could not assign: ' + (error?.message || 'no row returned'))
        return
      }
      undoPayload = { kind: 'delete_deposit', depositId: data.id }
    } else {
      setBusyIds(s => { const next = new Set(s); next.delete(item.source_id); return next })
      return
    }

    await writeAuditLog({
      sourceType: item.source_type,
      sourceId: item.source_id,
      action: 'funding_account_assigned',
      metadata,
    })

    // Optimistically remove the row from the local list; the toast
    // undo can restore it via refetch.
    setItems(rs => rs.filter(r => r.source_id !== item.source_id))
    setBusyIds(s => { const next = new Set(s); next.delete(item.source_id); return next })
    onAssigned?.()

    if (toast?.timer) clearTimeout(toast.timer)
    const timer = setTimeout(() => setToast(null), 10000)
    setToast({
      label: item.label,
      accountName: account.name,
      sourceType: item.source_type,
      sourceId: item.source_id,
      undoPayload,
      auditMetadata: metadata,
      expiresAt: Date.now() + 10000,
      timer,
    })
  }

  async function undoToast() {
    if (!toast) return
    const t = toast
    clearTimeout(t.timer)
    setToast(null)
    let error = null
    if (t.undoPayload?.kind === 'unset_loan') {
      const r = await supabase.from('loans').update({ funding_account_id: null }).eq('id', t.sourceId)
      error = r.error
    } else if (t.undoPayload?.kind === 'unset_custom_outflow') {
      const r = await supabase.from('custom_outflows').update({ funding_account_id: null }).eq('id', t.sourceId)
      error = r.error
    } else if (t.undoPayload?.kind === 'unset_invoice') {
      const r = await supabase.from('invoices').update({ funding_account_id: null }).eq('id', t.sourceId)
      error = r.error
    } else if (t.undoPayload?.kind === 'delete_deposit') {
      const r = await supabase.from('expected_inflow_deposits').delete().eq('id', t.undoPayload.depositId)
      error = r.error
    }
    if (error) { alert('Undo failed: ' + error.message); load(); onAssigned?.(); return }
    await writeAuditLog({
      sourceType: t.sourceType,
      sourceId: t.sourceId,
      action: 'funding_account_unassigned',
      metadata: { ...t.auditMetadata, undo: true },
    })
    load()
    onAssigned?.()
  }

  if (loading || items.length === 0) return null

  return (
    <div className="rounded-2xl border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 p-4 min-w-0">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9"  x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {items.length} unassigned {items.length === 1 ? 'item' : 'items'}
          </p>
          <span className="text-xs font-mono font-semibold text-amber-700/80 dark:text-amber-400/80">
            · {fmtMoney(totalAmount)} total
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-amber-700 dark:text-amber-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {SECTION_ORDER.filter(k => grouped[k]?.length).map(sectionKey => {
            const rows = grouped[sectionKey]
            const sectionTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
            const sectionPending = sectionKey === 'loan'
              ? rows.reduce((s, r) => s + Number(r.pending_count || 0), 0)
              : 0
            return (
              <div key={sectionKey} className="rounded-lg bg-white/40 dark:bg-white/[0.02] border border-amber-100 dark:border-amber-500/10 p-3">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800/80 dark:text-amber-300/80">
                    {SECTION_LABELS[sectionKey]}
                  </p>
                  <p className="text-[11px] font-mono text-amber-700/80 dark:text-amber-400/80">
                    {rows.length} · {fmtMoney(sectionTotal)}
                    {sectionKey === 'loan' && sectionPending > 0 && (
                      <span> · {sectionPending} pending {sectionPending === 1 ? 'payment' : 'payments'}</span>
                    )}
                  </p>
                </div>
                <ul className="divide-y divide-amber-100/60 dark:divide-amber-500/10">
                  {rows.map(r => (
                    <Row
                      key={r.source_id}
                      item={r}
                      accounts={accounts}
                      busy={busyIds.has(r.source_id)}
                      canEdit={canEdit}
                      onAssign={assign}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border border-amber-200 dark:border-amber-500/30 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
        >
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-amber-500" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">
            Tagged <span className="font-medium">{toast.label}</span> to{' '}
            <span className="font-medium">{toast.accountName}</span>.{' '}
            <button onClick={undoToast} className="font-semibold text-amber-600 dark:text-amber-400 hover:underline ml-1">
              Undo ({remainingSeconds(toast)}s)
            </button>
          </div>
          <button
            onClick={() => { clearTimeout(toast.timer); setToast(null) }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ item, accounts, busy, canEdit, onAssign }) {
  // Local state for the dropdown so it resets between rows / when the
  // row goes away. We never write the selection itself to URL.
  const [pickedId, setPickedId] = useState('')
  const dueLabel = fmtDate(item.next_due_date)
  // Show the loan cascade impact prominently so the user sees why
  // tagging this one row matters more than tagging a one-off invoice.
  const secondaryBits = []
  if (item.subtitle) secondaryBits.push(item.subtitle)
  if (item.entity_name) secondaryBits.push(item.entity_name)
  if (item.source_type === 'loan' && Number(item.pending_count || 0) > 0) {
    secondaryBits.push(`${item.pending_count} pending`)
  }
  if (dueLabel) secondaryBits.push(`Next: ${dueLabel}`)

  return (
    <li className="grid grid-cols-12 gap-2 items-baseline py-1.5 text-xs">
      <div className="col-span-12 sm:col-span-6 min-w-0">
        <div className="text-amber-900 dark:text-amber-200 font-medium truncate">{item.label}</div>
        {secondaryBits.length > 0 && (
          <div className="text-amber-700/70 dark:text-amber-400/70 text-[11px] truncate">
            {secondaryBits.join(' · ')}
          </div>
        )}
      </div>
      <div className="col-span-4 sm:col-span-2 text-amber-700/80 dark:text-amber-400/80 font-mono text-right whitespace-nowrap">
        {fmtMoney(item.amount)}
      </div>
      <div className="col-span-8 sm:col-span-4 min-w-0">
        {canEdit ? (
          <select
            value={pickedId}
            disabled={busy}
            onChange={e => {
              const next = e.target.value
              setPickedId(next)
              if (next) onAssign(item, next)
            }}
            className="w-full text-xs rounded-md border border-amber-300 dark:border-amber-500/30 bg-white dark:bg-[#0d0d1f] text-amber-900 dark:text-amber-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-50"
          >
            <option value="">{busy ? 'Saving…' : 'Select account…'}</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.bank_name ? `${a.name} (${a.bank_name})` : a.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-amber-700/60 dark:text-amber-400/60 italic">read-only</span>
        )}
      </div>
    </li>
  )
}
