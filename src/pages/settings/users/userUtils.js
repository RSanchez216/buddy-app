// Pill colors and labels for the Users settings module.
// Roles: admin = purple, manager = blue, viewer = gray.
// Status: active = green, pending = amber, deactivated = gray.

export const ROLES = ['admin', 'manager', 'viewer']

export const ROLE_LABEL = {
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTION = {
  admin: 'Full access including user management.',
  manager: 'Full edit access; cannot manage users or delete records.',
  viewer: 'Read-only access to all modules.',
}

export function rolePill(role) {
  switch (role) {
    case 'admin':   return 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20'
    case 'manager': return 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20'
    case 'viewer':  return 'bg-gray-100 dark:bg-slate-700/50 text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-600/30'
    default:        return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
  }
}

export function statusPill(status) {
  switch (status) {
    case 'active':      return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'pending':     return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20'
    case 'deactivated': return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
    default:            return 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
  }
}

export function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
