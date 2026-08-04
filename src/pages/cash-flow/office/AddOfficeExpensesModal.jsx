import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { useExpenseCategories } from '../../../hooks/useExpenseCategories'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import {
  rateFor, getRateEstimate, listExpenses, periodRange, stepPeriod, firstOfMonth,
  todayISO, rate2, usd2, local0,
} from './officeData'
import { flushStaged, validateFile, fileKind, fmtBytes, ACCEPTED_HINT } from './officeDocsData'
import { StagedRowChip } from './OfficeDocuments'

// Add one or more office expenses in EITHER currency. amount_local + fx_rate are
// canonical (a DB trigger derives amount_usd), so we NEVER write amount_usd.
// Per the contract we store entry_currency + entered_amount (the raw typed side)
// and amount_local, leaving fx_rate NULL when there's no real transfer (pending —
// the trigger backfills the real rate later, keeping the entered side fixed).
// The "effective rate" is the real transfer rate if one exists, else the office's
// editable estimate for that month.

const emptyRow = (date, entry_currency = 'local') => ({ expense_date: date, category: '', description: '', entry_currency, entered_amount: '' })

export default function AddOfficeExpensesModal({ open, office, defaultDate, periodLabel, onClose, onSaved, onAttachFailed }) {
  const { user } = useAuth()
  const toast = useToast()
  const { activeOffice: categories } = useExpenseCategories()
  const [rows, setRows] = useState([emptyRow(defaultDate || todayISO())])
  const [rateCache, setRateCache] = useState({}) // dateISO → { fx_rate, transfer_id, is_inherited } | null
  const [estCache, setEstCache] = useState({})   // 'YYYY-MM-01' → estimate fx_rate | null
  // Files staged per ROW INDEX. Held in component state, never uploaded on
  // selection — cancelling the modal must leave nothing in storage.
  const [staged, setStaged] = useState({})
  const [stagedRejects, setStagedRejects] = useState([])
  const [copying, setCopying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const ccy = office?.currency_code || ''

  useEffect(() => {
    if (!open) return
    setRows([emptyRow(defaultDate || todayISO())])
    setRateCache({}); setEstCache({}); setError('')
    setStaged({}); setStagedRejects([])
  }, [open, defaultDate])

  // Resolve the real transfer rate per row date, and the estimate per row month.
  useEffect(() => {
    if (!open || !office) return
    let cancelled = false
    const dates = [...new Set(rows.map(r => r.expense_date).filter(Boolean))].filter(d => !(d in rateCache))
    const months = [...new Set(rows.map(r => r.expense_date).filter(Boolean).map(firstOfMonth))].filter(m => !(m in estCache))
    if (!dates.length && !months.length) return
    ;(async () => {
      const rNext = {}, eNext = {}
      for (const d of dates) { try { rNext[d] = await rateFor(office.id, d) } catch { rNext[d] = null } }
      for (const m of months) { try { eNext[m] = await getRateEstimate(office.id, m) } catch { eNext[m] = null } }
      if (cancelled) return
      if (Object.keys(rNext).length) setRateCache(prev => ({ ...prev, ...rNext }))
      if (Object.keys(eNext).length) setEstCache(prev => ({ ...prev, ...eNext }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, office, rows])

  // Effective rate for a row: real transfer rate (canonical) if present, else the
  // month's estimate. { rate, real, inherited }.
  const effFor = (r) => {
    const info = rateCache[r.expense_date]
    if (info?.fx_rate) return { rate: Number(info.fx_rate), real: true, inherited: !!info.is_inherited, transferId: info.transfer_id || null }
    const est = estCache[firstOfMonth(r.expense_date)]
    if (est != null && est > 0) return { rate: Number(est), real: false, inherited: false, transferId: null }
    return { rate: null, real: false, inherited: false, transferId: null }
  }

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, emptyRow(rs[rs.length - 1]?.expense_date || defaultDate || todayISO(), rs[rs.length - 1]?.entry_currency || 'local')])
  const removeRow = (i) => {
    setRows(rs => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))
    // Staged files are keyed by index, so dropping a row has to reindex the rest
    // or the files would follow the wrong expense.
    setStaged(st => {
      const next = {}
      for (const k of Object.keys(st)) {
        const idx = Number(k)
        if (idx === i) continue
        next[idx > i ? idx - 1 : idx] = st[k]
      }
      return next
    })
  }
  const setRowFiles = (i, fileList) => {
    const incoming = [...(fileList || [])]
    if (!incoming.length) return
    const ok = [], bad = []
    for (const f of incoming) { const v = validateFile(f); v.ok ? ok.push(f) : bad.push({ name: f.name, reason: v.reason }) }
    setStagedRejects(bad)
    if (ok.length) setStaged(st => ({ ...st, [i]: [...(st[i] || []), ...ok] }))
  }
  const dropRowFile = (i, j) => setStaged(st => ({ ...st, [i]: (st[i] || []).filter((_, k) => k !== j) }))

  const stagedCount = Object.values(staged).reduce((n, fs2) => n + (fs2?.length || 0), 0)

  const headEff = defaultDate ? effFor({ expense_date: defaultDate }) : { rate: null, real: false }

  async function copyLastMonth() {
    if (!office) return
    setCopying(true); setError('')
    try {
      const prevAnchor = stepPeriod('month', defaultDate || todayISO(), -1)
      const pr = periodRange('month', prevAnchor)
      const prev = await listExpenses(office.id, pr.from, pr.to)
      if (!prev.length) { setError(`No expenses found for ${pr.label} to copy`); setCopying(false); return }
      const date = defaultDate || todayISO()
      // Copy in local currency (the stored amount_local), re-dated to this period.
      setRows(prev.map(e => ({
        expense_date: date,
        category: e.category || '',
        description: e.description || '',
        entry_currency: 'local',
        entered_amount: e.amount_local != null ? String(e.amount_local) : '',
      })))
    } catch (e) {
      setError(e.message || 'Copy failed')
    } finally {
      setCopying(false)
    }
  }

  // amount_local per the currency rule (USD invoices multiply by the effective rate).
  const localFor = (r) => {
    const entered = Number(r.entered_amount)
    if (!entered) return 0
    if (r.entry_currency === 'usd') { const { rate } = effFor(r); return rate ? entered * rate : 0 }
    return entered
  }
  const totalLocal = useMemo(() => rows.reduce((s, r) => s + localFor(r), 0), [rows, rateCache, estCache]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (!r.expense_date) return setError(`Row ${i + 1}: date is required`)
      if (!r.category) return setError(`Row ${i + 1}: choose a category`)
      const amt = Number(r.entered_amount)
      if (!amt || amt <= 0) return setError(`Row ${i + 1}: amount must be greater than 0`)
      if (r.entry_currency === 'usd' && !(effFor(r).rate > 0)) {
        return setError(`Row ${i + 1}: set an estimate rate (or record a transfer) to enter in USD, or switch to ${ccy}`)
      }
    }

    setSaving(true); setError('')
    const payload = rows.map(r => {
      const eff = effFor(r)
      const entered = Number(r.entered_amount)
      const base = {
        office_id: office.id,
        category: r.category,
        description: r.description.trim() || null,
        expense_date: r.expense_date,
        entry_currency: r.entry_currency,
        entered_amount: entered,
        amount_local: r.entry_currency === 'usd' ? entered * eff.rate : entered,
        created_by: user?.id || null,
      }
      // Only a REAL transfer stamps fx_rate; an estimate leaves it null (pending)
      // so the trigger backfills the true rate later.
      if (eff.real) {
        base.fx_rate = eff.rate
        base.rate_transfer_id = eff.transferId
        base.rate_is_manual = false
      }
      return base
    })
    // select() so each staged file knows the id of the row it belongs to. The
    // order returned matches the order sent.
    const { data: inserted, error: e } = await supabase.from('office_expenses').insert(payload).select('id')
    if (e) { setError(`Couldn't save: ${e.message || 'unknown error'}`); toast.error("Couldn't save expenses", e); setSaving(false); return }
    const pend = payload.filter(p => p.fx_rate == null).length
    toast.success(`${payload.length} expense${payload.length === 1 ? '' : 's'} added${pend ? ` · ${pend} pending a real rate` : ''}`)

    // Files upload only now that the rows exist. A failure here must NOT undo a
    // saved expense — the expenses stand, the modal closes, and the page names
    // whatever didn't attach so it can be retried from the row's popover.
    const failures = []
    for (let i = 0; i < rows.length; i++) {
      const files = staged[i]
      if (!files?.length || !inserted?.[i]?.id) continue
      const res = await flushStaged(files, {
        officeId: office.id, parentKind: 'expense', parentId: inserted[i].id, documentType: 'receipt',
      })
      failures.push(...res.failed)
    }
    if (failures.length) onAttachFailed?.(failures)
    else if (stagedCount > 0) toast.success(`${stagedCount} file${stagedCount === 1 ? '' : 's'} attached`)

    setSaving(false)
    onSaved?.()
    onClose?.()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add expenses — ${office?.name || ''}`} size="3xl">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        {/* Effective-rate strip */}
        {headEff.rate ? (
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-cyan-50 dark:bg-cyan-500/5 border border-cyan-200 dark:border-cyan-500/20">
            <div className="text-xs font-medium text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">Rate for {periodLabel || 'this period'}</div>
            <div className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">
              1 USD = {rate2(headEff.rate)} {ccy}
              <span className="ml-2 text-[11px] font-normal opacity-70">({headEff.real ? (headEff.inherited ? 'inherited' : 'actual') : 'estimate'})</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/[0.08] border border-amber-200 dark:border-amber-500/20">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">No rate yet for {periodLabel || 'this period'}</div>
            <div className="text-xs text-amber-700 dark:text-amber-400">{ccy} saves as <span className="font-semibold">pending</span> · set an estimate rate to enter in USD.</div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button type="button" onClick={copyLastMonth} disabled={copying} className={S.btnSecondary}>
            {copying ? 'Copying…' : 'Copy last month'}
          </button>
          <button type="button" onClick={addRow} className={S.btnSecondary}>+ Add row</button>
        </div>

        {/* Rows */}
        <div className="space-y-2">
          <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-2 px-1 text-[11px] font-semibold text-gray-500 dark:text-slate-500 uppercase tracking-wide">
            <div className="col-span-2">Date</div>
            <div className="col-span-3">Category</div>
            <div className="col-span-2">Description</div>
            <div className="col-span-3">Amount</div>
            <div className="col-span-1 text-right">Converts to</div>
            <div className="col-span-2">Files</div>
            <div className="col-span-1" />
          </div>
          {rows.map((r, i) => {
            const eff = effFor(r)
            const hasRate = eff.rate > 0
            const entered = Number(r.entered_amount)
            const isUsd = r.entry_currency === 'usd'
            return (
              <div key={i} className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-2 items-center">
                <input type="date" className={`${S.input} col-span-2`} value={r.expense_date}
                  onChange={e => setRow(i, { expense_date: e.target.value })} />
                <select className={`${S.input} col-span-3`} value={r.category}
                  onChange={e => setRow(i, { category: e.target.value })}>
                  <option value="">— Category —</option>
                  {categories.map(c => <option key={c.name} value={c.name}>{c.display_label}</option>)}
                </select>
                <input className={`${S.input} col-span-2`} value={r.description}
                  onChange={e => setRow(i, { description: e.target.value })} placeholder="Optional" />
                {/* Amount + currency toggle */}
                <div className="col-span-3 flex items-center gap-1">
                  <input type="number" step="0.01" min="0" className={`${S.input} flex-1`} value={r.entered_amount}
                    onChange={e => setRow(i, { entered_amount: e.target.value })} placeholder="0" />
                  <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-700 text-[10px] font-semibold shrink-0">
                    <button type="button" onClick={() => setRow(i, { entry_currency: 'local' })}
                      className={`px-1.5 py-1.5 ${!isUsd ? 'bg-cyan-500 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>{ccy}</button>
                    <button type="button" disabled={!hasRate} onClick={() => setRow(i, { entry_currency: 'usd' })}
                      title={hasRate ? '' : 'set an estimate rate to enter in USD'}
                      className={`px-1.5 py-1.5 ${isUsd ? 'bg-cyan-500 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'}`}>USD</button>
                  </div>
                </div>
                {/* Live conversion of the other currency */}
                <div className="col-span-1 text-right text-xs tabular-nums">
                  {!entered ? (
                    <span className="text-gray-400 dark:text-slate-500">—</span>
                  ) : isUsd ? (
                    hasRate ? <span className="text-gray-600 dark:text-slate-400">{local0(entered * eff.rate, ccy)}</span> : <span className="text-amber-600 dark:text-amber-400">no rate</span>
                  ) : (
                    hasRate ? <span className="text-gray-600 dark:text-slate-400">{usd2(entered / eff.rate)}{!eff.real && <span className="text-amber-500"> ≈</span>}</span> : <span className="text-amber-600 dark:text-amber-400 text-[11px]">pending</span>
                  )}
                </div>
                {/* FILES — staged only. Nothing is uploaded until save. */}
                <div className="col-span-2">
                  <StagedRowChip count={staged[i]?.length || 0} onFiles={files => setRowFiles(i, files)} />
                </div>
                <div className="col-span-1 flex justify-end">
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500 px-1 py-2" title="Remove row">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Staged files. Listed per row so a misfiled attachment is visible
            before it's committed, and removable while it's still only in memory. */}
        {stagedCount > 0 && (
          <div className="rounded-xl border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50/60 dark:bg-cyan-500/[0.07] p-2.5 space-y-1.5">
            <p className="text-[11px] text-cyan-800 dark:text-cyan-300">
              <span className="font-bold">{stagedCount} file{stagedCount === 1 ? '' : 's'} ready.</span>{' '}
              They upload once the expenses are saved — nothing is stored if you cancel.
            </p>
            {Object.entries(staged).map(([idx, files]) => (files || []).map((f, j) => (
              <div key={`${idx}-${j}`} className="flex items-center gap-2 text-[11px]">
                <span className="shrink-0 text-gray-400 dark:text-slate-500 tabular-nums">Row {Number(idx) + 1}</span>
                <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-white/70 dark:bg-white/10 text-cyan-800 dark:text-cyan-300">{fileKind(f)}</span>
                <span className="text-gray-800 dark:text-slate-200 break-all min-w-0 leading-snug">{f.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-500 dark:text-slate-400 tabular-nums">{fmtBytes(f.size)}</span>
                <button type="button" onClick={() => dropRowFile(Number(idx), j)} aria-label={`Remove ${f.name}`}
                  className="shrink-0 text-gray-400 hover:text-red-500">✕</button>
              </div>
            )))}
          </div>
        )}
        {stagedRejects.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
            {stagedRejects.map(r => (
              <p key={r.name} className="break-all"><span className="font-medium">{r.name}</span> — {r.reason}</p>
            ))}
            <p className="text-amber-600/80 dark:text-amber-400/70 mt-0.5">{ACCEPTED_HINT}</p>
          </div>
        )}

        <div className="flex items-baseline justify-between pt-3 border-t border-gray-100 dark:border-white/5">
          <span className="text-sm text-gray-500 dark:text-slate-400">
            <span className="font-semibold text-gray-700 dark:text-slate-300">Total ({ccy}):</span> {local0(totalLocal, ccy)}
          </span>
          <div className={S.modalFooter}>
            <button onClick={onClose} className={S.btnCancel}>Cancel</button>
            <button onClick={save} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : `Save ${rows.length} ${rows.length === 1 ? 'expense' : 'expenses'}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
