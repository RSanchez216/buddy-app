// /settings/recurring-expenses — list, edit (limited fields), and
// archive recurring expense templates. Creation lives on the Payment
// Calendar (Quick Line Add → Recurring tab); the top-right CTA on this
// page deep-links there with ?add=recurring so the modal auto-opens on
// the right tab.
//
// Editable fields: amount, category, funding_account_id, end_date, notes.
// Frequency / day-pattern / start_date / name are locked — the safe
// remedy for a change is "archive + create new" rather than re-anchor
// the existing instances.
//
// Save cascades to FUTURE PLANNED custom_outflows rows generated from
// this template (status='planned', due_date >= chicago today). Paid
// rows are left alone. Shortening end_date past a paid row blocks the
// save; otherwise rows past the new end_date are deleted. Extending
// end_date (or going indefinite) re-runs generate_recurring_instances
// to fill in the gap.
//
// Audit: each edit / archive / restore writes one row to public.audit_log
// with table_name='recurring_expense_templates' and a metadata payload
// capturing before/after + the cascade counts.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { useExpenseCategories } from '../../hooks/useExpenseCategories'
import { defaultDisplayLabelFor } from '../../constants/expenseCategories'

const SURFACE = 'settings_recurring_expenses'
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function chicagoTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function ordinal(n) {
  const v = Number(n) || 0
  const s = ['th', 'st', 'nd', 'rd']
  const rem = v % 100
  return v + (s[(rem - 20) % 10] || s[rem] || s[0])
}

function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : (plural || singular + 's')}`
}

function fmtCadence(tpl) {
  if (!tpl) return '—'
  const dow = WEEKDAY_NAMES[Number(tpl.day_of_week)] || ''
  switch (tpl.frequency) {
    case 'weekly':      return dow ? `Weekly · ${dow}s` : 'Weekly'
    case 'biweekly':    return dow ? `Biweekly · ${dow}s` : 'Biweekly'
    case 'semimonthly': return `Semimonthly · ${ordinal(tpl.day_of_month)} & ${ordinal(tpl.second_day_of_month)}`
    case 'monthly':     return `Monthly · ${ordinal(tpl.day_of_month)}`
    case 'quarterly':   return `Quarterly · ${ordinal(tpl.day_of_month)}`
    case 'annually':    return `Annually · ${ordinal(tpl.day_of_month)}`
    default:            return tpl.frequency || '—'
  }
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n) {
  const num = Number(n) || 0
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

// ── Rough estimate of how many additional planned instances an
// end_date extension would create. Same cadence math as the SQL
// function uses; close enough for a preview banner (the actual save
// goes through generate_recurring_instances which is the source of
// truth — ON CONFLICT DO NOTHING means there's no harm if the estimate
// is off by one or two).
function estimateNewInstances(tpl, fromISO, toISO) {
  if (!fromISO || !toISO || toISO < fromISO) return 0
  const from = new Date(`${fromISO}T00:00:00`)
  const to   = new Date(`${toISO}T00:00:00`)
  const days = Math.round((to - from) / 86_400_000)
  switch (tpl.frequency) {
    case 'weekly':      return Math.max(0, Math.floor(days / 7))
    case 'biweekly':    return Math.max(0, Math.floor(days / 14))
    case 'semimonthly': return Math.max(0, Math.floor(days / 15))
    case 'monthly':     return Math.max(0, Math.floor(days / 30))
    case 'quarterly':   return Math.max(0, Math.floor(days / 91))
    case 'annually':    return Math.max(0, Math.floor(days / 365))
    default:            return 0
  }
}

export default function RecurringExpenses() {
  const { canEdit } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [templates, setTemplates] = useState([])
  const [accounts, setAccounts] = useState([])
  const [nextDueByTemplate, setNextDueByTemplate] = useState({}) // {template_id: nextDueISO}
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')   // 'all' | 'active' | 'archived'
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [editTarget, setEditTarget] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [tplRes, accRes, nextRes] = await Promise.all([
      supabase.from('recurring_expense_templates').select('*').order('name'),
      supabase.from('funding_accounts').select('id, name, bank_name, is_active').order('name'),
      supabase.from('custom_outflows')
        .select('recurring_template_id, due_date, status')
        .not('recurring_template_id', 'is', null)
        .eq('status', 'planned')
        .gte('due_date', chicagoTodayISO())
        .order('due_date', { ascending: true }),
    ])
    setTemplates(tplRes.data || [])
    setAccounts(accRes.data || [])
    // First (earliest) planned future instance per template
    const nextDue = {}
    for (const row of (nextRes.data || [])) {
      if (!nextDue[row.recurring_template_id]) {
        nextDue[row.recurring_template_id] = row.due_date
      }
    }
    setNextDueByTemplate(nextDue)
    setLoading(false)
  }

  const activeCount   = templates.filter(t => t.is_active).length
  const archivedCount = templates.length - activeCount

  const visible = useMemo(() => {
    const filtered = templates.filter(t => {
      if (filter === 'active')   return t.is_active
      if (filter === 'archived') return !t.is_active
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      let av, bv
      switch (sortKey) {
        case 'name':       av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); break
        case 'amount':     av = Number(a.amount || 0);        bv = Number(b.amount || 0);        break
        case 'start_date': av = a.start_date || '';           bv = b.start_date || '';           break
        case 'end_date':   av = a.end_date   || '￿';     bv = b.end_date   || '￿';     break
        case 'next_due':   av = nextDueByTemplate[a.id] || '￿'; bv = nextDueByTemplate[b.id] || '￿'; break
        default:           av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase()
      }
      if (av < bv) return -1 * dir
      if (av > bv) return  1 * dir
      return 0
    })
    return sorted
  }, [templates, filter, sortKey, sortDir, nextDueByTemplate])

  function toggleSort(key) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    setSortDir(d => d === 'asc' ? 'desc' : 'asc')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Recurring Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Templates that automatically generate scheduled expense lines on the Payment Calendar.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => navigate('/cash-flow/payment-calendar?add=recurring')}
            className={S.btnPrimary}
            title="Opens the Payment Calendar with the Recurring tab pre-selected"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New recurring expense
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2">
        <FilterChip active={filter === 'all'}      onClick={() => setFilter('all')}>      All ({templates.length})</FilterChip>
        <FilterChip active={filter === 'active'}   onClick={() => setFilter('active')}>   Active ({activeCount})</FilterChip>
        <FilterChip active={filter === 'archived'} onClick={() => setFilter('archived')}>Archived ({archivedCount})</FilterChip>
      </div>

      {/* Empty state */}
      {templates.length === 0 ? (
        <div className={`${S.card} p-10 text-center`}>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No recurring expenses yet. Create one from the Payment Calendar.
          </p>
          {canEdit && (
            <button
              onClick={() => navigate('/cash-flow/payment-calendar?add=recurring')}
              className={`${S.btnPrimary} mt-4 inline-flex`}
            >
              New recurring expense
            </button>
          )}
        </div>
      ) : (
        <div className={`${S.card} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <SortTh label="Name"        col="name"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th className={S.th}>Cadence</th>
                <SortTh label="Amount"      col="amount"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
                <th className={S.th}>Category</th>
                <th className={S.th}>Funding account</th>
                <SortTh label="Start date"  col="start_date" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortTh label="End date"    col="end_date"   sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <SortTh label="Next instance" col="next_due" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th className={S.th}>Status</th>
                <th className={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400 dark:text-slate-600 text-sm">No templates in this section.</td></tr>
              ) : visible.map(t => {
                const acc = accounts.find(a => a.id === t.funding_account_id)
                const nextDue = nextDueByTemplate[t.id]
                return (
                  <tr key={t.id} className={S.tableRow}>
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{t.name}</td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{fmtCadence(t)}</td>
                    <td className={`${S.td} font-mono text-right`}>{fmtMoney(t.amount)}</td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{t.category || <span className="text-gray-400 italic">—</span>}</td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>
                      {acc ? (acc.bank_name ? `${acc.name} (${acc.bank_name})` : acc.name) : <span className="text-gray-400 italic">unassigned</span>}
                    </td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{fmtDate(t.start_date)}</td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{t.end_date ? fmtDate(t.end_date) : <span className="text-gray-400 italic">Indefinite</span>}</td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{nextDue ? fmtDate(nextDue) : <span className="text-gray-400 italic">—</span>}</td>
                    <td className={S.td}>
                      <StatusPill active={t.is_active} />
                    </td>
                    <td className={`${S.td} text-right`}>
                      {canEdit && (
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => setEditTarget(t)}
                            className="text-xs font-medium text-gray-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400"
                          >
                            Edit
                          </button>
                          {t.is_active ? (
                            <button
                              onClick={() => setArchiveTarget({ template: t, mode: 'archive' })}
                              className="text-xs font-medium text-gray-400 hover:text-amber-600 dark:hover:text-amber-400"
                            >
                              Archive
                            </button>
                          ) : (
                            <button
                              onClick={() => setArchiveTarget({ template: t, mode: 'restore' })}
                              className="text-xs font-medium text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                            >
                              Restore
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
      )}

      <EditModal
        template={editTarget}
        accounts={accounts}
        onClose={() => setEditTarget(null)}
        onSaved={() => { setEditTarget(null); load() }}
        onRequestArchive={(t) => { setEditTarget(null); setArchiveTarget({ template: t, mode: t.is_active ? 'archive' : 'restore' }) }}
      />
      <ArchiveRestoreDialog
        target={archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onDone={() => { setArchiveTarget(null); load() }}
      />
    </div>
  )
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

function SortTh({ label, col, sortKey, sortDir, onClick, align = 'left' }) {
  const active = sortKey === col
  return (
    <th
      className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300 ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onClick(col)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        <span className={`text-[9px] leading-none ${active ? 'text-orange-500' : 'text-gray-300 dark:text-slate-700'}`}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

function StatusPill({ active }) {
  if (active) return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">Active</span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30">Archived</span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Edit modal
// ─────────────────────────────────────────────────────────────────────────

function EditModal({ template, accounts, onClose, onSaved, onRequestArchive }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const { active: activeCategories, archived: archivedCategories, labelByName: categoryLabelByName } = useExpenseCategories()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // future-planned + future-paid counts loaded once per template open so the
  // banner copy reads off a stable snapshot. Re-checked at save time before
  // committing.
  const [counts, setCounts] = useState({ planned: 0, paid: 0, latestPaidISO: null })

  useEffect(() => {
    if (!template) return
    setError('')
    setSaving(false)
    setForm({
      amount: template.amount != null ? String(template.amount) : '',
      category: template.category || '',
      funding_account_id: template.funding_account_id || '',
      end_date: template.end_date || '',
      notes: template.notes || '',
    })
    // Counts for the preview banner. Pending status doesn't apply to
    // custom_outflows generated from templates (those use 'planned' /
    // 'paid'); count both so we can block end-date shortening that would
    // strand a paid row.
    ;(async () => {
      const today = chicagoTodayISO()
      const { data } = await supabase
        .from('custom_outflows')
        .select('status, due_date')
        .eq('recurring_template_id', template.id)
        .gte('due_date', today)
      const rows = data || []
      const planned = rows.filter(r => r.status === 'planned').length
      const paidRows = rows.filter(r => r.status === 'paid')
      const latestPaid = paidRows.length
        ? paidRows.reduce((m, r) => r.due_date > m ? r.due_date : m, paidRows[0].due_date)
        : null
      setCounts({ planned, paid: paidRows.length, latestPaidISO: latestPaid })
    })()
  }, [template])

  if (!template || !form) return null

  // Locked field rendering
  const archivedHit = form.category
    && (archivedCategories || []).find(c => c.name === form.category)
  const activeHit = form.category
    && (activeCategories || []).find(c => c.name === form.category)

  // Detect dirty state per field for the banner
  const dirty = {
    amount: Number(form.amount) !== Number(template.amount),
    category: (form.category || '') !== (template.category || ''),
    funding_account_id: (form.funding_account_id || '') !== (template.funding_account_id || ''),
    end_date: (form.end_date || '') !== (template.end_date || ''),
    notes: (form.notes || '') !== (template.notes || ''),
  }
  const anyDirty = Object.values(dirty).some(Boolean)
  const blockingDirty = (() => {
    if (!dirty.end_date) return null
    if (!form.end_date) return null  // making it indefinite doesn't shorten
    const shortened = !template.end_date || form.end_date < template.end_date
    if (!shortened) return null
    if (counts.latestPaidISO && form.end_date < counts.latestPaidISO) {
      return `Cannot shorten end date — there are paid instances dated after ${fmtDate(form.end_date)} (latest paid: ${fmtDate(counts.latestPaidISO)}). Either keep the end date or contact accounting.`
    }
    return null
  })()

  // Banner bullets
  const bannerLines = []
  if (dirty.amount && counts.planned > 0)               bannerLines.push(`Saving will update ${pluralize(counts.planned, 'future planned instance')} to ${fmtMoney(form.amount)}.`)
  if (dirty.funding_account_id && counts.planned > 0)   bannerLines.push(`Saving will move ${pluralize(counts.planned, 'future planned instance')} to ${accountLabel(accounts, form.funding_account_id)}.`)
  if (dirty.category && counts.planned > 0)             bannerLines.push(`Saving will recategorize ${pluralize(counts.planned, 'future planned instance')}.`)
  if (dirty.end_date) {
    if (!form.end_date) {
      bannerLines.push('Saving will set this template to indefinite. Additional instances will be generated through one year from today.')
    } else if (!template.end_date) {
      bannerLines.push(`Saving will cap recurrence at ${fmtDate(form.end_date)} and generate any instances missing between today and that date.`)
    } else if (form.end_date > template.end_date) {
      const est = estimateNewInstances(template, template.end_date, form.end_date)
      bannerLines.push(`Saving will generate ~${pluralize(est, 'additional planned instance')} through ${fmtDate(form.end_date)}.`)
    } else if (form.end_date < template.end_date) {
      bannerLines.push(`Saving will delete planned instances scheduled after ${fmtDate(form.end_date)}.`)
    }
  }

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (error) setError('')
  }

  async function save() {
    if (!anyDirty) { onClose?.(); return }
    if (blockingDirty) { setError(blockingDirty); return }
    const amt = Number(form.amount)
    if (!amt || amt <= 0)            return setError('Amount must be > 0')
    if (!form.category?.trim())      return setError('Category is required')
    if (!form.funding_account_id)    return setError('Funding account is required')
    setSaving(true); setError('')
    try {
      const today = chicagoTodayISO()
      const before = {
        amount: Number(template.amount),
        category: template.category,
        funding_account_id: template.funding_account_id,
        end_date: template.end_date,
        notes: template.notes,
      }
      const after = {
        amount: amt,
        category: form.category.trim(),
        funding_account_id: form.funding_account_id,
        end_date: form.end_date || null,
        notes: form.notes?.trim() || null,
      }

      // 1) Update the template row itself
      const { error: tErr } = await supabase
        .from('recurring_expense_templates')
        .update(after)
        .eq('id', template.id)
      if (tErr) throw tErr

      // 2) If end_date shortened, delete planned instances past the new date
      if (template.end_date && after.end_date && after.end_date < template.end_date) {
        const { error: dErr } = await supabase
          .from('custom_outflows')
          .delete()
          .eq('recurring_template_id', template.id)
          .eq('status', 'planned')
          .gt('due_date', after.end_date)
        if (dErr) throw dErr
      } else if (template.end_date && !after.end_date) {
        // Was capped, now indefinite — no deletion needed; regenerate will fill forward
      } else if (!template.end_date && after.end_date) {
        // Was indefinite, now capped — delete planned instances past the new cap
        const { error: dErr } = await supabase
          .from('custom_outflows')
          .delete()
          .eq('recurring_template_id', template.id)
          .eq('status', 'planned')
          .gt('due_date', after.end_date)
        if (dErr) throw dErr
      }

      // 3) Cascade amount / category / funding_account_id to future planned
      if (dirty.amount || dirty.category || dirty.funding_account_id) {
        const cascade = {}
        if (dirty.amount)             cascade.amount = amt
        if (dirty.category)           cascade.category = after.category
        if (dirty.funding_account_id) cascade.funding_account_id = after.funding_account_id
        cascade.updated_at = new Date().toISOString()
        const { error: cErr } = await supabase
          .from('custom_outflows')
          .update(cascade)
          .eq('recurring_template_id', template.id)
          .eq('status', 'planned')
          .gte('due_date', today)
        if (cErr) throw cErr
      }

      // 4) Regenerate instances when the schedule horizon extended
      const extendedOrUncapped = (
        (template.end_date && after.end_date && after.end_date > template.end_date)
        || (template.end_date && !after.end_date)
      )
      if (extendedOrUncapped) {
        const { error: rpcErr } = await supabase.rpc('generate_recurring_instances', { p_template_id: template.id })
        if (rpcErr) throw rpcErr
      }

      // 5) Audit
      await supabase.from('audit_log').insert({
        table_name: 'recurring_expense_templates',
        record_id: template.id,
        action: 'update',
        performed_by: user?.id || null,
        performed_by_email: profile?.email || null,
        metadata: {
          surface: SURFACE,
          name: template.name,
          before, after,
          changed_fields: Object.entries(dirty).filter(([, v]) => v).map(([k]) => k),
          planned_at_open: counts.planned,
        },
      }).then(({ error: aErr }) => {
        if (aErr) console.warn('[RecurringExpenses] audit_log update failed', aErr.message)
      })

      toast.success(`Recurring expense updated — ${template.name}`)
      setSaving(false)
      onSaved?.()
    } catch (e) {
      console.error('[RecurringExpenses] save failed:', e)
      setError(e?.message || 'Save failed')
      toast.error("Couldn't save recurring expense", e)
      setSaving(false)
    }
  }

  return (
    <Modal open={!!template} onClose={onClose} title={`Edit recurring expense: ${template.name}`} size="xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <ReadOnlyField label="Name" value={template.name} helper="Name is locked. To rename, archive this and create a new one." />
          <ReadOnlyField label="Cadence" value={fmtCadence(template)} helper="To change frequency or day pattern, archive this and create a new template." />
          <ReadOnlyField label="Start date" value={fmtDate(template.start_date)} helper="Past anchor; not editable." />

          <div>
            <label className={S.label}>Amount *</label>
            <input
              type="number" step="0.01"
              className={S.input}
              value={form.amount}
              onChange={e => setField('amount', e.target.value)}
            />
          </div>
          <div>
            <label className={S.label}>Category *</label>
            <Select value={form.category || ''} onChange={e => setField('category', e.target.value)}>
              <option value="">— Select —</option>
              {form.category
                && !activeHit
                && archivedHit && (
                <option value={archivedHit.name}>{archivedHit.display_label} (archived)</option>
              )}
              {(activeCategories || []).map(c => (
                <option key={c.id} value={c.name}>{c.display_label}</option>
              ))}
            </Select>
            {form.category && categoryLabelByName?.get(form.category) && !activeHit && !archivedHit && (
              <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 truncate">
                {categoryLabelByName.get(form.category) || defaultDisplayLabelFor(form.category)}
              </p>
            )}
          </div>
          <div>
            <label className={S.label}>Funding account *</label>
            <Select value={form.funding_account_id} onChange={e => setField('funding_account_id', e.target.value)}>
              <option value="">— Select —</option>
              {accounts.filter(a => a.is_active || a.id === template.funding_account_id).map(a => (
                <option key={a.id} value={a.id}>{a.bank_name ? `${a.name} (${a.bank_name})` : a.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className={S.label}>End date</label>
            <input
              type="date"
              className={S.input}
              value={form.end_date || ''}
              onChange={e => setField('end_date', e.target.value)}
            />
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">Leave blank for indefinite.</p>
          </div>
          <div className="col-span-2">
            <label className={S.label}>Notes</label>
            <textarea
              className={S.textarea}
              rows={2}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
            />
          </div>
        </div>

        {/* Live impact banner. Hidden when nothing's changed; red variant
            when the change would strand paid instances (blocks save). */}
        {anyDirty && (blockingDirty || bannerLines.length > 0) && (
          <div
            className={`rounded-xl p-3 text-xs ${
              blockingDirty
                ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400'
                : 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300'
            }`}
          >
            {blockingDirty ? (
              blockingDirty
            ) : bannerLines.length === 1 ? (
              bannerLines[0]
            ) : (
              <ul className="list-disc pl-4 space-y-1">
                {bannerLines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-white/5">
          <button
            type="button"
            onClick={() => onRequestArchive?.(template)}
            className={`text-xs font-medium ${
              template.is_active
                ? 'text-amber-700 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300'
                : 'text-emerald-700 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300'
            }`}
          >
            {template.is_active ? 'Archive…' : 'Restore…'}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className={S.btnCancel}>Cancel</button>
            <button
              onClick={save}
              disabled={saving || !anyDirty || !!blockingDirty}
              className={S.btnSave}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ReadOnlyField({ label, value, helper }) {
  return (
    <div>
      <label className={S.label}>{label}</label>
      <div className="px-3 py-2 text-sm rounded-xl bg-gray-100 dark:bg-slate-800/40 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700/40">
        {value || '—'}
      </div>
      {helper && <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{helper}</p>}
    </div>
  )
}

function accountLabel(accounts, id) {
  const a = (accounts || []).find(x => x.id === id)
  if (!a) return 'the new account'
  return a.bank_name ? `${a.name} (${a.bank_name})` : a.name
}

// ─────────────────────────────────────────────────────────────────────────
// Archive / Restore dialog
// ─────────────────────────────────────────────────────────────────────────

function ArchiveRestoreDialog({ target, onClose, onDone }) {
  const { user, profile } = useAuth()
  const toast = useToast()
  const [plannedCount, setPlannedCount] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!target) { setPlannedCount(null); return }
    if (target.mode !== 'archive') return
    const today = chicagoTodayISO()
    supabase.from('custom_outflows')
      .select('id', { count: 'exact', head: true })
      .eq('recurring_template_id', target.template.id)
      .eq('status', 'planned')
      .gte('due_date', today)
      .then(({ count }) => setPlannedCount(count || 0))
  }, [target])

  if (!target) return null
  const { template, mode } = target

  async function confirm() {
    setBusy(true)
    try {
      const today = chicagoTodayISO()
      if (mode === 'archive') {
        // Flip is_active and remove future planned instances.
        const { error: u1 } = await supabase
          .from('recurring_expense_templates')
          .update({ is_active: false })
          .eq('id', template.id)
        if (u1) throw u1
        const { error: dErr } = await supabase
          .from('custom_outflows')
          .delete()
          .eq('recurring_template_id', template.id)
          .eq('status', 'planned')
          .gte('due_date', today)
        if (dErr) throw dErr
        await supabase.from('audit_log').insert({
          table_name: 'recurring_expense_templates',
          record_id: template.id,
          action: 'archive',
          performed_by: user?.id || null,
          performed_by_email: profile?.email || null,
          metadata: { surface: SURFACE, name: template.name, deleted_planned_count: plannedCount || 0 },
        })
        toast.success(`${template.name} archived${plannedCount ? ` — ${plannedCount} future planned instance${plannedCount === 1 ? '' : 's'} removed` : ''}`)
      } else {
        // Restore: flip is_active back and re-run the generator so the
        // calendar refills forward. Symmetric to creation — the user
        // doesn't have to remember a second step to see instances again.
        const { error: u1 } = await supabase
          .from('recurring_expense_templates')
          .update({ is_active: true })
          .eq('id', template.id)
        if (u1) throw u1
        const { data: regenCount, error: rpcErr } = await supabase
          .rpc('generate_recurring_instances', { p_template_id: template.id })
        await supabase.from('audit_log').insert({
          table_name: 'recurring_expense_templates',
          record_id: template.id,
          action: 'restore',
          performed_by: user?.id || null,
          performed_by_email: profile?.email || null,
          metadata: {
            surface: SURFACE,
            name: template.name,
            regenerated_count: rpcErr ? null : Number(regenCount || 0),
          },
        })
        toast.success(rpcErr
          ? `${template.name} restored, but instance regeneration failed.`
          : `${template.name} restored — ${Number(regenCount || 0)} instance${Number(regenCount) === 1 ? '' : 's'} regenerated.`)
      }
      setBusy(false)
      onDone?.()
    } catch (e) {
      console.error('[RecurringExpenses] archive/restore failed', e)
      toast.error("Couldn't update template", e)
      setBusy(false)
    }
  }

  return (
    <Modal open={!!target} onClose={onClose} title={mode === 'archive' ? `Archive ${template.name}?` : `Restore ${template.name}?`} size="sm">
      <div className={S.modalBody}>
        {mode === 'archive' ? (
          <div className="text-sm text-gray-700 dark:text-slate-300 space-y-2">
            <p>This will:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Stop generating new instances from this template</li>
              <li>
                Delete{' '}
                {plannedCount == null
                  ? <span className="italic text-gray-400">checking…</span>
                  : <span className="font-semibold">{pluralize(plannedCount, 'future planned instance')}</span>}{' '}
                (already-paid rows will remain on the calendar)
              </li>
            </ul>
          </div>
        ) : (
          <div className="text-sm text-gray-700 dark:text-slate-300">
            Re-enable this template and regenerate instances through the default 1-year horizon.
          </div>
        )}
        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel} disabled={busy}>Cancel</button>
          <button
            onClick={confirm}
            disabled={busy || (mode === 'archive' && plannedCount == null)}
            className={`px-4 py-2 text-sm font-semibold rounded-xl text-white transition-colors ${
              mode === 'archive'
                ? 'bg-amber-600 hover:bg-amber-500 disabled:bg-amber-300'
                : 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300'
            }`}
          >
            {busy ? 'Working…' : (mode === 'archive' ? 'Archive' : 'Restore')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
