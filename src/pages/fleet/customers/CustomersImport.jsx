import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import { parseCustomersWorkbook } from './customersParse'
import { buildCustomerPlan } from './customersPlan'
import { fetchAllCustomers, applyCustomerPlan, loadRecentCustomerImports } from './customersApply'

// Customers ingest — modelled on the loads importer: upload the TMS "Customers"
// export → parse + match → REVIEW a preview → Apply writes through. Nothing is
// written until Apply (the preview is held in client state; only the completed
// run is recorded, in customer_imports). Matching is MC → TMS code → name; a row
// two rules disagree on is a conflict for a human, applied to nothing.

export default function CustomersImport() {
  const { user, canEdit } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState(null)   // { filename, plan, counts }
  const [applied, setApplied] = useState(null)  // durable success summary
  const [recent, setRecent] = useState([])

  const toastRef = useRef(toast); toastRef.current = toast
  useEffect(() => { loadRecentCustomerImports().then(setRecent).catch(() => {}) }, [])

  const onFile = useCallback(async (file) => {
    if (!file) return
    setBusy(true); setApplied(null)
    try {
      const buf = await file.arrayBuffer()
      const { rows, errors, cols } = parseCustomersWorkbook(buf)
      if (errors.length) { toast.error(errors[0]); return }
      if (!rows.length) { toast.error('No customer rows found in the file.'); return }
      if (!cols.mc) toast.error('No MC column found — matching will fall back to code/name.')
      // The full customers table, paged, is the match set.
      const existing = await fetchAllCustomers()
      const { plan, counts } = buildCustomerPlan({ rows, existing })
      setStaged({ filename: file.name, plan, counts })
      toast.success(`Parsed ${rows.length.toLocaleString()} rows — review below`)
    } catch (e) {
      toast.error("Couldn't read the file", e)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [toast])

  const onApply = useCallback(async () => {
    if (!staged || busy) return
    setBusy(true)
    try {
      const res = await applyCustomerPlan({ plan: staged.plan, counts: staged.counts, filename: staged.filename, userId: user?.id })
      if (res.error) { toast.error("Couldn't apply the import", res.error); return }
      toast.success(`Applied — ${res.created} created, ${res.updated} updated`)
      setApplied({ filename: staged.filename, ...res })
      setStaged(null)
      setRecent(await loadRecentCustomerImports())
    } finally { setBusy(false) }
  }, [staged, busy, user?.id, toast])

  const c = staged?.counts
  const conflicts = staged?.plan.filter(p => p.conflict) || []

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers Import</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Fill in MC numbers, TMS codes and contact details from the TMS Customers export. Preview first — nothing is written until you apply.
          </p>
        </div>
        {canEdit && (
          <label className={`${S.btnPrimary} cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            {busy ? 'Working…' : staged ? 'Choose another file' : 'Upload Customers.xlsx'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => onFile(e.target.files?.[0])} disabled={busy} />
          </label>
        )}
      </div>

      {applied && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          ✓ Applied{applied.filename ? ` — ${applied.filename}` : ''}:{' '}
          <span className="font-semibold">{applied.created} created, {applied.updated} updated, {applied.mcFilled} MC filled</span>
          {applied.conflicts > 0 && <>, {applied.conflicts} conflict{applied.conflicts === 1 ? '' : 's'} left for review</>}.
          {applied.createdNames?.length > 0 && (
            <span className="block mt-1"><span className="font-medium">Created:</span> {applied.createdNames.join(' · ')}</span>
          )}
        </div>
      )}

      {staged && c && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Stat label="Rows in file" value={c.total} tone="slate" />
            <Stat label="Matched" value={c.matched} tone="emerald" />
            <Stat label="Created" value={c.created} tone="cyan" />
            <Stat label="MC filled" value={c.mc_filled} tone="amber" />
            <Stat label="Conflicts" value={c.conflicts} tone={c.conflicts > 0 ? 'red' : 'slate'} />
          </div>

          <p className="text-xs text-gray-500 dark:text-slate-400">
            Matched by MC {c.by_rule.MC.toLocaleString()} · TMS code {c.by_rule['TMS code'].toLocaleString()} · name {c.by_rule.Name.toLocaleString()}.
            {' '}is_active is never changed by an import.
          </p>

          {c.created_names.length > 0 && (
            <Section title={`New customers (${c.created_names.length})`} subtitle="Created verbatim from the file — check for a typo'd broker before applying.">
              <p className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed">{c.created_names.join(' · ')}</p>
            </Section>
          )}

          {conflicts.length > 0 && (
            <Section title={`Conflicts (${conflicts.length})`} subtitle="Two match rules point at different customers — resolve these by hand; they will not be applied.">
              <div className="space-y-1.5">
                {conflicts.map((p, i) => (
                  <div key={i} className="text-[11px] flex items-start gap-2">
                    <span className="font-semibold text-gray-700 dark:text-slate-200 shrink-0">{p.row.name}</span>
                    <span className="text-gray-400 dark:text-slate-500">MC {p.row.mc_number || '—'} · code {p.row.tms_code || '—'}</span>
                    <span className="text-red-600 dark:text-red-400">→ {p.conflictWith.join(' vs ')}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {canEdit && (
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setStaged(null)} disabled={busy} className={S.btnCancel}>Cancel</button>
              <button onClick={onApply} disabled={busy}
                className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">
                {busy ? 'Applying…' : `Apply — ${(c.created + c.matched).toLocaleString()} customers`}
              </button>
            </div>
          )}
        </>
      )}

      {!staged && recent.length > 0 && (
        <Section title="Recent imports">
          <div className="space-y-1.5">
            {recent.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-[11px] text-gray-600 dark:text-slate-300">
                <span className="truncate">{r.filename || 'Customers import'}</span>
                <span className="text-gray-400 dark:text-slate-500 shrink-0 tabular-nums">
                  {r.total_rows != null ? `${r.total_rows} rows` : ''}
                  {r.counts?.created != null ? ` · ${r.counts.created} created` : ''}
                  {r.applied_at ? ` · ${fmtDate(r.applied_at)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        A broker&apos;s full record — risk, volume, observed terms, paperwork — lives on its profile at <span className="font-mono">/fleet/customers/&lt;id&gt;</span>.
      </p>
    </div>
  )
}

function fmtDate(ts) {
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Stat({ label, value, tone }) {
  const toneText = {
    emerald: 'text-emerald-700 dark:text-emerald-400', amber: 'text-amber-700 dark:text-amber-400',
    cyan: 'text-cyan-700 dark:text-cyan-400', red: 'text-red-700 dark:text-red-400',
    slate: 'text-gray-900 dark:text-slate-200',
  }[tone] || 'text-gray-900 dark:text-slate-200'
  return (
    <div className={`${S.card} p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-mono font-medium ${toneText}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className={`${S.card} p-4 space-y-3`}>
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        {subtitle && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
