import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import { StagePill } from './fleetUtils'
import TruckTrailerFormModal from './TruckTrailerFormModal'

// Trucks master list. Joins to drivers for name display. Add modal opens
// the shared TruckTrailerFormModal with kind="truck". Edit opens the same
// modal seeded with the row.

export default function TrucksList() {
  const { canEdit } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)

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

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows
    const q = filter.toLowerCase()
    return rows.filter(r =>
      (r.unit_number || '').toLowerCase().includes(q) ||
      (r.vin || '').toLowerCase().includes(q) ||
      (r.make || '').toLowerCase().includes(q) ||
      (r.model || '').toLowerCase().includes(q) ||
      (r.license_plate || '').toLowerCase().includes(q) ||
      (r.driver?.full_name || '').toLowerCase().includes(q)
    )
  }, [rows, filter])

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
            Fleet inventory — manual entry only in this version
          </p>
        </div>
        {canEdit && (
          <button onClick={openAdd} className={S.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Truck
          </button>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-slate-500">
          {rows.length} truck{rows.length === 1 ? '' : 's'}
        </p>
        <input
          className={`${S.input} max-w-xs`}
          placeholder="Search unit, VIN, plate, driver…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <th className={`${S.th} min-w-[110px]`}>Unit #</th>
                <th className={`${S.th} min-w-[170px]`}>VIN</th>
                <th className={`${S.th} min-w-[160px]`}>Year / Make / Model</th>
                <th className={`${S.th} min-w-[160px]`}>Driver</th>
                <th className={`${S.th} min-w-[180px]`}>Ownership Stage</th>
                <th className={`${S.th} min-w-[160px]`}>Carrier</th>
                <th className={`${S.th} min-w-[120px]`}>License</th>
                <th className={`${S.th} text-right`}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">
                  {rows.length === 0
                    ? "No trucks yet. Click 'Add Truck' to add your first one, or wait for PR 2 to upload an Excel report."
                    : 'No trucks match this filter.'}
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                    <Link to={`/fleet/trucks/${r.id}`} className="hover:text-orange-600 dark:hover:text-orange-400">
                      {r.unit_number || '—'}
                    </Link>
                  </td>
                  <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>{r.vin || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>
                    {[r.year, r.make, r.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{r.driver?.full_name || '—'}</td>
                  <td className={S.td}><StagePill stage={r.ownership_stage} /></td>
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
    </div>
  )
}
