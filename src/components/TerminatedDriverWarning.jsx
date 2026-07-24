import { Link } from 'react-router-dom'

// Shared pre-import warning: flag staged rows that reference a terminated
// driver. Warning only — never blocks, never auto-fixes. Used by the Loads,
// Settlement, and Equipment-Assignment importers. The status lookup lives in
// lib/terminatedDrivers (fetchTerminatedDrivers).

// 'YYYY-MM-DD' (or timestamp) → "Jun 5, 2026", no UTC day-shift for date-only.
function fmtTermDate(s) {
  if (!s) return 'an unknown date'
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s)
  return Number.isNaN(d.getTime())
    ? 'an unknown date'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Link to the driver record — opens in a new tab so correcting the status
// doesn't discard the staged import.
function DriverLink({ id, name, internalId }) {
  const label = <>{name}{internalId != null && <span className="opacity-70"> · #{internalId}</span>}</>
  if (!id) return <span className="font-medium">{label}</span>
  return (
    <Link to={`/fleet/drivers/${id}`} target="_blank" rel="noopener noreferrer"
      className="font-medium underline decoration-amber-400/50 hover:decoration-amber-500">
      {label}
    </Link>
  )
}

// entries (grouped by driver): { id, name, internalId, terminatedAt, count, unit? }.
// variant 'assignment' → the "handing equipment to someone who left" wording
// (a new open assignment is more serious than a historical load); the `unit`
// on each entry is shown. variant 'load' (default) → the grouped-by-driver
// table with a per-driver row count; `noun` labels that count ("loads",
// "settlements", "rows").
export default function TerminatedDriverWarning({ entries, variant = 'load', noun = 'rows', className = '' }) {
  if (!entries || entries.length === 0) return null
  const box = `rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-500/[0.06] px-4 py-3 text-amber-800 dark:text-amber-300 ${className}`

  if (variant === 'assignment') {
    return (
      <div className={box} role="alert">
        <p className="text-sm font-semibold mb-1">⚠️ You&apos;re assigning equipment to a terminated driver.</p>
        <ul className="text-xs space-y-1 mt-1.5">
          {entries.map((e, i) => (
            <li key={i} className="leading-relaxed">
              <span className="font-mono font-semibold">{e.unit}</span> →{' '}
              <DriverLink id={e.id} name={e.name} internalId={e.internalId} />, terminated {fmtTermDate(e.terminatedAt)}.
            </li>
          ))}
        </ul>
        <p className="text-[11px] mt-2 opacity-90">
          The assignment will still be created. A new open assignment means company equipment is handed to someone who no longer works here — check whether the driver&apos;s status needs updating first.
        </p>
      </div>
    )
  }

  const rowWord = entries.length === 1 ? 'row references' : 'rows reference'
  return (
    <div className={box} role="alert">
      <p className="text-sm font-semibold mb-0.5">⚠️ {entries.length} {rowWord} terminated drivers</p>
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
              <td className="py-1 whitespace-nowrap">{e.count} {e.count === 1 ? noun.replace(/s$/, '') : noun}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
