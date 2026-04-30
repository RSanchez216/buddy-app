import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import BuddyLogo from '../components/BuddyLogo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const { signIn, accessError, setAccessError } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setAccessError?.('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) { setError(error.message); setLoading(false) }
    else navigate('/')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#09091a] flex items-center justify-center px-4 relative overflow-hidden transition-colors duration-300">

      {/* Dark mode ambient glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-cyan-500/10 rounded-full blur-[130px] pointer-events-none hidden dark:block" />
      <div className="absolute bottom-1/3 left-1/4 w-[350px] h-[350px] bg-fuchsia-500/10 rounded-full blur-[110px] pointer-events-none hidden dark:block" />

      {/* Ghost "BUDDY" watermark behind everything */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
        aria-hidden="true"
      >
        <span
          className="text-[22vw] font-black tracking-tighter leading-none
            text-gray-900/[0.025] dark:text-white/[0.025]"
        >
          BUDDY
        </span>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-2 rounded-xl text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </button>

      <div className="relative max-w-sm w-full">

        {/* Brand block */}
        <div className="text-center mb-8">
          {/* Logo + wordmark row */}
          <div className="flex items-center justify-center gap-4 mb-3">
            <BuddyLogo className="w-16 h-16" />
            <div className="text-left">
              <h1 className="text-5xl font-black tracking-tighter leading-none
                text-transparent bg-clip-text
                bg-gradient-to-r from-cyan-500 via-cyan-400 to-fuchsia-500
                dark:from-cyan-300 dark:via-cyan-400 dark:to-fuchsia-400">
                BUDDY
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-4 h-px bg-cyan-500/50" />
                <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-gray-400 dark:text-slate-500">
                  by Manas Express
                </span>
              </div>
            </div>
          </div>

          {/* Pill tag */}
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full
            bg-cyan-500/10 border border-cyan-500/20
            text-cyan-600 dark:text-cyan-400 text-xs font-medium tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
            Operations Control System
          </span>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-white/5 dark:backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl p-8 shadow-xl dark:shadow-black/50">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-6">
            Sign in to your account
          </h2>

          {(error || accessError) && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">
              {error || accessError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/50 rounded-xl text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                placeholder="you@manasexpress.com"
              />
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide">Password</label>
                <button
                  type="button"
                  onClick={() => setShowForgot(true)}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/50 rounded-xl text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl text-sm font-semibold text-slate-900 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-400/30"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        {showForgot && <ForgotPasswordModal initialEmail={email} onClose={() => setShowForgot(false)} />}

        <p className="text-center text-xs text-gray-400 dark:text-slate-600 mt-6">
          Internal use only — Manas Express © 2026
        </p>
      </div>
    </div>
  )
}

function ForgotPasswordModal({ initialEmail = '', onClose }) {
  const [email, setEmail] = useState(initialEmail)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email address')
    setSubmitting(true); setError('')
    const { error: rpErr } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/set-password`,
    })
    setSubmitting(false)
    if (rpErr) { setError(rpErr.message); return }
    setSent(true)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Reset your password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="p-5 text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Check your email</p>
            <p className="text-xs text-gray-500 dark:text-slate-500">If an account exists for {email}, we sent a reset link.</p>
            <button onClick={onClose} className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-4">
            {error && <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">{error}</div>}
            <p className="text-xs text-gray-500 dark:text-slate-500">Enter your email and we'll send you a link to set a new password.</p>
            <input
              type="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700/50 rounded-xl text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              placeholder="you@manasexpress.com"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">Cancel</button>
              <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-all">
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
