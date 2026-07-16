import { Link, Outlet, useLocation } from 'react-router-dom'

// Layout wrapper for settings sub-pages that provides a back link to the hub.
// Most sub-pages are narrow forms/lists and stay capped at max-w-4xl; the Users
// page is a wide multi-column table, so it uses the full content width (like the
// fleet pages, which have no cap) to avoid clipping columns behind a scrollbar.
export default function SettingsLayout() {
  const { pathname } = useLocation()
  const wide = pathname.startsWith('/settings/users')
  return (
    <div className={`space-y-5 ${wide ? '' : 'max-w-4xl'}`}>
      {/* Back link to Settings hub */}
      <Link
        to="/settings"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
      >
        ← Settings
      </Link>

      {/* Sub-page content */}
      <Outlet />
    </div>
  )
}
