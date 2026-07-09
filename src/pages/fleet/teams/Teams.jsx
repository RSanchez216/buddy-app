import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'

// Teams — link drivers who run as a team (two drivers, one truck) with
// effective dates. Read model: v_driver_teams_admin. Mutations go through the
// shipped RPCs (create_team_with_members / add_team_member / end_team_member /
// dissolve_team); name/truck/notes + reactivate are direct driver_teams writes.

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

// Optional truck picker (unit number search → truck_id | null).
function TruckPicker({ trucks, value, onChange }) {
  const [q, setQ] = useState('')
  const selected = value ? trucks.find(t => t.id === value) : null
  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    return trucks.filter(t => !s || String(t.unit_number || '').toLowerCase().includes(s)).slice(0, 8)
  }, [trucks, q])
  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-300 dark:border-slate-700 px-3 py-2">
        <span className="text-sm text-gray-800 dark:text-slate-200">Truck #{selected.unit_number}</span>
        <button type="button" onClick={() => onChange(null)} className="text-[11px] text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">Change</button>
      </div>
    )
  }
  return (
    <div>
      <input className={`${S.input}`} value={q} onChange={e => setQ(e.target.value)} placeholder="Search truck unit… (optional)" />
      {q.trim() && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/5">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches</p>
          ) : results.map(t => (
            <button key={t.id} type="button" onClick={() => { onChange(t.id); setQ('') }}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-slate-200 hover:bg-orange-50 dark:hover:bg-orange-500/10">Truck #{t.unit_number}</button>
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

export default function Teams() {
  const toast = useToast()
  const [teams, setTeams] = useState(null)
  const [drivers, setDrivers] = useState([])
  const [trucks, setTrucks] = useState([])
  const [error, setError] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [addFor, setAddFor] = useState(null)   // team object for add-member modal
  const [editFor, setEditFor] = useState(null) // team object for edit modal

  const truckUnit = useMemo(() => {
    const m = new Map(trucks.map(t => [t.id, t.unit_number]))
    return (id) => (id ? (m.get(id) ? `#${m.get(id)}` : '#—') : null)
  }, [trucks])

  async function loadTeams() {
    const { data, error: err } = await supabase.from('v_driver_teams_admin').select('*').order('status').order('name')
    if (err) throw err
    setTeams(data || [])
  }
  async function refreshTeams() {
    try { await loadTeams() } catch (e) { toast.error("Couldn't refresh teams", e) }
  }
  // Initial load — setState lives in the .then/.catch callbacks (async), never
  // synchronously in the effect body.
  useEffect(() => {
    let stale = false
    Promise.all([
      supabase.from('v_driver_teams_admin').select('*').order('status').order('name'),
      supabase.from('drivers').select('id, full_name, internal_id, driver_type, compensation_type').neq('current_status', 'terminated').order('full_name'),
      supabase.from('trucks').select('id, unit_number').order('unit_number'),
    ]).then(([teamsRes, driversRes, trucksRes]) => {
      if (stale) return
      if (teamsRes.error) { setError(rpcMessage(teamsRes.error, String(teamsRes.error))); setTeams([]) }
      else setTeams(teamsRes.data || [])
      if (!driversRes.error) setDrivers(driversRes.data || [])
      if (!trucksRes.error) setTrucks(trucksRes.data || [])
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
            <TeamCard key={t.team_id} team={t} truckUnit={truckUnit} onAdd={() => setAddFor(t)} onEdit={() => setEditFor(t)} onChanged={refreshTeams} toast={toast} />
          ))}
          {dissolved.length > 0 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 pt-2">Dissolved</p>
              {dissolved.map(t => (
                <TeamCard key={t.team_id} team={t} truckUnit={truckUnit} onAdd={() => setAddFor(t)} onEdit={() => setEditFor(t)} onChanged={refreshTeams} toast={toast} />
              ))}
            </>
          )}
        </div>
      )}

      {newOpen && (
        <NewTeamModal drivers={drivers} trucks={trucks} toast={toast}
          onClose={() => setNewOpen(false)}
          onCreated={async () => { setNewOpen(false); await refreshTeams() }} />
      )}
      {addFor && (
        <AddMemberModal team={addFor} drivers={drivers} toast={toast}
          onClose={() => setAddFor(null)}
          onAdded={async () => { setAddFor(null); await refreshTeams() }} />
      )}
      {editFor && (
        <EditTeamModal team={editFor} trucks={trucks} toast={toast}
          onClose={() => setEditFor(null)}
          onSaved={async () => { setEditFor(null); await refreshTeams() }} />
      )}
    </div>
  )
}

function TeamCard({ team, truckUnit, onAdd, onEdit, onChanged, toast }) {
  const dissolved = team.status !== 'active'
  const members = Array.isArray(team.members) ? team.members : []
  const [endingMember, setEndingMember] = useState(null) // member_id with open date confirm
  const [confirmDissolve, setConfirmDissolve] = useState(false)
  const [busy, setBusy] = useState(false)
  const unit = truckUnit(team.truck_id)

  async function endMember(memberId, endDate) {
    setBusy(true)
    const { error } = await supabase.rpc('end_team_member', { p_member: memberId, p_end: endDate })
    setBusy(false)
    if (error) { toast.error("Couldn't end this membership", rpcMessage(error, 'Try again')); return }
    setEndingMember(null); toast.success('Membership ended'); onChanged()
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
            since {fmtDate(team.since)} · {unit ? `Truck ${unit}` : 'no truck'}
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
      {members.length === 0 ? (
        <div className="px-4 py-4 text-sm text-gray-400 dark:text-slate-500">No open members.</div>
      ) : (
        <ul className="divide-y divide-gray-50 dark:divide-white/[0.03]">
          {members.map(m => (
            <li key={m.member_id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 dark:text-slate-200 truncate">{m.full_name}</span>
                  <span className="text-[11px] text-gray-400 dark:text-slate-500">#{m.internal_id}</span>
                  <RolePill role={m.role} />
                  <span className="text-[11px] text-gray-400 dark:text-slate-500">since {fmtDate(m.effective_start)}</span>
                  <PayTag compensationType={m.compensation_type} driverType={m.driver_type} />
                </div>
                {!dissolved && (
                  <button onClick={() => setEndingMember(endingMember === m.member_id ? null : m.member_id)}
                    className="text-[11px] font-medium text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400">End</button>
                )}
              </div>
              {endingMember === m.member_id && (
                <div className="mt-2">
                  <InlineDateConfirm label="Ended on" cta="End" tone="danger" busy={busy}
                    onConfirm={(d) => endMember(m.member_id, d)} onCancel={() => setEndingMember(null)} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewTeamModal({ drivers, trucks, toast, onClose, onCreated }) {
  const [picked, setPicked] = useState([]) // driver objects (max 2)
  const [primaryId, setPrimaryId] = useState(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [truckId, setTruckId] = useState(null)
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
    const { error } = await supabase.rpc('create_team_with_members', {
      p_name: effectiveName.trim(), p_truck_id: truckId, p_start: start, p_members: members,
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
          <label className={S.label}>Truck (optional)</label>
          <TruckPicker trucks={trucks} value={truckId} onChange={setTruckId} />
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

function EditTeamModal({ team, trucks, toast, onClose, onSaved }) {
  const [name, setName] = useState(team.name || '')
  const [truckId, setTruckId] = useState(team.truck_id || null)
  const [notes, setNotes] = useState(team.notes || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    if (!name.trim()) { setErr('Team name is required.'); return }
    setSaving(true)
    const { error } = await supabase.from('driver_teams')
      .update({ name: name.trim(), truck_id: truckId, notes: notes.trim() || null })
      .eq('id', team.team_id)
    setSaving(false)
    if (error) { setErr(rpcMessage(error, "Couldn't save changes.")); return }
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
        <div>
          <label className={S.label}>Truck</label>
          <TruckPicker trucks={trucks} value={truckId} onChange={setTruckId} />
        </div>
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
