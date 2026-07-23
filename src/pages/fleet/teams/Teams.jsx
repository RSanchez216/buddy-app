import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'

// Teams — link drivers who run as a team (two drivers, one truck) with
// effective dates. Read model: v_driver_teams_admin (card header) + the
// authoritative driver_team_members rows (member list, dates) + v_driver_equipment
// (derived truck). All date/membership mutations go through the shipped RPCs
// (create_team_with_members / add_team_member / end_team_member / dissolve_team /
// set_team_start / set_team_member_dates). The truck is derived from assignments,
// never typed. Name/notes + reactivate remain direct driver_teams writes (no RPC).

// ── date helpers (plain YYYY-MM-DD, America/Chicago — no UTC-parse shift) ──────
function fmtDate(ymd) {
  if (!ymd) return '—'
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function todayChicago() {
  // en-CA formats as YYYY-MM-DD; timeZone pins it to Central regardless of host.
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()) }
  catch { return new Date().toISOString().slice(0, 10) }
}

// One-word pay hint from the driver's compensation type.
const PAY_HINT = {
  rate_per_mile: 'pay per-head',
  flat_rate: 'pay per-head',
  rate_pct: '% split',
  service_charge_pct: 'owner-op',
}
const payHint = (comp) => PAY_HINT[comp] || null
const surname = (name) => String(name || '').trim().split(/\s+/).pop() || ''
const driverMatches = (d, q) => {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return String(d.full_name || '').toLowerCase().includes(s) || String(d.internal_id || '').toLowerCase().includes(s)
}

// Friendly RPC error text — the backend throws readable messages (one open team
// per driver, one primary, name required); surface those, never a raw stack.
const rpcMessage = (err, fallback) => (err && (err.message || err.hint)) ? (err.message || err.hint) : fallback

// ── small shared bits ─────────────────────────────────────────────────────────
function RolePill({ role }) {
  const primary = role === 'primary'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
      primary ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'
              : 'bg-gray-100 text-gray-600 dark:bg-slate-700/50 dark:text-slate-300'
    }`}>{primary ? 'primary' : 'co'}</span>
  )
}
function PayTag({ compensationType, driverType }) {
  const hint = payHint(compensationType)
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400">
      {driverType && <span className="text-gray-400 dark:text-slate-500">{String(driverType).replace(/_/g, ' ')}</span>}
      {hint && <span className="font-semibold">{hint}</span>}
      {!driverType && !hint && '—'}
    </span>
  )
}

// Driver search + result list. onPick(driver); already-picked ids are hidden.
function DriverSearch({ drivers, excludeIds, onPick, placeholder = 'Search driver by name or ID…' }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const ex = new Set(excludeIds || [])
    return drivers.filter(d => !ex.has(d.id) && driverMatches(d, q)).slice(0, 8)
  }, [drivers, excludeIds, q])
  return (
    <div>
      <input className={`${S.input}`} value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} />
      {q.trim() && (
        <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/5">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</p>
          ) : results.map(d => (
            <button key={d.id} type="button" onClick={() => { onPick(d); setQ('') }}
              className="w-full text-left px-3 py-2 hover:bg-orange-50 dark:hover:bg-orange-500/10 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm text-gray-800 dark:text-slate-200">{d.full_name} <span className="text-gray-400 dark:text-slate-500">#{d.internal_id}</span></span>
              <PayTag compensationType={d.compensation_type} driverType={d.driver_type} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Lightweight non-blocking modal shell.
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div className={`${S.card} w-full max-w-lg my-8`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-white/5">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200 text-lg leading-none">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// Inline (non-blocking) date confirm — used for End member and Dissolve.
function InlineDateConfirm({ label, cta, tone = 'danger', busy, onConfirm, onCancel }) {
  const [date, setDate] = useState(todayChicago())
  const toneCls = tone === 'danger'
    ? 'bg-red-500 hover:bg-red-600'
    : 'bg-orange-500 hover:bg-orange-600'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] px-2 py-1.5">
      <span className="text-[11px] text-gray-500 dark:text-slate-400">{label}</span>
      <input type="date" value={date} onChange={e => setDate(e.target.value)}
        className="text-xs rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-1.5 py-0.5 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-500/40" />
      <button type="button" disabled={busy || !date} onClick={() => onConfirm(date)}
        className={`text-[11px] px-2 py-1 rounded-md text-white font-medium disabled:opacity-50 ${toneCls}`}>{busy ? '…' : cta}</button>
      <button type="button" disabled={busy} onClick={onCancel}
        className="text-[11px] px-2 py-1 rounded-md text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50">Cancel</button>
    </div>
  )
}

const BTN_PRIMARY = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_QUIET = 'text-xs font-medium px-2.5 py-1 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors'

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3 h-3 shrink-0" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  )
}

// Authoritative team data: the admin view (card header) + the member rows
// straight from driver_team_members (so we get driver_id + effective_end and
// can show/un-end left members) + per-driver equipment for the derived truck.
async function fetchTeamData() {
  const [teamsRes, membersRes, equipRes] = await Promise.all([
    supabase.from('v_driver_teams_admin').select('*').order('status').order('name'),
    supabase.from('driver_team_members')
      .select('id, team_id, driver_id, role, effective_start, effective_end, drivers(full_name, internal_id, driver_type, compensation_type)'),
    supabase.from('v_driver_equipment').select('driver_id, truck_unit, truck_confirmed'),
  ])
  if (teamsRes.error) throw teamsRes.error
  const membersByTeam = new Map()
  for (const m of (membersRes.data || [])) {
    // PostgREST may return a to-one embed as an object or a 1-element array —
    // normalize so `m.drivers.full_name` is always reachable.
    if (Array.isArray(m.drivers)) m.drivers = m.drivers[0] || null
    if (!membersByTeam.has(m.team_id)) membersByTeam.set(m.team_id, [])
    membersByTeam.get(m.team_id).push(m)
  }
  const equipByDriver = new Map((equipRes.data || []).map(r => [r.driver_id, r]))
  return { teams: teamsRes.data || [], membersByTeam, equipByDriver }
}

// Active members first, primary before co, then by start date.
function sortMembers(members) {
  return [...(members || [])].sort((a, b) => {
    const ae = a.effective_end ? 1 : 0, be = b.effective_end ? 1 : 0
    if (ae !== be) return ae - be
    const ap = a.role === 'primary' ? 0 : 1, bp = b.role === 'primary' ? 0 : 1
    if (ap !== bp) return ap - bp
    return String(a.effective_start || '').localeCompare(String(b.effective_start || ''))
  })
}

// Team truck = the currently-active members' active truck assignments
// (v_driver_equipment.truck_confirmed → a live equipment_assignment, not the
// driver-import fallback). Assignments win over the hand-typed truck_id, which
// we no longer read. A team is two drivers sharing one truck, so if both hold
// one we show the primary's and flag it for review. truck_unit is stored with
// its leading '#', so it's printed as-is (no extra '#').
function deriveTeamTruck(members, equipByDriver) {
  const held = (members || [])
    .filter(m => !m.effective_end)
    .map(m => {
      const eq = equipByDriver.get(m.driver_id)
      return { role: m.role, unit: eq?.truck_confirmed ? eq.truck_unit : null }
    })
    .filter(x => x.unit)
  if (held.length === 0) return { unit: null, conflict: false }
  if (held.length === 1) return { unit: held[0].unit, conflict: false }
  const primary = held.find(x => x.role === 'primary')
  return { unit: (primary || held[0]).unit, conflict: true }
}

// Compact per-member date editor (3b): Joined required, Left optional + clear.
// Left must be ≥ Joined (also enforced by the RPC). Passing end=null un-ends.
function MemberDateEditor({ member, busy, onSave, onCancel }) {
  const [joined, setJoined] = useState(member.effective_start || todayChicago())
  const [left, setLeft] = useState(member.effective_end || '')
  const [err, setErr] = useState('')
  const invalid = !!(left && joined && left < joined)
  const dateCls = 'text-xs rounded-md border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-1.5 py-0.5 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-500/40'
  function submit() {
    if (!joined) { setErr('Joined date is required.'); return }
    if (invalid) { setErr("Left date can't be before joined."); return }
    onSave(joined, left || null)
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] px-2.5 py-2">
      <label className="flex flex-col text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide">
        Joined
        <input type="date" value={joined} onChange={e => { setErr(''); setJoined(e.target.value) }} className={`mt-0.5 ${dateCls}`} />
      </label>
      <label className="flex flex-col text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide">
        Left <span className="normal-case text-gray-400 dark:text-slate-500">(optional)</span>
        <span className="mt-0.5 inline-flex items-center gap-1.5">
          <input type="date" value={left} min={joined || undefined} onChange={e => { setErr(''); setLeft(e.target.value) }} className={dateCls} />
          {left && (
            <button type="button" onClick={() => { setErr(''); setLeft('') }}
              className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/5">clear</button>
          )}
        </span>
      </label>
      <div className="flex items-center gap-2 pb-0.5">
        <button type="button" disabled={busy || invalid || !joined} onClick={submit}
          className="text-[11px] px-2 py-1 rounded-md text-white font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50">{busy ? '…' : 'Save'}</button>
        <button type="button" disabled={busy} onClick={onCancel}
          className="text-[11px] px-2 py-1 rounded-md text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50">Cancel</button>
      </div>
      {(err || invalid) && <p className="w-full text-[11px] text-red-600 dark:text-red-400">{err || "Left date can't be before joined."}</p>}
    </div>
  )
}

export default function Teams() {
  const toast = useToast()
  const [teams, setTeams] = useState(null)
  const [membersByTeam, setMembersByTeam] = useState(() => new Map())
  const [equipByDriver, setEquipByDriver] = useState(() => new Map())
  const [drivers, setDrivers] = useState([])
  const [error, setError] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [addFor, setAddFor] = useState(null)   // team object for add-member modal
  const [editFor, setEditFor] = useState(null) // team object for edit modal

  // Re-pull teams + members + equipment together after any mutation, so the
  // card header, member rows, and derived truck stay consistent.
  async function refreshTeams() {
    try {
      const d = await fetchTeamData()
      setTeams(d.teams); setMembersByTeam(d.membersByTeam); setEquipByDriver(d.equipByDriver)
    } catch (e) { toast.error("Couldn't refresh teams", e) }
  }
  // Initial load — setState lives in the async callback, never synchronously in
  // the effect body.
  useEffect(() => {
    let stale = false
    Promise.all([
      fetchTeamData(),
      supabase.from('drivers').select('id, full_name, internal_id, driver_type, compensation_type').neq('current_status', 'terminated').order('full_name'),
    ]).then(([data, driversRes]) => {
      if (stale) return
      setTeams(data.teams); setMembersByTeam(data.membersByTeam); setEquipByDriver(data.equipByDriver)
      if (!driversRes.error) setDrivers(driversRes.data || [])
    }).catch(e => { if (!stale) { setError(rpcMessage(e, String(e))); setTeams([]) } })
    return () => { stale = true }
  }, [])

  const loading = teams === null
  const active = (teams || []).filter(t => t.status === 'active')
  const dissolved = (teams || []).filter(t => t.status !== 'active')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Teams</h1>
          <p className="text-sm text-gray-700 dark:text-slate-500 mt-0.5">
            Drivers who run as a team — two drivers, one truck. Linking keeps the co-driver off the idle list and credits the pair as one unit.
          </p>
        </div>
        <button onClick={() => setNewOpen(true)} className={BTN_PRIMARY}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
          New team
        </button>
      </div>

      {error && <div className={S.errorBox}>Couldn't load teams: {error}</div>}

      {loading ? (
        <div className={`${S.card} p-12 text-center text-sm text-gray-500 dark:text-slate-500 animate-pulse`}>Loading teams…</div>
      ) : teams.length === 0 ? (
        <div className={`${S.card} p-12 text-center text-sm text-gray-400 dark:text-slate-500`}>No teams yet — create one with “New team”.</div>
      ) : (
        <div className="space-y-3">
          {active.map(t => (
            <TeamCard key={t.team_id} team={t} members={membersByTeam.get(t.team_id) || []} equipByDriver={equipByDriver} onAdd={() => setAddFor(t)} onEdit={() => setEditFor(t)} onChanged={refreshTeams} toast={toast} />
          ))}
          {dissolved.length > 0 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 pt-2">Dissolved</p>
              {dissolved.map(t => (
                <TeamCard key={t.team_id} team={t} members={membersByTeam.get(t.team_id) || []} equipByDriver={equipByDriver} onAdd={() => setAddFor(t)} onEdit={() => setEditFor(t)} onChanged={refreshTeams} toast={toast} />
              ))}
            </>
          )}
        </div>
      )}

      {newOpen && (
        <NewTeamModal drivers={drivers} toast={toast}
          onClose={() => setNewOpen(false)}
          onCreated={async () => { setNewOpen(false); await refreshTeams() }} />
      )}
      {addFor && (
        <AddMemberModal team={addFor} drivers={drivers} toast={toast}
          onClose={() => setAddFor(null)}
          onAdded={async () => { setAddFor(null); await refreshTeams() }} />
      )}
      {editFor && (
        <EditTeamModal team={editFor} members={membersByTeam.get(editFor.team_id) || []} toast={toast}
          onClose={() => setEditFor(null)}
          onSaved={async () => { setEditFor(null); await refreshTeams() }} />
      )}
    </div>
  )
}

function TeamCard({ team, members, equipByDriver, onAdd, onEdit, onChanged, toast }) {
  const dissolved = team.status !== 'active'
  const rows = sortMembers(members)
  const [endingMember, setEndingMember] = useState(null)  // member_id with open End confirm
  const [editingDates, setEditingDates] = useState(null)  // member_id with open date editor
  const [confirmDissolve, setConfirmDissolve] = useState(false)
  const [busy, setBusy] = useState(false)
  const { unit, conflict } = deriveTeamTruck(members, equipByDriver)

  async function endMember(memberId, endDate) {
    setBusy(true)
    const { error } = await supabase.rpc('end_team_member', { p_member: memberId, p_end: endDate })
    setBusy(false)
    if (error) { toast.error("Couldn't end this membership", rpcMessage(error, 'Try again')); return }
    setEndingMember(null); toast.success('Membership ended'); onChanged()
  }
  async function saveMemberDates(memberId, start, end) {
    setBusy(true)
    const { error } = await supabase.rpc('set_team_member_dates', { p_member: memberId, p_start: start, p_end: end })
    setBusy(false)
    if (error) { toast.error("Couldn't update the dates", rpcMessage(error, 'Try again')); return }
    setEditingDates(null); toast.success('Dates updated'); onChanged()
  }
  async function dissolve(asOf) {
    setBusy(true)
    const { error } = await supabase.rpc('dissolve_team', { p_team: team.team_id, p_as_of: asOf })
    setBusy(false)
    if (error) { toast.error("Couldn't dissolve the team", rpcMessage(error, 'Try again')); return }
    setConfirmDissolve(false); toast.success('Team dissolved'); onChanged()
  }
  async function reactivate() {
    setBusy(true)
    const { error } = await supabase.from('driver_teams').update({ status: 'active' }).eq('id', team.team_id)
    setBusy(false)
    if (error) { toast.error("Couldn't reactivate the team", rpcMessage(error, 'Try again')); return }
    toast.success('Team reactivated'); onChanged()
  }

  return (
    <div className={`${S.card} overflow-hidden ${dissolved ? 'opacity-70' : ''}`}>
      {/* Card header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{team.name}</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">Team · {team.open_member_count ?? 0}</span>
            {dissolved && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300">Dissolved</span>}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-0.5">
            since {fmtDate(team.since)} · {unit ? (
              <>Truck {unit}{conflict && (
                <span title="Both members have an active truck assignment — a team shares one. Showing the primary's; review the assignments." className="ml-1 text-amber-600 dark:text-amber-400" aria-label="Two trucks assigned — review">⚠</span>
              )}</>
            ) : 'no truck'}
            {team.notes && <span className="text-gray-400 dark:text-slate-500"> · {team.notes}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!dissolved && <button onClick={onAdd} className={BTN_QUIET}>Add member</button>}
          <button onClick={onEdit} className={BTN_QUIET}>Edit</button>
          {dissolved
            ? <button onClick={reactivate} disabled={busy} className={BTN_QUIET}>Reactivate</button>
            : <button onClick={() => setConfirmDissolve(v => !v)} className={BTN_QUIET}>Dissolve</button>}
        </div>
      </div>

      {confirmDissolve && !dissolved && (
        <div className="px-4 py-2 border-b border-gray-100 dark:border-white/5">
          <InlineDateConfirm label="Dissolve as of" cta="Dissolve" tone="danger" busy={busy}
            onConfirm={dissolve} onCancel={() => setConfirmDissolve(false)} />
        </div>
      )}

      {/* Members */}
      {rows.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-400 dark:text-slate-500">No members.</div>
      ) : (
        <ul className="divide-y divide-gray-50 dark:divide-white/[0.03]">
          {rows.map(m => {
            const ended = !!m.effective_end
            return (
            <li key={m.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className={`font-medium truncate ${ended ? 'text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-slate-200'}`}>{m.drivers?.full_name || '—'}</span>
                  <span className="text-[11px] text-gray-400 dark:text-slate-500">#{m.drivers?.internal_id}</span>
                  <RolePill role={m.role} />
                  {/* Click the date (or the pencil) to edit joined / left. */}
                  <button type="button" onClick={() => setEditingDates(editingDates === m.id ? null : m.id)}
                    title="Edit joined / left dates"
                    className="inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 hover:text-orange-600 dark:hover:text-orange-400">
                    <span>since {fmtDate(m.effective_start)}{ended ? ` · left ${fmtDate(m.effective_end)}` : ''}</span>
                    <PencilIcon />
                  </button>
                  <PayTag compensationType={m.drivers?.compensation_type} driverType={m.drivers?.driver_type} />
                  {ended && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-slate-700/50 dark:text-slate-400">left</span>}
                </div>
                {!dissolved && !ended && (
                  <button onClick={() => setEndingMember(endingMember === m.id ? null : m.id)}
                    className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400">End</button>
                )}
              </div>
              {editingDates === m.id && (
                <MemberDateEditor member={m} busy={busy}
                  onSave={(start, end) => saveMemberDates(m.id, start, end)}
                  onCancel={() => setEditingDates(null)} />
              )}
              {endingMember === m.id && (
                <div className="mt-2">
                  <InlineDateConfirm label="Ended on" cta="End" tone="danger" busy={busy}
                    onConfirm={(d) => endMember(m.id, d)} onCancel={() => setEndingMember(null)} />
                </div>
              )}
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function NewTeamModal({ drivers, toast, onClose, onCreated }) {
  const [picked, setPicked] = useState([]) // driver objects (max 2)
  const [primaryId, setPrimaryId] = useState(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [start, setStart] = useState(todayChicago())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Name prefilled from the picked surnames (primary first) — derived, not an
  // effect, so it updates as drivers change until the manager edits it.
  const computedName = useMemo(() => {
    const ordered = [...picked].sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : 0))
    return ordered.map(d => surname(d.full_name)).filter(Boolean).join(' / ')
  }, [picked, primaryId])
  const effectiveName = nameEdited ? name : computedName

  function addDriver(d) {
    setPicked(prev => {
      if (prev.length >= 2 || prev.some(p => p.id === d.id)) return prev
      const next = [...prev, d]
      if (next.length === 1) setPrimaryId(d.id) // first pick defaults to primary
      return next
    })
  }
  function removeDriver(id) {
    setPicked(prev => prev.filter(p => p.id !== id))
    if (primaryId === id) setPrimaryId(null)
  }

  const canSave = picked.length === 2 && primaryId && effectiveName.trim() && !saving

  async function save() {
    setErr('')
    if (!canSave) { if (picked.length !== 2) setErr('Pick two drivers.'); else if (!effectiveName.trim()) setErr('Team name is required.'); return }
    const members = picked.map(d => ({ driver_id: d.id, role: d.id === primaryId ? 'primary' : 'co' }))
    setSaving(true)
    // Truck is derived from assignments, never typed — pass null for the legacy
    // truck_id column (kept in the DB, no longer read).
    const { error } = await supabase.rpc('create_team_with_members', {
      p_name: effectiveName.trim(), p_truck_id: null, p_start: start, p_members: members,
    })
    setSaving(false)
    if (error) { setErr(rpcMessage(error, "Couldn't create the team.")); return }
    toast.success('Team created')
    onCreated()
  }

  return (
    <Modal title="New team" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={S.label}>Members</label>
          {picked.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {picked.map(d => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-800 dark:text-slate-200 truncate">{d.full_name} <span className="text-gray-400 dark:text-slate-500">#{d.internal_id}</span></span>
                    <PayTag compensationType={d.compensation_type} driverType={d.driver_type} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="inline-flex items-center gap-1 text-[11px] text-gray-600 dark:text-slate-400 cursor-pointer">
                      <input type="radio" name="primary" checked={primaryId === d.id} onChange={() => setPrimaryId(d.id)} className="accent-orange-500" />
                      primary
                    </label>
                    <button type="button" onClick={() => removeDriver(d.id)} className="text-[11px] text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {picked.length < 2 && (
            <DriverSearch drivers={drivers} excludeIds={picked.map(p => p.id)} onPick={addDriver} />
          )}
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Pick two drivers; mark one as primary (the other is co).</p>
        </div>

        <div>
          <label className={S.label}>Team name</label>
          <input className={S.input} value={effectiveName} onChange={e => { setName(e.target.value); setNameEdited(true) }} placeholder="e.g. Theard / Ellis" />
        </div>

        <div>
          <label className={S.label}>Effective start</label>
          <input type="date" className={S.input} value={start} onChange={e => setStart(e.target.value)} />
        </div>

        {err && <div className={S.errorBox}>{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button type="button" onClick={save} disabled={!canSave} className={BTN_PRIMARY}>{saving ? 'Creating…' : 'Create team'}</button>
        </div>
      </div>
    </Modal>
  )
}

function AddMemberModal({ team, drivers, toast, onClose, onAdded }) {
  const [driver, setDriver] = useState(null)
  const [role, setRole] = useState('co')
  const [start, setStart] = useState(todayChicago())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    if (!driver) { setErr('Pick a driver.'); return }
    setSaving(true)
    const { error } = await supabase.rpc('add_team_member', { p_team: team.team_id, p_driver: driver.id, p_role: role, p_start: start })
    setSaving(false)
    if (error) { setErr(rpcMessage(error, "Couldn't add the member.")); return }
    toast.success('Member added')
    onAdded()
  }

  return (
    <Modal title={`Add member · ${team.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={S.label}>Driver</label>
          {driver ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2">
              <span className="text-sm text-gray-800 dark:text-slate-200 truncate">{driver.full_name} <span className="text-gray-400 dark:text-slate-500">#{driver.internal_id}</span></span>
              <button type="button" onClick={() => setDriver(null)} className="text-[11px] text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">Change</button>
            </div>
          ) : (
            <DriverSearch drivers={drivers} onPick={setDriver} />
          )}
        </div>
        <div>
          <label className={S.label}>Role</label>
          <select className={S.select + ' w-full'} value={role} onChange={e => setRole(e.target.value)}>
            <option value="co">co</option>
            <option value="primary">primary</option>
          </select>
        </div>
        <div>
          <label className={S.label}>Effective start</label>
          <input type="date" className={S.input} value={start} onChange={e => setStart(e.target.value)} />
        </div>
        {err && <div className={S.errorBox}>{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button type="button" onClick={save} disabled={saving || !driver} className={BTN_PRIMARY}>{saving ? 'Adding…' : 'Add member'}</button>
        </div>
      </div>
    </Modal>
  )
}

function EditTeamModal({ team, members, toast, onClose, onSaved }) {
  // Team start is derived from the currently-active members' effective_start.
  const active = (members || []).filter(m => !m.effective_end)
  const startVals = active.map(m => m.effective_start).filter(Boolean)
  const uniqueStarts = [...new Set(startVals)]
  const differ = uniqueStarts.length > 1                 // can't move as one date
  const derivedStart = startVals.length ? [...startVals].sort()[0] : ''  // min(active)
  const canEditStart = active.length >= 1 && !differ

  const [name, setName] = useState(team.name || '')
  const [notes, setNotes] = useState(team.notes || '')
  const [start, setStart] = useState(canEditStart ? uniqueStarts[0] : derivedStart)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    if (!name.trim()) { setErr('Team name is required.'); return }
    setSaving(true)
    // Name + notes have no RPC of their own — keep the existing direct update.
    // truck_id is intentionally dropped (the truck comes from assignments now).
    const { error } = await supabase.from('driver_teams')
      .update({ name: name.trim(), notes: notes.trim() || null })
      .eq('id', team.team_id)
    if (error) { setSaving(false); setErr(rpcMessage(error, "Couldn't save changes.")); return }
    // Move the whole team's start only when it's a single shared date that changed.
    // set_team_start touches active members only; anyone who left keeps their date.
    if (canEditStart && start && start !== uniqueStarts[0]) {
      const { error: e2 } = await supabase.rpc('set_team_start', { p_team: team.team_id, p_start: start })
      if (e2) { setSaving(false); setErr(rpcMessage(e2, "Couldn't update the start date.")); return }
    }
    setSaving(false)
    toast.success('Team updated')
    onSaved()
  }

  return (
    <Modal title="Edit team" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={S.label}>Team name</label>
          <input className={S.input} value={name} onChange={e => setName(e.target.value)} />
        </div>
        {active.length >= 1 && (
          <div>
            <label className={S.label}>Start date</label>
            {differ ? (
              <>
                <input type="date" className={`${S.input} opacity-60`} value={derivedStart} disabled readOnly />
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Members joined on different dates — edit each member below.</p>
              </>
            ) : (
              <>
                <input type="date" className={S.input} value={start} onChange={e => setStart(e.target.value)} />
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Applies to all current members. Members who already left keep their original dates.</p>
              </>
            )}
          </div>
        )}
        <div>
          <label className={S.label}>Notes</label>
          <textarea rows={3} className={S.textarea} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
        </div>
        {err && <div className={S.errorBox}>{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={BTN_PRIMARY}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}
