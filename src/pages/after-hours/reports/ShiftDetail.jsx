import { useState } from 'react'
import { S } from '../../../lib/styles'
import { fmtClock, fmtTs, fmtHours, money, kindMeta } from './reportsData'

// The expanded row. Two columns: a fixed 300px left (handoff, what was raised)
// and a flexible right (drivers worked, activity log).
//
// Most shifts on record have no handoff, no drivers and an empty timeline, so
// every section renders its own empty state rather than assuming content.

const OUTCOME = {
  issue: { label: 'Issue', cls: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30' },
  needs_load: { label: 'Needs load', cls: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
  ok: { label: 'OK', cls: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' },
}
const outcomeMeta = (o) => OUTCOME[o] || { label: o || '—', cls: 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-white/10' }

const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500'
const TIMELINE_CAP = 8

export default function ShiftDetail({ detail, loading, error, onRetry }) {
  if (error) {
    return (
      <div className="px-4 py-4">
        <div className={S.errorBox}>
          Couldn&apos;t load this shift. <button onClick={onRetry} className="underline font-medium">Retry</button>
        </div>
      </div>
    )
  }
  if (loading || !detail) {
    return (
      <div className="px-4 py-4 grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="h-40 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse" />
        <div className="h-40 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse" />
      </div>
    )
  }

  return (
    <div className="px-4 py-4 bg-gray-50/70 dark:bg-white/[0.02] border-t border-gray-200 dark:border-white/10">
      <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
        <div className="space-y-4 min-w-0">
          <Handoff detail={detail} />
          <Raised raised={detail.raised} />
        </div>
        <div className="space-y-4 min-w-0">
          <Drivers drivers={detail.drivers || []} counts={detail.driver_counts || {}} />
          <Timeline entries={detail.timeline || []} />
        </div>
      </div>
    </div>
  )
}

// ── ① Handoff ───────────────────────────────────────────────────────────────
function Handoff({ detail }) {
  const h = detail.handoff || {}
  const duration = detail.is_open ? null : fmtHours(detail.hours)

  return (
    <Card n={1} title="Handoff">
      {h.text ? (
        <>
          {h.is_frozen && (
            <span className="inline-flex items-center px-1.5 py-0.5 mb-2 rounded text-[9px] font-bold bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300">
              FROZEN
            </span>
          )}
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-gray-700 dark:text-slate-300 border-l-2 border-gray-300 dark:border-white/15 pl-2.5">
            {h.text}
          </pre>
        </>
      ) : (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">No handoff recorded.</p>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5 space-y-1 text-[11px] text-gray-500 dark:text-slate-400">
        <Line label="Handed to" value={h.handed_to} />
        <Line label="Sent" value={h.sent_at ? fmtTs(h.sent_at) : null} />
        <Line label="Shift" value={`${fmtClock(detail.started_at)} → ${detail.is_open ? 'open' : fmtClock(detail.ended_at)}`} />
        {duration && <Line label="Duration" value={duration} />}
      </div>
      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-2">
        Stored as it was sent — this text never re-renders from live data, so it still reads the way
        the next shift received it.
      </p>
    </Card>
  )
}

// ── ③ Raised this shift ─────────────────────────────────────────────────────
function Raised({ raised }) {
  const r = raised || {}
  const acc = r.accessorials || []
  const nothing = acc.length === 0 && !r.requests_raised && !r.requests_handled && !r.lumpers_count

  return (
    <Card n={3} title="Raised this shift">
      {nothing ? (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">Nothing raised this shift.</p>
      ) : (
        <div className="space-y-2.5">
          {acc.length > 0 && (
            <div>
              <p className={EYEBROW}>Accessorials</p>
              <div className="mt-1 space-y-1">
                {acc.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px]">
                    <span className="text-gray-700 dark:text-slate-300 capitalize">{String(a.type || '').replace(/_/g, ' ')}</span>
                    {a.load_number && <span className="font-mono text-gray-500 dark:text-slate-400">{a.load_number}</span>}
                    <span className="ml-auto font-mono tabular-nums font-semibold text-gray-900 dark:text-white shrink-0">{money(a.claimed_amount, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(r.requests_raised > 0 || r.requests_handled > 0) && (
            <div className="flex items-center gap-3 text-[11px] text-gray-600 dark:text-slate-300">
              <span><span className={EYEBROW}>Requests</span> <span className="tabular-nums font-semibold">{r.requests_raised || 0}</span> raised</span>
              <span className="tabular-nums font-semibold">{r.requests_handled || 0}</span><span className="-ml-2">handled</span>
            </div>
          )}
          {r.lumpers_count > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-300">
              <span className={EYEBROW}>Lumpers</span>
              <span className="tabular-nums font-semibold">{r.lumpers_count}</span>
              <span className="ml-auto font-mono tabular-nums font-semibold text-gray-900 dark:text-white">{money(r.lumpers_amount, 2)}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ── ② Drivers worked ────────────────────────────────────────────────────────
// Defaults to exceptions. On a 92% shift that is ~9 rows instead of ~120, and the
// handful that needed something isn't buried under the ones that didn't.
function Drivers({ drivers, counts }) {
  const [showAll, setShowAll] = useState(false)
  const exceptions = drivers.filter(d => d.is_exception === true)
  const nException = counts.exceptions ?? exceptions.length
  const nReviewed = counts.reviewed ?? drivers.length
  const nCleared = counts.cleared ?? Math.max(nReviewed - nException, 0)
  const rows = showAll ? drivers : exceptions

  return (
    <Card n={2} title="Drivers worked"
      right={
        drivers.length > 0 && (
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-slate-600 text-[10px]">
            {[[false, `Exceptions ${nException}`], [true, `All reviewed ${nReviewed}`]].map(([v, l]) => (
              <button key={String(v)} type="button" onClick={() => setShowAll(v)}
                className={`px-2 py-1 font-medium transition-colors ${
                  showAll === v ? 'bg-orange-500 text-white' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                }`}>{l}</button>
            ))}
          </div>
        )
      }>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
        {nReviewed} reviewed{nException > 0 ? `, ${nException} needed action` : ''}
        {nCleared > 0 ? `, ${nCleared} cleared with no action` : ''}.
      </p>

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">
          {drivers.length === 0 ? 'No drivers reviewed on this shift.' : 'No exceptions — every driver reviewed was cleared.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-gray-400 dark:text-slate-500">
                {['Driver', 'Load', 'Outcome', 'Note', 'Checked'].map(h => (
                  <th key={h} className="text-left font-semibold py-1 pr-3 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(d => {
                const o = outcomeMeta(d.outcome)
                return (
                  <tr key={d.driver_id || `${d.driver}-${d.checked_at}`} className="border-t border-gray-100 dark:border-white/5">
                    <td className="py-1 pr-3 text-gray-800 dark:text-slate-200 whitespace-nowrap">{d.driver || '—'}</td>
                    <td className="py-1 pr-3 font-mono text-gray-500 dark:text-slate-400 whitespace-nowrap">{d.load_number || '—'}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${o.cls}`}>{o.label}</span>
                    </td>
                    <td className="py-1 pr-3 text-gray-500 dark:text-slate-400 max-w-[220px]">
                      <span className="block truncate" title={d.issue_note || ''}>{d.issue_note || '—'}</span>
                    </td>
                    <td className="py-1 text-gray-400 dark:text-slate-500 tabular-nums whitespace-nowrap">{fmtClock(d.checked_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!showAll && nCleared > 0 && (
        <p className="mt-2 pt-2 border-t border-gray-100 dark:border-white/5 text-[11px] text-gray-400 dark:text-slate-500">
          {nCleared} reviewed, cleared — switch to <span className="font-medium">All reviewed</span> to see every driver.
        </p>
      )}
    </Card>
  )
}

// ── ④ Activity log ──────────────────────────────────────────────────────────
function Timeline({ entries }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? entries : entries.slice(0, TIMELINE_CAP)
  const more = entries.length - shown.length

  return (
    <Card n={4} title="Activity log">
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">Nothing logged on this shift.</p>
      ) : (
        <>
          <ol className="space-y-2.5">
            {shown.map((e, i) => <Entry key={`${e.source}-${e.occurred_at}-${i}`} e={e} />)}
          </ol>
          {more > 0 && (
            <button type="button" onClick={() => setExpanded(true)}
              className="mt-2.5 text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline">
              {more} more {more === 1 ? 'entry' : 'entries'}
            </button>
          )}
        </>
      )}
    </Card>
  )
}

function Entry({ e }) {
  const meta = kindMeta(e.kind)
  // The meta line carries the raw kind deliberately — when something unfamiliar
  // shows up, the value that explains it is right there.
  const bits = [fmtClock(e.occurred_at), e.kind]
  if (e.escalated_to) bits.push(`to ${e.escalated_to}`)
  if (e.acknowledged_at) bits.push(`ack ${fmtClock(e.acknowledged_at)}`)
  if (e.lag_hours != null) bits.push(`${Number(e.lag_hours).toFixed(1)}h to handle`)
  if (e.amount != null) bits.push(money(e.amount, 2))
  if (e.raised_by) bits.push(`raised by ${e.raised_by}`)

  return (
    <li className="flex gap-2.5">
      <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${meta.dot}`} />
      <div className="min-w-0">
        <p className="text-xs text-gray-800 dark:text-slate-200">
          {meta.label}
          {e.driver && <span className="text-gray-500 dark:text-slate-400"> · {e.driver}</span>}
          {e.load_number && <span className="font-mono text-gray-500 dark:text-slate-400"> {e.load_number}</span>}
          {e.note && <span className="text-gray-500 dark:text-slate-400"> — {e.note}</span>}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-slate-500 tabular-nums">{bits.filter(Boolean).join(' · ')}</p>
      </div>
    </li>
  )
}

// ── Shared ──────────────────────────────────────────────────────────────────
function Card({ n, title, right, children }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 inline-flex items-center justify-center text-[10px] font-bold">{n}</span>
        <h4 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide">{title}</h4>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  )
}

function Line({ label, value }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className={EYEBROW}>{label}</span>
      <span className="text-gray-700 dark:text-slate-300 truncate">{value || '—'}</span>
    </p>
  )
}
