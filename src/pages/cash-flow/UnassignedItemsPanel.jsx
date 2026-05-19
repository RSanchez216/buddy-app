import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { fmtMoneyExact } from './calendarUtils'
import { useToast } from '../../contexts/ToastContext'

// Warning panel listing actionable items that lack a funding_account_id.
// Lives above the Payment Calendar grid.
//
// Selections are STAGED locally — picking an account doesn't fire a
// mutation. A footer Apply bar shows the pending count and commits every
// staged change in parallel on click. Per-row visual marker (amber left
// border + "Unsaved" pill) makes the staged state visible. Partial
// failures keep their staged state with a red pill so the user can retry.

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

const fmtMoney = fmtMoneyExact

function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function UnassignedItemsPanel({ onAssigned }) {
  const { user, profile, canEdit } = useAuth()
  const globalToast = useToast()
  const [items, setItems] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  // Once the user has either interacted with the chevron OR the panel
  // has finished its first load, stop auto-collapsing on item-count
  // changes — refetches after Apply should preserve the user's
  // chosen expansion state.
  const [expandedInitialized, setExpandedInitialized] = useState(false)

  // Staged selections — keyed by source_id. Each entry remembers the
  // chosen account so we can rehydrate the dropdown and write the
  // mutation on Apply without another lookup.
  const [pendingById, setPendingById] = useState({}) // { [source_id]: { source_type, funding_account_id, account_name, account_bank_name } }
  // source_ids of rows whose most recent Apply attempt failed. Cleared
  // when the user re-stages or clears a row. Reset at the start of
  // every Apply.
  const [failedIds, setFailedIds] = useState(() => new Set())
  // Whole-panel flight flag. True while Promise.allSettled is in flight;
  // disables Apply (prevents double-fires) and grays dropdowns.
  const [applying, setApplying] = useState(false)

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

  // First load only: collapse for big queues, expand for small. After
  // that the user's chevron toggle is sticky across refetches.
  useEffect(() => {
    if (!loading && !expandedInitialized) {
      setExpanded(items.length <= 5)
      setExpandedInitialized(true)
    }
  }, [loading, expandedInitialized, items.length])

  // Ghost pending detection: anything in pendingById that no longer
  // appears in the refetched items (e.g. another tab assigned it) is
  // dropped with a one-time toast so the user knows their staged
  // selection isn't sitting there forever. Skipped on the very first
  // render (pendingById is empty then anyway).
  useEffect(() => {
    if (loading) return
    const ghostIds = Object.keys(pendingById).filter(
      id => !items.some(i => i.source_id === id)
    )
    if (ghostIds.length === 0) return
    setPendingById(prev => {
      const next = { ...prev }
      for (const id of ghostIds) delete next[id]
      return next
    })
    setFailedIds(prev => {
      let changed = false
      const next = new Set(prev)
      for (const id of ghostIds) if (next.delete(id)) changed = true
      return changed ? next : prev
    })
    globalToast.success(
      `${ghostIds.length} item${ghostIds.length === 1 ? '' : 's'} no longer in panel, change${ghostIds.length === 1 ? '' : 's'} discarded`
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loading])

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

  const pendingCount = Object.keys(pendingById).length

  async function writeAuditLog({ sourceType, sourceId, metadata }) {
    await supabase.from('audit_log').insert({
      table_name: AUDIT_TABLE_NAME[sourceType],
      record_id: sourceId,
      action: 'funding_account_assigned',
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata,
    })
  }

  // Stage (no mutation). Clear any prior failed flag for this row.
  function stage(item, fundingAccountId) {
    if (!canEdit || !fundingAccountId) return
    const account = accounts.find(a => a.id === fundingAccountId)
    if (!account) return
    setPendingById(prev => ({
      ...prev,
      [item.source_id]: {
        source_type: item.source_type,
        funding_account_id: fundingAccountId,
        account_name: account.name,
        account_bank_name: account.bank_name || null,
      },
    }))
    setFailedIds(prev => {
      if (!prev.has(item.source_id)) return prev
      const next = new Set(prev); next.delete(item.source_id); return next
    })
  }

  function clearPending(sourceId) {
    setPendingById(prev => {
      if (!(sourceId in prev)) return prev
      const next = { ...prev }; delete next[sourceId]; return next
    })
    setFailedIds(prev => {
      if (!prev.has(sourceId)) return prev
      const next = new Set(prev); next.delete(sourceId); return next
    })
  }

  function discardAll() {
    if (applying) return
    setPendingById({})
    setFailedIds(new Set())
  }

  // Apply one staged change. Returns true on success, false on failure.
  // Each branch matches the existing single-row write path so the same
  // audit_log surface ('funding_account_assigned') and metadata shape
  // carry through.
  async function applyOne(sourceId, pending) {
    const item = items.find(i => i.source_id === sourceId)
    if (!item) return false
    const account = accounts.find(a => a.id === pending.funding_account_id)
    if (!account) return false

    const metadata = {
      funding_account_id: account.id,
      funding_account_name: account.name,
      source: 'unassigned_panel',
    }

    let ok = false
    if (item.source_type === 'loan') {
      const { error } = await supabase
        .from('loans')
        .update({ funding_account_id: account.id })
        .eq('id', item.source_id)
      if (!error) { ok = true; metadata.cascaded_payment_count = Number(item.pending_count || 0) }
    } else if (item.source_type === 'custom_outflow') {
      const { error } = await supabase
        .from('custom_outflows')
        .update({ funding_account_id: account.id })
        .eq('id', item.source_id)
      if (!error) ok = true
    } else if (item.source_type === 'invoice') {
      const { error } = await supabase
        .from('invoices')
        .update({ funding_account_id: account.id })
        .eq('id', item.source_id)
      if (!error) ok = true
    } else if (item.source_type === 'expected_inflow') {
      // Full-amount single deposit. Splits across multiple accounts
      // require the inflow detail page (out of scope here).
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
      if (!error && data) ok = true
    }

    if (ok) {
      // Best-effort audit. A failure here shouldn't roll back the
      // mutation (the assignment already landed) — just warn.
      try {
        await writeAuditLog({
          sourceType: item.source_type,
          sourceId: item.source_id,
          metadata,
        })
      } catch (e) {
        console.warn('[UnassignedItemsPanel] audit_log write failed', e)
      }
    }
    return ok
  }

  async function applyAll() {
    if (applying || pendingCount === 0) return
    setApplying(true)
    setFailedIds(new Set())

    const entries = Object.entries(pendingById)
    const results = await Promise.allSettled(
      entries.map(([sourceId, p]) => applyOne(sourceId, p))
    )

    const successIds = []
    const failed = new Set()
    results.forEach((r, i) => {
      const sourceId = entries[i][0]
      if (r.status === 'fulfilled' && r.value === true) successIds.push(sourceId)
      else failed.add(sourceId)
    })

    setPendingById(prev => {
      const next = { ...prev }
      for (const id of successIds) delete next[id]
      return next
    })
    setFailedIds(failed)
    setApplying(false)

    const total = entries.length
    const succeeded = successIds.length
    const failedCount = total - succeeded
    if (failedCount === 0) {
      globalToast.success(`${succeeded} ${succeeded === 1 ? 'item' : 'items'} assigned`)
    } else if (succeeded === 0) {
      globalToast.error('Update failed')
    } else {
      globalToast.success(
        `${succeeded} of ${total} items assigned. ${failedCount} failed.`
      )
    }

    // Refetch — successful rows drop out of the view, failed rows stay
    // visible (still NULL funding_account_id) and keep their staged
    // state so the user can retry.
    await load()
    onAssigned?.()
  }

  if (loading || items.length === 0) return null

  return (
    <div className="rounded-2xl border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 p-4 min-w-0">
      <button
        type="button"
        onClick={() => { setExpanded(e => !e); setExpandedInitialized(true) }}
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
                      pending={pendingById[r.source_id]}
                      failed={failedIds.has(r.source_id)}
                      applying={applying}
                      canEdit={canEdit}
                      onStage={stage}
                      onClear={clearPending}
                    />
                  ))}
                </ul>
              </div>
            )
          })}

          {/* Apply bar — sticky to the bottom of the panel. Hidden when
              no row has a staged change. */}
          {pendingCount > 0 && (
            <div className="sticky bottom-0 -mx-1 mt-2 px-2 py-2 flex items-center justify-between gap-3 bg-amber-50/95 dark:bg-amber-500/10 backdrop-blur border-t border-amber-200 dark:border-amber-500/20 rounded-b-xl">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {pendingCount} change{pendingCount === 1 ? '' : 's'} pending
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={discardAll}
                  disabled={applying}
                  className="text-xs text-amber-700/80 dark:text-amber-400/80 hover:underline disabled:opacity-50"
                >
                  Discard all
                </button>
                <button
                  type="button"
                  onClick={applyAll}
                  disabled={applying}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 hover:bg-orange-400 disabled:bg-orange-300 disabled:cursor-not-allowed text-white transition-colors"
                >
                  {applying ? 'Applying…' : 'Apply'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ item, accounts, pending, failed, applying, canEdit, onStage, onClear }) {
  const dueLabel = fmtDate(item.next_due_date)
  const secondaryBits = []
  if (item.subtitle) secondaryBits.push(item.subtitle)
  if (item.entity_name) secondaryBits.push(item.entity_name)
  if (item.source_type === 'loan' && Number(item.pending_count || 0) > 0) {
    secondaryBits.push(`${item.pending_count} pending`)
  }
  if (dueLabel) secondaryBits.push(`Next: ${dueLabel}`)

  const staged = !!pending
  const rowIsApplying = applying && staged
  const dropdownValue = pending?.funding_account_id || ''
  // Border accent: amber when staged + idle, deeper amber while
  // applying, red when the last apply attempt for this row failed.
  const borderClass = failed
    ? 'border-l-2 border-red-400 pl-2 -ml-2'
    : rowIsApplying
      ? 'border-l-2 border-amber-600 pl-2 -ml-2'
      : staged
        ? 'border-l-2 border-amber-400 pl-2 -ml-2'
        : ''

  return (
    <li className={`grid grid-cols-12 gap-2 items-baseline py-1.5 text-xs ${borderClass}`}>
      <div className="col-span-12 sm:col-span-6 min-w-0">
        <div className="text-amber-900 dark:text-amber-200 font-medium truncate flex items-center gap-1.5">
          <span className="truncate">{item.label}</span>
          {failed ? (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
              ● Failed — retry?
            </span>
          ) : staged ? (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              ● Unsaved
            </span>
          ) : null}
        </div>
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
          <div className="flex items-center gap-1.5">
            <select
              value={dropdownValue}
              disabled={rowIsApplying}
              onChange={e => {
                const next = e.target.value
                if (next) onStage(item, next)
                else onClear(item.source_id)
              }}
              className="w-full text-xs rounded-md border border-amber-300 dark:border-amber-500/30 bg-white dark:bg-[#0d0d1f] text-amber-900 dark:text-amber-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-50"
            >
              <option value="">Select account…</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.bank_name ? `${a.name} (${a.bank_name})` : a.name}
                </option>
              ))}
            </select>
            {rowIsApplying ? (
              <div
                className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-amber-300 border-t-amber-600 animate-spin"
                aria-label="Applying"
              />
            ) : staged ? (
              <button
                type="button"
                onClick={() => onClear(item.source_id)}
                title="Clear staged selection"
                className="text-amber-600/60 dark:text-amber-400/60 hover:text-amber-700 dark:hover:text-amber-300 shrink-0"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-amber-700/60 dark:text-amber-400/60 italic">read-only</span>
        )}
      </div>
    </li>
  )
}
