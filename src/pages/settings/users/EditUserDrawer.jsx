import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Select from '../../../components/Select'
import { ROLES, ROLE_LABEL, rolePill, statusPill, fmtDateTime } from './userUtils'
import { useToast } from '../../../contexts/ToastContext'

const ORANGE_BTN = 'px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all'
const ACTION_BTN = 'px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors'

export default function EditUserDrawer({ open, user, onClose, onChange, onSuccess, allUsers }) {
  const { profile: me } = useAuth()
  const toast = useToast()
  const isSelf = me && user && me.id === user.id

  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('viewer')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false) // for resend / reset / deactivate
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !user) return
    setFullName(user.full_name || '')
    setRole(user.role || 'viewer')
    setError('')
  }, [open, user])

  if (!open || !user) return null

  // Self-protection: are we the only active admin?
  const otherActiveAdmins = (allUsers || [])
    .filter(u => u.id !== user.id && u.role === 'admin' && u.status === 'active')
    .length

  const wouldOrphanAdmin = isSelf && user.role === 'admin' && role !== 'admin' && otherActiveAdmins === 0

  async function save() {
    if (!fullName.trim()) return setError('Full name is required')
    if (!ROLES.includes(role)) return setError('Invalid role')
    if (wouldOrphanAdmin) return setError('You are the only admin. Promote someone else to admin before changing your role.')

    setSaving(true); setError('')
    const { error: updErr } = await supabase.from('users').update({
      full_name: fullName.trim(),
      role,
    }).eq('id', user.id)
    setSaving(false)
    if (updErr) { setError(updErr.message); toast.error("Couldn't update user", updErr); return }
    onSuccess?.('User updated')
    onChange?.()
  }

  async function resendInvite() {
    setBusy(true); setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('invite-user', {
        body: { email: user.email, full_name: user.full_name || fullName, role: user.role },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (data?.error) throw new Error(data.error)
      onSuccess?.('Invite resent')
    } catch (e) {
      setError('Resend failed: ' + (e?.message || 'unknown error'))
      toast.error("Couldn't resend invite", e)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    setBusy(true); setError('')
    const { error: rpErr } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/auth/set-password`,
    })
    setBusy(false)
    if (rpErr) { setError('Reset failed: ' + rpErr.message); toast.error("Couldn't send password reset", rpErr); return }
    onSuccess?.('Password reset email sent')
  }

  async function deactivate() {
    if (isSelf) return setError('You cannot deactivate your own account.')
    if (!confirm(`Deactivate ${user.full_name || user.email}? They will be signed out and unable to log in.`)) return
    setBusy(true); setError('')
    const { error: dErr } = await supabase.from('users').update({
      status: 'deactivated',
      deactivated_at: new Date().toISOString(),
    }).eq('id', user.id)
    setBusy(false)
    if (dErr) { setError(dErr.message); toast.error("Couldn't deactivate user", dErr); return }
    onSuccess?.('User deactivated')
    onChange?.()
    onClose?.()
  }

  async function reactivate() {
    setBusy(true); setError('')
    const { error: rErr } = await supabase.from('users').update({
      status: 'active',
      deactivated_at: null,
    }).eq('id', user.id)
    setBusy(false)
    if (rErr) { setError(rErr.message); toast.error("Couldn't reactivate user", rErr); return }
    onSuccess?.('User reactivated')
    onChange?.()
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end" onMouseDown={e => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white dark:bg-[#0d0d1f] border-l border-gray-200 dark:border-white/10 shadow-2xl overflow-y-auto">
        <div className="flex items-start justify-between p-4 border-b border-gray-100 dark:border-white/5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${rolePill(user.role)}`}>
                {ROLE_LABEL[user.role] || user.role}
              </span>
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${statusPill(user.status)}`}>
                {user.status}
              </span>
              {isSelf && <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-slate-500">You</span>}
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mt-2 truncate">{user.full_name || user.email}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500 truncate">{user.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && <div className={S.errorBox}>{error}</div>}

          {wouldOrphanAdmin && (
            <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-xs text-amber-700 dark:text-amber-400">
              You are the only admin. Promote someone else to admin before changing your role.
            </div>
          )}

          <div>
            <label className={S.label}>Full name</label>
            <input className={S.input} value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div>
            <label className={S.label}>Role</label>
            <Select value={role} onChange={e => setRole(e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
            {isSelf && (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Changing your own role takes effect after the next page load.</p>
            )}
          </div>

          <div className={`${S.card} p-4 space-y-2 text-sm`}>
            <Row label="Email" value={user.email} mono />
            <Row label="Invited by" value={user.invited_by_name || (user.invited_by ? user.invited_by : '—')} />
            <Row label="Invited at" value={fmtDateTime(user.invited_at)} />
            <Row label="Last sign-in" value={fmtDateTime(user.last_sign_in_at)} muted={!user.last_sign_in_at} />
            <Row label="Created" value={fmtDateTime(user.created_at)} />
            {user.deactivated_at && <Row label="Deactivated" value={fmtDateTime(user.deactivated_at)} />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {user.status === 'pending' && (
              <button onClick={resendInvite} disabled={busy} className={ACTION_BTN}>Resend invite</button>
            )}
            <button onClick={resetPassword} disabled={busy} className={ACTION_BTN}>Reset password</button>
            {user.status === 'active' && !isSelf && (
              <button onClick={deactivate} disabled={busy} className="px-3 py-1.5 text-xs font-medium bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors">
                Deactivate
              </button>
            )}
            {user.status === 'deactivated' && (
              <button onClick={reactivate} disabled={busy} className="px-3 py-1.5 text-xs font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
                Reactivate
              </button>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-[#0d0d1f] p-4 border-t border-gray-100 dark:border-white/5 flex items-center justify-end gap-2">
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving || wouldOrphanAdmin} className={ORANGE_BTN}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Row({ label, value, mono, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono' : ''} ${muted ? 'text-gray-400 dark:text-slate-500 italic' : 'text-gray-700 dark:text-slate-300'} text-right break-all`}>
        {value || '—'}
      </span>
    </div>
  )
}
