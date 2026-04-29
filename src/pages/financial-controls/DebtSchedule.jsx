import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Select from '../../components/Select'
import {
  FC, STATUS_LABELS, LOAN_STATUSES,
  loanStatusPill, daysBehindCellClass,
  fmtMoney, fmtMoneyCompact, fmtDate,
} from './loanUtils'
import AddLoanModal from './AddLoanModal'

function KpiCard({ label, value, accent = 'orange' }) {
  const accents = {
    orange: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10',
    cyan:   'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10',
    red:    'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
    green:  'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
    gray:   'text-gray-600 dark:text-slate-400 bg-gray-50 dark:bg-slate-700/40',
  }
  return (
    <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-4 hover:border-gray-300 dark:hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">{label}</p>
        <span className={`w-2 h-2 rounded-full ${accents[accent].split(' ').filter(c => c.startsWith('bg-')).join(' ')}`} />
      </div>
      <p className={`text-xl font-bold ${accents[accent].split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>{value}</p>
    </div>
  )
}

export default function DebtSchedule() {
  const { profile } = useAuth()
  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

  const [loans, setLoans] = useState([])
  const [equipmentByLoan, setEquipmentByLoan] = useState({})
  const [entities, setEntities] = useState([])
  const [lenders, setLenders] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  const [search, setSearch] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterLender, setFilterLender] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterEquipType, setFilterEquipType] = useState('')
  const [pastDueOnly, setPastDueOnly] = useState(false)
  const [groupByEntity, setGroupByEntity] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [loanRes, eqRes, entRes, lndRes] = await Promise.all([
      supabase.from('v_loans_summary').select('*').order('next_due_date', { ascending: true, nullsFirst: false }),
      supabase.from('loan_equipment').select('id, loan_id, unit_number, vin, equipment_type, make, model, year'),
      supabase.from('loan_entities').select('id, name').eq('is_active', true).order('name'),
      supabase.from('loan_lenders').select('id, name').eq('is_active', true).order('name'),
    ])
    setLoans(loanRes.data || [])
    const grouped = {}
    for (const e of (eqRes.data || [])) {
      if (!grouped[e.loan_id]) grouped[e.loan_id] = []
      grouped[e.loan_id].push(e)
    }
    setEquipmentByLoan(grouped)
    setEntities(entRes.data || [])
    setLenders(lndRes.data || [])
    setLoading(false)
  }

  const equipmentTypes = useMemo(() => {
    const set = new Set()
    Object.values(equipmentByLoan).forEach(arr => arr.forEach(e => e.equipment_type && set.add(e.equipment_type)))
    return [...set].sort()
  }, [equipmentByLoan])

  // Apply filters + global search; tag each loan with searchHit info
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return loans
      .map(l => {
        let hit = null
        if (q) {
          const eq = equipmentByLoan[l.id] || []
          if (l.loan_id_external && l.loan_id_external.toLowerCase().includes(q)) hit = { field: 'Loan ID', value: l.loan_id_external }
          else if (l.contract_number && l.contract_number.toLowerCase().includes(q)) hit = { field: 'Contract', value: l.contract_number }
          else {
            const vinMatch = eq.find(e => e.vin && e.vin.toLowerCase().includes(q))
            if (vinMatch) hit = { field: 'VIN', value: vinMatch.vin }
            else {
              const unitMatch = eq.find(e => e.unit_number && e.unit_number.toLowerCase().includes(q))
              if (unitMatch) hit = { field: 'Unit', value: unitMatch.unit_number }
              else {
                const mmMatch = eq.find(e => (e.make && e.make.toLowerCase().includes(q)) || (e.model && e.model.toLowerCase().includes(q)))
                if (mmMatch) hit = { field: 'Equipment', value: [mmMatch.make, mmMatch.model].filter(Boolean).join(' ') }
              }
            }
          }
          if (!hit) return null
        }
        if (filterEntity && l.entity_id !== filterEntity) return null
        if (filterLender && l.lender_id !== filterLender) return null
        if (filterStatus && l.status !== filterStatus) return null
        if (pastDueOnly && (!l.days_behind || l.days_behind <= 0)) return null
        if (filterEquipType) {
          const eq = equipmentByLoan[l.id] || []
          if (!eq.some(e => e.equipment_type === filterEquipType)) return null
        }
        return { ...l, _hit: hit }
      })
      .filter(Boolean)
  }, [loans, equipmentByLoan, search, filterEntity, filterLender, filterStatus, filterEquipType, pastDueOnly])

  // KPIs
  const kpis = useMemo(() => {
    const yearStart = new Date(); yearStart.setMonth(0, 1); yearStart.setHours(0, 0, 0, 0)
    return {
      activeDebt: loans.filter(l => l.status === 'active').reduce((s, l) => s + Number(l.current_balance || 0), 0),
      monthlyService: loans.filter(l => l.status === 'active').reduce((s, l) => s + Number(l.monthly_payment || 0), 0),
      activeLoans: loans.filter(l => l.status === 'active').length,
      pastDue: loans.filter(l => l.status === 'active' && Number(l.days_behind) > 0).length,
      paidOffYTD: loans.filter(l => l.status === 'paid_off' && l.updated_at && new Date(l.updated_at) >= yearStart).length,
    }
  }, [loans])

  // Group view: by entity
  const grouped = useMemo(() => {
    if (!groupByEntity) return null
    const map = {}
    for (const l of filtered) {
      const key = l.entity_name || 'Unassigned'
      if (!map[key]) map[key] = []
      map[key].push(l)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered, groupByEntity])

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Financial Controls
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Debt Schedule</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">{loans.length} total loans • {kpis.activeLoans} active</p>
        </div>
        {canEdit && (
          <button onClick={() => setShowAdd(true)} className={FC.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Loan
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Active Debt" value={fmtMoneyCompact(kpis.activeDebt)} accent="orange" />
        <KpiCard label="Monthly Debt Service" value={fmtMoneyCompact(kpis.monthlyService)} accent="cyan" />
        <KpiCard label="# Active Loans" value={kpis.activeLoans} accent="green" />
        <KpiCard label="# Past Due" value={kpis.pastDue} accent="red" />
        <KpiCard label="Paid Off YTD" value={kpis.paidOffYTD} accent="gray" />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search Loan ID, Contract, VIN, Unit, Make/Model…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${S.input} w-80`}
        />
        <Select value={filterEntity} onChange={e => setFilterEntity(e.target.value)}>
          <option value="">All Entities</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select value={filterLender} onChange={e => setFilterLender(e.target.value)}>
          <option value="">All Lenders</option>
          {lenders.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {LOAN_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
        <Select value={filterEquipType} onChange={e => setFilterEquipType(e.target.value)}>
          <option value="">All Equipment Types</option>
          {equipmentTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
        <button
          onClick={() => setPastDueOnly(v => !v)}
          className={S.filterBtn(pastDueOnly)}
        >
          Past Due Only
        </button>
        <button
          onClick={() => setGroupByEntity(v => !v)}
          className={S.filterBtn(groupByEntity)}
        >
          {groupByEntity ? 'Grouped by Entity' : 'Flat View'}
        </button>
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Loan ID', 'Entity', 'Lender', 'Equipment', 'Monthly Pmt', 'Balance', 'Next Due', 'Days Behind', 'Status'].map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            {grouped ? (
              grouped.map(([entityName, rows]) => (
                <GroupedBody
                  key={entityName}
                  entityName={entityName}
                  rows={rows}
                  equipmentByLoan={equipmentByLoan}
                />
              ))
            ) : (
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No loans found</td></tr>
                ) : filtered.map(l => (
                  <LoanRow key={l.id} loan={l} equipment={equipmentByLoan[l.id] || []} />
                ))}
              </tbody>
            )}
          </table>
        </div>
      </div>

      <AddLoanModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => loadData()} />
    </div>
  )
}

function GroupedBody({ entityName, rows, equipmentByLoan }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <thead>
        <tr
          className="bg-gray-50 dark:bg-white/[0.02] border-b border-gray-100 dark:border-white/5 cursor-pointer"
          onClick={() => setOpen(o => !o)}
        >
          <td colSpan={9} className="px-4 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-slate-300 uppercase tracking-wide">
              <svg className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {entityName}
              <span className="text-gray-400 dark:text-slate-500 font-normal normal-case">({rows.length} loans)</span>
            </div>
          </td>
        </tr>
      </thead>
      {open && (
        <tbody>
          {rows.map(l => <LoanRow key={l.id} loan={l} equipment={equipmentByLoan[l.id] || []} />)}
        </tbody>
      )}
    </>
  )
}

function LoanRow({ loan, equipment }) {
  const days = Number(loan.days_behind) || 0
  const eqCount = equipment.length
  const primaryType = (() => {
    if (!equipment.length) return null
    const counts = {}
    equipment.forEach(e => { if (e.equipment_type) counts[e.equipment_type] = (counts[e.equipment_type] || 0) + 1 })
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return best?.[0] || null
  })()

  return (
    <tr className={S.tableRow}>
      <td className={`${S.td} font-medium`}>
        <Link to={`/financial-controls/debt-schedule/${loan.id}`} className="text-gray-900 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400 transition-colors">
          {loan.loan_id_external || '—'}
        </Link>
        {loan._hit && (
          <div className="text-[10px] text-orange-600 dark:text-orange-400 font-normal mt-0.5">
            matched on {loan._hit.field}: {loan._hit.value}
          </div>
        )}
        {loan.contract_number && (
          <div className="text-[10px] text-gray-400 dark:text-slate-600 font-mono mt-0.5">{loan.contract_number}</div>
        )}
      </td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{loan.entity_name || '—'}</td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{loan.lender_name || '—'}</td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>
        {eqCount > 0 ? (
          <span>
            <span className="font-medium text-gray-700 dark:text-slate-300">{eqCount}</span>
            {primaryType && <span className="text-gray-400 dark:text-slate-500 ml-1">({primaryType})</span>}
          </span>
        ) : <span className="text-gray-300 dark:text-slate-600">—</span>}
      </td>
      <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(loan.monthly_payment)}</td>
      <td className={`${S.td} font-mono text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{fmtMoney(loan.current_balance)}</td>
      <td className={`${S.td} text-gray-600 dark:text-slate-400 whitespace-nowrap`}>{fmtDate(loan.next_due_date)}</td>
      <td className={`${S.td} font-semibold whitespace-nowrap ${daysBehindCellClass(days)}`}>
        {days > 0 ? `${days}d` : '0'}
      </td>
      <td className={S.td}>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${loanStatusPill(loan.status)}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
          {STATUS_LABELS[loan.status] || loan.status}
        </span>
      </td>
    </tr>
  )
}
