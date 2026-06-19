import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import { DriverTypePill, DriverStatusPill, DRIVER_STATUSES, fmtCompensation, monogram, nameHue } from './fleetUtils'
import DriverFormModal from './DriverFormModal'
import DriversUploadModal from './upload/DriversUploadModal'
import CopyButton from '../../components/CopyButton'

const STATUS_PILLS = [
  { key: 'all',        label: 'All',        icon: '' },
  ...DRIVER_STATUSES.map(s => ({ key: s.value, label: s.label, icon: s.icon })),
]

const SORT_FIELDS = {
  internal_id:    (r) => (r.internal_id || '').padStart(8, '0'),
  full_name:      (r) => (r.full_name || '').toLowerCase(),
  driver_type:    (r) => r.driver_type || '',
  carrier:        (r) => r.carrier || '',
  current_status: (r) => r.current_status || '',
}

export default function DriversList() {
  const { canEdit } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [photoFilter, setPhotoFilter] = useState(null)
  const [sortField, setSortField] = useState('full_name')
  const [sortDir, setSortDir] = useState('asc')
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [photoUrls, setPhotoUrls] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('drivers').select('*, photo_path').order('full_name')
    setRows(data || [])

    // Load signed URLs for drivers with photos (batch)
    if (data?.length) {
      const withPhotos = data.filter(d => d.photo_path)
      if (withPhotos.length > 0) {
        try {
          const { data: urls, error } = await supabase.storage
            .from('driver-avatars')
            .createSignedUrls(
              withPhotos.map(d => d.photo_path),
              3600
            )
          if (!error && urls) {
            const urlMap = {}
            urls.forEach((url, idx) => {
              if (url?.signedUrl) {
                urlMap[withPhotos[idx].id] = url.signedUrl
              }
            })
            setPhotoUrls(urlMap)
          }
        } catch (err) {
          console.error('Failed to load photo URLs:', err)
        }
      }
    }

    setLoading(false)
  }

  const statusCounts = useMemo(() => {
    const c = { all: rows.length }
    for (const s of DRIVER_STATUSES) c[s.value] = 0
    for (const r of rows) {
      if (c[r.current_status] !== undefined) c[r.current_status]++
    }
    return c
  }, [rows])

  const missingPhotoCount = useMemo(() => {
    const base = statusFilter === 'all' ? rows : rows.filter(r => r.current_status === statusFilter)
    return base.filter(r => !r.photo_path).length
  }, [rows, statusFilter])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const base = statusFilter === 'all' ? rows : rows.filter(r => r.current_status === statusFilter)
    let result = q ? base.filter(r =>
      (r.internal_id || '').toLowerCase().includes(q) ||
      (r.full_name || '').toLowerCase().includes(q) ||
      (r.phone || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.truck_assignment_raw || '').toLowerCase().includes(q) ||
      (r.trailer_assignment_raw || '').toLowerCase().includes(q) ||
      (r.carrier || '').toLowerCase().includes(q)
    ) : base

    if (photoFilter === 'missing') {
      result = result.filter(r => !r.photo_path)
    }

    const fn = SORT_FIELDS[sortField] || SORT_FIELDS.full_name
    const dir = sortDir === 'desc' ? -1 : 1
    return [...result].sort((a, b) => {
      const va = fn(a); const vb = fn(b)
      if (va < vb) return -1 * dir
      if (va > vb) return  1 * dir
      return 0
    })
  }, [rows, filter, statusFilter, photoFilter, sortField, sortDir])

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Drivers</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Driver master — upload to refresh weekly
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
            <button onClick={openAdd} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Driver
            </button>
          </div>
        )}
      </div>

      {/* Status pills */}
      <div className="flex items-center flex-wrap gap-2">
        {STATUS_PILLS.map(p => {
          const active = statusFilter === p.key
          return (
            <button
              key={p.key}
              onClick={() => { setStatusFilter(p.key); setPhotoFilter(null) }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                active
                  ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                  : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
              }`}
            >
              {p.icon} {p.label} <span className="ml-1 opacity-70">{statusCounts[p.key] ?? 0}</span>
            </button>
          )
        })}
        {missingPhotoCount > 0 && (
          <button
            onClick={() => setPhotoFilter(photoFilter === 'missing' ? null : 'missing')}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors flex items-center gap-1 ${
              photoFilter === 'missing'
                ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                : 'border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
            }`}
          >
            📷 Missing photos <span className="font-semibold ml-1">{missingPhotoCount}</span>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-gray-500 dark:text-slate-500">
          Showing {filtered.length} of {rows.length} driver{rows.length === 1 ? '' : 's'}{photoFilter === 'missing' && ` · ${missingPhotoCount} missing photo${missingPhotoCount === 1 ? '' : 's'}`}
        </p>
        <input
          className={`${S.input} max-w-xs`}
          placeholder="Search ID, name, phone, email, truck, trailer…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <SortableTh field="internal_id"    label="ID#"             sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[80px]" />
                <SortableTh field="full_name"      label="Full Name"       sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[200px]" />
                <SortableTh field="driver_type"    label="Driver Type"     sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[140px]" />
                <SortableTh field="carrier"        label="Carrier"         sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[180px]" />
                <th className={`${S.th} min-w-[80px]`}>Truck</th>
                <th className={`${S.th} min-w-[80px]`}>Trailer</th>
                <th className={`${S.th} min-w-[180px]`}>Compensation</th>
                <SortableTh field="current_status" label="Status"          sortField={sortField} sortDir={sortDir} onToggle={toggleSort} minW="min-w-[120px]" />
                <th className={`${S.th} min-w-[130px]`}>Phone</th>
                <th className={`${S.th} min-w-[180px]`}>Email</th>
                <th className={`${S.th} text-right`}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">
                  {rows.length === 0
                    ? "No drivers yet. Click 'Upload Excel' to import from your TMS export, or 'Add Driver' to add one manually."
                    : 'No drivers match these filters.'}
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className={`group ${S.tableRow}`}>
                  <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>{r.internal_id || '—'}</td>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                    <span className="inline-flex items-center gap-2">
                      <PhotoIndicator driver={r} photoUrl={photoUrls[r.id]} onUploadClick={() => openEdit(r)} />
                      <span className="inline-flex items-center gap-1.5">
                        <Link to={`/fleet/drivers/${r.id}`} className="hover:text-orange-600 dark:hover:text-orange-400">
                          {r.full_name || '—'}
                        </Link>
                        {r.full_name && <CopyButton value={r.full_name} label="Copy name" />}
                      </span>
                    </span>
                  </td>
                  <td className={S.td}><DriverTypePill type={r.driver_type} short /></td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{r.carrier || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 font-mono text-xs`}>{r.truck_assignment_raw || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 font-mono text-xs`}>{r.trailer_assignment_raw || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{r.compensation_raw || fmtCompensation(r)}</td>
                  <td className={S.td}><DriverStatusPill status={r.current_status} /></td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap`}>{r.phone || '—'}</td>
                  <td
                    className={`${S.td} text-gray-500 dark:text-slate-400 text-xs max-w-[220px] truncate`}
                    title={r.email || ''}
                  >
                    {r.email || '—'}
                  </td>
                  <td className={`${S.td} text-right whitespace-nowrap`}>
                    {canEdit && (
                      <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 mr-3" title="Edit">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                    )}
                    <Link to={`/fleet/drivers/${r.id}`} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400" title="View detail">
                      <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" /></svg>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <DriverFormModal
        open={showModal}
        editItem={editItem}
        onClose={() => setShowModal(false)}
        onSaved={() => { setShowModal(false); load() }}
      />
      <DriversUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
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
        {active && <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  )
}

function PhotoIndicator({ driver, photoUrl, onUploadClick }) {
  const [imageError, setImageError] = useState(false)

  if (driver.photo_path && photoUrl && !imageError) {
    return (
      <div className="relative inline-block shrink-0">
        <img
          src={photoUrl}
          alt={driver.full_name}
          onError={() => setImageError(true)}
          className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-slate-700"
        />
        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-white dark:border-slate-900 flex items-center justify-center">
          <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      </div>
    )
  }

  // Fallback to initials
  if (driver.photo_path && !photoUrl) {
    const h = nameHue(driver.full_name || '')
    const initialsGradient = `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 42) % 360} 68% 34%))`
    return (
      <div
        className="w-8 h-8 rounded-full border border-gray-200 dark:border-slate-700 flex items-center justify-center text-[10px] font-bold text-white shrink-0"
        style={{ background: initialsGradient }}
      >
        {monogram(driver.full_name || '')}
      </div>
    )
  }

  // No photo - show camera icon button
  return (
    <button
      onClick={onUploadClick}
      className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center text-gray-400 dark:text-slate-500 hover:border-orange-500 hover:text-orange-500 dark:hover:border-orange-400 dark:hover:text-orange-400 transition-colors shrink-0"
      title="Click to upload photo"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    </button>
  )
}
