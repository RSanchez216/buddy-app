import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import { DriverTypePill, DriverStatusPill, DRIVER_STATUS_LABELS, fmtDate, fmtCompensation } from './fleetUtils'
import DriverFormModal from './DriverFormModal'

export default function DriverDetail() {
  const { canEdit } = useAuth()
  const { id } = useParams()
  const [row, setRow] = useState(null)
  const [trucks, setTrucks] = useState([])
  const [trailers, setTrailers] = useState([])
  const [history, setHistory] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => { if (id) load() /* eslint-disable-line */ }, [id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('drivers').select('*').eq('id', id).maybeSingle()
    setRow(data || null)

    const [tRes, trRes, hRes, aRes] = await Promise.all([
      supabase.from('trucks').select('id, unit_number, vin, ownership_stage').eq('driver_id', id).order('unit_number'),
      supabase.from('trailers').select('id, unit_number, vin, ownership_stage, trailer_type').eq('driver_id', id).order('unit_number'),
      supabase.from('driver_status_history')
        .select('*, creator:users!driver_status_history_created_by_fkey(full_name, email)')
        .eq('driver_id', id)
        .order('occurred_at', { ascending: false }),
      // Equipment assignment history for this driver — both trucks and
      // trailers, all events, newest first. The truck:/trailer: hints
      // are tolerant of unmatched assignments (FK null when the unit was
      // gone from BUDDY at upload time).
      supabase.from('equipment_assignments')
        .select(`
          id, equipment_type, start_date, end_date, equipment_name_raw, tms_equipment_id,
          truck:trucks(id, unit_number),
          trailer:trailers(id, unit_number)
        `)
        .eq('driver_id', id)
        .order('start_date', { ascending: false }),
    ])
    setTrucks(tRes.data || [])
    setTrailers(trRes.data || [])
    setHistory(hRes.data || [])
    setAssignments(aRes.data || [])
    setLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }
  if (!row) {
    return (
      <div className="space-y-4">
        <Link to="/fleet/drivers" className="text-sm text-orange-600 hover:underline">← Back to Drivers</Link>
        <p className="text-sm text-gray-500 dark:text-slate-500">Driver not found.</p>
      </div>
    )
  }

  // Surface mismatch when the raw assignment string is set but no inventory row matches.
  const truckMismatch = !!row.truck_assignment_raw && !trucks.some(t => (t.unit_number || '').trim() === row.truck_assignment_raw.trim())
  const trailerMismatch = !!row.trailer_assignment_raw && !trailers.some(t => (t.unit_number || '').trim() === row.trailer_assignment_raw.trim())

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/fleet/drivers" className="text-xs text-orange-600 hover:underline">← Drivers</Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{row.full_name}</h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {row.internal_id && <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">#{row.internal_id}</span>}
            <DriverTypePill type={row.driver_type} />
            <DriverStatusPill status={row.current_status} />
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setShowEdit(true)} className={S.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Edit
          </button>
        )}
      </div>

      <Section title="Driver Info">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <InfoRow label="Internal ID" value={row.internal_id} mono />
          <InfoRow label="Full Name" value={row.full_name} />
          <InfoRow label="Phone" value={row.phone} />
          <InfoRow label="Email" value={row.email} />
          <InfoRow label="Driver Type" value={row.driver_type} />
          <InfoRow label="Carrier" value={row.carrier} />
          <InfoRow label="Truck Assignment (raw)" value={row.truck_assignment_raw} mono />
          <InfoRow label="Trailer Assignment (raw)" value={row.trailer_assignment_raw} mono />
          <InfoRow label="Compensation" value={row.compensation_raw || fmtCompensation(row)} />
          <InfoRow label="Onboarded" value={fmtDate(row.onboarded_at)} />
          <InfoRow label="Status" value={DRIVER_STATUS_LABELS[row.current_status] || row.current_status} />
          {row.terminated_at && <InfoRow label="Terminated" value={fmtDate(row.terminated_at)} />}
          {row.termination_reason && <InfoRow label="Termination Reason" value={row.termination_reason} />}
          <InfoRow label="Referred By" value={row.referred_by} />
          <InfoRow label="Missing OP" value={row.missing_op} />
          <InfoRow label="Temporary License" value={row.temporary_license ? 'Yes' : 'No'} />
          <InfoRow label="Last Seen in Upload" value={row.last_seen_in_upload_at ? new Date(row.last_seen_in_upload_at).toLocaleString('en-US') : '—'} />
        </div>
        {row.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/5">
            <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{row.notes}</p>
          </div>
        )}
      </Section>

      <Section title="Current Equipment Assignments">
        {trucks.length === 0 && trailers.length === 0 && !truckMismatch && !trailerMismatch ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 italic">No equipment assigned.</p>
        ) : (
          <div className="space-y-3">
            {truckMismatch && (
              <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-sm text-amber-800 dark:text-amber-300">
                ⚠️ Truck assignment string "{row.truck_assignment_raw}" present but no matching truck in inventory.
              </div>
            )}
            {trailerMismatch && (
              <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-sm text-amber-800 dark:text-amber-300">
                ⚠️ Trailer assignment string "{row.trailer_assignment_raw}" present but no matching trailer in inventory.
              </div>
            )}
            {trucks.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-2">Trucks</p>
                <ul className="space-y-1.5">
                  {trucks.map(t => (
                    <li key={t.id} className="flex items-center gap-3 text-sm">
                      <Link to={`/fleet/trucks/${t.id}`} className="font-mono text-orange-600 hover:underline">{t.unit_number || t.id.slice(0, 8)}</Link>
                      <span className="font-mono text-xs text-gray-500 dark:text-slate-400">{t.vin}</span>
                      <span className="text-xs text-gray-500 dark:text-slate-400">· {t.ownership_stage}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {trailers.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-2">Trailers</p>
                <ul className="space-y-1.5">
                  {trailers.map(t => (
                    <li key={t.id} className="flex items-center gap-3 text-sm">
                      <Link to={`/fleet/trailers/${t.id}`} className="font-mono text-orange-600 hover:underline">{t.unit_number || t.id.slice(0, 8)}</Link>
                      <span className="font-mono text-xs text-gray-500 dark:text-slate-400">{t.vin}</span>
                      <span className="text-xs text-gray-500 dark:text-slate-400">· {t.trailer_type || t.ownership_stage}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Equipment Assignment History">
        {assignments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 italic">
            No assignment history yet. Upload the TMS Truck or Trailer Assignments export
            from the {' '}<Link to="/fleet/trucks" className="text-orange-600 hover:underline">Trucks</Link>{' '}/
            {' '}<Link to="/fleet/trailers" className="text-orange-600 hover:underline">Trailers</Link>{' '}
            list to populate this.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={S.th}>Type</th>
                  <th className={S.th}>Unit</th>
                  <th className={S.th}>Start</th>
                  <th className={S.th}>End</th>
                  <th className={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map(a => {
                  const isCurrent = a.end_date == null
                  const unitMatched = a.equipment_type === 'truck' ? a.truck : a.trailer
                  const unitLabel = unitMatched?.unit_number || a.equipment_name_raw || '—'
                  const unitDisplay = unitMatched?.id
                    ? (
                      <Link
                        to={`/fleet/${a.equipment_type === 'truck' ? 'trucks' : 'trailers'}/${unitMatched.id}`}
                        className="font-mono text-orange-600 hover:underline"
                      >
                        {unitLabel}
                      </Link>
                    )
                    : (
                      <span className="font-mono text-gray-600 dark:text-slate-400" title={`Unit no longer in BUDDY (TMS Equipment ID ${a.tms_equipment_id ?? 'unknown'})`}>
                        {unitLabel}
                      </span>
                    )
                  return (
                    <tr key={a.id} className={S.tableRow}>
                      <td className={`${S.td} text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400`}>{a.equipment_type}</td>
                      <td className={S.td}>{unitDisplay}</td>
                      <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>{fmtDate(a.start_date)}</td>
                      <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>
                        {a.end_date ? fmtDate(a.end_date) : <span className="italic text-emerald-600 dark:text-emerald-400">Open</span>}
                      </td>
                      <td className={`${S.td} whitespace-nowrap`}>
                        {isCurrent && (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                            Current
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Status History">
        {history.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 italic">No status changes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={S.th}>Date</th>
                  <th className={S.th}>Transition</th>
                  <th className={S.th}>Reason</th>
                  <th className={S.th}>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className={S.tableRow}>
                    <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>{fmtDate(h.occurred_at?.slice(0, 10))}</td>
                    <td className={S.td}>
                      <span className="text-xs text-gray-500 dark:text-slate-500">{DRIVER_STATUS_LABELS[h.from_status] || h.from_status || '—'}</span>
                      <span className="mx-2 text-gray-400 dark:text-slate-600">→</span>
                      <span className="text-xs font-medium text-gray-900 dark:text-slate-200">{DRIVER_STATUS_LABELS[h.to_status] || h.to_status}</span>
                    </td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{h.reason || '—'}</td>
                    <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400`}>{h.creator?.full_name || h.creator?.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <DriverFormModal
        open={showEdit}
        editItem={row}
        onClose={() => setShowEdit(false)}
        onSaved={() => { setShowEdit(false); load() }}
      />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className={`${S.card} p-5`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-4">{title}</h2>
      {children}
    </section>
  )
}

function InfoRow({ label, value, mono }) {
  const display = value === null || value === undefined || value === ''
    ? <span className="text-gray-400 dark:text-slate-600">—</span>
    : value
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className={`text-sm text-gray-700 dark:text-slate-300 text-right ${mono ? 'font-mono text-xs' : ''}`}>{display}</span>
    </div>
  )
}
