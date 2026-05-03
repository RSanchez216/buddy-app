import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'

const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', viewer: 'Viewer' }
const ROLE_COLOR = {
  admin:   'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  manager: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  viewer:  'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-600/20',
}

// Avatar pill in the top-right header. Click toggles a dropdown with
// the user-related controls that used to live at the bottom of the
// sidebar: identity, role badge, theme toggle, sign out.
export default function UserMenu() {
  const { profile, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false)
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login')
  }

  const initial = profile?.full_name?.charAt(0)?.toUpperCase() || '?'
  const firstName = (profile?.full_name || '').split(' ')[0] || profile?.email || 'User'
  const role = profile?.role || 'viewer'

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl border border-transparent hover:border-gray-200 dark:hover:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
      >
        <span className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-xs">
          {initial}
        </span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300 hidden sm:inline max-w-[7rem] truncate">
          {firstName}
        </span>
        <svg className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 hidden sm:inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-2xl z-40 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
            <p className="text-sm font-semibold text-gray-900 dark:text-slate-200 truncate">
              {profile?.full_name || 'User'}
            </p>
            {profile?.email && (
              <p className="text-xs text-gray-500 dark:text-slate-500 truncate">{profile.email}</p>
            )}
            <span className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ROLE_COLOR[role] || ROLE_COLOR.viewer}`}>
              {ROLE_LABEL[role] || 'Viewer'}
            </span>
          </div>

          <button
            onClick={() => { toggleTheme() /* keep menu open so user can confirm switch */ }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
            <span className="flex-1 text-left">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            <span className={`inline-flex w-8 h-4 rounded-full transition-colors relative ${theme === 'dark' ? 'bg-cyan-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${theme === 'dark' ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
          </button>

          <div className="border-t border-gray-100 dark:border-white/5">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
