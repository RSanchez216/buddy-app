import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import { StagePill, OWNERSHIP_STAGES, OperationalStatusPill } from './fleetUtils'
import Select from '../../components/Select'
import CopyButton from '../../components/CopyButton'
import TruckTrailerFormModal from './TruckTrailerFormModal'
import FleetUploadModal from './upload/FleetUploadModal'
import EquipmentAssignmentsUploadModal from './upload/EquipmentAssignmentsUploadModal'

// Trucks master list. Filter pills by ownership stage, click-to-sort on
// key columns, extended search across unit/VIN/plate/driver/owner. The
// Upload Excel button opens the multi-stage upload modal.

const STAGE_PILLS = [
  { key: 'all',                          label: 'All',                  icon: '' },
  ...OWNERSHIP_STAGES.map(s => ({ key: s.value, label: s.label, icon: s.icon })),
]

const SORT_FIELDS = {
  unit_number:     (r) => (r.unit_number || '').toLowerCase(),
  vin:             (r) => (r.vin || '').toLowerCase(),
  year:            (r) => r.year ?? -Infinity,
  ownership_stage: (r) => r.ownership_stage || '',
  driver:          (r) => (r.driver?.full_name || '').toLowerCase(),
}

export default function TrucksList() {
  const { canEdit } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  // Default hides archived; user can switch to 'archived' or 'all' to see them.
  const [opStatusFilter, setOpStatusFilter] = useState('active_inactive')
  const [sortField, setSortField] = useState('unit_number')
  const [sortDir, setSortDir] = useState('asc')
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showAssignmentsUpload, setShowAssignmentsUpload] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('trucks')
      .select('*, driver:drivers(id, full_name)')
      .order('unit_number')
    setRows(data || [])
    setLoading(false)
  }

  const stageCounts = useMemo(() => {
    const c = { all: rows.length }
    for (const s of OWNERSHIP_STAGES) c[s.value] = 0
    for (const r of rows) {
      if (c[r.ownership_stage] !== undefined) c[r.ownership_stage]++
    }
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const stageBase = stageFilter === 'all' ? rows : rows.filter(r => r.ownership_stage === stageFilter)
    // operational_status filter. 'active_inactive' is the default and hides
    // archived; the all-rows path keeps archived. Defensive default to
    // 'active' so legacy rows with a NULL column (shouldn't happen — DB
    // default is 'active' — but defensive) still show up.
    const base = opStatusFilter === 'all'
      ? stageBase
      : opStatusFilter === 'active_inactive'
        ? stageBase.filter(r => (r.operational_status || 'active') !== 'archived')
        : opStatusFilter === 'idle'
          // Idle = active with no current driver. driver_id is kept in
          // sync with the open assignment by the source-of-truth
          // resolver, so this is the precise definition.
          ? stageBase.filter(r => (r.operational_status || 'active') === 'active' && !r.driver_id)
          : stageBase.filter(r => (r.operational_status || 'active') === opStatusFilter)
    const searched = q ? base.filter(r =>
      (r.unit_number || '').toLowerCase().includes(q) ||
      (r.vin || '').toLowerCase().includes(q) ||
      (r.make || '').toLowerCase().includes(q) ||
      (r.model || '').toLowerCase().includes(q) ||
      (r.license_plate || '').toLowerCase().includes(q) ||
      (r.equipment_owner_raw || '').toLowerCase().includes(q) ||
      (r.driver?.full_name || '').toLowerCase().includes(q)
    ) : base
    const fn = SORT_FIELDS[sortField] || SORT_FIELDS.unit_number
    const dir = sortDir === 'desc' ? -1 : 1
    return [...searched].sort((a, b) => {
      const va = fn(a); const vb = fn(b)
      if (va < vb) return -1 * dir
      if (va > vb) return  1 * dir
      return 0
    })
  }, [rows, filter, stageFilter, opStatusFilter, sortField, sortDir])

  function toggleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field); setSortDir('asc')
    }
  }

  function openAdd() { setEditItem(null); setShowModal(true) }
  function openEdit(r) { setEditItem(r); setShowModal(true) }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trucks</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Fleet inventory — upload a TMS Excel export or add rows manually
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-orange-500 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-xl transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Upload Excel
            </button>
            <button
              onClick={() => setShowAssignmentsUpload(true)}
              title="Upload the TMS Truck Assignments export to refresh assignment history + current drivers"
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-cyan-500 text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 rounded-xl transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6 1.87a4 4 0 100-8 4 4 0 000 8z" /></svg>
              Upload Assignments
            </button>
            <button onClick={openAdd} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Truck
            </button>
          </div>
        )}
      </div>

      {/* Stage filter pills */}
      <div className="flex items-center flex-wrap gap-2">
        {STAGE_PILLS.map(p => {
          const active = stageFilter === p.key
          return (
            <button
              key={p.key}
              onClick={() => setStageFilter(p.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                active
                  ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              {p.icon} {p.label} <span className="ml-1 opacity-70">{stageCounts[p.key] ?? 0}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-slate-500">
          Showing {filtered.length} of {rows.length} truck{rows.length === 1 ? '' : 's'}
        </p>
        <div className="flex items-center gap-2">
          <Select value={opStatusFilter} onChange={e => setOpStatusFilter(e.target.value)} className="text-xs">
            <option value="active_inactive">Active + Inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
            <option value="archived">Archived only</option>
            <option value="all">All (incl. archived)</option>
            <option value="idle">⚠️ Idle (no driver)</option>
          </Select>
          <input
            className={`${S.input} max-w-xs`}
            placeholder="Search unit, VIN, plate, owner, driver…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <SortableTh field="unit_number" label="Unit #" sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[110px]" />
                <SortableTh field="vin"         label="VIN"    sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[170px]" />
                <SortableTh field="year"        label="Year / Make / Model" sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[160px]" />
                <SortableTh field="driver"      label="Driver" sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[160px]" />
                <SortableTh field="ownership_stage" label="Ownership Stage" sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[180px]" />
                <th className={`${S.th} min-w-[100px]`} title="Operational state — user-managed, survives uploads">Status</th>
                <th className={`${S.th} min-w-[160px]`}>Carrier</th>
                <th className={`${S.th} min-w-[120px]`}>License</th>
                <th className={`${S.th} text-right`}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">
                  {rows.length === 0
                    ? "No trucks yet. Click 'Upload Excel' to import a TMS export or 'Add Truck' to add one manually."
                    : 'No trucks match these filters.'}
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className={`group ${S.tableRow}`}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                    <Link to={`/fleet/trucks/${r.id}`} className="hover:text-orange-600 dark:hover:text-orange-400">
                      {r.unit_number || '—'}
                    </Link>
                  </td>
                  <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>
                    {r.vin
                      ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{r.vin}</span>
                          <CopyButton value={r.vin} label="Copy VIN" />
                        </span>
                      )
                      : '—'}
                  </td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>
                    {[r.year, r.make, r.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.driver?.full_name || '—'}</td>
                  <td className={S.td}><StagePill stage={r.ownership_stage} /></td>
                  <td className={S.td}><OperationalStatusPill status={r.operational_status} /></td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{r.carrier || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs whitespace-nowrap`}>
                    {r.license_plate ? `${r.license_plate}${r.license_state ? ` (${r.license_state})` : ''}` : '—'}
                  </td>
                  <td className={`${S.td} text-right whitespace-nowrap`}>
                    {canEdit && (
                      <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 mr-3" title="Edit">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                    )}
                    <Link to={`/fleet/trucks/${r.id}`} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400" title="View detail">
                      <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" /></svg>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TruckTrailerFormModal
        kind="truck"
        open={showModal}
        editItem={editItem}
        onClose={() => setShowModal(false)}
        onSaved={() => { setShowModal(false); load() }}
      />
      <FleetUploadModal
        kind="truck"
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onCommitted={() => load()}
      />
      <EquipmentAssignmentsUploadModal
        equipmentType="truck"
        open={showAssignmentsUpload}
        onClose={() => setShowAssignmentsUpload(false)}
        onCommitted={() => load()}
      />
    </div>
  )
}

function SortableTh({ field, label, sortField, sortDir, onToggle, minW }) {
  const active = sortField === field
  return (
    <th className={`${S.th} ${minW || ''}`}>
      <button onClick={() => onToggle(field)} className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-slate-200">
        {label}
        {active && (
          <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
        )}
      </button>
    </th>
  )
}
