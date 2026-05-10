import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import KpiCards from './components/KpiCards'
import WarningPanels from './components/WarningPanels'
import PurchasesTable from './components/PurchasesTable'
import PurchaseFormModal from './components/PurchaseFormModal'

// Columns the user can sort by, with their default first-click direction.
// Anything else in the URL falls back to the application default (last
// charged DESC), keeping bookmarked URLs robust against typos.
const SORT_DEFAULT_DIR = {
  driver_name:       'asc',
  status:            'desc',
  payment_amount:    'asc',
  current_balance:   'desc',
  last_charged_date: 'desc',
  linked:            'desc',
}

// Returns the final signed result for the (a, b, direction) triple,
// already accounting for direction. Returning final-signed (vs. raw +
// caller-multiplies) lets us pin NULLS LAST regardless of asc/desc:
// the null branches return a fixed +1/-1 instead of being flipped by
// the caller.
function compareByKey(a, b, key, dir) {
  const flip = dir === 'asc' ? 1 : -1
  if (key === 'status') {
    // Composite: active rows always group on top, then alphabetical by
    // status_name. The direction flip only affects the alphabetical
    // half — active-first is invariant.
    const aActive = a.is_active_state ? 1 : 0
    const bActive = b.is_active_state ? 1 : 0
    if (aActive !== bActive) return bActive - aActive
    return (a.status_name || '').localeCompare(b.status_name || '') * flip
  }
  if (key === 'linked') {
    const av = a.underlying_loan_id ? 1 : 0
    const bv = b.underlying_loan_id ? 1 : 0
    return (av - bv) * flip
  }
  if (key === 'driver_name') {
    return (a.driver_name || '').localeCompare(b.driver_name || '') * flip
  }
  if (key === 'payment_amount' || key === 'current_balance') {
    return (Number(a[key] || 0) - Number(b[key] || 0)) * flip
  }
  if (key === 'last_charged_date') {
    const av = a.last_charged_date
    const bv = b.last_charged_date
    if (!av && !bv) return 0
    if (!av) return 1   // NULLS LAST regardless of dir
    if (!bv) return -1
    return (av < bv ? -1 : av > bv ? 1 : 0) * flip
  }
  return 0
}

const FILTERS = [
  { id: 'all',            label: 'All' },
  { id: 'active',         label: 'Active' },
  { id: 'behind',         label: 'Behind' },
  { id: 'fully_paid',     label: 'Fully paid' },
  { id: 'title_pending',  label: 'Title pending', tone: 'amber' },
  { id: 'cancelled',      label: 'Cancelled' },
]

export default function DriverPurchasesPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)

  // Sort state lives in the URL so refresh + back-from-detail preserve
  // it. sortKey === null means "no user sort applied" → the default
  // last_charged_date DESC NULLS LAST ordering kicks in.
  const [searchParams, setSearchParams] = useSearchParams()
  const rawKey = searchParams.get('sort')
  const rawDir = searchParams.get('dir')
  const sortKey = rawKey && SORT_DEFAULT_DIR[rawKey] ? rawKey : null
  const sortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : (sortKey ? SORT_DEFAULT_DIR[sortKey] : 'desc')

  // 3-state cycle: unsorted → default direction → reverse → cleared.
  // Clicking a different column starts fresh on its default direction.
  function handleSort(nextKey) {
    if (!SORT_DEFAULT_DIR[nextKey]) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (sortKey !== nextKey) {
        next.set('sort', nextKey)
        next.set('dir', SORT_DEFAULT_DIR[nextKey])
      } else if (sortDir === SORT_DEFAULT_DIR[nextKey]) {
        // Currently at default direction → flip to opposite
        next.set('dir', SORT_DEFAULT_DIR[nextKey] === 'asc' ? 'desc' : 'asc')
      } else {
        // Already flipped → clear
        next.delete('sort')
        next.delete('dir')
      }
      return next
    }, { replace: true })
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_driver_purchase_summary')
      .select('*')
      .order('driver_name')
    if (error) {
      console.error('Driver purchases load error:', error)
      setRows([])
    } else {
      setRows(data || [])
    }
    setLoading(false)
  }

  // Counts per filter chip — computed off the unfiltered set
  const counts = useMemo(() => {
    const active     = rows.filter(r => r.is_active_state).length
    const fullyPaid  = rows.filter(r => r.status_name === 'Fully Paid').length
    const cancelled  = rows.filter(r =>
      r.status_name === 'Contract Broken' ||
      r.status_name === 'Driver Left' ||
      r.status_name === 'Owner Left'
    ).length
    const behind = rows.filter(r => r.is_behind).length
    const titlePending = rows.filter(r => r.title_release_pending).length
    return {
      all: rows.length, active, behind,
      fully_paid: fullyPaid, title_pending: titlePending, cancelled,
    }
  }, [rows])

  const visible = useMemo(() => {
    let list = rows
    if (filter === 'active')      list = list.filter(r => r.is_active_state)
    else if (filter === 'fully_paid') list = list.filter(r => r.status_name === 'Fully Paid')
    else if (filter === 'cancelled')  list = list.filter(r =>
      r.status_name === 'Contract Broken' ||
      r.status_name === 'Driver Left' ||
      r.status_name === 'Owner Left'
    )
    else if (filter === 'behind') list = list.filter(r => r.is_behind)
    else if (filter === 'title_pending') list = list.filter(r => r.title_release_pending)

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(r =>
        (r.driver_name || '').toLowerCase().includes(q) ||
        (r.truck_number || '').toLowerCase().includes(q) ||
        (r.vin || '').toLowerCase().includes(q)
      )
    }

    // Apply sort. When no user sort is set, default to most-recently-
    // charged at the top with never-charged contracts at the bottom
    // (compareByKey pins nulls last regardless of direction).
    const effectiveKey = sortKey || 'last_charged_date'
    const effectiveDir = sortKey ? sortDir : 'desc'
    const sorted = [...list].sort((a, b) => {
      const cmp = compareByKey(a, b, effectiveKey, effectiveDir)
      // Tiebreaker on driver_name keeps sort output stable when the
      // primary key ties (common for $0 balances, status groups, etc).
      if (cmp !== 0) return cmp
      return (a.driver_name || '').localeCompare(b.driver_name || '')
    })
    return sorted
  }, [rows, filter, search, sortKey, sortDir])

  const underwaterRows = useMemo(() => rows.filter(r => r.is_underwater), [rows])

  // Fully paid + title not yet handed to driver. Sorted oldest-first so
  // the longest-overdue hand-offs surface at the top of the panel.
  const titlePendingRows = useMemo(() => {
    return rows
      .filter(r => r.title_release_pending)
      .sort((a, b) => {
        const da = a.fully_paid_date || a.updated_at || ''
        const db = b.fully_paid_date || b.updated_at || ''
        return da.localeCompare(db)
      })
  }, [rows])

  // Behind = view's is_behind flag, sorted by amount_behind desc so the
  // most severe contracts surface first. Each row carries amount_behind
  // and periods_behind so the warning panel can render a meaningful
  // secondary metric ("3 wks · $3,000").
  const behindRows = useMemo(() => {
    return rows
      .filter(r => r.is_behind)
      .map(r => ({
        ...r,
        // Friendly secondary string consumed by WarningPanels via its
        // existing { primary, secondary } shape — but we now also pass
        // the raw amount/periods through so the panel can format.
        periods_behind: Number(r.periods_behind || 0),
        amount_behind: Number(r.amount_behind || 0),
      }))
      .sort((a, b) => b.amount_behind - a.amount_behind)
  }, [rows])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Financial Controls
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Driver Purchases</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Trucks and trailers sold to drivers, collected via payroll deduction.
          </p>
        </div>

        {canEdit && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl text-white bg-orange-500 hover:bg-orange-400 transition-all shadow-lg shadow-orange-500/20"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New purchase
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
        </div>
      ) : (
        <>
          <KpiCards rows={rows} />

          <WarningPanels
            behindRows={behindRows}
            underwaterRows={underwaterRows}
            titlePendingRows={titlePendingRows}
          />

          {/* Filter chips + search */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {FILTERS.map(f => {
                const isActive = filter === f.id
                // Amber-toned chips echo the title-release alert so the
                // visual relationship between panel ↔ chip ↔ badge is
                // obvious. Other chips keep the default cyan accent.
                const cls = f.tone === 'amber'
                  ? `px-3 py-1.5 text-sm rounded-xl border transition-colors ${
                      isActive
                        ? 'bg-amber-100 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300'
                        : 'border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                    }`
                  : S.filterBtn(isActive)
                return (
                  <button key={f.id} onClick={() => setFilter(f.id)} className={cls}>
                    {f.label}
                    <span className="ml-1.5 text-xs opacity-70">{counts[f.id] ?? 0}</span>
                  </button>
                )
              })}
            </div>
            <div className="relative">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search driver, unit, or VIN…"
                className={`${S.input} pl-8 w-72`}
              />
              <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <PurchasesTable
            rows={visible}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
          />
        </>
      )}

      <PurchaseFormModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onSaved={(newId) => {
          setShowNew(false)
          if (newId) navigate(`/financial-controls/driver-purchases/${newId}`)
        }}
      />
    </div>
  )
}
