import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import Select from '../../../components/Select'
import { ROLES, ROLE_LABEL, ROLE_DESCRIPTION } from './userUtils'
import { useToast } from '../../../contexts/ToastContext'

const ORANGE_BTN = 'px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all'

function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) }

export default function InviteUserModal({ open, onClose, onInvited }) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('manager')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setEmail(''); setFullName(''); setRole('manager'); setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  async function submit() {
    if (!isEmail(email.trim())) return setError('Enter a valid email address')
    if (!fullName.trim())       return setError('Full name is required')
    if (!ROLES.includes(role))  return setError('Pick a role')

    setSubmitting(true); setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('invite-user', {
        body: { email: email.trim().toLowerCase(), full_name: fullName.trim(), role },
      })
      if (fnErr) throw new Error(fnErr.message || 'Invite failed')
      if (data?.error) throw new Error(data.error)
      onInvited?.({ email: email.trim().toLowerCase(), user_id: data?.user_id })
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
            <div>
              <label className={S.label}>Role</label>
              <Select value={role} onChange={e => setRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
              <p className="text-xs text-gray-500 dark:text-slate-500 mt-1.5">
                {ROLE_DESCRIPTION[role]}
              </p>
            </div>

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
