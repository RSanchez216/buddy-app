import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '../../../../lib/styles'
import { SpinnerBox, ErrorRetry } from '../../../../components/Loading'
import { fetchDepartures, fetchDeparturesInterpretation, money, int, periodLabel } from './dispatcherData'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "Jul 1" — short, no year (the modal header already carries the period).
function fmtMD(iso) {
  if (!iso) return '—'
  const s = String(iso).slice(0, 10)
  const [, m, d] = s.split('-').map(Number)
  if (!m || !d) return '—'
  return `${MON[m - 1]} ${d}`
}
// Human tenure from a run-length in days: months over ~2mo, weeks over ~2wk.
function fmtRun(days) {
  const d = Math.max(0, Math.round(Number(days) || 0))
  if (d >= 60) return `${Math.round(d / 30.4)} mo`
  if (d >= 14) return `${Math.round(d / 7)} wk`
  return `${d} day${d === 1 ? '' : 's'}`
}
function firstWord(s) {
  return String(s || '').trim().split(/\s+/)[0] || ''
}
function toInt(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}
// Wrap the first standalone occurrence of each highlight's value in a coloured
// span, leaving the RPC's prose untouched. Numbers glued to letters (188k) or
// other digits are skipped so only whole standalone figures colour.
function highlightNumbers(detail, highlights) {
  if (!detail) return null
  const parts = String(detail).split(/(\d+)/)
  const used = new Set()
  return parts.map((part, i) => {
    if (!/^\d+$/.test(part)) return part
    const prev = parts[i - 1] || ''
    const next = parts[i + 1] || ''
    if (/[A-Za-z]$/.test(prev) || /^[A-Za-z]/.test(next)) return part // e.g. "188k"
    const n = Number(part)
    for (const h of highlights) {
      if (used.has(h.key) || h.value == null || n !== h.value) continue
      used.add(h.key)
      return <span key={i} className={h.className}>{part}</span>
    }
    return part
  })
}
const rowKey = (r) => `${r.driver_internal_id ?? r.driver_name}-${r.desk_id ?? r.desk_name}`

export default function DeparturesModal({ open, grain, anchor, onClose }) {
  const [rows, setRows] = useState(null)
  const [interp, setInterp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const panelRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(''); setRows(null); setInterp(null)
      try {
        // Departures are required; the interpretation is an enhancement — if it
        // fails, still show the list rather than blanking the whole modal.
        const [d, ip] = await Promise.all([
          fetchDepartures(grain, anchor),
          fetchDeparturesInterpretation(grain, anchor).catch(() => null),
        ])
        if (!cancelled) { setRows(d); setInterp(ip) }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load departures')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, grain, anchor, reloadKey])

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement
    panelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const el = restoreFocusRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open])

  const counted = useMemo(() => (rows || []).filter(r => r.counted_in_total), [rows])
  const notCounted = useMemo(() => (rows || []).filter(r => !r.counted_in_total), [rows])
  const summary = useMemo(() => {
    const booked = counted.reduce((s, r) => s + (Number(r.run_gross) || 0), 0)
    const runrate = counted.reduce((s, r) => s + (Number(r.monthly_runrate) || 0), 0)
    const deskCounts = {}
    counted.forEach(r => { deskCounts[r.desk_name] = (deskCounts[r.desk_name] || 0) + 1 })
    const desks = Object.keys(deskCounts).length
    const top = Object.entries(deskCounts).sort((a, b) => b[1] - a[1])[0] || null
    return { booked, runrate, desks, top }
  }, [counted])
  const anyShort = useMemo(() => counted.some(r => r.short_run), [counted])

  if (!open) return null
  const period = periodLabel(grain, anchor)

  function telegramText() {
    const L = []
    L.push(`Departures — ${period}`)
    if (interp?.headline) L.push(interp.headline)
    if (interp?.detail) L.push(interp.detail)
    L.push(`${counted.length} drivers · ${money(summary.booked)} booked · ~${money(summary.runrate)}/mo run-rate`)
    L.push('')
    for (const r of counted) {
      L.push(`• ${r.driver_name} → ${r.desk_name}`)
      const permo = r.short_run ? '' : ` · ${money(r.monthly_runrate)}/mo`
      L.push(`  left ${fmtMD(r.terminated_at)} · ${fmtRun(r.run_days)} · ${int(r.run_loads)} loads · ${money(r.run_gross)}${permo}`)
    }
    if (notCounted.length) {
      L.push('')
      L.push('Not counted (desk had no loads this period):')
      for (const r of notCounted) L.push(`• ${r.driver_name} → ${r.desk_name} · left ${fmtMD(r.terminated_at)}`)
    }
    L.push('')
    L.push("Booking volume, not profit — roughly 56% is owner-op pass-through Manas doesn't keep. Run-rate assumes each driver would have continued at their own pace, and isn't a loss if they're replaced.")
    return L.join('\n')
  }

  async function copyTelegram() {
    try {
      await navigator.clipboard.writeText(telegramText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — no-op, never alert */ }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-6"
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Backdrop owns the close handler directly — it's the topmost element at
          any click outside the panel. */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Departures — ${period}`}
        onClick={e => e.stopPropagation()}
        className={`${S.card} relative flex flex-col w-[min(920px,94vw)] max-h-[88vh] shadow-2xl focus:outline-none`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-white/5 shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Departures — {period}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">
              {rows ? (
                <>
                  <span className="font-semibold text-gray-700 dark:text-slate-300 tabular-nums">{counted.length}</span> drivers left this period
                  {notCounted.length > 0 && <span className="text-gray-400 dark:text-slate-600"> · {notCounted.length} more on desks with no loads</span>}
                </>
              ) : 'Everyone terminated in the period, and what they booked through their desk.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={copyTelegram}
              disabled={loading || !rows || counted.length === 0}
              className={`${S.btnSecondary} text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {copied ? '✓ Copied' : '✈ Copy for Telegram'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-slate-200 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 space-y-4">
          {loading && <SpinnerBox className="h-40" />}
          {!loading && error && <ErrorRetry message={error} onRetry={() => setReloadKey(k => k + 1)} />}
          {!loading && !error && rows && (
            <>
              {/* Interpretation — how to read the number: rate band + veteran/early split */}
              {interp && <InterpBanner interp={interp} />}

              {/* Summary tiles — counted rows only */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Tile label="Booked by these drivers" value={money(summary.booked)} sub="total, across their runs" />
                <Tile label="Run-rate leaving" value={`~${money(summary.runrate)}/mo`} sub="combined booking pace" />
                <Tile
                  label="Desks affected"
                  value={int(summary.desks)}
                  sub={summary.top && summary.top[1] > 1 ? `${firstWord(summary.top[0])} lost ${summary.top[1]}` : 'one departure each'}
                />
              </div>

              {/* Always-visible caveat */}
              <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-relaxed">
                Booking volume, <strong className="font-semibold text-gray-600 dark:text-slate-300">not profit</strong> — roughly 56% is owner-op
                pass-through Manas doesn't keep. Run-rate assumes each driver would have continued at their own pace, and isn't a loss if they're replaced.
              </p>

              {/* Table */}
              <div className={`${S.card} overflow-x-auto`}>
                <table className="w-full text-sm">
                  <thead className={S.tableHead}>
                    <tr>
                      <th className={S.th}>Driver</th>
                      <th className={S.th}>Desk</th>
                      <th className={`${S.th} whitespace-nowrap`}>Left</th>
                      <th className={`${S.th} whitespace-nowrap`}>Run</th>
                      <th className={`${S.th} text-right`}>Loads</th>
                      <th className={`${S.th} text-right`}>Gross</th>
                      <th className={`${S.th} text-right whitespace-nowrap`}>Per mo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counted.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-slate-600">No departures counted this period.</td></tr>
                    ) : counted.map(r => <Row key={rowKey(r)} r={r} />)}

                    {notCounted.length > 0 && (
                      <>
                        <tr>
                          <td colSpan={7} className="px-4 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                            Not counted above ({notCounted.length}) — their desk booked no loads this period
                          </td>
                        </tr>
                        {notCounted.map(r => <Row key={rowKey(r)} r={r} muted />)}
                      </>
                    )}
                  </tbody>
                </table>
              </div>

              {anyShort && (
                <p className="text-[11px] text-gray-400 dark:text-slate-500">
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">*</span> Run shorter than 30 days — the per-month figure is extrapolated from very little data.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function InterpBanner({ interp }) {
  // Leading-dot tint by how the departure rate compares to normal.
  const dot = interp.rate_band === 'high'
    ? 'bg-red-500'
    : interp.rate_band === 'low'
      ? 'bg-emerald-500'
      : 'bg-gray-400 dark:bg-slate-500'
  // Veteran churn (expensive) → red; early churn (onboarding/fit) → amber.
  const highlights = [
    { key: 'early', value: toInt(interp.gone_within_60d), className: 'font-semibold text-amber-600 dark:text-amber-400' },
    { key: 'vet', value: toInt(interp.veterans), className: 'font-semibold text-red-600 dark:text-red-400' },
  ]
  return (
    <div className="space-y-1">
      {interp.headline && (
        <p className="flex items-start gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <span className={`mt-[0.4rem] h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          <span>{interp.headline}</span>
        </p>
      )}
      {interp.detail && (
        <p className="pl-4 text-xs leading-relaxed text-gray-600 dark:text-slate-400">
          {highlightNumbers(interp.detail, highlights)}
        </p>
      )}
    </div>
  )
}

function Tile({ label, value, sub }) {
  return (
    <div className={`${S.card} p-3`}>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-white tabular-nums mt-0.5">{value}</div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{sub}</div>
    </div>
  )
}

function Row({ r, muted }) {
  const short = !!r.short_run
  return (
    <tr className={`${S.tableRow} ${muted ? 'opacity-60' : ''}`}>
      <td className={S.td}>
        <span className={muted ? 'text-gray-600 dark:text-slate-400' : 'font-medium text-gray-900 dark:text-slate-200'}>{r.driver_name}</span>
        {r.driver_internal_id != null && <span className="ml-1.5 text-[11px] text-gray-400 dark:text-slate-600 tabular-nums">#{r.driver_internal_id}</span>}
      </td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.desk_name}</td>
      <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400 tabular-nums`}>{fmtMD(r.terminated_at)}</td>
      <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400 tabular-nums`}>
        {fmtRun(r.run_days)}
        {short && <span className="text-amber-600 dark:text-amber-400 font-semibold" title="Run shorter than 30 days">&nbsp;*</span>}
      </td>
      <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(r.run_loads)}</td>
      <td className={`${S.td} text-right tabular-nums font-medium text-gray-900 dark:text-slate-200`}>{money(r.run_gross)}</td>
      <td className={`${S.td} text-right tabular-nums whitespace-nowrap ${short ? 'text-gray-400 dark:text-slate-600' : 'text-gray-700 dark:text-slate-300'}`}>
        {money(r.monthly_runrate)}/mo
      </td>
    </tr>
  )
}
