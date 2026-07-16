import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import { ROLE_LABEL, rolePill, statusPill, fmtDateTime, WARN_CHIP } from './userUtils'
import InviteUserModal from './InviteUserModal'
import EditUserDrawer from './EditUserDrawer'
import Pages from './Pages'
import Roles from './Roles'
import { useToast } from '../../../contexts/ToastContext'

const ORANGE_BTN = 'flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20'

export default function Users() {
  const { profile, loading: authLoading, isAdmin } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('users') // 'users' | 'roles' | 'pages'
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [effAccess, setEffAccess] = useState(new Map()) // user_id -> { count, extras: [page_key] }
  const [pageLabels, setPageLabels] = useState(new Map()) // page_key -> label
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)

  useEffect(() => { load() }, [])

  // Click-away handler for kebab menus
  useEffect(() => {
    if (!openMenuId) return
    function onClickAway(e) {
      if (!e.target.closest?.('[data-user-menu]')) setOpenMenuId(null)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [openMenuId])

  // Admin gate — viewers and managers shouldn't see this page even by URL.
  // Must be evaluated AFTER all hooks above so the hook count stays stable
  // across renders (otherwise React error #300).
  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

  async function load() {
    setLoading(true)
    // Plain select — the embedded self-join via users!users_invited_by_fkey
    // returns 400 from PostgREST on self-referential relationships, so we
    // resolve the inviter's name client-side from the same fetched list.
    // Roles (for the Role dropdown), effective page access (for the Pages
    // column, read from the view — never by unioning the two grant tables),
    // and page labels (for the +badge tooltip) load alongside.
    const [
      { data, error },
      { data: rolesData },
      { data: effData },
      { data: pagesData },
    ] = await Promise.all([
      supabase.from('users')
        .select('id, full_name, email, role, role_id, status, invited_at, last_sign_in_at, deactivated_at, created_at, invited_by')
        .order('created_at', { ascending: false }),
      supabase.from('roles').select('id, name, is_active, sort_order').order('sort_order'),
      supabase.from('v_user_effective_page_access').select('user_id, page_key, source'),
      supabase.from('pages').select('page_key, label'),
    ])

    if (error) {
      console.error('[Users] load failed:', error)
      setUsers([])
      setLoading(false)
      return
    }

    const rows = data || []
    const byId = new Map(rows.map(u => [u.id, u]))
    const flat = rows.map(u => {
      const inv = u.invited_by ? byId.get(u.invited_by) : null
      return { ...u, invited_by_name: inv?.full_name || inv?.email || null }
    })

    // Effective page count per user + the individually-granted extras (source
    // 'individual' or 'both') for the +badge and its tooltip.
    const eff = new Map()
    for (const r of effData || []) {
      let e = eff.get(r.user_id)
      if (!e) { e = { count: 0, extras: [] }; eff.set(r.user_id, e) }
      e.count++
      if (r.source === 'individual' || r.source === 'both') e.extras.push(r.page_key)
    }

    setUsers(flat)
    setRoles(rolesData || [])
    setEffAccess(eff)
    setPageLabels(new Map((pagesData || []).map(p => [p.page_key, p.label])))
    setTotalPages((pagesData || []).length)
    setLoading(false)
  }

  async function changeRole(u, roleId) {
    const { error } = await supabase.from('users').update({ role_id: roleId || null }).eq('id', u.id)
    if (error) { toast.error("Couldn't update role", error); return }
    toast.success(`Role updated — ${u.full_name || u.email}`)
    load()
  }

  async function resendInvite(u) {
    setOpenMenuId(null)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email: u.email, full_name: u.full_name || u.email, role: u.role },
      })
      if (error || data?.error) throw new Error(error?.message || data?.error)
      toast.success(`Invite resent to ${u.email}`)
    } catch (e) {
      toast.error("Couldn't resend invite", e)
    }
  }

  async function resetPassword(u) {
    setOpenMenuId(null)
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: `${window.location.origin}/auth/set-password`,
    })
    if (error) { toast.error("Couldn't send password reset", error); return }
    toast.success(`Password reset email sent to ${u.email}`)
  }

  async function deactivate(u) {
    setOpenMenuId(null)
    if (u.id === profile?.id) { toast.error('You cannot deactivate your own account.'); return }
    if (!confirm(`Deactivate ${u.full_name || u.email}? They will be unable to sign in.`)) return
    const { error } = await supabase.from('users').update({
      status: 'deactivated', deactivated_at: new Date().toISOString(),
    }).eq('id', u.id)
    if (error) { toast.error("Couldn't deactivate user", error); return }
    toast.success(`User deactivated — ${u.full_name || u.email}`)
    load()
  }

  async function reactivate(u) {
    setOpenMenuId(null)
    const { error } = await supabase.from('users').update({
      status: 'active', deactivated_at: null,
    }).eq('id', u.id)
    if (error) { toast.error("Couldn't reactivate user", error); return }
    toast.success(`User reactivated — ${u.full_name || u.email}`)
    load()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  const TAB_LABELS = { users: 'Users', roles: 'Roles', pages: 'Pages' }
  const TabSwitch = () => (
    <div className="flex gap-2">
      {['users', 'roles', 'pages'].map(tabName => (
        <button
          key={tabName}
          onClick={() => setTab(tabName)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === tabName
              ? 'bg-orange-500 text-white'
              : 'bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-white/10'
          }`}
        >
          {TAB_LABELS[tabName]}
        </button>
      ))}
    </div>
  )

  if (tab === 'roles') {
    return (
      <div className="space-y-5">
        <TabSwitch />
        <Roles />
      </div>
    )
  }

  if (tab === 'pages') {
    return (
      <div className="space-y-5">
        <TabSwitch />
        <Pages />
      </div>
    )
  }

  const activeAdminCount = users.filter(u => u.role === 'admin' && u.status === 'active').length

  return (
    <div className="space-y-5">
      <TabSwitch />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            {users.length} total · {users.filter(u => u.status === 'active').length} active · {activeAdminCount} admin{activeAdminCount === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={() => setShowInvite(true)} className={ORANGE_BTN}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Invite user
        </button>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Name', 'Email', 'Permission', 'Role', 'Pages', 'Status', 'Last sign-in', 'Invited by', ''].map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500 mx-auto" /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No users yet</td></tr>
              ) : users.map(u => {
                const isSelf = u.id === profile?.id
                return (
                  <tr key={u.id} className={`${S.tableRow} cursor-pointer`} onClick={() => setEditUser(u)}>
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                      {u.full_name || '—'}
                      {isSelf && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">You</span>}
                    </td>
                    <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>{u.email}</td>
                    {/* Permission — the existing users.role (Admin/Manager). Relabelled
                        header only; the DB column and its value are untouched. */}
                    <td className={S.td}>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rolePill(u.role)}`}>
                        {ROLE_LABEL[u.role] || u.role}
                      </span>
                    </td>
                    {/* Role — the new users.role_id (menu/page access only). Admins
                        bypass everything, so they show — instead of a dropdown. */}
                    <td className={S.td} onClick={e => e.stopPropagation()}>
                      {u.role === 'admin' ? (
                        <span className="text-gray-400 dark:text-slate-500">—</span>
                      ) : (
                        <select
                          value={u.role_id || ''}
                          onChange={e => changeRole(u, e.target.value)}
                          className={`${S.select} text-xs py-1 px-2 ${!u.role_id ? '!text-amber-700 dark:!text-amber-400 !border-amber-300 dark:!border-amber-500/40' : ''}`}
                          title={u.role_id ? 'Change role' : 'No role assigned'}
                        >
                          <option value="">— No role —</option>
                          {roles.filter(r => r.is_active || r.id === u.role_id).map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    {/* Pages — effective count from the view; +badge = individual grants. */}
                    <td className={S.td}>
                      {u.role === 'admin' ? (
                        <span className="text-gray-500 dark:text-slate-400 text-xs">all {totalPages}</span>
                      ) : (() => {
                        const e = effAccess.get(u.id) || { count: 0, extras: [] }
                        return (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-gray-700 dark:text-slate-300 text-xs tabular-nums">{e.count}</span>
                            {e.extras.length > 0 && (
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${WARN_CHIP}`}
                                title={`Individual grant${e.extras.length === 1 ? '' : 's'}: ${e.extras.map(k => pageLabels.get(k) || k).join(', ')}`}
                              >
                                +{e.extras.length}
                              </span>
                            )}
                          </span>
                        )
                      })()}
                    </td>
                    <td className={S.td}>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusPill(u.status)}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                        {u.status}
                      </span>
                    </td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs whitespace-nowrap`}>{fmtDateTime(u.last_sign_in_at)}</td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{u.invited_by_name || '—'}</td>
                    <td className={`${S.td} text-right whitespace-nowrap`} onClick={e => e.stopPropagation()}>
                      <div className="relative inline-block" data-user-menu>
                        <button
                          onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-white/5"
                          title="Actions"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
                          </svg>
                        </button>
                        {openMenuId === u.id && (
                          <div className="absolute right-0 mt-1 w-44 rounded-xl bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-xl py-1 z-10 text-left">
                            <MenuItem onClick={() => { setOpenMenuId(null); setEditUser(u) }}>Edit</MenuItem>
                            {u.status === 'pending' && (
                              <MenuItem onClick={() => resendInvite(u)}>Resend invite</MenuItem>
                            )}
                            <MenuItem onClick={() => resetPassword(u)}>Reset password</MenuItem>
                            {u.status === 'active' && !isSelf && (
                              <MenuItem onClick={() => deactivate(u)} danger>Deactivate</MenuItem>
                            )}
                            {u.status === 'deactivated' && (
                              <MenuItem onClick={() => reactivate(u)}>Reactivate</MenuItem>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <InviteUserModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onInvited={({ email }) => { toast.success(`Invite sent to ${email}`); load() }}
      />
      <EditUserDrawer
        open={!!editUser}
        user={editUser}
        allUsers={users}
        onClose={() => setEditUser(null)}
        onChange={load}
        onSuccess={(msg) => toast.success(msg)}
      />
    </div>
  )
}

function MenuItem({ onClick, danger, children }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left px-3 py-2 text-sm transition-colors ${
        danger
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  )
}
