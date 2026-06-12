import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { S } from '../lib/styles'
import { BuddyLogoSmall } from '../components/BuddyLogo'

const ORANGE_BTN = 'w-full px-4 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all'

export default function AcceptInvite() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [inviteExpired, setInviteExpired] = useState(false)

  const token = searchParams.get('token')

  useEffect(() => {
    async function checkInvite() {
      if (!token) {
        setInviteExpired(true)
        setLoading(false)
        return
      }

      try {
        // Try to get the user via the invite token
        const { data, error: err } = await supabase.auth.getSession()

        // If no session yet and we have a token, we need the user to set password
        if (!data.session && token) {
          setLoading(false)
          return
        }

        // If already signed in, redirect home
        if (data.session) {
          navigate('/')
        }
      } catch (e) {
        console.error('Invite check failed:', e)
        setInviteExpired(true)
      }

      setLoading(false)
    }

    checkInvite()
  }, [token, navigate])

  async function submit(e) {
    e.preventDefault()
    setError('')

    if (!fullName.trim()) return setError('Full name is required')
    if (!password) return setError('Password is required')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (password !== passwordConfirm) return setError('Passwords do not match')

    setSubmitting(true)

    try {
      // Update the user's password and full_name via the auth API
      const { error: updateErr } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim() },
      })

      if (updateErr) {
        setError(updateErr.message || 'Failed to set password')
        setSubmitting(false)
        return
      }

      // Success — redirect to dashboard
      navigate('/')
    } catch (e) {
      setError(e?.message || 'An unexpected error occurred')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#09091a] flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    )
  }

  if (inviteExpired) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#09091a] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-[#0d0d1f] rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Invite Expired</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
            This invite link has expired. Please ask an admin to send you a new invite.
          </p>
          <a href="/login" className={S.btnSecondary + ' inline-block'}>
            Go to login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#09091a] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0d0d1f] rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg p-8 max-w-md w-full">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <BuddyLogoSmall className="w-8 h-8" />
          <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-fuchsia-500">BUDDY</span>
        </div>

        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Complete your setup</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Set your password to get started</p>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="space-y-4">
          {error && <div className={S.errorBox}>{error}</div>}

          <div>
            <label className={S.label}>Full name</label>
            <input
              type="text"
              className={S.input}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your full name"
              autoFocus
            />
          </div>

          <div>
            <label className={S.label}>Password</label>
            <input
              type="password"
              className={S.input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label className={S.label}>Confirm password</label>
            <input
              type="password"
              className={S.input}
              value={passwordConfirm}
              onChange={e => setPasswordConfirm(e.target.value)}
              placeholder="Confirm your password"
            />
          </div>

          <button type="submit" disabled={submitting} className={ORANGE_BTN}>
            {submitting ? 'Setting up…' : 'Complete enrollment'}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-white/5 text-center text-xs text-gray-500 dark:text-slate-400">
          Already enrolled? <a href="/login" className="text-orange-600 dark:text-orange-400 hover:underline">Sign in</a>
        </div>
      </div>
    </div>
  )
}
