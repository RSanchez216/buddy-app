import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'
import UsageRangeControl from './UsageRangeControl'
import {
  fmtActive, fmtActiveCompact, fmtRelative, fmtTime, fmtDayLong, fmtWeekdayLetter,
  fmtDayShort, endedBadge, daysInRange, addDaysYmd,
} from './usageFormat'
import { downloadUserUsagePdf } from './usageReportPdf'

// "Usage & Activity" section in the user drawer. Renders whatever
// user_usage_summary(user, start, end) returns — active time, sessions,
// time-by-page, a daily chart, and the sessions table — plus a vector-PDF
// download for the selected range. Admin-only (the RPC rejects non-admins;
// the drawer also gates this on isAdmin).

export default function UsageActivityPanel({ user }) {
  const toast = useToast()
  const [range, setRange] = useState(null) // { start, end, label } from the control
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!user?.id || !range?.start || !range?.end) return
    let stale = false
    setLoading(true); setError(false)
    supabase.rpc('user_usage_summary', { p_user: user.id, p_start: range.start, p_end: range.end })
      .then(({ data: d, error: e }) => {
        if (stale) return
        if (e) { setError(true); setData(null) }
        else setData(d || null)
      })
      .catch(() => { if (!stale) { setError(true); setData(null) } })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [user?.id, range?.start, range?.end])

  const empty = data && (!data.active_seconds || (data.session_list || []).length === 0)

  async function download() {
    if (!data || downloading) return
    setDownloading(true)
    try {
      await downloadUserUsagePdf(data)
    } catch (e) {
      toast.error("Couldn't generate the report", e)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">Usage &amp; Activity</h4>
        <button
          onClick={download}
          disabled={!data || empty || downloading}
          className="px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          title="Download this user's usage report (PDF)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
          {downloading ? 'Preparing…' : 'Download report'}
        </button>
      </div>

      <UsageRangeControl onChange={setRange} />

      {loading ? (
        <div className="h-40 rounded-2xl bg-gray-100 dark:bg-white/[0.03] animate-pulse" />
      ) : error ? (
        <div className={S.errorBox}>Couldn&apos;t load usage for this range.</div>
      ) : !data ? null : empty ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-white/10 p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-slate-400">No activity recorded in this range yet.</p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Usage builds up as this person navigates the app.</p>
        </div>
      ) : (
        <>
          <StatCards data={data} range={range} />
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <TimeByPage rows={data.by_page || []} />
            <DailyChart byDay={data.by_day || []} range={range} />
          </div>
          <SessionsTable rows={data.session_list || []} />
        </>
      )}
    </div>
  )
}

function StatCards({ data, range }) {
  const activeDays = data.active_days ?? 0
  const totalDays = daysInRange(range?.start, range?.end)
  const lastPage = (data.session_list || []).find(s => s.ended === 'live')?.last_page
    || (data.by_page || [])[0]?.label
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
      {/* Green hero — active time */}
      <div className="col-span-2 sm:col-span-1 rounded-2xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/60 dark:bg-emerald-500/[0.08] px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700/70 dark:text-emerald-400/70">Active time</p>
        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono leading-tight mt-0.5">{fmtActive(data.active_seconds)}</p>
      </div>
      <Stat label="Sessions" value={data.sessions ?? 0} />
      <Stat label="Avg session" value={fmtActive(data.avg_session_seconds)} />
      <Stat label="Active days" value={`${activeDays} / ${totalDays}`} sub="days in range" />
      <Stat
        label="Last active"
        value={fmtRelative(data.last_active)}
        sub={lastPage ? `on ${lastPage}` : undefined}
      />
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className={`${S.card} px-4 py-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white font-mono leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

function TimeByPage({ rows }) {
  const top = rows[0]?.seconds || 1
  if (rows.length === 0) return null
  return (
    <div className={`${S.card} p-4`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2.5">Time by page</p>
      <div className="space-y-2">
        {rows.slice(0, 12).map((r, i) => (
          <div key={r.page_key || r.label || i} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-gray-700 dark:text-slate-300 truncate" title={r.label}>{r.label}</span>
            <div className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-orange-400 dark:bg-orange-500" style={{ width: `${Math.max(3, Math.round((r.seconds / top) * 100))}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right text-xs font-mono text-gray-500 dark:text-slate-400">{fmtActive(r.seconds)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DailyChart({ byDay, range }) {
  // One bar per day across the whole range (zero-fill days with no activity),
  // capped so a very long custom range stays readable. (React Compiler
  // memoizes this component, so no manual useMemo is needed.)
  const days = []
  if (range?.start && range?.end) {
    const map = new Map((byDay || []).map(d => [d.day, Number(d.seconds) || 0]))
    let cur = range.start
    let guard = 0
    while (cur <= range.end && guard < 120) { days.push({ day: cur, seconds: map.get(cur) || 0 }); cur = addDaysYmd(cur, 1); guard++ }
  }

  const max = Math.max(1, ...days.map(d => d.seconds))
  if (days.length === 0) return null
  const showLetters = days.length <= 31
  return (
    <div className={`${S.card} p-4`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2.5">Daily active time</p>
      <div className="flex items-end gap-1 h-24">
        {days.map(d => (
          <div key={d.day} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group" title={`${fmtDayShort(d.day)} · ${fmtActiveCompact(d.seconds)}`}>
            <div
              className="w-full rounded-t bg-orange-300 dark:bg-orange-500/70 group-hover:bg-orange-400 dark:group-hover:bg-orange-500 transition-colors"
              style={{ height: `${d.seconds > 0 ? Math.max(4, Math.round((d.seconds / max) * 100)) : 0}%` }}
            />
          </div>
        ))}
      </div>
      {showLetters && (
        <div className="flex gap-1 mt-1">
          {days.map(d => (
            <span key={d.day} className="flex-1 min-w-0 text-center text-[9px] text-gray-400 dark:text-slate-600">{fmtWeekdayLetter(d.day)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionsTable({ rows }) {
  if (rows.length === 0) return null
  return (
    <div className={`${S.card} overflow-hidden`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 px-4 pt-3 pb-2">Sessions</p>
      <div className="max-h-[32rem] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white dark:bg-[#0d0d1f] border-y border-gray-100 dark:border-white/5 text-gray-400 dark:text-slate-500">
            <tr>
              <th className="text-left font-semibold px-3 py-2">Date</th>
              <th className="text-left font-semibold px-2 py-2">Signed in</th>
              <th className="text-right font-semibold px-2 py-2">Active</th>
              <th className="text-right font-semibold px-2 py-2">Pages</th>
              <th className="text-left font-semibold px-3 py-2">Flow</th>
              <th className="text-left font-semibold px-3 py-2">Ended</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const badge = endedBadge(s.ended)
              return (
                <tr key={i} className="border-b border-gray-50 dark:border-white/[0.03]">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-slate-300">{fmtDayLong(s.date || s.start)}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-gray-500 dark:text-slate-400">{fmtTime(s.start)}</td>
                  <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-slate-300">{fmtActive(s.active_seconds)}</td>
                  <td className="px-2 py-2 text-right font-mono text-gray-500 dark:text-slate-400">{s.pages ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-slate-400 truncate max-w-[140px]" title={`${s.first_page || '—'} → ${s.last_page || '—'}`}>
                    {s.first_page || '—'} <span className="text-gray-300 dark:text-slate-600">→</span> {s.last_page || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
