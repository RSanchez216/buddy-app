import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import Select from '../../../components/Select'
import { buildDeptOptions } from '../../../lib/deptUtils'
import { ROLES, ROLE_LABEL, rolePill, statusPill, fmtDateTime, fmtDate, WARN_CHIP } from './userUtils'
import EffectivePageList from './EffectivePageList'
import PageAccessPanel from './PageAccessPanel'
import UsageActivityPanel from './UsageActivityPanel'

const ACTION_BTN = 'px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

// Full-width user profile — the roomy replacement for the view drawer. Reuses
// the live usage RPC (via UsageActivityPanel), the effective page-access list,
// the grant editor (PageAccessPanel), and the existing user-action handlers.
export default function UserProfile() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { profile: me, isAdmin } = useAuth()

  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showAccessPanel, setShowAccessPanel] = useState(false)
  // Admin-editable fields (permission level / access role / department).
  const [roleOptions, setRoleOptions] = useState([])
  const [deptList, setDeptList] = useState([])
  const [activeAdminCount, setActiveAdminCount] = useState(0)
  const [savingField, setSavingField] = useState(null)
  const [fieldError, setFieldError] = useState('')

  const isSelf = me && user && me.id === user.id

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('users')
      .select('id, full_name, email, role, role_id, department_id, status, invited_at, last_sign_in_at, deactivated_at, created_at, invited_by')
      .eq('id', userId).maybeSingle()
    if (error || !data) { setUser(null); setLoading(false); return }

    // Resolve the inviter's name, the assigned role + department names, the
    // effective page-access count (+ individual-grant count), and — for the
    // self-demotion guard — how many active admins exist. All display-only.
    const [inv, roleRow, deptRow, eff, pagesCount, adminCnt] = await Promise.all([
      data.invited_by
        ? supabase.from('users').select('full_name, email').eq('id', data.invited_by).maybeSingle()
        : Promise.resolve({ data: null }),
      data.role_id
        ? supabase.from('roles').select('name').eq('id', data.role_id).maybeSingle()
        : Promise.resolve({ data: null }),
      data.department_id
        ? supabase.from('departments').select('name').eq('id', data.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('v_user_effective_page_access').select('page_key, source').eq('user_id', userId),
      data.role === 'admin'
        ? supabase.from('pages').select('page_key', { count: 'exact', head: true })
        : Promise.resolve({ count: null }),
      isAdmin
        ? supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('status', 'active')
        : Promise.resolve({ count: null }),
    ])

    const effRows = eff.data || []
    setActiveAdminCount(adminCnt.count ?? 0)
    setUser({
      ...data,
      invited_by_name: inv.data?.full_name || inv.data?.email || null,
      role_name: roleRow.data?.name || null,
      department_name: deptRow.data?.name || null,
      page_count: data.role === 'admin' ? (pagesCount.count || 0) : effRows.length,
      extra_count: data.role === 'admin' ? 0 : effRows.filter(r => r.source === 'individual').length,
    })
    setLoading(false)
  }, [userId, isAdmin])

  useEffect(() => { load() }, [load])

  // Option lists for the admin-only editable selects.
  useEffect(() => {
    if (!isAdmin) return
    let stale = false
    Promise.all([
      supabase.from('roles').select('id, name').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('departments').select('id, name, parent_id').eq('is_active', true).order('name'),
    ]).then(([r, d]) => {
      if (stale) return
      setRoleOptions(r.data || [])
      setDeptList(d.data || [])
    }).catch(() => { /* non-fatal: selects just stay minimal */ })
    return () => { stale = true }
  }, [isAdmin])

  // Save one privileged field: optimistic update, roll back + inline error on
  // rejection (the guard_user_privileged_columns trigger raises 42501). Never
  // alert() — it blocks the page and browser automation.
  async function patchField(field, value) {
    if (savingField) return
    setFieldError('')
    // Don't let the last active admin strip their own admin permission.
    if (field === 'role' && isSelf && user.role === 'admin' && value !== 'admin' && activeAdminCount - 1 <= 0) {
      setFieldError('You are the only admin. Promote someone else to admin before changing your own permission level.')
      return
    }
    const prev = user
    const optimistic = { ...user, [field]: value }
    if (field === 'role_id') optimistic.role_name = roleOptions.find(r => r.id === value)?.name || null
    if (field === 'department_id') optimistic.department_name = deptList.find(d => d.id === value)?.name || null
    setUser(optimistic)
    setSavingField(field)
    const { error } = await supabase.from('users').update({ [field]: value }).eq('id', prev.id)
    setSavingField(null)
    if (error) {
      setUser(prev) // rollback
      const guard = error.code === '42501' || /only an admin can change/i.test(error.message || '')
      setFieldError(guard
        ? 'Only an admin can change role, role_id, status, department, or email.'
        : (error.message || 'Update failed.'))
      return
    }
    load() // refresh derived values (page counts, admin count)
  }

  // ── User actions (same behavior as the drawer's handlers) ──────────────
  async function resetPassword() {
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/set-password`,
    })
    setBusy(false)
    if (error) { toast.error("Couldn't send password reset", error); return }
    toast.success('Password reset email sent')
  }

  async function resendInvite() {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email: user.email, full_name: user.full_name || user.email, role: user.role },
      })
      if (error || data?.error) throw new Error(error?.message || data?.error)
      toast.success('Invite resent')
    } catch (e) {
      toast.error("Couldn't resend invite", e)
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    if (isSelf) { toast.error('You cannot deactivate your own account.'); return }
    if (!confirm(`Deactivate ${user.full_name || user.email}? They will be signed out and unable to log in.`)) return
    setBusy(true)
    const { error } = await supabase.from('users').update({
      status: 'deactivated', deactivated_at: new Date().toISOString(),
    }).eq('id', user.id)
    setBusy(false)
    if (error) { toast.error("Couldn't deactivate user", error); return }
    toast.success('User deactivated'); load()
  }

  async function reactivate() {
    setBusy(true)
    const { error } = await supabase.from('users').update({
      status: 'active', deactivated_at: null,
    }).eq('id', user.id)
    setBusy(false)
    if (error) { toast.error("Couldn't reactivate user", error); return }
    toast.success('User reactivated'); load()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <BackLink navigate={navigate} />
        <div className={`${S.card} p-8 text-center text-sm text-gray-500 dark:text-slate-400`}>
          This user couldn&apos;t be found, or you don&apos;t have access to it.
        </div>
      </div>
    )
  }

  const initials = (user.full_name || user.email || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?'

  return (
    <div className="space-y-5">
      <BackLink navigate={navigate} />

      {/* ── Identity header ── */}
      <div className={`${S.card} p-5`}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center text-lg font-bold">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">{user.full_name || user.email}</h1>
                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${rolePill(user.role)}`}>
                  {ROLE_LABEL[user.role] || user.role}
                </span>
                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${statusPill(user.status)}`}>
                  {user.status}
                </span>
                {isSelf && <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-slate-500">You</span>}
              </div>
              <p className="text-sm text-gray-500 dark:text-slate-400 font-mono mt-0.5 truncate">{user.email}</p>

              {/* Facts row — Permission level / Role / Department are editable
                  for admins (inline selects), read-only text otherwise. */}
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3 mt-4">
                <EditFact label="Permission level">
                  {isAdmin ? (
                    <Select className="w-36" value={user.role} disabled={savingField === 'role'} onChange={e => patchField('role', e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>
                  ) : (
                    <FactText>{ROLE_LABEL[user.role] || user.role}</FactText>
                  )}
                </EditFact>

                <EditFact label="Role">
                  {isAdmin ? (
                    <Select className="w-44" value={user.role_id || ''} disabled={savingField === 'role_id'} onChange={e => patchField('role_id', e.target.value || null)}>
                      <option value="">No role</option>
                      {roleOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  ) : (
                    <FactText muted={!user.role_name}>{user.role_name || 'Not set'}</FactText>
                  )}
                </EditFact>

                <EditFact label="Department">
                  {isAdmin ? (
                    <Select className="w-48" value={user.department_id || ''} disabled={savingField === 'department_id'} onChange={e => patchField('department_id', e.target.value || null)}>
                      <option value="">Not set</option>
                      {buildDeptOptions(deptList).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </Select>
                  ) : (
                    <FactText muted={!user.department_name}>{user.department_name || 'Not set'}</FactText>
                  )}
                </EditFact>

                <Fact
                  label="Page access"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      {user.page_count} page{user.page_count === 1 ? '' : 's'}
                      {user.extra_count > 0 && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${WARN_CHIP}`}>+{user.extra_count}</span>
                      )}
                    </span>
                  }
                />
                <Fact label="Last sign-in" value={fmtDateTime(user.last_sign_in_at)} muted={!user.last_sign_in_at} />
                <Fact label="Invited by" value={user.invited_by_name ? `${user.invited_by_name}${user.invited_at ? ` · ${fmtDate(user.invited_at)}` : ''}` : '—'} />
              </div>

              {fieldError && (
                <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-700 dark:text-red-400">
                  <svg className="w-4 h-4 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
                  <span className="min-w-0">{fieldError}</span>
                  <button onClick={() => setFieldError('')} className="ml-auto shrink-0 font-medium hover:underline">Dismiss</button>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowAccessPanel(true)} disabled={busy} className={ACTION_BTN}>Manage access</button>
            {user.status === 'pending' && (
              <button onClick={resendInvite} disabled={busy} className={ACTION_BTN}>Resend invite</button>
            )}
            <button onClick={resetPassword} disabled={busy} className={ACTION_BTN}>Reset password</button>
            {user.status === 'active' && !isSelf && (
              <button onClick={deactivate} disabled={busy} className="px-3 py-1.5 text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-50">
                Deactivate
              </button>
            )}
            {user.status === 'deactivated' && (
              <button onClick={reactivate} disabled={busy} className="px-3 py-1.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
                Reactivate
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Main + side columns ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Usage & Activity — the point of this page. Admin-only. */}
        {isAdmin ? (
          <div className="lg:col-span-2 min-w-0">
            <div className={`${S.card} p-5`}>
              <UsageActivityPanel user={user} />
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 min-w-0">
            <div className={`${S.card} p-5 text-sm text-gray-500 dark:text-slate-400`}>
              Usage &amp; Activity is available to admins only.
            </div>
          </div>
        )}

        {/* Page access */}
        <div className="lg:col-span-1 min-w-0">
          <div className={`${S.card} p-5 space-y-4`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">Access</span>
              <button onClick={() => setShowAccessPanel(true)} className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">Edit</button>
            </div>
            <EffectivePageList user={user} />
          </div>
        </div>
      </div>

      {/* Manage access modal — reuses the existing grant editor. */}
      {showAccessPanel && createPortal(
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm" onClick={() => setShowAccessPanel(false)} />
          <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Manage page access</h3>
                <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">{user.full_name || user.email}</p>
              </div>
              <button onClick={() => setShowAccessPanel(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              <PageAccessPanel user={user} onClose={() => { setShowAccessPanel(false); load() }} />
            </div>
            <div className="border-t border-gray-100 dark:border-white/5 p-4 flex items-center justify-end">
              <button onClick={() => { setShowAccessPanel(false); load() }} className={S.btnCancel}>Done</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function BackLink({ navigate }) {
  return (
    <button onClick={() => navigate('/settings/users')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 transition-colors">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      Users
    </button>
  )
}

function Fact({ label, value, muted }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className={`text-sm mt-0.5 ${muted ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-800 dark:text-slate-200'}`}>{value}</p>
    </div>
  )
}

// A fact whose value is a control (admin) or read-only text (non-admin).
function EditFact({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1">{label}</p>
      {children}
    </div>
  )
}

function FactText({ children, muted }) {
  return <p className={`text-sm ${muted ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-800 dark:text-slate-200'}`}>{children}</p>
}
