import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import KpiCards from './components/KpiCards'
import WarningPanels from './components/WarningPanels'
import PurchasesTable from './components/PurchasesTable'
import PurchaseFormModal from './components/PurchaseFormModal'

const FILTERS = [
  { id: 'all',         label: 'All' },
  { id: 'active',      label: 'Active' },
  { id: 'behind',      label: 'Behind' },
  { id: 'fully_paid',  label: 'Fully paid' },
  { id: 'cancelled',   label: 'Cancelled' },
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
    // Behind needs Phase 3 reconciliation data — always 0 in Phase 1
    return { all: rows.length, active, behind: 0, fully_paid: fullyPaid, cancelled }
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
    else if (filter === 'behind') list = []  // Phase 3

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(r =>
        (r.driver_name || '').toLowerCase().includes(q) ||
        (r.truck_number || '').toLowerCase().includes(q) ||
        (r.vin || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, filter, search])

  const underwaterRows = useMemo(() => rows.filter(r => r.is_underwater), [rows])

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

          <WarningPanels behindRows={[]} underwaterRows={underwaterRows} />

          {/* Filter chips + search */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={S.filterBtn(filter === f.id)}
                >
                  {f.label}
                  <span className="ml-1.5 text-xs opacity-70">{counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search driver, truck, or VIN…"
                className={`${S.input} pl-8 w-72`}
              />
              <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <PurchasesTable rows={visible} />
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
