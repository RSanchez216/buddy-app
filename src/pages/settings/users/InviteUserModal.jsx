import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import Select from '../../../components/Select'
import { buildDeptOptions } from '../../../lib/deptUtils'
import { ROLES, ROLE_LABEL, ROLE_DESCRIPTION } from './userUtils'
import { useToast } from '../../../contexts/ToastContext'
import { useAuth } from '../../../contexts/AuthContext'
import DispatcherPicker, { DISPATCHER_HELPER } from './DispatcherPicker'
import { linkUserDispatcher } from './dispatcherLink'

const ORANGE_BTN = 'px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all'

function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) }

export default function InviteUserModal({ open, onClose, onInvited }) {
  const toast = useToast()
  const { canEdit } = useAuth() // admin or manager — same gate link_user_dispatcher enforces
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  // Permission level (users.role) — governs real data access via RLS. Default
  // Viewer: Admin/Manager must be a deliberate choice (Manager alone satisfies
  // is_admin_or_manager() across ~45 policies).
  const [role, setRole] = useState('viewer')
  // Access role (users.role_id) — additive sidebar pages only, no data rights.
  const [roleId, setRoleId] = useState('')
  // Department (users.department_id) — drives Lumper "Paid from" attribution.
  const [departmentId, setDepartmentId] = useState('')
  // Dispatcher record (users.dispatcher_id) — linked straight after the invite,
  // so they sign in to a working "My drivers" rather than an empty one.
  const [dispatcher, setDispatcher] = useState(null)
  const [roles, setRoles] = useState([])
  const [departments, setDepartments] = useState([])
  const [rolePageCounts, setRolePageCounts] = useState({}) // role_id -> granted page count
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setEmail(''); setFullName(''); setRole('viewer'); setRoleId(''); setDepartmentId(''); setDispatcher(null); setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Option lists + per-role page-grant counts (for the empty-sidebar warning).
  useEffect(() => {
    if (!open) return
    let stale = false
    Promise.all([
      supabase.from('roles').select('id, name, key').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('departments').select('id, name, parent_id').eq('is_active', true).order('name'),
      supabase.from('role_page_access').select('role_id'),
    ]).then(([r, d, rpa]) => {
      if (stale) return
      setRoles(r.data || [])
      setDepartments(d.data || [])
      const counts = {}
      for (const row of rpa.data || []) counts[row.role_id] = (counts[row.role_id] || 0) + 1
      setRolePageCounts(counts)
    }).catch(() => { /* non-fatal: the pickers just stay empty */ })
    return () => { stale = true }
  }, [open])

  const deptOptions = buildDeptOptions(departments)
  const zeroPageRole = !!roleId && (rolePageCounts[roleId] ?? 0) === 0

  async function submit() {
    if (!isEmail(email.trim())) return setError('Enter a valid email address')
    if (!fullName.trim())       return setError('Full name is required')
    if (!ROLES.includes(role))  return setError('Pick a permission level')

    setSubmitting(true); setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('invite-user', {
        body: { email: email.trim().toLowerCase(), full_name: fullName.trim(), role },
      })
      if (fnErr) throw new Error(fnErr.message || 'Invite failed')
      if (data?.error) throw new Error(data.error)

      // Persist the (optional) access role + department. The edge function
      // creates the row with just the permission level; the inviting admin is
      // allowed to set these privileged columns (guard trigger permits admins).
      // Non-fatal — the invite already succeeded and they're settable later.
      const newId = data?.user_id
      const patch = {}
      if (roleId) patch.role_id = roleId
      if (departmentId) patch.department_id = departmentId
      if (newId && Object.keys(patch).length) {
        const { error: updErr } = await supabase.from('users').update(patch).eq('id', newId)
        if (updErr) toast.error("Invite sent, but couldn't set role/department — set them on the profile.", updErr)
      }

      // The dispatcher link goes through the RPC, never a direct column write —
      // it owns the one-record-one-login rule. Non-fatal for the same reason as
      // the patch above: the invite already succeeded and it's settable later.
      if (newId && dispatcher?.id) {
        try { await linkUserDispatcher(newId, dispatcher.id) }
        catch (e) { toast.error(`Invite sent, but the dispatcher record wasn't linked — ${e.message}`) }
      }

      onInvited?.({ email: email.trim().toLowerCase(), user_id: newId })
      onClose()
    } catch (e) {
      setError(e?.message || 'Invite failed')
      toast.error("Couldn't send invite", e)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Invite user</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">They'll receive an email with a link to set their password.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className={S.modalBody}>
            {error && <div className={S.errorBox}>{error}</div>}

            <div>
              <label className={S.label}>Email *</label>
              <input
                type="email" autoFocus
                className={S.input}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@manasexpress.com"
              />
            </div>
            <div>
              <label className={S.label}>Full name *</label>
              <input
                className={S.input}
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>

            {/* Permission level (users.role) — real data access */}
            <div>
              <label className={S.label}>Permission level</label>
              <Select value={role} onChange={e => setRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-1.5">
                Controls what data this person can access. Not the same as their role below.
              </p>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{ROLE_DESCRIPTION[role]}</p>
            </div>

            {/* Access role (users.role_id) — sidebar pages only */}
            <div>
              <label className={S.label}>Role</label>
              <Select value={roleId} onChange={e => setRoleId(e.target.value)}>
                <option value="">No role</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-1.5">Controls which pages appear in their sidebar.</p>
              {zeroPageRole && (
                <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                  <svg className="w-4 h-4 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
                  <span>This role has no pages assigned. They&apos;ll sign in to an empty sidebar.</span>
                </div>
              )}
            </div>

            {/* Department (users.department_id) */}
            <div>
              <label className={S.label}>Department</label>
              <Select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
                <option value="">Not set</option>
                {deptOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </Select>
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-1.5">Can be set later from the user's profile.</p>
            </div>

            {/* Dispatcher record (users.dispatcher_id) — admin/manager only.
                Deliberately NOT required: a new hire has no record until their
                first load imports, and Accounting and Fleet staff never need one. */}
            {canEdit && (
              <div>
                <label className={S.label}>Dispatcher record</label>
                <DispatcherPicker
                  selected={dispatcher}
                  onSelect={setDispatcher}
                  onClear={() => setDispatcher(null)}
                />
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-1.5">{DISPATCHER_HELPER}</p>
              </div>
            )}

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel}>Cancel</button>
              <button onClick={submit} disabled={submitting} className={ORANGE_BTN}>
                {submitting ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
