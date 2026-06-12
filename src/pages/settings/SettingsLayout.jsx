import { Link, Outlet } from 'react-router-dom'

// Layout wrapper for settings sub-pages that provides a back link to the hub
export default function SettingsLayout() {
  return (
    <div className="space-y-5 max-w-4xl">
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
