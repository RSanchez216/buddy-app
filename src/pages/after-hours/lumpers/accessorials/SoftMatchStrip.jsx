import { useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../../lib/styles'
import { money, todayChicago } from '../lumperData'
import { typeLabel, matchKindMeta } from './accountingData'

// A rate confirmation changed on a load that still has an unpaid request. That is
// a SUGGESTION, not a fact — the broker may have raised the linehaul for an
// unrelated reason. Nothing is written until someone confirms or dismisses.

export default function SoftMatchStrip({ matches, onConfirm, onDismiss, busyId }) {
  const [open, setOpen] = useState(true)
  if (!matches?.length) return null

  return (
    <div className="rounded-2xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/70 dark:bg-blue-500/[0.07] overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
        <span className="text-sm font-bold text-blue-800 dark:text-blue-300">{matches.length} possible match{matches.length === 1 ? '' : 'es'}</span>
        <span className="text-xs text-blue-700/80 dark:text-blue-400/80 truncate">
          — a rate confirmation changed on a load with an unpaid accessorial request. Nothing is updated until someone confirms.
        </span>
        <svg className={`ml-auto w-3.5 h-3.5 shrink-0 text-blue-500 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>

      {open && (
        <div className="border-t border-blue-200/70 dark:border-blue-500/20 divide-y divide-blue-200/50 dark:divide-blue-500/10">
          {matches.map(m => (
            <MatchRow key={`${m.accessorial_id}-${m.detected_at}`} m={m}
              onConfirm={onConfirm} onDismiss={onDismiss}
              busy={busyId === m.accessorial_id} />
          ))}
        </div>
      )}
    </div>
  )
}

function MatchRow({ m, onConfirm, onDismiss, busy }) {
  const kind = matchKindMeta(m.match_kind)
  const requested = m.approved_amount ?? m.claimed_amount

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-900 dark:text-white">
          <span className="font-mono">{m.load_number || '—'}</span>
          <span className="font-normal text-gray-500 dark:text-slate-400"> · {m.driver_name || '—'}</span>
        </p>
        <p className="text-[11px] text-gray-500 dark:text-slate-400">
          {typeLabel(m.accessorial_type)} request {money(requested)}
        </p>
      </div>

      <div className="text-xs font-mono tabular-nums text-gray-700 dark:text-slate-300 whitespace-nowrap">
        {money(m.old_linehaul)} <span className="text-gray-400 dark:text-slate-500">→</span> {money(m.new_linehaul)}
        <span className="ml-1.5 font-semibold text-emerald-600 dark:text-emerald-400">+{money(m.delta)}</span>
      </div>

      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${kind.cls}`}>{kind.label}</span>
      {m.match_kind === 'partial' && (
        <span className="text-[11px] text-amber-600 dark:text-amber-400">short of the request — a different decision</span>
      )}

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <button type="button" disabled={busy} onClick={() => onDismiss?.(m)}
          className={`${S.btnCancel} !px-3 !py-1.5 !text-xs disabled:opacity-50`}>Not related</button>
        <button type="button" disabled={busy} onClick={() => onConfirm?.(m)}
          className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors">
          {busy ? 'Saving…' : `✓ Confirm collected ${money(m.delta)}`}
        </button>
      </div>
    </div>
  )
}

// Confirm dialog — the amount and date are editable because what the broker
// actually paid can differ from the linehaul delta that surfaced the match.
export function ConfirmCollectedModal({ target, onClose, onSubmit }) {
  const [amount, setAmount] = useState(() => {
    const n = Number(target?.amount)
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : ''
  })
  const [on, setOn] = useState(todayChicago())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setErr('')
    const n = parseFloat(amount)
    if (!(n > 0)) { setErr('Enter the amount collected.'); return }
    setBusy(true)
    try {
      await onSubmit(n, on)
    } catch (e) {
      setErr(e?.message || 'Could not confirm collection.') // server refusal, verbatim
    } finally { setBusy(false) }
  }

  // Portaled to the body — the inactive tab is display:none, and a modal must
  // never depend on its parent being the visible one.
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-sm rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl p-5 space-y-3">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Confirm collected</h3>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 truncate">
            {target?.label || 'Request'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={S.label}>Amount collected</label>
            <input type="text" inputMode="decimal" autoFocus className={`${S.input} font-mono tabular-nums`}
              value={amount}
              onChange={e => setAmount(String(e.target.value).replace(',', '.').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
              placeholder="0.00" />
          </div>
          <div>
            <label className={S.label}>Collected on</label>
            <input type="date" className={S.input} value={on} max={todayChicago()} onChange={e => setOn(e.target.value || on)} />
          </div>
        </div>
        <p className="text-[11px] text-gray-400 dark:text-slate-500">This closes the request. Only accounting or a manager can record it.</p>
        {err && <div className={S.errorBox}>{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className={S.btnCancel}>Cancel</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl transition-colors">
            {busy ? 'Saving…' : 'Confirm collected'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
