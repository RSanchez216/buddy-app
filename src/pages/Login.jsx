import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import BuddyLogo from '../components/BuddyLogo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
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

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm">
              {error}
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
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Password</label>
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

        <p className="text-center text-xs text-gray-400 dark:text-slate-600 mt-6">
          Internal use only — Manas Express © 2026
        </p>
      </div>
    </div>
  )
}
