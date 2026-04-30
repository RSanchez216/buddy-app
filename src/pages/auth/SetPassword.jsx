import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import BuddyLogo from '../../components/BuddyLogo'

// Reads the recovery/invite tokens that Supabase puts in the URL hash
// (e.g. #access_token=...&refresh_token=...&type=invite),
// installs the session, lets the user pick a new password, and flips their
// public.users.status from 'pending' to 'active' on success.
function parseHashTokens() {
  if (typeof window === 'undefined') return {}
  const hash = window.location.hash.replace(/^#/, '')
  const params = new URLSearchParams(hash)
  return {
    access_token:  params.get('access_token') || null,
    refresh_token: params.get('refresh_token') || null,
    type:          params.get('type') || null,
    error:         params.get('error_description') || params.get('error') || null,
  }
}

function strengthScore(pw) {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score // 0..5
}

const STRENGTH_LABEL = ['Too short', 'Weak', 'Okay', 'Good', 'Strong', 'Excellent']
const STRENGTH_COLOR = [
  'bg-gray-300', 'bg-red-400', 'bg-amber-400', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-600',
]

export default function SetPassword() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [tokenError, setTokenError] = useState('')
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const { access_token, refresh_token, error } = parseHashTokens()
    if (error) { setTokenError(error); setReady(true); return }

    // Supabase v2 may have already installed the session via detectSessionInUrl
    // before this component mounted. We handle both cases.
    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setEmail(session.user?.email || '')
        setReady(true); return
      }
      if (access_token && refresh_token) {
        const { data, error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
        if (setErr) { setTokenError(setErr.message); setReady(true); return }
        setEmail(data?.session?.user?.email || data?.user?.email || '')
      } else {
        setTokenError('Invalid or expired invite link.')
      }
      setReady(true)
    }
    bootstrap()
  }, [])

  const score = useMemo(() => strengthScore(password), [password])

  function validatePassword(pw) {
    if (pw.length < 8) return 'Password must be at least 8 characters.'
    if (!/\d/.test(pw)) return 'Password must contain at least one number.'
    return null
  }

  async function submit(e) {
    e.preventDefault()
    const pwErr = validatePassword(password)
    if (pwErr) return setError(pwErr)
    if (password !== confirm) return setError('Passwords do not match.')
    setSubmitting(true); setError('')

    try {
      const { data: { user }, error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw new Error(updErr.message)
      if (!user) throw new Error('No active session — open the invite link again.')

      // Activate the public.users row tied to this auth user
      const { error: activateErr } = await supabase
        .from('users')
        .update({ status: 'active' })
        .eq('id', user.id)
      if (activateErr) console.warn('[SetPassword] activation update failed:', activateErr)

      // Refresh the AuthContext profile so ProtectedRoute sees status='active'
      // before we navigate. Without this, the next render would bounce back here.
      await refreshProfile?.()

      // Clear the hash to prevent confusion if the user hits Back
      if (window.history?.replaceState) {
        window.history.replaceState({}, '', window.location.pathname)
      }

      // Brief success splash before redirecting
      setSuccess(true)
      setTimeout(() => navigate('/', { replace: true }), 1200)
    } catch (err) {
      setError(err?.message || 'Failed to set password')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#09091a] flex items-center justify-center px-4">
      <div className="relative max-w-sm w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-3">
            <BuddyLogo className="w-14 h-14" />
            <h1 className="text-4xl font-black tracking-tighter leading-none text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-cyan-400 to-fuchsia-500">
              BUDDY
            </h1>
          </div>
        </div>

        <div className="bg-white dark:bg-white/5 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl">
          {!ready ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
            </div>
          ) : tokenError ? (
            <div className="text-center space-y-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Invalid link</h2>
              <p className="text-sm text-red-600 dark:text-red-400">{tokenError}</p>
              <p className="text-xs text-gray-500 dark:text-slate-500">If your invite expired, ask an admin to resend it.</p>
              <button
                onClick={() => navigate('/login')}
                className="inline-block mt-2 px-4 py-2 text-sm font-semibold text-slate-900 bg-cyan-500 hover:bg-cyan-400 rounded-xl transition-all"
              >
                Go to sign in
              </button>
            </div>
          ) : success ? (
            <div className="text-center space-y-3 py-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Password set! Welcome to BUDDY.</p>
              <p className="text-xs text-gray-500 dark:text-slate-500">Taking you to the dashboard…</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Welcome to BUDDY — set your password</h2>
                {email && (
                  <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Signed in as <span className="font-mono text-gray-700 dark:text-slate-300">{email}</span></p>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">{error}</div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">New password</label>
                <input
                  type="password" autoFocus required
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/50 rounded-xl text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  placeholder="••••••••"
                />
                {password && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <span
                          key={i}
                          className={`h-1 flex-1 rounded ${i <= score ? STRENGTH_COLOR[score] : 'bg-gray-200 dark:bg-slate-700'}`}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">
                      {STRENGTH_LABEL[Math.max(0, score - 1) || 0]}
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">Minimum 8 characters and at least one number.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Confirm password</label>
                <input
                  type="password" required
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/50 rounded-xl text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <button
                type="submit" disabled={submitting}
                className="w-full mt-2 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-orange-500 hover:bg-orange-400 disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20"
              >
                {submitting ? 'Saving…' : 'Set password and continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
