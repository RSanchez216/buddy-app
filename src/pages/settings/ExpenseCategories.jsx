// Settings UI for the expense_categories reference table.
//
// Mirrors the Equipment Types page pattern (list + add/edit modal +
// archive toggle), with two differences spelled out in the brief:
//   * `name` is read-only after creation. Renaming the lowercase id
//     would orphan existing rows referencing it. To "rename", archive
//     the misnamed one and add a new entry instead.
//   * Hard delete is not exposed. Archive is the surfaced retire path;
//     hard delete only via Supabase MCP after a usage_count check.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import {
  invalidateExpenseCategories,
} from '../../hooks/useExpenseCategories'
import { isValidCategoryName } from '../../constants/expenseCategories'

const empty = { name: '', display_label: '', sort_order: 100, scope: 'fleet' }

// Which surfaces a category shows up on. Fleet = cash-flow (Payment Calendar,
// recurring templates); Office = the Office Expenses page; Both = everywhere.
const SCOPES = [
  { value: 'fleet',  label: 'Fleet' },
  { value: 'office', label: 'Office' },
  { value: 'both',   label: 'Both' },
]
const SCOPE_LABEL = { fleet: 'Fleet', office: 'Office', both: 'Both' }
const scopeOf = (it) => it.scope || 'fleet'

function ScopeChip({ scope }) {
  const s = scope || 'fleet'
  const tone = s === 'office'
    ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/20'
    : s === 'both'
      ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/20'
      : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-white/10'
  return <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full border ${tone}`}>{SCOPE_LABEL[s]}</span>
}

export default function SettingsExpenseCategories() {
  const { user, profile, canEdit } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [usageByName, setUsageByName] = useState({})
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [scopeFilter, setScopeFilter] = useState('all') // all | fleet | office | both

  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null) // null = add, row = edit
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [catRes, outRes, tmplRes] = await Promise.all([
      supabase.from('expense_categories').select('*').order('sort_order').order('display_label'),
      supabase.from('custom_outflows').select('category').not('category', 'is', null),
      supabase.from('recurring_expense_templates').select('category').not('category', 'is', null),
    ])
    setItems(catRes.data || [])
    const usage = {}
    for (const r of (outRes.data || []))  usage[r.category] = (usage[r.category] || 0) + 1
    for (const r of (tmplRes.data || [])) usage[r.category] = (usage[r.category] || 0) + 1
    setUsageByName(usage)
    setLoading(false)
  }

  const active   = useMemo(() => items.filter(i => i.is_active  && (scopeFilter === 'all' || scopeOf(i) === scopeFilter)),  [items, scopeFilter])
  const archived = useMemo(() => items.filter(i => !i.is_active && (scopeFilter === 'all' || scopeOf(i) === scopeFilter)), [items, scopeFilter])

  function openAdd() {
    setEditItem(null); setForm(empty); setError(''); setShowModal(true)
  }
  function openEdit(it) {
    setEditItem(it)
    setForm({
      name: it.name || '',
      display_label: it.display_label || '',
      sort_order: it.sort_order ?? 100,
      scope: it.scope || 'fleet',
    })
    setError(''); setShowModal(true)
  }

  async function writeAudit({ record_id, action, before, after }) {
    await supabase.from('audit_log').insert({
      table_name: 'expense_categories',
      record_id,
      action,
      performed_by: user?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        surface: 'settings_expense_categories',
        name: after?.name ?? before?.name,
        display_label_before: before?.display_label ?? null,
        display_label_after:  after?.display_label  ?? null,
        sort_order_before:    before?.sort_order    ?? null,
        sort_order_after:     after?.sort_order     ?? null,
        is_active_before:     before?.is_active     ?? null,
        is_active_after:      after?.is_active      ?? null,
      },
    })
  }

  async function save() {
    const name = String(form.name || '').trim().toLowerCase()
    const display_label = String(form.display_label || '').trim()
    const sort_order = Number(form.sort_order)
    const scope = SCOPES.some(s => s.value === form.scope) ? form.scope : 'fleet'
    if (!display_label) return setError('Display label is required')
    if (Number.isNaN(sort_order)) return setError('Sort order must be a number')

    if (editItem) {
      // Rename of the lowercase name is not supported; the form locks it
      // to the original value. Only display_label / sort_order / scope change.
      const payload = { display_label, sort_order, scope }
      if (payload.display_label === editItem.display_label && payload.sort_order === editItem.sort_order && scope === (editItem.scope || 'fleet')) {
        setShowModal(false); return
      }
      setSaving(true); setError('')
      const { data, error: e } = await supabase
        .from('expense_categories')
        .update(payload)
        .eq('id', editItem.id)
        .select('*')
        .single()
      if (e || !data) {
        setError(e?.message || 'Save failed'); toast.error("Couldn't update category", e); setSaving(false); return
      }
      await writeAudit({ record_id: data.id, action: 'update', before: editItem, after: data })
      invalidateExpenseCategories()
      toast.success(`Category updated — ${data.display_label}`)
      setShowModal(false); setSaving(false); load()
      return
    }

    // Add path
    if (!isValidCategoryName(name)) {
      return setError('Name must be lowercase letters / digits / underscores, max 30 chars, starting with a letter')
    }
    if (items.some(c => c.name.toLowerCase() === name)) {
      return setError(`A category named "${name}" already exists`)
    }
    setSaving(true); setError('')
    const { data, error: e } = await supabase
      .from('expense_categories')
      .insert({ name, display_label, sort_order: Number.isFinite(sort_order) ? sort_order : 500, scope, is_active: true })
      .select('*')
      .single()
    if (e || !data) {
      setError(e?.message || 'Save failed'); toast.error("Couldn't create category", e); setSaving(false); return
    }
    await writeAudit({ record_id: data.id, action: 'insert', after: data })
    invalidateExpenseCategories()
    toast.success(`Category created — ${data.display_label}`)
    setShowModal(false); setSaving(false); load()
  }

  async function setActive(it, nextActive) {
    const { data, error: e } = await supabase
      .from('expense_categories')
      .update({ is_active: nextActive })
      .eq('id', it.id)
      .select('*')
      .single()
    if (e || !data) { toast.error(nextActive ? "Couldn't unarchive" : "Couldn't archive", e); return }
    await writeAudit({
      record_id: data.id,
      action: nextActive ? 'unarchive' : 'archive',
      before: it,
      after: data,
    })
    invalidateExpenseCategories()
    toast.success(nextActive ? `${data.display_label} unarchived` : `${data.display_label} archived`)
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
    </div>
  )

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Expense Categories</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Used for one-off expenses and recurring templates. Categories appear in dropdowns sorted by order below.
          </p>
        </div>
        {canEdit && (
          <button onClick={openAdd} className={`${S.btnPrimary} shrink-0 whitespace-nowrap`}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Category
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {[{ value: 'all', label: 'All' }, ...SCOPES].map(s => (
          <button key={s.value} onClick={() => setScopeFilter(s.value)} className={S.filterBtn(scopeFilter === s.value)}>
            {s.label}
          </button>
        ))}
      </div>

      <CategoryTable items={active}   usageByName={usageByName} onEdit={openEdit} onArchive={(it) => setActive(it, false)} canEdit={canEdit} />

      {archived.length > 0 && (
        <div className={`${S.card} p-0 overflow-hidden`}>
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-semibold text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/[0.02]"
          >
            <span>Archived ({archived.length})</span>
            <svg className={`w-4 h-4 transition-transform ${showArchived ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showArchived && (
            <CategoryTable
              embedded
              items={archived}
              usageByName={usageByName}
              onEdit={openEdit}
              onUnarchive={(it) => setActive(it, true)}
              canEdit={canEdit}
            />
          )}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Category' : 'Add Category'} size="sm">
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Name *</label>
            <input
              className={S.input}
              value={form.name}
              disabled={!!editItem}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. dispatch_fee"
            />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
              {editItem
                ? 'Locked after creation. To rename, archive this and add a new entry.'
                : 'Lowercase letters / digits / underscores. Stored on each expense row.'}
            </p>
          </div>
          <div>
            <label className={S.label}>Display Label *</label>
            <input
              className={S.input}
              value={form.display_label}
              onChange={e => setForm(f => ({ ...f, display_label: e.target.value }))}
              placeholder="e.g. Dispatch Fee"
            />
          </div>
          <div>
            <label className={S.label}>Scope</label>
            <select
              className={S.input}
              value={form.scope}
              onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
            >
              {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
              Fleet = cash-flow dropdowns. Office = Office Expenses page. Both = everywhere.
            </p>
          </div>
          <div>
            <label className={S.label}>Sort Order</label>
            <input
              type="number"
              className={S.input}
              value={form.sort_order}
              onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
            />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Lower = appears first. Increment by 10 to leave room for inserts.</p>
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={save} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editItem ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function CategoryTable({ items, usageByName, onEdit, onArchive, onUnarchive, canEdit, embedded }) {
  return (
    <div className={embedded ? 'overflow-hidden border-t border-gray-100 dark:border-white/5' : `${S.card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className={S.tableHead}>
          <tr>
            <th className={S.th}>Sort</th>
            <th className={S.th}>Name</th>
            <th className={S.th}>Display Label</th>
            <th className={S.th}>Scope</th>
            <th className={S.th}>Usage</th>
            <th className={S.th}></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-slate-600 text-sm">
                No categories in this section
              </td>
            </tr>
          ) : items.map(it => {
            const usage = usageByName[it.name] || 0
            return (
              <tr key={it.id} className={S.tableRow}>
                <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{it.sort_order}</td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>{it.name}</td>
                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{it.display_label}</td>
                <td className={S.td}><ScopeChip scope={it.scope} /></td>
                <td className={`${S.td} text-gray-500 dark:text-slate-400`}>
                  {usage === 0 ? <span className="italic text-gray-400">unused</span> : `${usage} row${usage === 1 ? '' : 's'}`}
                </td>
                <td className={`${S.td} text-right`}>
                  {canEdit && (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => onEdit(it)}
                        title="Edit display label or sort order"
                        className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {onArchive && (
                        <button
                          onClick={() => onArchive(it)}
                          className="text-xs font-medium text-gray-400 hover:text-amber-600 dark:hover:text-amber-400"
                          title="Archive"
                        >
                          Archive
                        </button>
                      )}
                      {onUnarchive && (
                        <button
                          onClick={() => onUnarchive(it)}
                          className="text-xs font-medium text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                          title="Unarchive"
                        >
                          Unarchive
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
