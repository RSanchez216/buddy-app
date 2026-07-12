import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import Select from '../../components/Select'
import { DRIVER_STATUSES, DRIVER_STATUS_LABELS, terminationFields, todayLocalYmd, fmtDate, fmtCompensation, monogram, nameHue, STAGE_LABELS } from './fleetUtils'
import DriverFormModal from './DriverFormModal'
import DriverProfileHeader from './DriverProfileHeader'
import ErrorBoundary from '../../components/ErrorBoundary'

// Canonical unit-number normalization — mirrors the importer / DB canonical key
// lower(btrim(regexp_replace(x,'^#+',''))): strip leading '#'(s) → collapse
// internal whitespace → trim → lowercase. Used to test whether a raw driver
// assignment string names a unit that actually exists in inventory.
const normUnit = (s) =>
  String(s ?? '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLowerCase()

export default function DriverDetail() {
  const { canEdit, user } = useAuth()
  const { id } = useParams()
  const [row, setRow] = useState(null)
  const [truckInv, setTruckInv] = useState([])     // full truck inventory (unit_number only) — for the "in inventory?" check
  const [trailerInv, setTrailerInv] = useState([]) // full trailer inventory (unit_number only)
  const [history, setHistory] = useState([])
  const [assignments, setAssignments] = useState([])
  const [teamCurrent, setTeamCurrent] = useState(null) // v_driver_current_team row (or null)
  const [teamHistory, setTeamHistory] = useState([])   // driver_team_history rows (newest first)
  const [teamAvatars, setTeamAvatars] = useState({})   // photo_path → signed URL
  const [activity, setActivity] = useState(null)       // driver_activity_snapshot row (idle days + last load)
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => { if (id) load() /* eslint-disable-line */ }, [id])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('drivers').select('*').eq('id', id).maybeSingle()
    setRow(data || null)

    const [hRes, aRes, teamRes, teamHistRes, tInvRes, trInvRes, actRes] = await Promise.all([
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
          id, equipment_type, start_date, end_date, source, equipment_name_raw, tms_equipment_id,
          truck:trucks(id, unit_number, vin, ownership_stage),
          trailer:trailers(id, unit_number, vin, trailer_type)
        `)
        .eq('driver_id', id)
        .order('start_date', { ascending: false }),
      // Current team (0/1 row) + full membership history (newest first).
      supabase.from('v_driver_current_team')
        .select('team_id, team_name, role, effective_start, partners, members')
        .eq('driver_id', id).maybeSingle(),
      supabase.rpc('driver_team_history', { p_driver: id }),
      // Full inventory unit numbers — used only to test whether the driver's raw
      // assignment string names a unit that exists somewhere in inventory (it may
      // be assigned to another driver or currently unassigned).
      supabase.from('trucks').select('unit_number'),
      supabase.from('trailers').select('unit_number'),
      // Activity snapshot — idle days + last completed load (team-aware).
      supabase.rpc('driver_activity_snapshot', { p_driver_id: id }),
    ])
    setTruckInv(tInvRes.data || [])
    setTrailerInv(trInvRes.data || [])
    setHistory(hRes.data || [])
    setAssignments(aRes.data || [])
    setTeamCurrent(teamRes.data || null)
    setTeamHistory(teamHistRes.data || [])
    setActivity(actRes.data?.[0] || null)

    // Sign the current teammates' avatars (private bucket — never getPublicUrl).
    const memberPaths = (teamRes.data?.members || []).map(m => m.photo_path).filter(Boolean)
    if (memberPaths.length) {
      const { data: urls } = await supabase.storage.from('driver-avatars').createSignedUrls(memberPaths, 3600)
      const map = {}
      ;(urls || []).forEach(u => { if (u?.signedUrl) map[u.path] = u.signedUrl })
      setTeamAvatars(map)
    } else {
      setTeamAvatars({})
    }
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

  // Surface the "no matching unit in inventory" banner only when the raw
  // assignment string is genuinely absent from inventory. Computed on every
  // render from the current inventory arrays (never memoized on a stale key), so
  // adding a unit to inventory clears the banner automatically. Normalization
  // mirrors the importer / DB canonical key — both sides carry a leading '#'.
  const truckInInventory = !!row.truck_assignment_raw &&
    truckInv.some(t => normUnit(t.unit_number) === normUnit(row.truck_assignment_raw))
  const trailerInInventory = !!row.trailer_assignment_raw &&
    trailerInv.some(t => normUnit(t.unit_number) === normUnit(row.trailer_assignment_raw))

  // Secondary guard: if the driver's current OPEN equipment assignment already
  // resolves to an inventory unit, the raw string is authoritative-superseded
  // (it may name a prior unit) — never warn for that equipment type.
  const truckAssignResolved = assignments.some(a => a.equipment_type === 'truck' && a.end_date == null && a.truck?.id)
  const trailerAssignResolved = assignments.some(a => a.equipment_type === 'trailer' && a.end_date == null && a.trailer?.id)

  const truckMismatch = !!row.truck_assignment_raw && !truckInInventory && !truckAssignResolved
  const trailerMismatch = !!row.trailer_assignment_raw && !trailerInInventory && !trailerAssignResolved

  // Equipment section data — split assignment history by type (already newest
  // first from the query) and pick each type's current open row (latest start).
  const truckHistory = assignments.filter(a => a.equipment_type === 'truck')
  const trailerHistory = assignments.filter(a => a.equipment_type === 'trailer')
  const latestOpen = (rows) => rows
    .filter(a => a.end_date == null)
    .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''))[0] || null
  const openTruck = latestOpen(truckHistory)
  const openTrailer = latestOpen(trailerHistory)

  // Home address (display-only, maintained by the periodic import): prefer the
  // clean full address (trimming a trailing ", USA"), else city/state/zip.
  const homeAddress = row.home_full_address
    ? row.home_full_address.replace(/,?\s*USA\s*$/i, '')
    : ([row.home_city, row.home_state].filter(Boolean).join(', ') + (row.home_zip ? ` ${row.home_zip}` : '')).trim() || null

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <Link to="/fleet/drivers" className="text-xs text-orange-600 hover:underline">← Drivers</Link>
        {canEdit && (
          <div className="flex items-center gap-2">
            <StatusQuickChange driver={row} userId={user?.id} onSaved={load} />
            <button onClick={() => setShowEdit(true)} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </button>
          </div>
        )}
      </div>
      <DriverProfileHeader driver={row} activity={activity} />

      <ErrorBoundary label="the team section">
        <TeamSection driverId={id} current={teamCurrent} history={teamHistory} avatars={teamAvatars} />
      </ErrorBoundary>

      <Section title="Driver Info">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <InfoRow label="Internal ID" value={row.internal_id} mono />
          <InfoRow label="Full Name" value={row.full_name} />
          <InfoRow label="Phone" value={row.phone} />
          <InfoRow label="Email" value={row.email} />
          <InfoRow label="Home Address" value={homeAddress} />
          <InfoRow label="Driver Type" value={row.driver_type} />
          <InfoRow label="Carrier" value={row.carrier} />
          <InfoRow label="Truck Assignment (raw)" value={row.truck_assignment_raw} mono />
          <InfoRow label="Trailer Assignment (raw)" value={row.trailer_assignment_raw} mono />
          <InfoRow label="Compensation" value={row.compensation_raw || fmtCompensation(row)} />
          <InfoRow label="Status" value={DRIVER_STATUS_LABELS[row.current_status] || row.current_status} />
          {row.terminated_at && <InfoRow label="Terminated" value={fmtDate(row.terminated_at)} />}
          {row.termination_reason && <InfoRow label="Termination Reason" value={row.termination_reason} />}
          <InfoRow label="Referred By" value={row.referred_by} />
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

      <Section title="Equipment">
        {(truckMismatch || trailerMismatch) && (
          <div className="space-y-3 mb-4">
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
          </div>
        )}

        <div className="rounded-xl border border-gray-100 dark:border-white/5 bg-gray-50/60 dark:bg-white/[0.02] p-4 space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Current equipment</p>
          <CurrentEquipmentLine typeLabel="Truck" typeName="truck" assignment={openTruck} />
          <CurrentEquipmentLine typeLabel="Trailer" typeName="trailer" assignment={openTrailer} />
        </div>

        <div className="mt-4 space-y-3">
          <EquipmentHistoryGroup title="Truck history" type="truck" rows={truckHistory} />
          <EquipmentHistoryGroup title="Trailer history" type="trailer" rows={trailerHistory} />
        </div>
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

// Resolve the display unit + details for an equipment_assignments row. Prefers
// the joined inventory row; falls back to the raw string (no VIN/detail) when
// the unit is no longer in BUDDY. Unit numbers already carry a leading '#'.
function resolveAssignmentUnit(a) {
  const inv = a.equipment_type === 'truck' ? a.truck : a.trailer
  const unit = inv?.unit_number || a.equipment_name_raw || '—'
  const detail = a.equipment_type === 'truck'
    ? (inv?.ownership_stage ? (STAGE_LABELS[inv.ownership_stage] || inv.ownership_stage) : null)
    : (inv?.trailer_type || null)
  return { id: inv?.id || null, unit, vin: inv?.vin || null, detail }
}

function CurrentPill() {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
      Current
    </span>
  )
}

// One line in the Current-equipment card: type label, unit link, VIN,
// ownership/trailer-type, `since {start}`, and a Current pill. Renders a muted
// "No {type} assigned" placeholder when there's no open assignment for the type.
function CurrentEquipmentLine({ typeLabel, typeName, assignment }) {
  const dot = <span className="text-gray-300 dark:text-slate-600">·</span>
  if (!assignment) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{typeLabel}</span>
        <span className="text-sm text-gray-400 dark:text-slate-500 italic">No {typeName} assigned</span>
      </div>
    )
  }
  const { id, unit, vin, detail } = resolveAssignmentUnit(assignment)
  const path = typeName === 'truck' ? 'trucks' : 'trailers'
  return (
    <div className="flex items-center gap-2 flex-wrap text-sm">
      <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{typeLabel}</span>
      {id
        ? <Link to={`/fleet/${path}/${id}`} className="font-mono text-orange-600 hover:underline">{unit}</Link>
        : <span className="font-mono text-gray-600 dark:text-slate-400" title={`Unit no longer in BUDDY (TMS Equipment ID ${assignment.tms_equipment_id ?? 'unknown'})`}>{unit}</span>}
      {vin && <>{dot}<span className="font-mono text-xs text-gray-500 dark:text-slate-400">{vin}</span></>}
      {detail && <>{dot}<span className="text-xs text-gray-500 dark:text-slate-400">{detail}</span></>}
      {dot}<span className="text-xs text-gray-500 dark:text-slate-400">since {fmtDate(assignment.start_date)}</span>
      <CurrentPill />
    </div>
  )
}

// Collapsible history group (collapsed by default) for one equipment type. Rows are
// newest-first with the open assignment first; columns Unit | Start | End |
// status. A count badge sits in the summary. Empty → muted placeholder.
function EquipmentHistoryGroup({ title, type, rows }) {
  const path = type === 'truck' ? 'trucks' : 'trailers'
  const sorted = [...rows].sort((a, b) => {
    const ao = a.end_date == null ? 1 : 0
    const bo = b.end_date == null ? 1 : 0
    if (ao !== bo) return bo - ao
    return (b.start_date || '').localeCompare(a.start_date || '')
  })
  return (
    <details className="group rounded-xl border border-gray-100 dark:border-white/5 overflow-hidden">
      <summary className="flex items-center gap-2 cursor-pointer select-none px-4 py-2.5 bg-gray-50/60 dark:bg-white/[0.02] text-sm font-semibold text-gray-700 dark:text-slate-300">
        <svg className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-slate-500 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        {title}
        <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 dark:bg-slate-700/50 text-gray-600 dark:text-slate-300">{rows.length}</span>
      </summary>
      {sorted.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-400 dark:text-slate-500 italic">No {type} history</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <th className={S.th}>Unit</th>
                <th className={S.th}>Start</th>
                <th className={S.th}>End</th>
                <th className={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(a => {
                const { id, unit } = resolveAssignmentUnit(a)
                const open = a.end_date == null
                return (
                  <tr key={a.id} className={S.tableRow}>
                    <td className={S.td}>
                      {id
                        ? <Link to={`/fleet/${path}/${id}`} className="font-mono text-orange-600 hover:underline">{unit}</Link>
                        : <span className="font-mono text-gray-600 dark:text-slate-400" title={`Unit no longer in BUDDY (TMS Equipment ID ${a.tms_equipment_id ?? 'unknown'})`}>{unit}</span>}
                    </td>
                    <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>{fmtDate(a.start_date)}</td>
                    <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>
                      {open ? <span className="italic text-emerald-600 dark:text-emerald-400">Open</span> : fmtDate(a.end_date)}
                    </td>
                    <td className={`${S.td} whitespace-nowrap`}>{open && <CurrentPill />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}

// Quick status change — flip a driver's status (e.g. Active → Terminated) from
// the profile without opening the full Edit form. A non-blocking popover; on
// Terminated it captures a termination date (defaults to today) + optional
// reason. Writes current_status + status_changed_at + terminated_at and logs a
// driver_status_history row, matching the Edit modal's write shape.
function StatusQuickChange({ driver, userId, onSaved }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(driver.current_status)
  const [date, setDate] = useState(driver.terminated_at || todayLocalYmd())
  const [reason, setReason] = useState(driver.termination_reason || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openMenu() {
    setStatus(driver.current_status)
    setDate(driver.terminated_at || todayLocalYmd())
    setReason(driver.termination_reason || '')
    setError('')
    setOpen(true)
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const changed = status !== driver.current_status
      const patch = {
        current_status: status,
        updated_by: userId || null,
        ...terminationFields(status, date, reason),
      }
      if (changed) patch.status_changed_at = new Date().toISOString()
      const { error: err } = await supabase.from('drivers').update(patch).eq('id', driver.id)
      if (err) throw err
      if (changed) {
        const { error: hErr } = await supabase.from('driver_status_history').insert({
          driver_id: driver.id,
          from_status: driver.current_status,
          to_status: status,
          reason: (reason && reason.trim()) || 'Quick status change',
          created_by: userId || null,
        })
        if (hErr) console.error('[DriverDetail] status history insert failed', hErr)
      }
      setOpen(false)
      onSaved?.()
    } catch (e) {
      console.error('[DriverDetail] status change failed', e)
      setError(e.message || 'Update failed')
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      <button onClick={() => (open ? setOpen(false) : openMenu())} className={S.btnSecondary}>Change status</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => !saving && setOpen(false)} />
          <div className={`absolute right-0 top-[calc(100%+6px)] z-20 w-[300px] ${S.card} p-4 shadow-lg text-left`}>
            <label className={S.label}>Status</label>
            <Select value={status} onChange={e => setStatus(e.target.value)}>
              {DRIVER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
            {status === 'terminated' && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className={S.label}>Termination date</label>
                  <input type="date" className={S.input} value={date || ''} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <label className={S.label}>Reason (optional)</label>
                  <input className={S.input} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Voluntary resignation" />
                </div>
              </div>
            )}
            {error && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} disabled={saving} className={S.btnCancel}>Cancel</button>
              <button onClick={save} disabled={saving} className={S.btnSave}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Team-unit glyph (users) — same icon used on the Teams page / spotlight.
function TeamIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${className} shrink-0`} aria-label="Team">
      <path d="M17 20h5v-2a3 3 0 0 0-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 0 1 5.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 0 1 9.288 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RolePill({ role }) {
  const primary = role === 'primary'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${primary ? 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400' : 'bg-gray-200 dark:bg-slate-600/40 text-gray-600 dark:text-slate-300'}`}>
      {primary ? 'primary' : 'co'}
    </span>
  )
}

function PartnerAvatar({ name, url, size = 'w-9 h-9' }) {
  if (url) return <img src={url} alt={name} className={`${size} rounded-xl object-cover ring-1 ring-black/5 dark:ring-white/10 shrink-0`} />
  const h = nameHue(name || '')
  return (
    <div className={`${size} rounded-xl flex items-center justify-center text-xs font-bold text-white shrink-0`}
      style={{ background: `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 42) % 360} 68% 34%))` }}>
      {monogram(name || '')}
    </div>
  )
}

// Team card + membership timeline. Renders nothing for solo drivers (no current
// team AND no history). Current stint prefers the live view (has member avatars);
// falls back to the is_current history row (partner names only) if the view is
// absent. Timeline shows only when there's more than the current stint.
function TeamSection({ driverId, current, history, avatars }) {
  const currentStint = current || history.find(h => h.is_current) || null
  const onTeam = !!currentStint
  if (!onTeam && (!history || history.length === 0)) return null

  const partners = (current?.members || []).filter(m => m.driver_id !== driverId)
  const showTimeline = history.length > (onTeam ? 1 : 0)

  return (
    <Section title="Team">
      {onTeam && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <TeamIcon className="w-5 h-5 text-gray-500 dark:text-slate-400" />
            <Link to="/fleet/teams" className="text-base font-bold text-gray-900 dark:text-white hover:text-orange-600 dark:hover:text-orange-400">
              {currentStint.team_name}
            </Link>
            <RolePill role={currentStint.role} />
            {currentStint.effective_start && (
              <span className="text-xs text-gray-500 dark:text-slate-400">since {fmtDate(currentStint.effective_start)}</span>
            )}
          </div>
          {partners.length > 0 ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Partner{partners.length > 1 ? 's' : ''}</span>
              {partners.map(p => (
                <Link key={p.driver_id} to={`/fleet/drivers/${p.driver_id}`} className="flex items-center gap-2 hover:opacity-80">
                  <PartnerAvatar name={p.full_name} url={p.photo_path ? avatars[p.photo_path] : null} />
                  <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{p.full_name}</span>
                </Link>
              ))}
            </div>
          ) : currentStint.partners ? (
            <span className="text-sm text-gray-600 dark:text-slate-400">with {currentStint.partners}</span>
          ) : null}
        </div>
      )}

      {showTimeline && (
        <div className={`${onTeam ? 'mt-4 pt-4 border-t border-gray-100 dark:border-white/5' : ''} space-y-2.5`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Membership history</p>
          {history.map((s, i) => (
            <div key={`${s.team_id}-${s.effective_start}-${i}`} className="flex items-start gap-2.5">
              <TeamIcon className="w-4 h-4 mt-0.5 text-gray-400 dark:text-slate-500" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-slate-200">{s.team_name}</span>
                  <RolePill role={s.role} />
                  {s.is_current && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  {s.effective_end ? `${fmtDate(s.effective_start)} – ${fmtDate(s.effective_end)}` : `since ${fmtDate(s.effective_start)}`}
                  {s.partners && ` · with ${s.partners}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
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
