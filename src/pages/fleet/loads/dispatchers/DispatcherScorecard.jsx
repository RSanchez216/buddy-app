import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { S } from '../../../../lib/styles'
import { useAuth } from '../../../../contexts/AuthContext'
import { useToast } from '../../../../contexts/ToastContext'
import DeskDrawer from './DeskDrawer'
import {
  fetchScorecard, fetchAmazonBookers, computeFloors, deskRead, surfaceFocus, bookerTier,
  periodLabel, stepAnchor, isCurrentPeriod, anchorForRpc, todayISO,
  fetchReviews, fetchReviewsRange, setDispatcherReview, fetchUserNames, deskKeyOf,
  periodBounds, periodLabelShort, monthShort,
  money, perDriver, rpm, int, pct,
} from './dispatcherData'

const GRAINS = [['month', 'Monthly'], ['quarter', 'Quarterly'], ['half', 'Six-month'], ['year', 'Yearly']]
const VALID_GRAINS = new Set(GRAINS.map(g => g[0]))

const PILL = {
  red:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  green: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
}
const TAG = {
  red:   'bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
}
// 4px left accent keyed to the focus-card / read severity.
const BORDER = { red: 'border-l-red-500', amber: 'border-l-amber-500', green: 'border-l-emerald-500' }

export default function DispatcherScorecard() {
  const [params, setParams] = useSearchParams()
  const grain = VALID_GRAINS.has(params.get('grain')) ? params.get('grain') : 'month'
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get('anchor') || '') ? params.get('anchor') : todayISO()

  const { profile, user } = useAuth()
  const toast = useToast()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [rows, setRows] = useState(null)
  const [bookers, setBookers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0) // bumped by Retry to re-run the fetch
  const [selectedDesk, setSelectedDesk] = useState(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'gross', dir: 'desc' })
  // Monthly review sign-offs — interactive on the Monthly grain.
  const [reviews, setReviews] = useState({})           // desk_key → { reviewed, note, reviewed_by, reviewed_at }
  const [reviewerNames, setReviewerNames] = useState({}) // user_id → display name
  // Multi-month roll-up (Quarter/Half/Year) — desk_key → [{ period_month, reviewed, note }].
  const [reviewRollup, setReviewRollup] = useState({})
  const [reviewTab, setReviewTab] = useState('all')    // all | reviewed | to_review
  const [exportingPdf, setExportingPdf] = useState(false)

  const isMonthly = grain === 'month'
  const monthStart = anchorForRpc('month', anchor) // period_month for the review record
  // Month-starts inside the displayed window (1 for month; 3/6/12 otherwise).
  const periodMonths = useMemo(() => periodBounds(grain, anchor).months, [grain, anchor])

  const setGrain = (g) => setParams(p => { p.set('grain', g); p.set('anchor', anchorForRpc(g, anchor)); return p }, { replace: true })
  const step = (dir) => setParams(p => { p.set('grain', grain); p.set('anchor', stepAnchor(grain, anchor, dir)); return p }, { replace: true })
  const goCurrent = () => setParams(p => { p.set('grain', grain); p.set('anchor', anchorForRpc(grain, todayISO())); return p }, { replace: true })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(''); setSelectedDesk(null)
      try {
        const [sc, bk] = await Promise.all([fetchScorecard(grain, anchor), fetchAmazonBookers(grain, anchor)])
        if (cancelled) return
        setRows(sc); setBookers(bk)
        // Monthly review sign-offs — one row per (desk, month), keyed by desk_key.
        if (grain === 'month') {
          const revs = await fetchReviews(monthStart)
          if (cancelled) return
          const byKey = {}
          revs.forEach(r => { byKey[r.desk_key] = r })
          setReviews(byKey)
          setReviewRollup({})
          setReviewerNames(await fetchUserNames(revs.map(r => r.reviewed_by)))
        } else {
          // Multi-month: roll every monthly review inside the window up per desk.
          const { start, end } = periodBounds(grain, anchor)
          const revs = await fetchReviewsRange(start, end)
          if (cancelled) return
          const byDesk = {}
          revs.forEach(r => { (byDesk[r.desk_key] || (byDesk[r.desk_key] = [])).push(r) })
          setReviewRollup(byDesk)
          setReviews({}); setReviewerNames({})
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load scorecard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [grain, anchor, reloadTick, monthStart])

  const retry = () => setReloadTick(t => t + 1)

  // Silent reconcile after a save — pulls the true reviewed_by/at stamps the RPC
  // wrote (first reviewer preserved, cleared on un-review) + any new names.
  async function refreshReviews() {
    if (grain !== 'month') return
    try {
      const revs = await fetchReviews(monthStart)
      const byKey = {}
      revs.forEach(r => { byKey[r.desk_key] = r })
      setReviews(byKey)
      const names = await fetchUserNames(revs.map(r => r.reviewed_by))
      setReviewerNames(prev => ({ ...prev, ...names }))
    } catch { /* keep the optimistic state */ }
  }

  // Shared review write used by the table checkmark and the drawer panel.
  // patch = { reviewed?, note? }; the unspecified field keeps its current value.
  // Optimistic; returns true on success, false on error (rolls back + toasts).
  async function saveReview(deskKey, patch) {
    const cur = reviews[deskKey] || {}
    const nextReviewed = patch.reviewed != null ? patch.reviewed : !!cur.reviewed
    const nextNote = patch.note != null ? patch.note : (cur.note || '')
    const prev = reviews
    setReviews(r => ({
      ...r,
      [deskKey]: {
        ...cur, reviewed: nextReviewed, note: nextNote,
        reviewed_by: nextReviewed ? (cur.reviewed_by ?? user?.id ?? null) : null,
        reviewed_at: nextReviewed ? (cur.reviewed_at ?? new Date().toISOString()) : null,
      },
    }))
    // Surface the current user's name immediately (before the reconcile fetch)
    // so the drawer's "Reviewed · by {name}" line isn't briefly nameless.
    if (nextReviewed && user?.id) {
      setReviewerNames(n => n[user.id] ? n : { ...n, [user.id]: profile?.full_name || profile?.email || 'You' })
    }
    try {
      await setDispatcherReview(deskKey, monthStart, nextReviewed, nextNote)
      refreshReviews()
      return true
    } catch (e) {
      setReviews(prev)
      toast.error("Couldn't save the review", e)
      return false
    }
  }

  // Grain word for the partial-period notice.
  const PERIOD_WORD = { month: 'month', quarter: 'quarter', half: 'half', year: 'year' }

  // The selected period is still "in progress" when it's the current one — its
  // gross (and therefore the vs-prior delta) is partial, so we suppress deltas
  // and keep them out of the read.
  const inProgress = isCurrentPeriod(grain, anchor)

  const desks = useMemo(() => (rows || []).filter(r => !r.is_amazon_team), [rows])
  const amazon = useMemo(() => (rows || []).find(r => r.is_amazon_team) || null, [rows])
  const floors = useMemo(() => computeFloors(desks), [desks])
  const focus = useMemo(() => (desks.length ? surfaceFocus(desks, floors, { inProgress }) : []), [desks, floors, inProgress])

  // Company strip.
  const company = useMemo(() => {
    if (!rows?.length) return null
    const totalGross = rows.reduce((s, r) => s + Number(r.gross || 0), 0)
    const totalMiles = desks.reduce((s, r) => s + Number(r.miles || 0), 0)
    const totalTurn = rows.reduce((s, r) => s + Number(r.turnover || 0), 0)
    const allDeltas = rows.every(r => r.gross_delta_pct != null)
    const prevGross = allDeltas ? rows.reduce((s, r) => s + Number(r.prev_gross || 0), 0) : null
    // Suppress the delta on an in-progress period — it's partial-vs-full.
    const grossDelta = (inProgress || !prevGross) ? null : ((totalGross - prevGross) / prevGross) * 100
    return {
      totalGross, activeDesks: desks.length,
      blendedRpm: totalMiles > 0 ? totalGross / totalMiles : 0, // company-wide gross ÷ desk miles
      floorRpm: floors.floorRpm, totalTurn, grossDelta,
    }
  }, [rows, desks, floors, inProgress])

  // Roll a desk's monthly reviews up over the displayed window: a pip per month
  // (green when that month is reviewed), the X/N count, and the months' notes
  // (month-prefixed, most recent first). Also serves the Monthly grain (N=1).
  const deskRollup = useCallback((d) => {
    const key = deskKeyOf(d)
    const rows = isMonthly ? (reviews[key] ? [{ period_month: monthStart, ...reviews[key] }] : []) : (reviewRollup[key] || [])
    const byMonth = {}
    rows.forEach(r => { byMonth[r.period_month] = r })
    const pips = periodMonths.map(m => ({ month: m, reviewed: !!byMonth[m]?.reviewed }))
    const reviewedCount = pips.filter(p => p.reviewed).length
    const notes = rows.filter(r => r.note && r.note.trim())
      .sort((a, b) => String(b.period_month).localeCompare(String(a.period_month)))
      .map(r => `${monthShort(r.period_month)}: ${r.note.trim()}`)
    return { pips, reviewedCount, total: periodMonths.length, notes }
  }, [isMonthly, reviews, reviewRollup, periodMonths, monthStart])

  // "Reviewed" for the filter/progress = fully reviewed (every month signed off).
  const isFullyReviewed = useCallback((d) => {
    const { reviewedCount, total } = deskRollup(d)
    return total > 0 && reviewedCount === total
  }, [deskRollup])

  // Progress — X of N desks (fully) reviewed for the window.
  const reviewProgress = useMemo(() => ({
    reviewed: desks.filter(isFullyReviewed).length,
    total: desks.length,
  }), [desks, isFullyReviewed])

  // Search + review-tab filter + sort the leaderboard.
  const shownDesks = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q ? desks.filter(d => d.desk_name.toLowerCase().includes(q)) : [...desks]
    if (reviewTab !== 'all') {
      list = list.filter(d => (reviewTab === 'reviewed' ? isFullyReviewed(d) : !isFullyReviewed(d)))
    }
    const key = sort.key
    const get = (d) => key === 'desk' ? d.desk_name.toLowerCase()
      : key === 'reviewed' ? deskRollup(d).reviewedCount
      : key === 'per_driver_month' ? Number(d.per_driver_month || 0)
      : Number(d[key] || 0)
    list.sort((a, b) => {
      const av = get(a), bv = get(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return list
  }, [desks, search, sort, reviewTab, isFullyReviewed, deskRollup])

  const toggleSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'desk' ? 'asc' : 'desc' })
  const arrow = (key) => sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : ''

  // PDF report (all grains) — header stats + focus cards + full desk table with
  // the manager's sign-off (Monthly: ✓/— + note; multi-month: the X/N roll-up +
  // month-prefixed notes). Client-side jsPDF + autoTable (dynamic import so the
  // libs don't bloat this page's bundle). Numeric RGB fills per the app's
  // Recharts→PDF convention.
  async function generatePdf() {
    if (exportingPdf || !company) return
    setExportingPdf(true)
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
      const autoTable = autoTableMod.default
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      const periodTitle = periodLabelShort(grain, anchor)
      const M = 40

      doc.setFontSize(16); doc.setTextColor(20)
      doc.text(`Dispatcher Scorecard — ${periodTitle}`, M, 40)
      doc.setFontSize(10); doc.setTextColor(110)
      doc.text(
        `Total Gross: ${money(company.totalGross)}      Active Desks: ${int(company.activeDesks)}      Blended RPM: ${rpm(company.blendedRpm)}      Total Departed: ${int(company.totalTurn)}`,
        M, 60,
      )

      let y = 82
      if (focus.length > 0) {
        doc.setFontSize(12); doc.setTextColor(20); doc.text('Desks to focus on', M, y)
        autoTable(doc, {
          startY: y + 8,
          head: [['Desk', 'Flag', 'Why']],
          body: focus.map(c => [c.desk.desk_name, c.tag, c.reason]),
          styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
          headStyles: { fillColor: [234, 88, 12] },
          columnStyles: { 2: { cellWidth: 460 } },
          margin: { left: M, right: M },
        })
        y = doc.lastAutoTable.finalY + 18
      }

      doc.setFontSize(12); doc.setTextColor(20); doc.text('All active desks', M, y)
      const reportDesks = [...desks].sort((a, b) => Number(b.gross) - Number(a.gross))
      autoTable(doc, {
        startY: y + 8,
        head: [['Desk', 'Gross', '$/drv·mo', 'Departed', 'RPM', 'Read', 'Reviewed', 'Notes']],
        body: reportDesks.map(d => {
          const base = [
            d.desk_name, money(d.gross), perDriver(d.per_driver_month), int(d.turnover), rpm(d.rpm),
            deskRead(d, floors, { inProgress }).label,
          ]
          if (isMonthly) {
            const rev = reviews[deskKeyOf(d)] || {}
            return [...base, rev.reviewed ? 'Yes' : 'No', rev.note || '']
          }
          const ru = deskRollup(d)
          const months = ru.pips.filter(p => p.reviewed).map(p => monthShort(p.month)).join(', ')
          const reviewedCell = `${ru.reviewedCount}/${ru.total} months${months ? ` (${months})` : ''}`
          return [...base, reviewedCell, ru.notes.join('\n')]
        }),
        styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [234, 88, 12] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 7: { cellWidth: 220 } },
        margin: { left: M, right: M },
      })

      const who = profile?.full_name || profile?.email || 'Unknown'
      const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date())
      doc.setFontSize(8); doc.setTextColor(150)
      doc.text(`Generated ${today} by ${who}`, M, doc.internal.pageSize.getHeight() - 20)
      doc.save(`Dispatcher Review - ${periodTitle}.pdf`)
    } catch (e) {
      toast.error("Couldn't generate the PDF", e)
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet · People
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dispatcher Scorecard</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5 max-w-3xl">
          Gross is billed freight credited to the booking desk — roughly 56% is owner-op pass-through Manas doesn&apos;t keep, so read it as booking <span className="font-medium">volume</span>, not profit.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 text-sm">
          {GRAINS.map(([k, lbl]) => (
            <button key={k} onClick={() => setGrain(k)}
              className={`px-3 py-1.5 whitespace-nowrap ${grain === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-700 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => step(-1)} className={S.btnSecondary} aria-label="Previous period">◀</button>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold text-gray-900 dark:text-white">{periodLabel(grain, anchor)}</span>
          <button onClick={() => step(1)} disabled={inProgress} className={`${S.btnSecondary} disabled:opacity-40`} aria-label="Next period">▶</button>
          {!inProgress && <button onClick={goCurrent} className={S.btnSecondary}>Current</button>}
          {inProgress && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" /> in progress · to date
            </span>
          )}
        </div>
        {/* PDF report — stats, focus cards, and the full desk table with each
            desk's review sign-off (roll-up on multi-month grains). */}
        <button
          onClick={generatePdf}
          disabled={exportingPdf || loading || !rows?.length}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40"
          title="Generate a PDF report for this period"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
          {exportingPdf ? 'Generating…' : 'Generate PDF'}
        </button>
      </div>

      {/* Partial-period notice — the selected window hasn't finished yet, so the
          numbers are year-to-date and read low. Real and correct, just partial. */}
      {inProgress && !loading && !error && (
        <div className="flex items-center gap-2 text-[13px] text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2">
          <svg className="w-4 h-4 shrink-0 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          This is all we have so far; the {PERIOD_WORD[grain] || 'period'} is not completed.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
      ) : error ? (
        <div className={`${S.card} p-10 text-center`}>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">Couldn&apos;t load the scorecard.</p>
          <button onClick={retry} className={S.btnSecondary}>Retry</button>
        </div>
      ) : !rows?.length ? (
        <div className={`${S.card} p-10 text-center text-gray-400 dark:text-slate-600`}>No dispatcher activity in {periodLabel(grain, anchor)}.</div>
      ) : (
        <>
          {/* Company strip */}
          {company && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Kpi label="Total gross" value={money(company.totalGross)} delta={company.grossDelta} sub={inProgress ? `${periodLabel(grain, anchor).replace(/ ·.*/, '')} to date` : undefined} accent="orange" />
              <Kpi label="Active desks" value={int(company.activeDesks)} />
              <Kpi label="Blended RPM" value={rpm(company.blendedRpm)} sub={`floor ${rpm(company.floorRpm)}`} />
              <Kpi label="Total departed" value={int(company.totalTurn)} sub="drivers left" />
            </div>
          )}

          {/* Desks to focus on */}
          {focus.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Desks to focus on</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {focus.map(c => (
                  <button key={c.desk.desk_id} onClick={() => setSelectedDesk(c.desk)}
                    className={`${S.card} border-l-4 ${BORDER[c.tone]} p-4 text-left hover:border-orange-300 dark:hover:border-orange-500/40 transition-colors`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-gray-900 dark:text-white truncate">{c.desk.desk_name}</span>
                      <span className={`shrink-0 text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${TAG[c.tone]}`}>{c.tag}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-snug mb-3 min-h-[2.5rem]">{c.reason}</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <Metric label="Gross" value={money(c.desk.gross)} />
                      <Metric label="$/drv·mo" value={perDriver(c.desk.per_driver_month)} />
                      <Metric label="RPM" value={rpm(c.desk.rpm)} />
                      <Metric label="Departed" value={int(c.desk.turnover)} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* All active desks */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">All active desks ({desks.length})</h2>
                <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
                  {[['all', 'All'], ['reviewed', 'Reviewed'], ['to_review', 'To review']].map(([k, lbl]) => (
                    <button key={k} onClick={() => setReviewTab(k)}
                      className={`px-2.5 py-1 whitespace-nowrap ${reviewTab === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums">
                  {reviewProgress.reviewed} of {reviewProgress.total} {isMonthly ? 'reviewed' : 'desks fully reviewed'}
                </span>
              </div>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search desks…"
                className="px-3 py-1.5 text-sm rounded-xl bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/40 w-56"
              />
            </div>
            <div className={`${S.card} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={S.tableHead}>
                    <tr>
                      <Th onClick={() => toggleSort('desk')} arrow={arrow('desk')}>Desk</Th>
                      <Th onClick={() => toggleSort('gross')} arrow={arrow('gross')} right>Gross</Th>
                      <Th onClick={() => toggleSort('per_driver_month')} arrow={arrow('per_driver_month')} right>$/driver·mo</Th>
                      <Th onClick={() => toggleSort('turnover')} arrow={arrow('turnover')} right>Departed</Th>
                      <Th onClick={() => toggleSort('rpm')} arrow={arrow('rpm')} right>RPM</Th>
                      <th className={S.th}>Read</th>
                      <Th onClick={() => toggleSort('reviewed')} arrow={arrow('reviewed')}>Reviewed</Th>
                      <th className={S.th}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDesks.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 dark:text-slate-600">No desks match this filter.</td></tr>
                    ) : shownDesks.map(d => {
                      const read = deskRead(d, floors, { inProgress })
                      const rev = reviews[deskKeyOf(d)]
                      const ru = isMonthly ? null : deskRollup(d)
                      return (
                        <tr key={d.desk_id} onClick={() => setSelectedDesk(d)} className={`${S.tableRow} cursor-pointer`}>
                          <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{d.desk_name}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-slate-200`}>
                            {money(d.gross)}
                            {!inProgress && d.gross_delta_pct != null && (
                              <span className={`ml-2 text-[11px] ${Number(d.gross_delta_pct) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pct(d.gross_delta_pct)}</span>
                            )}
                          </td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{perDriver(d.per_driver_month)}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(d.turnover)}</td>
                          <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{rpm(d.rpm)}</td>
                          <td className={S.td}>
                            <span className={`inline-block text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${PILL[read.tone]}`}>{read.label}</span>
                          </td>
                          {isMonthly ? (
                            <td className={S.td} onClick={e => e.stopPropagation()}>
                              <ReviewCheck reviewed={!!rev?.reviewed} canEdit={canEdit} onToggle={() => saveReview(deskKeyOf(d), { reviewed: !rev?.reviewed })} />
                            </td>
                          ) : (
                            <td className={S.td}><ReviewRollup rollup={ru} /></td>
                          )}
                          {isMonthly ? (
                            <td className={`${S.td} max-w-[16rem]`}>
                              {rev?.note
                                ? <span className="block text-xs text-gray-600 dark:text-slate-400 line-clamp-2" title={rev.note}>{rev.note}</span>
                                : <span className="text-xs text-gray-400 dark:text-slate-500">+ Add note</span>}
                            </td>
                          ) : (
                            <td className={`${S.td} max-w-[16rem]`}><RollupNotes notes={ru.notes} /></td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* Amazon Team card */}
          {amazon && <AmazonCard amazon={amazon} bookers={bookers} inProgress={inProgress} />}

          {/* How departures are counted */}
          <section className={`${S.card} p-5`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">How departures are counted</h3>
            <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed max-w-3xl">
              A departure is a driver actually terminated during the period (from their termination date, falling back to status
              history) — not inferred from load silence, so a driver on vacation no longer counts. Each departure is charged to one
              home desk: the desk that booked most of their recent freight. That desk wears it even if the driver&apos;s final load
              happened to run on another desk.
            </p>
          </section>

          {/* What's baked in */}
          <section className={`${S.card} p-5`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">What&apos;s baked in</h3>
            <ul className="text-sm text-gray-600 dark:text-slate-400 space-y-1.5 list-disc pl-5 max-w-3xl">
              <li>Monthly base: rosters and gross are built per month, then rolled up to the selected window.</li>
              <li>One desk per driver — the home desk — so retention isn&apos;t double-counted across desks.</li>
              <li>The Amazon team is judged as a single desk because bookings rotate among its members.</li>
              <li>Excluded/placeholder desks and desks with no drivers are hidden.</li>
              <li>Gross = billed freight credited to the booking desk (per-load), not company profit.</li>
              <li>TONU and canceled loads are excluded from gross, loads, and miles.</li>
            </ul>
          </section>
        </>
      )}

      <DeskDrawer
        open={!!selectedDesk} desk={selectedDesk} floors={floors} grain={grain} anchor={anchor} inProgress={inProgress}
        monthly={isMonthly}
        review={selectedDesk ? reviews[deskKeyOf(selectedDesk)] : null}
        reviewerName={selectedDesk ? reviewerNames[reviews[deskKeyOf(selectedDesk)]?.reviewed_by] : ''}
        canEdit={canEdit}
        monthLabel={periodLabel('month', anchor)}
        onSaveReview={saveReview}
        onClose={() => setSelectedDesk(null)}
      />
    </div>
  )
}

// Read-only roll-up of a desk's monthly sign-offs over a multi-month window:
// one pip per month (green #059669 when reviewed, gray otherwise) + an "X/N"
// count (green "N/N ✓" when full). Editing stays on the Monthly view.
function ReviewRollup({ rollup }) {
  const { pips, reviewedCount, total } = rollup
  const full = total > 0 && reviewedCount === total
  const tooltip = pips.map(p => `${monthShort(p.month)} ${p.reviewed ? '✓' : '—'}`).join(' · ')
  return (
    <span className="inline-flex items-center gap-1.5" title={tooltip}>
      <span className="inline-flex gap-[3px]">
        {pips.map((p, i) => (
          <span
            key={i}
            className={`inline-block w-[14px] h-[7px] rounded-[3px] ${p.reviewed ? '' : 'bg-gray-200 dark:bg-slate-700'}`}
            style={p.reviewed ? { background: '#059669' } : undefined}
          />
        ))}
      </span>
      <span className={`text-[11px] tabular-nums ${full ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : reviewedCount === 0 ? 'text-gray-400 dark:text-slate-500' : 'text-gray-600 dark:text-slate-300'}`}>
        {reviewedCount}/{total}{full ? ' ✓' : ''}
      </span>
    </span>
  )
}

// Constituent months' notes for a multi-month desk — latest shown with "+N" for
// the rest; full month-prefixed list on hover. "—" when there are none.
function RollupNotes({ notes }) {
  if (!notes.length) return <span className="text-xs text-gray-400 dark:text-slate-500">—</span>
  return (
    <span className="block text-xs text-gray-600 dark:text-slate-400 line-clamp-2" title={notes.join('\n')}>
      {notes[0]}{notes.length > 1 ? ` +${notes.length - 1}` : ''}
    </span>
  )
}

// ── Amazon Team card ──────────────────────────────────────────────────────────
function AmazonCard({ amazon, bookers, inProgress }) {
  const teamRpm = Number(amazon.rpm || 0)
  const TIER = {
    strong: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
    mid:    'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
    weak:   'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  }
  return (
    <section className={`${S.card} border-l-4 border-l-blue-500 p-5`}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Amazon Team</h2>
        <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20">One desk</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400 mb-4 max-w-3xl">
        Judged as one desk because bookings rotate among the team — no single member owns a load, so gross and retention are pooled.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <Kpi label="Team gross" value={money(amazon.gross)} delta={inProgress ? null : amazon.gross_delta_pct} sub={inProgress ? 'to date' : undefined} accent="blue" />
        <Kpi label="RPM" value={rpm(amazon.rpm)} />
        <Kpi label="Loads" value={int(amazon.loads)} />
        <Kpi label="Turnover" value={int(amazon.turnover)} sub="drivers left" />
      </div>
      <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Who books well</h4>
      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Booker</th>
              <th className={`${S.th} text-right`}>Gross</th>
              <th className={`${S.th} text-right`}>Loads</th>
              <th className={`${S.th} text-right`}>RPM</th>
              <th className={`${S.th} text-right`}>Drivers</th>
            </tr>
          </thead>
          <tbody>
            {bookers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 dark:text-slate-600">No bookings this period</td></tr>
            ) : bookers.map(b => {
              const tier = bookerTier(b, teamRpm)
              return (
                <tr key={b.dispatcher_id} className={S.tableRow}>
                  <td className={`${S.td} text-gray-900 dark:text-slate-200`}>
                    {b.dispatcher_name}
                    <span className={`ml-2 text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded-full border ${TIER[tier]}`}>{tier}</span>
                  </td>
                  <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-slate-200`}>{money(b.gross)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(b.loads)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{rpm(b.rpm)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-600 dark:text-slate-400`}>{int(b.drivers)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400 mt-3">
        Retention: {int(amazon.turnover)} driver{Number(amazon.turnover) === 1 ? '' : 's'} left the team this period.
      </p>
    </section>
  )
}

// ── small presentational bits ─────────────────────────────────────────────────
const KPI_ACCENT = { orange: 'border-l-4 border-l-orange-500', blue: 'border-l-4 border-l-blue-500', green: 'border-l-4 border-l-emerald-500' }
function Kpi({ label, value, sub, delta, accent }) {
  const showDelta = delta != null && Number.isFinite(Number(delta))
  return (
    <div className={`${S.card} ${accent ? KPI_ACCENT[accent] : ''} p-4`}>
      <div className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{value}</div>
      <div className="flex items-center gap-2 mt-1 min-h-[1rem]">
        {sub && <span className="text-[11px] text-gray-400 dark:text-slate-500 tabular-nums">{sub}</span>}
        {showDelta && <span className={`text-[11px] font-medium tabular-nums ${Number(delta) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pct(delta)}</span>}
      </div>
    </div>
  )
}
function Metric({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 dark:text-slate-500">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-slate-200 tabular-nums">{value}</span>
    </div>
  )
}
function Th({ children, onClick, arrow, right }) {
  return (
    <th className={`${S.th} ${right ? 'text-right' : ''} cursor-pointer select-none hover:text-gray-900 dark:hover:text-slate-200`} onClick={onClick}>
      {children}{arrow && <span className="ml-1">{arrow}</span>}
    </th>
  )
}

// Round review checkmark — empty circle when unreviewed, green check when
// reviewed. Managers get a toggle; non-managers a read-only indicator.
export function ReviewCheck({ reviewed, canEdit, onToggle }) {
  const check = (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
  const base = 'w-6 h-6 inline-flex items-center justify-center rounded-full border transition-colors'
  const on = 'bg-emerald-500 border-emerald-500 text-white'
  const off = 'border-gray-300 dark:border-slate-600 text-transparent'
  if (!canEdit) {
    return <span className={`${base} ${reviewed ? on : off}`} title={reviewed ? 'Reviewed' : 'Not reviewed'}>{check}</span>
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={reviewed}
      title={reviewed ? 'Reviewed — click to un-review' : 'Mark as reviewed'}
      className={`${base} ${reviewed ? `${on} hover:bg-emerald-600` : `${off} hover:border-emerald-400 hover:text-emerald-400`}`}
    >
      {check}
    </button>
  )
}
