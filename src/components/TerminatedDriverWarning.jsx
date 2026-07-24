import { Link } from 'react-router-dom'

// Shared pre-import warning: flag staged rows that reference a terminated
// driver. Warning only — never blocks, never auto-fixes. Used by the Loads,
// Settlement, and Equipment-Assignment importers. The status lookup + date
// classification live in lib/terminatedDrivers.
//
// For loads/assignments the caller classifies each staged row against the
// driver's termination date (using the FILE's dates) and passes the tallies —
// this component only renders the verdict. Settlements have no per-row dates,
// so they pass plain counts and get the count table.

// 'YYYY-MM-DD' (or timestamp) → "Jun 5, 2026", no UTC day-shift for date-only.
function fmtTermDate(s) {
  if (!s) return 'an unknown date'
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s)
  return Number.isNaN(d.getTime())
    ? 'an unknown date'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const AMBER_BOX = 'rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/[0.08] px-4 py-3 text-amber-900 dark:text-amber-200'
const CALM_BOX = 'rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-white/[0.03] px-4 py-3 text-gray-700 dark:text-slate-300'

const nounOne = (noun) => noun.replace(/s$/, '')

// Link to the driver record — opens in a new tab so correcting the status
// doesn't discard the staged import.
function DriverLink({ id, name, internalId }) {
  const label = <>{name}{internalId != null && <span className="opacity-70"> · #{internalId}</span>}</>
  if (!id) return <span className="font-medium">{label}</span>
  return (
    <Link to={`/fleet/drivers/${id}`} target="_blank" rel="noopener noreferrer"
      className="font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid">
      {label}
    </Link>
  )
}

// Per-driver verdict line for the load variant, from the before/inTransit/after
// tallies. "After" escalates (red); a mix reads plainly; all-before reassures.
function LoadVerdict({ e }) {
  if (e.after > 0) {
    return (
      <span className="text-red-700 dark:text-red-300 font-medium">
        ⚠ {e.after} of {e.count} picked up <strong>after</strong> termination — driver may still be active
      </span>
    )
  }
  if (e.inTransit > 0) {
    const parts = []
    if (e.before > 0) parts.push(`${e.before} delivered before termination`)
    parts.push(`${e.inTransit} in transit at termination`)
    return <span className="text-amber-700 dark:text-amber-300">{parts.join(' · ')}</span>
  }
  return <span className="text-emerald-600/90 dark:text-emerald-400/90">✓ All {e.count} delivered before termination</span>
}

export default function TerminatedDriverWarning({ entries, variant = 'load', noun = 'rows', className = '' }) {
  if (!entries || entries.length === 0) return null

  // ── Assignments: one line per unit, each with a date verdict ──────────────
  if (variant === 'assignment') {
    const sorted = [...entries].sort((a, b) => (b.startsAfter ? 1 : 0) - (a.startsAfter ? 1 : 0))
    const anyAfter = entries.some(e => e.startsAfter)
    return (
      <div className={`${anyAfter ? AMBER_BOX : CALM_BOX} ${className}`} role="alert">
        <p className="text-sm font-semibold mb-1">⚠️ You&apos;re assigning equipment to a terminated driver.</p>
        <ul className="text-xs space-y-1.5 mt-1.5">
          {sorted.map((e, i) => (
            <li key={i} className="leading-relaxed">
              <div><span className="font-mono font-semibold">{e.unit}</span> → <DriverLink id={e.id} name={e.name} internalId={e.internalId} />, terminated {fmtTermDate(e.terminatedAt)}.</div>
              <div className="mt-0.5">
                {e.startsAfter
                  ? <span className="text-red-700 dark:text-red-300 font-medium">⚠ Assignment starts {e.afterDays} {e.afterDays === 1 ? 'day' : 'days'} after termination</span>
                  : <span className="text-gray-500 dark:text-slate-400">Assignment predates termination</span>}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[11px] mt-2 opacity-90">
          The assignment will still be created. A new open assignment means company equipment is handed to someone who no longer works here — check whether the driver&apos;s status needs updating first.
        </p>
      </div>
    )
  }

  // ── Loads (date-aware): verdict line per driver, after-rows sorted first ───
  const dated = entries.some(e => typeof e.after === 'number')
  if (dated) {
    const sorted = [...entries].sort((a, b) => (b.after > 0 ? 1 : 0) - (a.after > 0 ? 1 : 0))
    const afterDrivers = entries.filter(e => e.after > 0).length
    const escalated = afterDrivers > 0
    const header = escalated
      ? `⚠ ${afterDrivers} ${afterDrivers === 1 ? 'driver has' : 'drivers have'} loads picked up after their termination date`
      : `${entries.length} ${entries.length === 1 ? 'row references' : 'rows reference'} terminated drivers — all loads predate termination`
    return (
      <div className={`${escalated ? AMBER_BOX : CALM_BOX} ${className}`} role="alert">
        <p className="text-sm font-semibold mb-2">{header}</p>
        <ul className="space-y-2">
          {sorted.map((e, i) => (
            <li key={i} className="text-xs leading-relaxed">
              <div>
                <DriverLink id={e.id} name={e.name} internalId={e.internalId} />
                <span className="text-gray-500 dark:text-slate-400"> · Terminated {fmtTermDate(e.terminatedAt)} · {e.count} {e.count === 1 ? nounOne(noun) : noun}</span>
              </div>
              <div className="mt-0.5"><LoadVerdict e={e} /></div>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // ── Plain count table (no per-row dates, e.g. Settlements) ────────────────
  return (
    <div className={`${AMBER_BOX} ${className}`} role="alert">
      <p className="text-sm font-semibold mb-0.5">⚠️ {entries.length} {entries.length === 1 ? 'row references' : 'rows reference'} terminated drivers</p>
      <p className="text-xs mb-2">These will still import. Check whether the driver&apos;s status needs updating first.</p>
      <table className="text-xs">
        <thead>
          <tr className="text-left text-amber-700/80 dark:text-amber-400/80">
            <th className="pr-6 py-1 font-semibold">Driver</th>
            <th className="pr-6 py-1 font-semibold">Terminated</th>
            <th className="py-1 font-semibold">Rows in this file</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="align-top">
              <td className="pr-6 py-1"><DriverLink id={e.id} name={e.name} internalId={e.internalId} /></td>
              <td className="pr-6 py-1 whitespace-nowrap">{fmtTermDate(e.terminatedAt)}</td>
              <td className="py-1 whitespace-nowrap">{e.count} {e.count === 1 ? nounOne(noun) : noun}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
