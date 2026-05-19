// Batch detail modal. Opens when a user clicks an Inflows / Transfers /
// Expenses batch card on the Payment Calendar day column. Renders the
// day's lines for that batch as an editable table:
//
//   * Click a row to enter edit mode (cells become inputs).
//   * Trash icon toggles the row's pending-delete state.
//   * "+ Add line" appends a new blank row in edit mode.
//   * Save fires updates / inserts / deletes in parallel with
//     Promise.allSettled; failed rows keep their staged state with a
//     red retry pill.
//   * Audit log per affected row, surface='payment_calendar_batch_modal'.
//
// The three kinds share state plumbing (edits/inserts/deletes) and the
// save dispatcher; only the column schema and cell editors differ.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { CF, fmtMoneyExact } from './calendarUtils'

const SURFACE = 'payment_calendar_batch_modal'

const KIND_META = {
  inflows:   { label: 'Inflows',   noun: 'inflow',   direction: 'inflow',   accent: 'text-emerald-700 dark:text-emerald-400' },
  transfers: { label: 'Transfers', noun: 'transfer', direction: 'transfer', accent: 'text-cyan-700 dark:text-cyan-300' },
  expenses:  { label: 'Expenses',  noun: 'expense',  direction: 'outflow',  accent: 'text-red-700 dark:text-red-400' },
}

function fmtFullDate(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtAccountOption(a) {
  return a.bank_name ? `${a.name} (${a.bank_name})` : a.name
}

let _tempSeq = 0
function nextTempId() { return `temp-${++_tempSeq}` }
function isTemp(id) { return typeof id === 'string' && id.startsWith('temp-') }

export default function BatchDetailModal({
  open, kind, dayISO, accounts = [], onClose, onSaved,
}) {
  const { user, profile } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])              // base server rows
  const [edits, setEdits] = useState({})            // { [rowId]: { field: newValue } }
  const [inserts, setInserts] = useState([])        // [{ tempId, ...newRow }]
  const [deletes, setDeletes] = useState(() => new Set())
  const [editingId, setEditingId] = useState(null)  // rowId or tempId
  const [failedIds, setFailedIds] = useState(() => new Set())
  const [statusFilter, setStatusFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  // Categories distinct list (Expenses only) and sources distinct list
  // (Inflows only). Cached once per modal open. Empty for the other kinds.
  const [knownCategories, setKnownCategories] = useState([])
  const [knownSources, setKnownSources] = useState([])

  const meta = kind ? KIND_META[kind] : null
  const activeAccounts = useMemo(
    () => (accounts || []).filter(a => a.is_active !== false).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [accounts]
  )

  // ── Open / close lifecycle: reset state, fetch the right rows for the kind+day
  useEffect(() => {
    if (!open || !kind || !dayISO) return
    let cancelled = false
    setLoading(true); setRows([]); setEdits({}); setInserts([]); setDeletes(new Set())
    setEditingId(null); setFailedIds(new Set()); setStatusFilter('all')
    setKnownCategories([]); setKnownSources([])
    ;(async () => {
      const fetched = await fetchRowsForKind(kind, dayISO)
      if (cancelled) return
      setRows(fetched)
      // Side fetches for autocomplete (one-shot)
      if (kind === 'expenses') {
        const { data } = await supabase.from('custom_outflows').select('category').not('category', 'is', null)
        if (!cancelled) setKnownCategories([...new Set((data || []).map(r => r.category).filter(Boolean))].sort())
      } else if (kind === 'inflows') {
        const { data } = await supabase.from('expected_inflows').select('source').not('source', 'is', null)
        if (!cancelled) setKnownSources([...new Set((data || []).map(r => r.source).filter(Boolean))].sort())
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open, kind, dayISO])

  // Esc to exit edit mode. The modal's outer wrapper also handles Esc via Modal.
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') setEditingId(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // ── Derived: rows with edits merged in (for display). Inserts are
  // appended separately by the per-kind table render.
  function getRow(id) {
    if (isTemp(id)) return inserts.find(i => i.tempId === id) || null
    const base = rows.find(r => r.id === id)
    if (!base) return null
    const edit = edits[id]
    return edit ? { ...base, ...edit } : base
  }
  function setField(id, field, value) {
    if (isTemp(id)) {
      setInserts(prev => prev.map(i => i.tempId === id ? { ...i, [field]: value } : i))
      return
    }
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }))
    // Clearing failed state on edit gives the user a clean retry.
    setFailedIds(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev); next.delete(id); return next
    })
  }
  function toggleDelete(id) {
    if (isTemp(id)) {
      // Inserts that aren't yet saved — just drop from the inserts list.
      setInserts(prev => prev.filter(i => i.tempId !== id))
      if (editingId === id) setEditingId(null)
      return
    }
    setDeletes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function addRow() {
    const blank = blankRowForKind(kind, dayISO)
    const tempId = nextTempId()
    setInserts(prev => [...prev, { ...blank, tempId }])
    setEditingId(tempId)
  }

  // Filter chips — only meaningful when the batch contains mixed statuses.
  const availableStatuses = useMemo(() => {
    const s = new Set()
    for (const r of rows) if (r.status) s.add(String(r.status).toLowerCase())
    return Array.from(s)
  }, [rows])
  const showStatusChips = availableStatuses.length > 1

  // ── Build displayed rows (existing + inserts), apply filter chip
  const visibleRows = useMemo(() => {
    const existing = rows.map(r => ({ id: r.id, base: r, isInsert: false }))
    const newOnes  = inserts.map(i => ({ id: i.tempId, base: i, isInsert: true }))
    const all = [...existing, ...newOnes]
    if (statusFilter === 'all' || !showStatusChips) return all
    return all.filter(({ base }) => String(base.status || '').toLowerCase() === statusFilter)
  }, [rows, inserts, statusFilter, showStatusChips])

  // ── Header totals
  const headerCount = visibleRows.length - visibleRows.filter(r => deletes.has(r.id)).length
  const headerTotal = useMemo(() => {
    return visibleRows.reduce((s, { id, base, isInsert }) => {
      if (deletes.has(id)) return s
      const live = isInsert ? base : (edits[id] ? { ...base, ...edits[id] } : base)
      return s + Math.abs(Number(live.amount || 0))
    }, 0)
  }, [visibleRows, edits, deletes])

  const pendingCount =
    Object.keys(edits).length + inserts.length + deletes.size

  // ── Cancel with confirm
  function attemptClose() {
    if (pendingCount === 0 || saving) { onClose?.(); return }
    if (window.confirm(`Discard ${pendingCount} change${pendingCount === 1 ? '' : 's'}?`)) onClose?.()
  }

  // ── Save dispatch
  async function save() {
    if (saving || pendingCount === 0) return
    setSaving(true)
    setFailedIds(new Set())

    const ops = []  // [{ kind: 'update'|'insert'|'delete', rowId|tempId, run: async () => true|false }]

    // Updates
    for (const [rowId, fields] of Object.entries(edits)) {
      if (deletes.has(rowId)) continue // delete takes precedence
      ops.push({
        kind: 'update', rowId,
        run: () => runUpdate(kind, rowId, fields, rows),
      })
    }
    // Inserts
    for (const i of inserts) {
      ops.push({
        kind: 'insert', rowId: i.tempId,
        run: () => runInsert(kind, i),
      })
    }
    // Deletes
    for (const rowId of deletes) {
      ops.push({
        kind: 'delete', rowId,
        run: () => runDelete(kind, rowId),
      })
    }

    const results = await Promise.allSettled(ops.map(o => o.run()))
    const failed = new Set()
    let succeeded = 0
    results.forEach((r, i) => {
      const op = ops[i]
      if (r.status === 'fulfilled' && r.value && r.value.ok) {
        succeeded++
        // Audit log per successful op (best-effort)
        writeAudit(kind, op, r.value, { user, profile }).catch(e =>
          console.warn('[BatchDetailModal] audit_log write failed', e)
        )
      } else {
        failed.add(op.rowId)
      }
    })

    // Clear successful edits / inserts / deletes from staged state. Keep failures.
    setEdits(prev => {
      const next = { ...prev }
      ops.forEach((op, i) => {
        if (op.kind === 'update' && !failed.has(op.rowId) && results[i].status === 'fulfilled' && results[i].value?.ok) {
          delete next[op.rowId]
        }
      })
      return next
    })
    setInserts(prev => prev.filter(i => failed.has(i.tempId)))
    setDeletes(prev => {
      const next = new Set()
      for (const id of prev) if (failed.has(id)) next.add(id)
      return next
    })
    setFailedIds(failed)
    setSaving(false)

    const total = ops.length
    const failedCount = total - succeeded
    if (failedCount === 0) {
      toast.success(`${succeeded} change${succeeded === 1 ? '' : 's'} saved`)
      onSaved?.()
      onClose?.()
    } else if (succeeded === 0) {
      toast.error('Save failed')
    } else {
      toast.success(`${succeeded} of ${total} changes saved. ${failedCount} failed.`)
    }
  }

  if (!open || !kind) return null

  return (
    <Modal open={open} onClose={attemptClose} title={`${meta.label} · ${headerCount} ${headerCount === 1 ? 'line' : 'lines'} · ${headerTotalLabel(headerTotal, meta)}`} size="2xl">
      <div className={S.modalBody}>
        <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2">{fmtFullDate(dayISO)}</p>

        {showStatusChips && (
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip active={statusFilter === 'all'}     onClick={() => setStatusFilter('all')}    >All</FilterChip>
            {availableStatuses.map(s => (
              <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </FilterChip>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-12 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
          </div>
        ) : (
          <BatchTable
            kind={kind}
            visibleRows={visibleRows}
            getRow={getRow}
            edits={edits}
            deletes={deletes}
            failedIds={failedIds}
            editingId={editingId}
            setEditingId={setEditingId}
            setField={setField}
            toggleDelete={toggleDelete}
            saving={saving}
            accounts={activeAccounts}
            knownCategories={knownCategories}
            knownSources={knownSources}
            dayISO={dayISO}
          />
        )}

        {!loading && (
          <button
            type="button"
            onClick={addRow}
            disabled={saving}
            className="w-full py-2 text-sm font-medium text-orange-600 dark:text-orange-400 border border-dashed border-orange-300 dark:border-orange-500/30 rounded-xl hover:bg-orange-50 dark:hover:bg-orange-500/5 transition-colors disabled:opacity-50"
          >
            + Add line
          </button>
        )}

        <div className="flex items-baseline justify-between pt-3 border-t border-gray-100 dark:border-white/5">
          <span className="text-sm text-gray-500 dark:text-slate-400">
            {pendingCount === 0
              ? <span>No changes</span>
              : <><span className="font-semibold text-gray-700 dark:text-slate-300">{pendingCount}</span> change{pendingCount === 1 ? '' : 's'} pending</>}
            {failedIds.size > 0 && (
              <span className="ml-3 text-xs text-red-600 dark:text-red-400">
                {failedIds.size} failed
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button onClick={attemptClose} className={S.btnCancel}>Cancel</button>
            <button onClick={save} disabled={saving || pendingCount === 0} className={CF.btnSave}>
              {saving ? 'Saving…' : 'Save all changes'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function headerTotalLabel(total, meta) {
  if (meta.direction === 'inflow')  return `+${fmtMoneyExact(total)}`
  if (meta.direction === 'outflow') return `−${fmtMoneyExact(total)}`
  return fmtMoneyExact(total)
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
        active
          ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
          : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Per-kind table dispatcher
// ─────────────────────────────────────────────────────────────────────────

function BatchTable(props) {
  if (props.kind === 'expenses')  return <ExpensesTable {...props} />
  if (props.kind === 'transfers') return <TransfersTable {...props} />
  if (props.kind === 'inflows')   return <InflowsTable {...props} />
  return null
}

// ─────────────────────────────────────────────────────────────────────────
// Expenses table — single underlying table (custom_outflows), simplest case
// ─────────────────────────────────────────────────────────────────────────

function ExpensesTable({ visibleRows, getRow, deletes, failedIds, editingId, setEditingId, setField, toggleDelete, saving, accounts, knownCategories }) {
  if (visibleRows.length === 0) return <EmptyState label="No expense lines on this day" />
  return (
    <div className="border border-gray-200 dark:border-white/5 rounded-xl overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-white/[0.02] text-[9px] uppercase tracking-widest text-gray-400 dark:text-slate-500">
          <tr>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[100px]">Status</th>
            <th className="text-right px-2 py-1.5 font-bold min-w-[110px]">Amount</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[180px]">Description</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[150px]">Category</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[210px]">Funding account</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[140px]">Planned date</th>
            <th className="text-center px-2 py-1.5 font-bold min-w-[60px]">Cash</th>
            <th className="px-2 py-1.5 min-w-[50px]"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-white/5">
          {visibleRows.map(({ id }) => {
            const row = getRow(id)
            if (!row) return null
            const isDel = deletes.has(id)
            const isEditing = editingId === id
            const isFailed = failedIds.has(id)
            return (
              <tr
                key={id}
                onClick={() => !saving && !isDel && setEditingId(id)}
                className={`${isDel ? 'opacity-50 line-through' : ''} ${isFailed ? 'bg-red-50/50 dark:bg-red-500/5' : ''} ${isEditing ? 'bg-orange-50/40 dark:bg-orange-500/5' : 'hover:bg-gray-50/60 dark:hover:bg-white/[0.02] cursor-pointer'}`}
              >
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <Select value={row.status || 'planned'} onChange={e => setField(id, 'status', e.target.value)}>
                      <option value="planned">planned</option>
                      <option value="paid">paid</option>
                    </Select>
                  ) : (
                    <StatusPill status={row.status} failed={isFailed} />
                  )}
                </td>
                <td className="px-2 py-1 text-right font-mono text-red-700 dark:text-red-400">
                  {isEditing && !isDel ? (
                    <input type="number" step="0.01" className={`${S.input} text-right`} value={row.amount ?? ''} onChange={e => setField(id, 'amount', e.target.value)} />
                  ) : fmtMoneyExact(row.amount)}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input className={S.input} value={row.description || ''} onChange={e => setField(id, 'description', e.target.value)} />
                  ) : (row.description || <span className="text-gray-400 italic">—</span>)}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input list="batchmodal-categories" className={S.input} value={row.category || ''} onChange={e => setField(id, 'category', e.target.value)} />
                  ) : (row.category || <span className="text-gray-400 italic">—</span>)}
                </td>
                <td className="px-2 py-1 max-w-0">
                  {isEditing && !isDel ? (
                    <Select value={row.funding_account_id || ''} onChange={e => setField(id, 'funding_account_id', e.target.value)}>
                      <option value="">— Select —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
                    </Select>
                  ) : (() => {
                    const name = accounts.find(a => a.id === row.funding_account_id)?.name
                    return name
                      ? <span className="block truncate" title={name}>{name}</span>
                      : <span className="text-gray-400 italic">unassigned</span>
                  })()}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input type="date" className={S.input} value={row.planned_pay_date || ''} onChange={e => setField(id, 'planned_pay_date', e.target.value)} />
                  ) : (row.planned_pay_date || row.due_date || '—')}
                </td>
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={!!row.cash_impacting}
                    disabled={!isEditing || isDel}
                    onChange={e => setField(id, 'cash_impacting', e.target.checked)}
                    onClick={e => e.stopPropagation()}
                    className="rounded"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <RowActions saving={saving} isDel={isDel} onToggleDelete={(e) => { e.stopPropagation(); toggleDelete(id) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <datalist id="batchmodal-categories">
        {knownCategories.map(c => <option key={c} value={c} />)}
      </datalist>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Transfers table — funding_account_transfers
// ─────────────────────────────────────────────────────────────────────────

function TransfersTable({ visibleRows, getRow, deletes, failedIds, editingId, setEditingId, setField, toggleDelete, saving, accounts }) {
  if (visibleRows.length === 0) return <EmptyState label="No transfer lines on this day" />
  return (
    <div className="border border-gray-200 dark:border-white/5 rounded-xl overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-white/[0.02] text-[9px] uppercase tracking-widest text-gray-400 dark:text-slate-500">
          <tr>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[100px]">Status</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[210px]">From</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[210px]">To</th>
            <th className="text-right px-2 py-1.5 font-bold min-w-[110px]">Amount</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[140px]">Debit date</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[140px]">Credit date</th>
            <th className="px-2 py-1.5 min-w-[50px]"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-white/5">
          {visibleRows.map(({ id }) => {
            const row = getRow(id)
            if (!row) return null
            const isDel = deletes.has(id)
            const isEditing = editingId === id
            const isFailed = failedIds.has(id)
            const status = row.credit_date && row.debit_date && row.credit_date > row.debit_date ? 'in_transit' : 'settled'
            return (
              <tr
                key={id}
                onClick={() => !saving && !isDel && setEditingId(id)}
                className={`${isDel ? 'opacity-50 line-through' : ''} ${isFailed ? 'bg-red-50/50 dark:bg-red-500/5' : ''} ${isEditing ? 'bg-orange-50/40 dark:bg-orange-500/5' : 'hover:bg-gray-50/60 dark:hover:bg-white/[0.02] cursor-pointer'}`}
              >
                <td className="px-2 py-1"><StatusPill status={status} failed={isFailed} /></td>
                <td className="px-2 py-1 max-w-0">
                  {isEditing && !isDel ? (
                    <Select value={row.from_funding_account_id || ''} onChange={e => setField(id, 'from_funding_account_id', e.target.value)}>
                      <option value="">— Select —</option>
                      {accounts.filter(a => a.id !== row.to_funding_account_id).map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
                    </Select>
                  ) : (() => {
                    const name = accounts.find(a => a.id === row.from_funding_account_id)?.name
                    return name ? <span className="block truncate" title={name}>{name}</span> : '—'
                  })()}
                </td>
                <td className="px-2 py-1 max-w-0">
                  {isEditing && !isDel ? (
                    <Select value={row.to_funding_account_id || ''} onChange={e => setField(id, 'to_funding_account_id', e.target.value)}>
                      <option value="">— Select —</option>
                      {accounts.filter(a => a.id !== row.from_funding_account_id).map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
                    </Select>
                  ) : (() => {
                    const name = accounts.find(a => a.id === row.to_funding_account_id)?.name
                    return name ? <span className="block truncate" title={name}>{name}</span> : '—'
                  })()}
                </td>
                <td className="px-2 py-1 text-right font-mono text-cyan-700 dark:text-cyan-300">
                  {isEditing && !isDel ? (
                    <input type="number" step="0.01" className={`${S.input} text-right`} value={row.amount ?? ''} onChange={e => setField(id, 'amount', e.target.value)} />
                  ) : fmtMoneyExact(row.amount)}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input type="date" className={S.input} value={row.debit_date || ''} onChange={e => setField(id, 'debit_date', e.target.value)} />
                  ) : (row.debit_date || '—')}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input type="date" className={S.input} value={row.credit_date || ''} onChange={e => setField(id, 'credit_date', e.target.value)} />
                  ) : (row.credit_date || '—')}
                </td>
                <td className="px-2 py-1 text-right">
                  <RowActions saving={saving} isDel={isDel} onToggleDelete={(e) => { e.stopPropagation(); toggleDelete(id) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Inflows table — one row per deposit. Parent fields (source, source_type,
// expected_date, notes, status) edit the parent expected_inflows row at
// save time. Amount and funding_account_id edit the deposit row. When
// multiple deposits share a parent, parent-field edits are deduped per
// parent_id so we don't fire the same UPDATE multiple times.
// ─────────────────────────────────────────────────────────────────────────

function InflowsTable({ visibleRows, getRow, deletes, failedIds, editingId, setEditingId, setField, toggleDelete, saving, accounts, knownSources }) {
  if (visibleRows.length === 0) return <EmptyState label="No inflow lines on this day" />
  return (
    <div className="border border-gray-200 dark:border-white/5 rounded-xl overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 dark:bg-white/[0.02] text-[9px] uppercase tracking-widest text-gray-400 dark:text-slate-500">
          <tr>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[100px]">Status</th>
            <th className="text-right px-2 py-1.5 font-bold min-w-[110px]">Amount</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[180px]">Source</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[100px]">Type</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[210px]">Funding account</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[140px]">Expected date</th>
            <th className="text-left  px-2 py-1.5 font-bold min-w-[180px]">Notes</th>
            <th className="px-2 py-1.5 min-w-[50px]"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-white/5">
          {visibleRows.map(({ id }) => {
            const row = getRow(id)
            if (!row) return null
            const isDel = deletes.has(id)
            const isEditing = editingId === id
            const isFailed = failedIds.has(id)
            return (
              <tr
                key={id}
                onClick={() => !saving && !isDel && setEditingId(id)}
                className={`${isDel ? 'opacity-50 line-through' : ''} ${isFailed ? 'bg-red-50/50 dark:bg-red-500/5' : ''} ${isEditing ? 'bg-orange-50/40 dark:bg-orange-500/5' : 'hover:bg-gray-50/60 dark:hover:bg-white/[0.02] cursor-pointer'}`}
              >
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <Select value={row.status || 'pending'} onChange={e => setField(id, 'status', e.target.value)}>
                      <option value="pending">pending</option>
                      <option value="received">received</option>
                    </Select>
                  ) : <StatusPill status={row.status} failed={isFailed} />}
                </td>
                <td className="px-2 py-1 text-right font-mono text-emerald-700 dark:text-emerald-400">
                  {isEditing && !isDel ? (
                    <input type="number" step="0.01" className={`${S.input} text-right`} value={row.amount ?? ''} onChange={e => setField(id, 'amount', e.target.value)} />
                  ) : fmtMoneyExact(row.amount)}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input list="batchmodal-sources" className={S.input} value={row.source || ''} onChange={e => setField(id, 'source', e.target.value)} />
                  ) : (row.source || '—')}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <Select value={row.source_type || 'other'} onChange={e => setField(id, 'source_type', e.target.value)}>
                      <option value="other">other</option>
                      <option value="factor">factor</option>
                    </Select>
                  ) : (row.source_type || 'other')}
                </td>
                <td className="px-2 py-1 max-w-0">
                  {isEditing && !isDel ? (
                    <Select value={row.funding_account_id || ''} onChange={e => setField(id, 'funding_account_id', e.target.value)}>
                      <option value="">— Select —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{fmtAccountOption(a)}</option>)}
                    </Select>
                  ) : (() => {
                    const name = accounts.find(a => a.id === row.funding_account_id)?.name
                    return name
                      ? <span className="block truncate" title={name}>{name}</span>
                      : <span className="text-gray-400 italic">unassigned</span>
                  })()}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input type="date" className={S.input} value={row.expected_date || ''} onChange={e => setField(id, 'expected_date', e.target.value)} />
                  ) : (row.expected_date || '—')}
                </td>
                <td className="px-2 py-1">
                  {isEditing && !isDel ? (
                    <input className={S.input} value={row.notes || row.description || ''} onChange={e => setField(id, 'notes', e.target.value)} />
                  ) : (row.notes || row.description || <span className="text-gray-400 italic">—</span>)}
                </td>
                <td className="px-2 py-1 text-right">
                  <RowActions saving={saving} isDel={isDel} onToggleDelete={(e) => { e.stopPropagation(); toggleDelete(id) }} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <datalist id="batchmodal-sources">
        {knownSources.map(s => <option key={s} value={s} />)}
      </datalist>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Shared row sub-components
// ─────────────────────────────────────────────────────────────────────────

function StatusPill({ status, failed }) {
  if (failed) return <span className="text-[9px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Failed — retry</span>
  if (!status) return <span className="text-gray-400 italic">—</span>
  const s = String(status).toLowerCase()
  const cls =
    s === 'paid' || s === 'received' || s === 'settled' ? 'text-emerald-700 dark:text-emerald-400'
    : s === 'in_transit'                                ? 'text-cyan-700 dark:text-cyan-300'
    : 'text-gray-500 dark:text-slate-400'
  return <span className={`text-[9px] font-semibold uppercase tracking-wide ${cls}`}>{s.replace('_', ' ')}</span>
}

function RowActions({ saving, isDel, onToggleDelete }) {
  return (
    <button
      type="button"
      onClick={onToggleDelete}
      disabled={saving}
      title={isDel ? 'Restore line' : 'Mark for deletion'}
      className={`px-1 py-1 transition-colors ${isDel ? 'text-amber-600 hover:text-amber-700' : 'text-gray-400 hover:text-red-500'} disabled:opacity-50`}
    >
      {isDel ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
        </svg>
      )}
    </button>
  )
}

function EmptyState({ label }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/10 py-6 text-center text-xs text-gray-500 dark:text-slate-500">
      {label}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Data layer — per-kind fetch / blank-row / update / insert / delete
// ─────────────────────────────────────────────────────────────────────────

function blankRowForKind(kind, dayISO) {
  if (kind === 'expenses') {
    return {
      id: null, status: 'planned', amount: '', description: '', category: '',
      funding_account_id: '', planned_pay_date: dayISO, due_date: dayISO, cash_impacting: true,
    }
  }
  if (kind === 'transfers') {
    return {
      id: null, from_funding_account_id: '', to_funding_account_id: '',
      amount: '', debit_date: dayISO, credit_date: dayISO,
    }
  }
  if (kind === 'inflows') {
    return {
      id: null, status: 'pending', amount: '', source: '', source_type: 'other',
      funding_account_id: '', expected_date: dayISO, notes: '',
    }
  }
  return {}
}

async function fetchRowsForKind(kind, dayISO) {
  if (kind === 'expenses') {
    // Mirror the day-card filter: row displays on the day matching
    // COALESCE(paid_date, planned_pay_date, due_date).
    const { data } = await supabase
      .from('custom_outflows')
      .select('id, status, amount, description, category, funding_account_id, planned_pay_date, due_date, paid_date, cash_impacting')
      .or(`paid_date.eq.${dayISO},planned_pay_date.eq.${dayISO},due_date.eq.${dayISO}`)
      .order('amount', { ascending: false })
    return data || []
  }
  if (kind === 'transfers') {
    const { data } = await supabase
      .from('funding_account_transfers')
      .select('id, from_funding_account_id, to_funding_account_id, amount, debit_date, credit_date, notes')
      .or(`debit_date.eq.${dayISO},credit_date.eq.${dayISO}`)
      .order('amount', { ascending: false })
    return data || []
  }
  if (kind === 'inflows') {
    // One row per deposit, with the parent's fields denormalized in.
    // Pick the parents first (filtered by date) so the deposit lookup
    // doesn't pull the whole expected_inflow_deposits table.
    // Editing parent fields (source, type, status, date, notes) on any
    // deposit row stages an edit on that row id; save() partitions and
    // fires one UPDATE per parent + one UPDATE per deposit. With
    // multi-deposit parents, parent-field edits on different deposit
    // rows can conflict (last-write-wins in DB order) — rare enough to
    // accept in this pass.
    const { data: parents } = await supabase
      .from('expected_inflows')
      .select('id, source, source_type, status, expected_date, received_date, notes, description')
      .or(`expected_date.eq.${dayISO},received_date.eq.${dayISO}`)
    if (!parents?.length) return []
    const parentIds = parents.map(p => p.id)
    const { data: deposits } = await supabase
      .from('expected_inflow_deposits')
      .select('id, expected_inflow_id, funding_account_id, amount')
      .in('expected_inflow_id', parentIds)
    const parentById = Object.fromEntries(parents.map(p => [p.id, p]))
    return (deposits || [])
      .map(d => {
        const p = parentById[d.expected_inflow_id]
        return {
          id: d.id,
          _parent_id: p.id,
          amount: d.amount,
          funding_account_id: d.funding_account_id,
          source: p.source,
          source_type: p.source_type,
          status: p.status,
          expected_date: p.expected_date,
          notes: p.notes || p.description || '',
        }
      })
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
  }
  return []
}

// Field partitions for inflows: which fields live on the parent table
// vs. the deposit table.
const INFLOW_PARENT_FIELDS = new Set(['source', 'source_type', 'status', 'expected_date', 'notes'])
const INFLOW_DEPOSIT_FIELDS = new Set(['amount', 'funding_account_id'])

async function runUpdate(kind, rowId, fields, rows) {
  if (kind === 'expenses') {
    const payload = pickAllowed(fields, ['status', 'amount', 'description', 'category', 'funding_account_id', 'planned_pay_date', 'cash_impacting'])
    if ('amount' in payload) payload.amount = Number(payload.amount)
    const { error } = await supabase.from('custom_outflows').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', rowId)
    return { ok: !error, error, table: 'custom_outflows', recordId: rowId }
  }
  if (kind === 'transfers') {
    const payload = pickAllowed(fields, ['from_funding_account_id', 'to_funding_account_id', 'amount', 'debit_date', 'credit_date'])
    if ('amount' in payload) payload.amount = Number(payload.amount)
    if (payload.from_funding_account_id && payload.to_funding_account_id && payload.from_funding_account_id === payload.to_funding_account_id) {
      return { ok: false, error: new Error('From and To must differ') }
    }
    if (payload.credit_date && payload.debit_date && payload.credit_date < payload.debit_date) {
      return { ok: false, error: new Error('Credit date must be on or after debit date') }
    }
    const { error } = await supabase.from('funding_account_transfers').update(payload).eq('id', rowId)
    return { ok: !error, error, table: 'funding_account_transfers', recordId: rowId }
  }
  if (kind === 'inflows') {
    const base = rows.find(r => r.id === rowId)
    if (!base) return { ok: false, error: new Error('row missing') }
    const parentPayload = {}
    const depositPayload = {}
    for (const [k, v] of Object.entries(fields)) {
      if (INFLOW_PARENT_FIELDS.has(k))  parentPayload[k]  = v
      if (INFLOW_DEPOSIT_FIELDS.has(k)) depositPayload[k] = v
    }
    if ('amount' in depositPayload) depositPayload.amount = Number(depositPayload.amount)
    let lastError = null
    if (Object.keys(depositPayload).length) {
      const { error } = await supabase.from('expected_inflow_deposits').update(depositPayload).eq('id', rowId)
      if (error) lastError = error
    }
    if (!lastError && Object.keys(parentPayload).length) {
      const { error } = await supabase.from('expected_inflows').update({ ...parentPayload, updated_at: new Date().toISOString() }).eq('id', base._parent_id)
      if (error) lastError = error
    }
    return { ok: !lastError, error: lastError, table: 'expected_inflows', recordId: base._parent_id }
  }
  return { ok: false, error: new Error('unknown kind') }
}

async function runInsert(kind, draft) {
  if (kind === 'expenses') {
    const amt = Number(draft.amount)
    if (!amt || amt <= 0)             return { ok: false, error: new Error('Amount required') }
    if (!draft.description?.trim())   return { ok: false, error: new Error('Description required') }
    if (!draft.category?.trim())      return { ok: false, error: new Error('Category required') }
    if (!draft.funding_account_id)    return { ok: false, error: new Error('Funding account required') }
    if (!draft.planned_pay_date)      return { ok: false, error: new Error('Date required') }
    const { data, error } = await supabase
      .from('custom_outflows')
      .insert({
        status:             draft.status || 'planned',
        amount:             amt,
        description:        draft.description.trim(),
        category:           draft.category.trim(),
        funding_account_id: draft.funding_account_id,
        planned_pay_date:   draft.planned_pay_date,
        due_date:           draft.due_date || draft.planned_pay_date,
        cash_impacting:     !!draft.cash_impacting,
      })
      .select('id').single()
    return { ok: !error && !!data, error, table: 'custom_outflows', recordId: data?.id }
  }
  if (kind === 'transfers') {
    const amt = Number(draft.amount)
    if (!draft.from_funding_account_id) return { ok: false, error: new Error('From required') }
    if (!draft.to_funding_account_id)   return { ok: false, error: new Error('To required') }
    if (draft.from_funding_account_id === draft.to_funding_account_id) return { ok: false, error: new Error('From and To must differ') }
    if (!amt || amt <= 0)               return { ok: false, error: new Error('Amount required') }
    if (!draft.debit_date || !draft.credit_date) return { ok: false, error: new Error('Dates required') }
    if (draft.credit_date < draft.debit_date)    return { ok: false, error: new Error('Credit on/after debit') }
    const { data, error } = await supabase
      .from('funding_account_transfers')
      .insert({
        from_funding_account_id: draft.from_funding_account_id,
        to_funding_account_id:   draft.to_funding_account_id,
        amount:                  amt,
        debit_date:              draft.debit_date,
        credit_date:             draft.credit_date,
      })
      .select('id').single()
    return { ok: !error && !!data, error, table: 'funding_account_transfers', recordId: data?.id }
  }
  if (kind === 'inflows') {
    const amt = Number(draft.amount)
    if (!draft.source?.trim())       return { ok: false, error: new Error('Source required') }
    if (!amt || amt <= 0)            return { ok: false, error: new Error('Amount required') }
    if (!draft.funding_account_id)   return { ok: false, error: new Error('Funding account required') }
    if (!draft.expected_date)        return { ok: false, error: new Error('Expected date required') }
    const { data: parent, error: pErr } = await supabase
      .from('expected_inflows')
      .insert({
        source:        draft.source.trim(),
        source_type:   draft.source_type || 'other',
        status:        draft.status || 'pending',
        expected_date: draft.expected_date,
        amount:        amt,
        notes:         draft.notes?.trim() || null,
      })
      .select('id').single()
    if (pErr || !parent) return { ok: false, error: pErr, table: 'expected_inflows', recordId: null }
    const { error: dErr } = await supabase.from('expected_inflow_deposits').insert({
      expected_inflow_id: parent.id,
      funding_account_id: draft.funding_account_id,
      amount: amt,
      position: 0,
    })
    if (dErr) {
      // Rollback the orphan parent so a retry doesn't pile up records.
      await supabase.from('expected_inflows').delete().eq('id', parent.id)
      return { ok: false, error: dErr, table: 'expected_inflows', recordId: parent.id }
    }
    return { ok: true, table: 'expected_inflows', recordId: parent.id }
  }
  return { ok: false, error: new Error('unknown kind') }
}

async function runDelete(kind, rowId) {
  if (kind === 'expenses') {
    const { error } = await supabase.from('custom_outflows').delete().eq('id', rowId)
    return { ok: !error, error, table: 'custom_outflows', recordId: rowId }
  }
  if (kind === 'transfers') {
    const { error } = await supabase.from('funding_account_transfers').delete().eq('id', rowId)
    return { ok: !error, error, table: 'funding_account_transfers', recordId: rowId }
  }
  if (kind === 'inflows') {
    // Delete deposit only; the parent inflow may still have other
    // deposits or be referenced elsewhere. Surface-level "delete this
    // line" deliberately doesn't cascade to the parent in this PR.
    const { error } = await supabase.from('expected_inflow_deposits').delete().eq('id', rowId)
    return { ok: !error, error, table: 'expected_inflow_deposits', recordId: rowId }
  }
  return { ok: false, error: new Error('unknown kind') }
}

async function writeAudit(kind, op, result, { user, profile }) {
  if (!result?.recordId || !result?.table) return
  const actionByOp = { update: 'updated', insert: 'inserted', delete: 'deleted' }
  await supabase.from('audit_log').insert({
    table_name:        result.table,
    record_id:         result.recordId,
    action:            actionByOp[op.kind] || op.kind,
    performed_by:      user?.id || null,
    performed_by_email: profile?.email || null,
    metadata: { surface: SURFACE, kind, op: op.kind },
  })
}

function pickAllowed(obj, keys) {
  const out = {}
  for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}
