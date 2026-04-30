import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
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
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [tokenError, setTokenError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const { access_token, refresh_token, error } = parseHashTokens()
    if (error) { setTokenError(error); setReady(true); return }

    // Supabase v2 may already have set the session via detectSessionInUrl,
    // but we also handle the explicit case for older flows.
    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { setReady(true); return }
      if (access_token && refresh_token) {
        const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token })
        if (setErr) setTokenError(setErr.message)
      } else {
        setTokenError('Missing or expired invite link.')
      }
      setReady(true)
    }
    bootstrap()
  }, [])

  const score = useMemo(() => strengthScore(password), [password])

  async function submit(e) {
    e.preventDefault()
    if (password.length < 8) return setError('Password must be at least 8 characters.')
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
      // Don't fail the flow if the row is missing — sign-in will still work
      if (activateErr) console.warn('[SetPassword] activation update failed:', activateErr)

      // Clear the hash and route to dashboard
      if (window.history?.replaceState) {
        window.history.replaceState({}, '', window.location.pathname)
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err?.message || 'Failed to set password')
    } finally {
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
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Set your password to activate your account.</p>
        </div>

        <div className="bg-white dark:bg-white/5 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl">
          {!ready ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
            </div>
          ) : tokenError ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-red-600 dark:text-red-400">{tokenError}</p>
              <button
                onClick={() => navigate('/login')}
                className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Set a new password</h2>
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
