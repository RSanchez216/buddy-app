import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { S } from '../lib/styles'

function relativeTime(iso) {
  const d = new Date(iso)
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', ...o }).format(d)
  const dayKey = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(x)
  const today = dayKey(new Date())
  const yest = dayKey(new Date(Date.now() - 864e5))
  const k = dayKey(d)
  const time = fmt({ hour: 'numeric', minute: '2-digit' })
  if (k === today) return `Today, ${time}`
  if (k === yest) return `Yesterday, ${time}`
  const sameYear = fmt({ year: 'numeric' }) === new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(new Date())
  return fmt(sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

function dateLabel(iso) {
  const d = new Date(iso)
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', ...o }).format(d)
  const dayKey = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(x)
  const today = dayKey(new Date())
  const yest = dayKey(new Date(Date.now() - 864e5))
  const k = dayKey(d)
  const time = fmt({ hour: 'numeric', minute: '2-digit' })
  if (k === today) return `Today, ${time}`
  if (k === yest) return `Yesterday, ${time}`
  const sameYear = fmt({ year: 'numeric' }) === new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(new Date())
  return fmt(sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AssignmentImportLog({ refreshKey = 0 }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  // Reloads on mount and whenever refreshKey changes (bumped by the parent
  // after an assignment upload applies, so the strip reflects the new run).
  useEffect(() => {
    load()
  }, [refreshKey])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.rpc('assignment_import_log', { p_limit: 12 })
      if (err) throw err
      setRows(data || [])
    } catch (e) {
      console.error('Failed to load assignment import log:', e)
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 h-12 animate-pulse" />
    )
  }

  if (error || !rows.length) {
    return (
      <div className="bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-gray-600 dark:text-slate-400 flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        No assignment imports yet.
      </div>
    )
  }

  const latest = rows[0]
  const showReassignedPill = latest.reassigned > 0
  const showNewPill = latest.new_total > 0
  const showUnmatchedPill = latest.unmatched > 0

  return (
    <div className="space-y-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <svg className="w-4 h-4 flex-shrink-0 text-gray-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div className="min-w-0 flex-1 text-left">
              <div className="text-sm text-gray-900 dark:text-slate-200">
                Last assignment import: <span className="font-medium">{relativeTime(latest.session_started_at)}</span>
                {latest.imported_by && <span className="text-gray-500 dark:text-slate-400"> by {latest.imported_by}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {showNewPill && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 flex-shrink-0">
                {latest.new_total} new
              </span>
            )}
            {showReassignedPill && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 flex-shrink-0">
                {latest.reassigned} reassigned
              </span>
            )}
            {showUnmatchedPill && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 flex-shrink-0">
                {latest.unmatched} unmatched
              </span>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-sm font-medium text-gray-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 flex items-center gap-1 ml-2"
            >
              View history
              <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
            </button>
          </div>
        </div>
      </button>

      {expanded && rows.length > 0 && (
        <div className="border border-t-0 border-gray-200 dark:border-white/10 rounded-b-xl bg-white dark:bg-white/[0.01] overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={S.tableHead}>
              <tr>
                <th className={S.th}>When</th>
                <th className={S.th}>By</th>
                <th className={`${S.th} text-right`}>Trucks</th>
                <th className={`${S.th} text-right`}>Trailers</th>
                <th className={`${S.th} text-right`}>Reassigned</th>
                <th className={`${S.th} text-right`}>Unmatched</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={S.tableRow}>
                  <td className={S.td}>{dateLabel(row.session_started_at)}</td>
                  <td className={S.td}>{row.imported_by || '—'}</td>
                  <td className={`${S.td} text-right ${row.new_trucks === 0 ? 'text-gray-400 dark:text-slate-600' : 'text-gray-900 dark:text-slate-200'}`}>
                    {row.new_trucks}
                  </td>
                  <td className={`${S.td} text-right ${row.new_trailers === 0 ? 'text-gray-400 dark:text-slate-600' : 'text-gray-900 dark:text-slate-200'}`}>
                    {row.new_trailers}
                  </td>
                  <td className={`${S.td} text-right ${row.reassigned === 0 ? 'text-gray-400 dark:text-slate-600' : 'text-gray-900 dark:text-slate-200'}`}>
                    {row.reassigned}
                  </td>
                  <td className={`${S.td} text-right ${row.unmatched === 0 ? 'text-gray-400 dark:text-slate-600' : 'text-red-700 dark:text-red-400'}`}>
                    {row.unmatched}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
