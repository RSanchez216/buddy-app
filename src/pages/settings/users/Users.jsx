import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import { ROLE_LABEL, rolePill, statusPill, fmtDateTime } from './userUtils'
import InviteUserModal from './InviteUserModal'
import EditUserDrawer from './EditUserDrawer'

const ORANGE_BTN = 'flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20'

export default function Users() {
  const { profile, loading: authLoading, isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [toast, setToast] = useState(null)

  // Admin gate — viewers and managers shouldn't see this page even by URL
  if (!authLoading && !isAdmin) return <Navigate to="/" replace />

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

  function showToast(message) {
    setToast({ message })
    setTimeout(() => setToast(null), 4000)
  }

  async function load() {
    setLoading(true)
    // Self-join via FK alias to fetch the inviter's name
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, status, invited_at, last_sign_in_at, deactivated_at, created_at, invited_by, inviter:users!users_invited_by_fkey(full_name, email)')
      .order('created_at', { ascending: false })

    if (!error) {
      const flat = (data || []).map(u => ({
        ...u,
        invited_by_name: u.inviter?.full_name || u.inviter?.email || null,
      }))
      setUsers(flat)
    }
    setLoading(false)
  }

  const activeAdminCount = useMemo(
    () => users.filter(u => u.role === 'admin' && u.status === 'active').length,
    [users]
  )

  async function resendInvite(u) {
    setOpenMenuId(null)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email: u.email, full_name: u.full_name || u.email, role: u.role },
      })
      if (error || data?.error) throw new Error(error?.message || data?.error)
      showToast(`Invite resent to ${u.email}`)
    } catch (e) {
      alert('Resend failed: ' + (e?.message || ''))
    }
  }

  async function resetPassword(u) {
    setOpenMenuId(null)
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: `${window.location.origin}/auth/set-password`,
    })
    if (error) { alert('Reset failed: ' + error.message); return }
    showToast(`Password reset email sent to ${u.email}`)
  }

  async function deactivate(u) {
    setOpenMenuId(null)
    if (u.id === profile?.id) { alert('You cannot deactivate your own account.'); return }
    if (!confirm(`Deactivate ${u.full_name || u.email}? They will be unable to sign in.`)) return
    const { error } = await supabase.from('users').update({
      status: 'deactivated', deactivated_at: new Date().toISOString(),
    }).eq('id', u.id)
    if (error) { alert(error.message); return }
    showToast('User deactivated')
    load()
  }

  async function reactivate(u) {
    setOpenMenuId(null)
    const { error } = await supabase.from('users').update({
      status: 'active', deactivated_at: null,
    }).eq('id', u.id)
    if (error) { alert(error.message); return }
    showToast('User reactivated')
    load()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }

  return (
    <div className="space-y-5">
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
                {['Name', 'Email', 'Role', 'Status', 'Last sign-in', 'Invited by', ''].map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500 mx-auto" /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No users yet</td></tr>
              ) : users.map(u => {
                const isSelf = u.id === profile?.id
                return (
                  <tr key={u.id} className={`${S.tableRow} cursor-pointer`} onClick={() => setEditUser(u)}>
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                      {u.full_name || '—'}
                      {isSelf && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">You</span>}
                    </td>
                    <td className={`${S.td} text-gray-500 dark:text-slate-400 font-mono text-xs`}>{u.email}</td>
                    <td className={S.td}>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rolePill(u.role)}`}>
                        {ROLE_LABEL[u.role] || u.role}
                      </span>
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
        onInvited={({ email }) => { showToast(`Invite sent to ${email}`); load() }}
      />
      <EditUserDrawer
        open={!!editUser}
        user={editUser}
        allUsers={users}
        onClose={() => setEditUser(null)}
        onChange={load}
        onSuccess={showToast}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border border-emerald-200 dark:border-emerald-500/30 rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">{toast.message}</div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
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
