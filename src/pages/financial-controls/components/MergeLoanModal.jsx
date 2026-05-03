import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { fmtMoney, fmtDate } from '../loanUtils'

// Three-step flow rendered inside one Modal:
//   pick    — search + select the OTHER loan
//   preview — side-by-side comparison + per-field choice + swap survivor
//   confirm — final summary + acknowledgement checkbox + Confirm merge
//
// Step state lives entirely in this component. On Confirm we call the
// merge_loan() RPC and let the caller (LoanDetail) refresh.
export default function MergeLoanModal({ open, onClose, loan, onMerged }) {
  const [step, setStep] = useState('pick')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // pick step
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [pickedId, setPickedId] = useState(null)

  // preview/confirm step
  const [survivorId, setSurvivorId] = useState(null)
  const [absorbedId, setAbsorbedId] = useState(null)
  const [loanA, setLoanA] = useState(null)              // raw data for survivor at first
  const [loanB, setLoanB] = useState(null)              // raw data for absorbed at first
  const [counts, setCounts] = useState({ A: null, B: null })
  const [picks, setPicks] = useState({})                // per-field 'A' | 'B'
  const [confirmed, setConfirmed] = useState(false)

  // Reset everything when the modal closes/reopens
  useEffect(() => {
    if (!open) return
    setStep('pick')
    setQuery(''); setResults([]); setPickedId(null)
    setSurvivorId(loan?.id || null); setAbsorbedId(null)
    setLoanA(null); setLoanB(null); setCounts({ A: null, B: null })
    setPicks({}); setConfirmed(false)
    setError(''); setBusy(false)
  }, [open, loan?.id])

  // Debounced search
  useEffect(() => {
    if (step !== 'pick') return
    const t = setTimeout(async () => {
      setSearching(true)
      const q = query.trim()
      let req = supabase.from('v_loans_summary')
        .select('id, loan_id_external, contract_number, task_name, lender_name, current_balance, monthly_payment')
        .neq('id', loan?.id || '00000000-0000-0000-0000-000000000000')
        .limit(20)
      if (q) {
        req = req.or(
          `loan_id_external.ilike.%${q}%,contract_number.ilike.%${q}%,task_name.ilike.%${q}%,lender_name.ilike.%${q}%`,
        )
      }
      const { data } = await req
      setResults(data || [])
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query, step, loan?.id])

  async function continueToPreview() {
    if (!pickedId) return
    setBusy(true); setError('')
    // Fetch full rows + counts + payment-month sets in parallel for both loans
    const [aRes, bRes, counts, paymonthsA, paymonthsB] = await Promise.all([
      supabase.from('v_loans_summary').select('*').eq('id', loan.id).maybeSingle(),
      supabase.from('v_loans_summary').select('*').eq('id', pickedId).maybeSingle(),
      Promise.all([loan.id, pickedId].map(id => fetchCounts(id))),
      fetchDueMonths(loan.id),
      fetchDueMonths(pickedId),
    ])
    setBusy(false)
    if (aRes.error || bRes.error || !aRes.data || !bRes.data) {
      setError('Could not load both loans'); return
    }
    setLoanA(aRes.data); setLoanB(bRes.data)
    setSurvivorId(loan.id); setAbsorbedId(pickedId)
    // Stash the due_month sets so the preview can compute conflicts as
    // the user toggles survivor/absorbed.
    setCounts({
      A: { ...counts[0], due_months: paymonthsA },
      B: { ...counts[1], due_months: paymonthsB },
    })
    // Default per-field pick: survivor wins, but if survivor has no value
    // and absorbed has one, default to absorbed (don't lose info).
    const initial = {}
    for (const f of FIELDS) {
      const av = aRes.data[f.key]; const bv = bRes.data[f.key]
      if (eq(av, bv)) continue
      initial[f.key] = isMissing(av) && !isMissing(bv) ? 'B' : 'A'
    }
    setPicks(initial)
    setStep('preview')
  }

  function swapSurvivor() {
    setSurvivorId(s => s === loanA.id ? loanB.id : loanA.id)
    setAbsorbedId(s => s === loanA.id ? loanB.id : loanA.id)
    // Picks are stored against A/B identity (loan-data slots), not against
    // survivor/absorbed roles, so they survive the swap unchanged.
  }

  async function fetchCounts(id) {
    const [eq, pay, doc, ev, dp] = await Promise.all([
      supabase.from('loan_equipment').select('id', { count: 'exact', head: true }).eq('loan_id', id),
      supabase.from('loan_payments').select('id', { count: 'exact', head: true }).eq('loan_id', id),
      supabase.from('loan_documents').select('id', { count: 'exact', head: true }).eq('loan_id', id),
      supabase.from('loan_events').select('id', { count: 'exact', head: true }).eq('loan_id', id),
      supabase.from('driver_purchases').select('id', { count: 'exact', head: true }).eq('underlying_loan_id', id),
    ])
    return {
      eq:  eq.count  || 0,
      pay: pay.count || 0,
      doc: doc.count || 0,
      ev:  ev.count  || 0,
      dp:  dp.count  || 0,
    }
  }

  // Pulls every due_month for a loan as an ISO-string Set so we can
  // intersect survivor vs. absorbed and report how many absorbed
  // payments will be skipped as duplicates by merge_loan().
  async function fetchDueMonths(id) {
    const { data } = await supabase
      .from('loan_payments')
      .select('due_month')
      .eq('loan_id', id)
    return new Set((data || []).map(r => r.due_month))
  }

  // The slot ('A' or 'B') that currently plays the role of survivor/absorbed
  const survivorSlot = survivorId === loanA?.id ? 'A' : 'B'
  const absorbedSlot = survivorSlot === 'A' ? 'B' : 'A'
  const survivor = survivorSlot === 'A' ? loanA : loanB
  const absorbed = absorbedSlot === 'A' ? loanA : loanB
  const survivorCounts = counts[survivorSlot]
  const absorbedCounts = counts[absorbedSlot]

  // How many absorbed payment rows merge_loan() will drop because their
  // due_month already exists on the survivor. Computed from the cached
  // due_month sets so it updates instantly when the user swaps roles.
  const skippedPayments = useMemo(() => {
    const surv = survivorCounts?.due_months
    const abs  = absorbedCounts?.due_months
    if (!surv || !abs) return 0
    let n = 0
    for (const m of abs) if (surv.has(m)) n++
    return n
  }, [survivorCounts, absorbedCounts])

  // The override jsonb to send to merge_loan: only include keys where
  // the user picked the absorbed slot's value (otherwise the survivor's
  // existing value is implicitly kept).
  const fieldOverrides = useMemo(() => {
    if (!survivor || !absorbed) return {}
    const out = {}
    for (const f of FIELDS) {
      const userPick = picks[f.key]                     // 'A' | 'B' | undefined
      if (!userPick) continue                           // values were equal
      const wantSlot = userPick                         // slot user selected
      if (wantSlot === survivorSlot) continue           // survivor already has it
      const value = absorbed[f.key]
      out[f.key] = value === null || value === undefined ? null : value
    }
    return out
  }, [picks, survivorSlot, survivor, absorbed])

  async function doMerge() {
    if (!survivor || !absorbed) return
    setBusy(true); setError('')
    const { error: e } = await supabase.rpc('merge_loan', {
      p_survivor_id: survivor.id,
      p_absorbed_id: absorbed.id,
      p_field_overrides: fieldOverrides,
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    onMerged?.(survivor.id)
  }

  return (
    <Modal open={open} onClose={onClose} title="Merge with another loan" size="xl">
      <div className={`${S.modalBody} space-y-4`}>
        {error && <div className={S.errorBox}>{error}</div>}

        {step === 'pick' && (
          <PickStep
            loan={loan}
            query={query} setQuery={setQuery}
            results={results} searching={searching}
            pickedId={pickedId} setPickedId={setPickedId}
          />
        )}

        {step === 'preview' && survivor && absorbed && (
          <PreviewStep
            survivor={survivor} absorbed={absorbed}
            survivorCounts={survivorCounts} absorbedCounts={absorbedCounts}
            survivorSlot={survivorSlot}
            picks={picks} setPicks={setPicks}
            onSwap={swapSurvivor}
            skippedPayments={skippedPayments}
          />
        )}

        {step === 'confirm' && survivor && absorbed && (
          <ConfirmStep
            survivor={survivor} absorbed={absorbed}
            absorbedCounts={absorbedCounts}
            skippedPayments={skippedPayments}
            confirmed={confirmed} setConfirmed={setConfirmed}
            fieldOverrides={fieldOverrides}
          />
        )}

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel} disabled={busy}>Cancel</button>
          <div className="flex items-center gap-2 ml-auto">
            {step !== 'pick' && (
              <button onClick={() => { setStep(step === 'confirm' ? 'preview' : 'pick'); setError('') }} className={S.btnCancel} disabled={busy}>Back</button>
            )}
            {step === 'pick' && (
              <button onClick={continueToPreview} disabled={!pickedId || busy} className={S.btnSave}>
                {busy ? 'Loading…' : 'Continue'}
              </button>
            )}
            {step === 'preview' && (
              <button onClick={() => setStep('confirm')} className={S.btnSave}>
                Continue
              </button>
            )}
            {step === 'confirm' && (
              <button
                onClick={doMerge}
                disabled={!confirmed || busy}
                className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white rounded-xl transition-all"
              >
                {busy ? 'Merging…' : 'Confirm merge'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Step 1: Pick ──────────────────────────────────────────────────────
function PickStep({ loan, query, setQuery, results, searching, pickedId, setPickedId }) {
  return (
    <>
      <p className="text-sm text-gray-500 dark:text-slate-400">
        This will combine equipment, payments, documents, and notes into a single loan. The other loan will be deleted.
      </p>
      <input
        autoFocus
        className={S.input}
        placeholder="Search by account, contract #, task, or lender…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <div className="rounded-xl border border-gray-200 dark:border-white/10 max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-white/5">
        {searching ? (
          <p className="px-3 py-3 text-xs text-gray-400 dark:text-slate-500">Searching…</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400 dark:text-slate-500">
            {query.trim() ? 'No matches' : 'Type to search'}
          </p>
        ) : results.map(r => {
          const isPicked = pickedId === r.id
          return (
            <button
              key={r.id}
              onClick={() => setPickedId(r.id)}
              className={`w-full text-left px-3 py-2 transition-colors flex items-center gap-3 ${
                isPicked ? 'bg-cyan-50 dark:bg-cyan-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              <span className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 ${
                isPicked ? 'border-cyan-500 bg-cyan-500' : 'border-gray-300 dark:border-slate-600'
              }`}>
                {isPicked && <span className="block w-1.5 h-1.5 rounded-full bg-white m-0.5" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">
                  {r.loan_id_external || r.contract_number || r.task_name || 'Loan'}
                </div>
                <div className="text-xs text-gray-500 dark:text-slate-500 truncate">
                  {r.lender_name || '—'} · {fmtMoney(r.current_balance)} · {fmtMoney(r.monthly_payment)} /mo
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        Current loan ({loan?.loan_id_external || 'this'}) is excluded from results.
      </p>
    </>
  )
}

// ── Step 2: Preview / reconcile ─────────────────────────────────────────
function PreviewStep({ survivor, absorbed, survivorCounts, absorbedCounts, survivorSlot, picks, setPicks, onSwap, skippedPayments = 0 }) {
  return (
    <>
      <p className="text-xs text-gray-500 dark:text-slate-500">
        Pick which loan should survive (the other will be deleted). Where the two records disagree, choose which value to keep.
      </p>

      {/* Survivor / absorbed swap */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <SurvivorCard isSurvivor onClick={onSwap} loan={survivor} counts={survivorCounts} title="Survivor (will keep)" />
        <SurvivorCard isSurvivor={false} onClick={onSwap} loan={absorbed} counts={absorbedCounts} title="Absorbed (will delete)" />
      </div>

      {/* Per-field comparison table */}
      <div className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-white/[0.02]">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Field</th>
              <th className="text-left px-3 py-1.5 font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Survivor</th>
              <th className="text-left px-3 py-1.5 font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Absorbed</th>
              <th className="text-left px-3 py-1.5 font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Keep</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(f => {
              const sv = survivor[f.key]; const av = absorbed[f.key]
              if (isMissing(sv) && isMissing(av)) return null
              const same = eq(sv, av)
              const flag = !same && (f.key === 'current_balance' || f.key === 'monthly_payment')
              const slotForSurvivor = survivorSlot                          // 'A' or 'B'
              const slotForAbsorbed = survivorSlot === 'A' ? 'B' : 'A'
              const userPick = picks[f.key]                                  // 'A' | 'B' | undefined
              return (
                <tr key={f.key} className="border-t border-gray-100 dark:border-white/5">
                  <td className="px-3 py-1.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{f.label}</td>
                  <td className={`px-3 py-1.5 font-mono ${flag ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-slate-300'}`}>
                    {f.fmt(sv)}
                  </td>
                  <td className={`px-3 py-1.5 font-mono ${flag ? 'text-amber-700 dark:text-amber-400' : 'text-gray-700 dark:text-slate-300'}`}>
                    {f.fmt(av)}
                  </td>
                  <td className="px-3 py-1.5">
                    {same ? (
                      <span className="text-gray-400 dark:text-slate-600 italic">same — no choice</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio" name={`pick-${f.key}`}
                            checked={userPick === slotForSurvivor}
                            onChange={() => setPicks(p => ({ ...p, [f.key]: slotForSurvivor }))}
                          />
                          <span className="text-[11px] text-gray-600 dark:text-slate-400">Survivor</span>
                        </label>
                        <label className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio" name={`pick-${f.key}`}
                            checked={userPick === slotForAbsorbed}
                            onChange={() => setPicks(p => ({ ...p, [f.key]: slotForAbsorbed }))}
                          />
                          <span className="text-[11px] text-gray-600 dark:text-slate-400">Absorbed</span>
                        </label>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 p-3 text-xs space-y-0.5">
        <p className="font-semibold text-gray-700 dark:text-slate-300 mb-1">Will move from absorbed to survivor:</p>
        <p className="text-gray-600 dark:text-slate-400">• <span className="font-mono">{absorbedCounts?.eq ?? 0}</span> equipment row{absorbedCounts?.eq === 1 ? '' : 's'} (currently <span className="font-mono">{survivorCounts?.eq ?? 0}</span> on survivor → <span className="font-mono">{(survivorCounts?.eq ?? 0) + (absorbedCounts?.eq ?? 0)}</span> total)</p>
        <p className="text-gray-600 dark:text-slate-400">
          • <span className="font-mono">{Math.max(0, (absorbedCounts?.pay ?? 0) - skippedPayments)}</span> payment record{((absorbedCounts?.pay ?? 0) - skippedPayments) === 1 ? '' : 's'}
          {skippedPayments > 0 && (
            <span className="ml-1 text-gray-500 dark:text-slate-500">
              ({absorbedCounts?.pay} absorbed; <span className="font-mono">{skippedPayments}</span> will be skipped as duplicates)
            </span>
          )}
        </p>
        <p className="text-gray-600 dark:text-slate-400">• <span className="font-mono">{absorbedCounts?.doc ?? 0}</span> document{absorbedCounts?.doc === 1 ? '' : 's'}</p>
        <p className="text-gray-600 dark:text-slate-400">• <span className="font-mono">{absorbedCounts?.ev ?? 0}</span> event{absorbedCounts?.ev === 1 ? '' : 's'}</p>
        <p className="text-gray-600 dark:text-slate-400">• <span className="font-mono">{absorbedCounts?.dp ?? 0}</span> driver purchase{absorbedCounts?.dp === 1 ? '' : 's'} referencing this loan</p>
      </div>
    </>
  )
}

function SurvivorCard({ isSurvivor, onClick, loan, counts, title }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all ${
        isSurvivor
          ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
          : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'
      }`}
      title="Click to swap survivor / absorbed"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-3.5 h-3.5 rounded-full border-2 ${
          isSurvivor ? 'border-emerald-500 bg-emerald-500' : 'border-red-400'
        }`}>
          {isSurvivor && <span className="block w-1.5 h-1.5 rounded-full bg-white m-0.5" />}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-slate-400">{title}</span>
      </div>
      <p className="font-semibold text-sm text-gray-900 dark:text-slate-200 truncate">
        {loan.loan_id_external || loan.contract_number || loan.task_name || 'Loan'}
      </p>
      <p className="text-xs text-gray-500 dark:text-slate-500 truncate">
        {(loan.entity_name || '—') + ' · ' + (loan.lender_name || '—')}
      </p>
      <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">
        <span className="font-mono">{counts?.eq ?? 0}</span> eq · <span className="font-mono">{counts?.pay ?? 0}</span> pay · <span className="font-mono">{counts?.doc ?? 0}</span> docs · <span className="font-mono">{counts?.dp ?? 0}</span> driver
      </p>
    </button>
  )
}

// ── Step 3: Confirm ─────────────────────────────────────────────────────
function ConfirmStep({ survivor, absorbed, absorbedCounts, skippedPayments = 0, confirmed, setConfirmed, fieldOverrides }) {
  const movedPayments = Math.max(0, (absorbedCounts?.pay ?? 0) - skippedPayments)
  const total = (absorbedCounts?.eq ?? 0) + movedPayments + (absorbedCounts?.doc ?? 0) + (absorbedCounts?.ev ?? 0) + (absorbedCounts?.dp ?? 0)
  const overrideCount = Object.keys(fieldOverrides || {}).length
  return (
    <>
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Confirm merge</h3>
      <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-sm space-y-1 text-amber-800 dark:text-amber-300">
        <p>
          Merging <span className="font-semibold">{absorbed.loan_id_external || absorbed.contract_number || 'absorbed'}</span>
          {' '}into{' '}
          <span className="font-semibold">{survivor.loan_id_external || survivor.contract_number || 'survivor'}</span>.
        </p>
        <p>
          <span className="font-mono">{total}</span> related record{total === 1 ? '' : 's'} will be moved to the survivor.
        </p>
        {skippedPayments > 0 && (
          <p>
            <span className="font-mono">{skippedPayments}</span> duplicate payment record{skippedPayments === 1 ? '' : 's'} will be discarded (same due-month already exists on survivor).
          </p>
        )}
        {overrideCount > 0 && (
          <p>
            <span className="font-mono">{overrideCount}</span> field value{overrideCount === 1 ? '' : 's'} will be replaced with the absorbed loan's value.
          </p>
        )}
        <p>
          <span className="font-semibold">{absorbed.loan_id_external || absorbed.contract_number || 'The absorbed loan'}</span> will be permanently deleted.
        </p>
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm text-gray-700 dark:text-slate-300">I understand this action cannot be undone.</span>
      </label>
    </>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────
const FIELDS = [
  { key: 'loan_id_external',     label: 'Account label', fmt: v => v ?? '—' },
  { key: 'task_name',            label: 'Task name',     fmt: v => v ?? '—' },
  { key: 'contract_number',      label: 'Contract #',    fmt: v => v ?? '—' },
  { key: 'loan_amount',          label: 'Loan amount',   fmt: v => v == null ? '—' : fmtMoney(v) },
  { key: 'current_balance',      label: 'Balance',       fmt: v => v == null ? '—' : fmtMoney(v) },
  { key: 'monthly_payment',      label: 'Monthly pmt',   fmt: v => v == null ? '—' : fmtMoney(v) },
  { key: 'interest_rate',        label: 'Interest',      fmt: v => v == null ? '—' : `${Number(v).toFixed(3)}%` },
  { key: 'due_day',              label: 'Due day',       fmt: v => v ?? '—' },
  { key: 'start_date',           label: 'Start',         fmt: v => fmtDate(v) },
  { key: 'first_payment_date',   label: 'First pmt',     fmt: v => fmtDate(v) },
  { key: 'maturity_date',        label: 'Maturity',      fmt: v => fmtDate(v) },
  { key: 'status',               label: 'Status',        fmt: v => v ?? '—' },
  { key: 'description',          label: 'Description',   fmt: v => v ? truncate(v, 40) : '—' },
  { key: 'payment_status_notes', label: 'Status notes',  fmt: v => v ? truncate(v, 40) : '—' },
]

function isMissing(v) { return v === null || v === undefined || v === '' }
function eq(a, b) {
  if (isMissing(a) && isMissing(b)) return true
  if (isMissing(a) || isMissing(b)) return false
  // Numbers might come back as strings from PostgREST — compare loosely.
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'string' && /^-?\d+(\.\d+)?$/.test(a) && typeof b === 'string' && /^-?\d+(\.\d+)?$/.test(b))
    return Number(a) === Number(b)
  return String(a) === String(b)
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s }
