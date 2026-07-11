import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { S } from '../../../lib/styles'
import StatusPill from './StatusPill'

function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtFreq(f) {
  if (!f) return ''
  if (f === 'weekly') return '/wk'
  if (f === 'biweekly') return '/2wk'
  if (f === 'monthly') return '/mo'
  return ''
}

// Relative-time label for the Last Charged column. days_since_last_payment
// is straight off v_driver_purchase_summary; last_charged_date is the
// absolute date for the tooltip.
function relativeLastCharged(days) {
  const d = Number(days)
  if (!Number.isFinite(d)) return null
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d <= 30) return `${d} days ago`
  if (d <= 60) return `${Math.floor(d / 7)} weeks ago`
  return `${Math.floor(d / 30)} months ago`
}

// Frequency-aware unit label for the Behind column. Singular/plural,
// abbreviated to fit the cell on narrow viewports.
function behindUnit(periods, frequency) {
  const n = Number(periods) || 0
  if (n <= 0) return null
  const unit = frequency === 'monthly' ? 'mo'
             : frequency === 'biweekly' ? 'biwk'
             : 'wk'
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

// Color thresholds for the Behind column. 1 period = amber, 2 = darker
// amber, 3+ = red+semibold. Mirrors the LAST CHARGED column's escalating
// urgency.
function behindToneClass(periods) {
  const n = Number(periods) || 0
  if (n >= 3) return 'text-red-600 dark:text-red-400 font-semibold'
  if (n === 2) return 'text-amber-700 dark:text-amber-400 font-medium'
  if (n === 1) return 'text-amber-600 dark:text-amber-400'
  return 'text-gray-400 dark:text-slate-600'
}

// Passive overdue signal — amber when slightly past the expected cadence,
// red when clearly past. Thresholds picked to give one cadence cycle of
// grace before going red (per the spec).
function lastChargedToneClass(days, frequency) {
  const d = Number(days)
  if (!Number.isFinite(d)) return ''
  if (frequency === 'monthly') {
    if (d >= 45) return 'text-red-600 dark:text-red-400 font-medium'
    if (d >= 32) return 'text-amber-600 dark:text-amber-400'
  } else if (frequency === 'biweekly') {
    if (d >= 21) return 'text-red-600 dark:text-red-400 font-medium'
    if (d >= 15) return 'text-amber-600 dark:text-amber-400'
  } else {
    // weekly (default)
    if (d >= 14) return 'text-red-600 dark:text-red-400 font-medium'
    if (d >= 8) return 'text-amber-600 dark:text-amber-400'
  }
  return ''
}

// Absolute-date tooltip (e.g. "May 4, 2026") for hover on the relative
// "6 days ago" string. Date-only ISO strings need the T00:00:00 anchor
// or they get UTC-interpreted into the previous day in negative TZs.
function fmtAbsDate(iso) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Sortable column header — clicking cycles asc → desc → off. Matches
// the DebtSchedule pattern for app-wide consistency.
function SortableTh({ label, columnKey, sortKey, sortDir, onSort, align = 'left' }) {
  const active = sortKey === columnKey
  return (
    <th
      className={`${S.th} cursor-pointer select-none hover:text-gray-700 dark:hover:text-slate-300`}
      onClick={() => onSort(columnKey)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {label}
        <span className={`text-[9px] leading-none ${active ? 'text-orange-500' : 'text-gray-300 dark:text-slate-700'}`}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  )
}

export default function PurchasesTable({
  rows = [],
  sortKey = null,
  sortDir = 'desc',
  onSort = () => {},
  canEdit = false,
  inlineBusy = false,
  onInlineReconcile = () => {},
}) {
  const navigate = useNavigate()
  // Tracks which row's overflow menu is currently open. One-at-a-time —
  // click outside or Escape closes.
  const [openMenuRow, setOpenMenuRow] = useState(null)
  useEffect(() => {
    if (!openMenuRow) return
    function onDocClick(e) {
      if (!e.target.closest('[data-overflow-menu]')) setOpenMenuRow(null)
    }
    function onKey(e) { if (e.key === 'Escape') setOpenMenuRow(null) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuRow])
  if (rows.length === 0) {
    return (
      <div className={`${S.card} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className={S.tableHead}>
            <tr>
              <SortableTh label="Driver / unit"  columnKey="driver_name"        sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh label="Status"         columnKey="status"             sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh label="Payment"        columnKey="payment_amount"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh label="Balance"        columnKey="current_balance"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh label="Behind"         columnKey="periods_behind"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <th className={S.th} aria-label="Quick action" />
              <SortableTh label="Last charged"   columnKey="last_charged_date"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh label="Last update"    columnKey="last_update_at"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortableTh label="Linked"         columnKey="linked"             sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-slate-600">
                No driver purchases yet. Phase 2 will import historical records from ClickUp.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={`${S.card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className={S.tableHead}>
          <tr>
            <SortableTh label="Driver / unit"  columnKey="driver_name"        sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="Status"         columnKey="status"             sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="Payment"        columnKey="payment_amount"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="Balance"        columnKey="current_balance"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="Behind"         columnKey="periods_behind"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <th className={S.th} aria-label="Quick action" />
            <SortableTh label="Last charged"   columnKey="last_charged_date"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="Last update"    columnKey="last_update_at"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh label="Linked"         columnKey="linked"             sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => navigate(`/financial-controls/driver-purchases/${r.id}`)}
              className={`${S.tableRow} cursor-pointer`}
            >
              <td className={S.td}>
                <div className="font-medium text-gray-900 dark:text-slate-200">
                  {r.driver_internal_id && (
                    <span className="text-gray-500 dark:text-slate-500 font-mono font-normal mr-1.5">#{r.driver_internal_id}</span>
                  )}
                  {r.driver_internal_id && <span className="text-gray-400 dark:text-slate-600 font-normal mr-1.5">·</span>}
                  {r.driver_name}
                </div>
                {r.truck_number && (
                  <div className="text-xs text-gray-500 dark:text-slate-500 font-mono">
                    Unit - {r.truck_number}
                  </div>
                )}
              </td>
              <td className={S.td}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusPill name={r.status_name} colorHex={r.status_color} />
                  {r.title_release_pending && <TitlePendingBadge />}
                </div>
              </td>
              <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300`}>
                {r.payment_amount ? fmtMoney(r.payment_amount) : '—'}
                <span className="text-xs text-gray-400 dark:text-slate-500">{fmtFreq(r.payment_frequency)}</span>
              </td>
              <td className={`${S.td} font-mono text-gray-900 dark:text-slate-200`}>
                {fmtMoney(r.current_balance)}
              </td>
              <td className={S.td}>
                {(() => {
                  const n = Number(r.periods_behind) || 0
                  const label = behindUnit(n, r.payment_frequency)
                  const dollars = Number(r.amount_behind) || 0
                  const skipped = Number(r.skipped_count_recent) || 0
                  const skippedTotal = Number(r.skipped_count_total) || 0
                  // Soft skipped pill rides alongside the BEHIND value
                  // (or stands alone when behind=0). They're independent
                  // signals — BEHIND = needs follow-up, SKIPPED = by
                  // agreement, no follow-up needed. The pill click
                  // bubbles to the row's navigate(detail) handler so
                  // no extra wiring is needed.
                  return (
                    <div className="flex flex-col gap-0.5 items-start">
                      {label ? (
                        <span
                          className={`text-xs ${behindToneClass(n)}`}
                          title={`${dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} owed across ${n} ${n === 1 ? 'period' : 'periods'}`}
                        >
                          {label}
                        </span>
                      ) : skipped === 0 ? (
                        <span className="text-xs text-gray-400 dark:text-slate-600">—</span>
                      ) : null}
                      {skipped > 0 && (
                        <span
                          className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 whitespace-nowrap"
                          title={`${skipped} skipped in last 90 days. ${skippedTotal} total. Click for details.`}
                        >
                          {skipped} skipped
                        </span>
                      )}
                    </div>
                  )
                })()}
              </td>
              <td className={S.td} onClick={e => e.stopPropagation()}>
                <QuickActionCell
                  row={r}
                  canEdit={canEdit}
                  inlineBusy={inlineBusy}
                  menuOpen={openMenuRow === r.id}
                  onOpenMenu={() => setOpenMenuRow(openMenuRow === r.id ? null : r.id)}
                  onCloseMenu={() => setOpenMenuRow(null)}
                  onInlineReconcile={() => onInlineReconcile(r)}
                  onOpenRecord={() => { setOpenMenuRow(null); navigate(`/financial-controls/driver-purchases/${r.id}?record=1`) }}
                  onOpenContract={() => { setOpenMenuRow(null); navigate(`/financial-controls/driver-purchases/${r.id}`) }}
                />
              </td>
              <td className={`${S.td} whitespace-nowrap`}>
                {r.last_charged_date ? (
                  <span
                    className={`text-xs ${lastChargedToneClass(r.days_since_last_payment, r.payment_frequency) || 'text-gray-500 dark:text-slate-500'}`}
                    title={fmtAbsDate(r.last_charged_date)}
                  >
                    {relativeLastCharged(r.days_since_last_payment) || fmtAbsDate(r.last_charged_date)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-slate-600" title="No payments recorded yet">—</span>
                )}
              </td>
              <td className={`${S.td} whitespace-nowrap`}>
                {r.last_update_at ? (
                  <div className="text-xs leading-tight">
                    <div className="text-gray-700 dark:text-slate-300">{fmtAbsDate(r.last_update_at)}</div>
                    {r.last_update_by && (
                      <div className="text-gray-400 dark:text-slate-500">{r.last_update_by}</div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-slate-600" title="No activity recorded yet">—</span>
                )}
              </td>
              <td className={`${S.td} whitespace-nowrap`}>
                {r.underlying_loan_id ? (
                  <div className="text-xs">
                    <div className="text-gray-700 dark:text-slate-300">{r.underlying_lender_name || '—'}</div>
                    <div className="font-mono text-gray-400 dark:text-slate-500">{r.underlying_loan_number || ''}</div>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-slate-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Inline reconcile cell + overflow menu. Click semantics mirror the
// payment-history reconcile circle:
//   • next_record_target_id present     → empty circle, combo action
//   • next_reconcile_only_target_id     → amber dot, reconcile-only
//   • neither (active contract)         → muted green ✓ ("caught up")
//   • terminal status                   → blank
// The ⋯ overflow menu is the escape hatch — opens the detail page's
// Record Payment modal (via ?record=1) for partial/off-cycle cases,
// or just navigates to the detail page.
function QuickActionCell({
  row,
  canEdit,
  inlineBusy,
  menuOpen,
  onOpenMenu,
  onCloseMenu,
  onInlineReconcile,
  onOpenRecord,
  onOpenContract,
}) {
  // Terminal contracts get nothing — no payments expected, no action.
  // is_terminal includes Fully Paid, but a Fully-Paid-but-title-not-
  // transferred contract still has the title-pending badge over in the
  // STATUS column, so leaving this cell blank is fine.
  if (row.is_terminal) return null

  const hasRecordTarget = !!row.next_record_target_id
  const hasReconcileOnly = !hasRecordTarget && !!row.next_reconcile_only_target_id
  const caughtUp = !hasRecordTarget && !hasReconcileOnly

  const circle = (() => {
    if (hasRecordTarget) {
      const amount = Number(row.next_record_target_amount || 0)
      const ps = row.next_record_target_period_start
      const pe = row.next_record_target_period_end
      const tip = `Record ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} for ${fmtAbsDate(ps)} – ${fmtAbsDate(pe)}`
      return (
        <button
          type="button"
          onClick={onInlineReconcile}
          disabled={!canEdit || inlineBusy}
          title={tip}
          aria-label={tip}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-gray-300 dark:text-slate-600 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-500 dark:hover:text-slate-400 transition-colors disabled:opacity-50"
        >○</button>
      )
    }
    if (hasReconcileOnly) {
      const amount = Number(row.next_reconcile_only_target_amount || 0)
      const ps = row.next_reconcile_only_target_period_start
      const pe = row.next_reconcile_only_target_period_end
      const tip = `Reconcile ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} recorded for ${fmtAbsDate(ps)} – ${fmtAbsDate(pe)}`
      return (
        <button
          type="button"
          onClick={onInlineReconcile}
          disabled={!canEdit || inlineBusy}
          title={tip}
          aria-label={tip}
          className="w-6 h-6 inline-flex items-center justify-center rounded text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors disabled:opacity-50"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 inline-block" />
        </button>
      )
    }
    // caughtUp
    return (
      <span
        title="All payments up to date."
        aria-label="All payments up to date"
        className="w-6 h-6 inline-flex items-center justify-center text-emerald-500/70 dark:text-emerald-400/70 text-sm"
      >✓</span>
    )
  })()

  return (
    <div className="relative inline-flex items-center gap-0.5" data-overflow-menu>
      {circle}
      {canEdit && (
        <button
          type="button"
          onClick={onOpenMenu}
          title="More actions"
          aria-label="More actions"
          className="w-5 h-6 inline-flex items-center justify-center text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 rounded"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
          </svg>
        </button>
      )}
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-48 rounded-lg bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-xl py-1"
        >
          <button
            role="menuitem"
            onClick={onOpenRecord}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-slate-300"
          >
            Record payment (custom)…
          </button>
          <button
            role="menuitem"
            onClick={onOpenContract}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-slate-300"
          >
            Open contract
          </button>
        </div>
      )}
    </div>
  )
}

// Compact amber pill — KeyRound icon + "Title pending" — shown next to
// the StatusPill on rows where the driver is paid off but the physical
// title hand-off hasn't been recorded yet. Spottable while scrolling
// without needing to filter.
function TitlePendingBadge() {
  return (
    <span
      title="Driver fully paid — title not yet handed over"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 whitespace-nowrap"
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7.5" cy="15.5" r="5.5" />
        <path d="m21 2-9.6 9.6" />
        <path d="m15.5 7.5 3 3L22 7l-3-3" />
      </svg>
      Title pending
    </span>
  )
}
