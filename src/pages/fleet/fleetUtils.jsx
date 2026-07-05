// Shared formatters + presentation helpers for the Fleet Inventory module.
// Trucks and trailers share most of the field set; the differences live in
// the trailer-only columns (trailer_type, annual_inspection_expiration_date).

export const OWNERSHIP_STAGES = [
  { value: 'unclassified',                label: 'Unclassified',                  icon: '⚠️' },
  { value: 'company_owned',               label: 'Company Owned',                 icon: '🏢' },
  { value: 'company_leased',              label: 'Company Leased',                icon: '🔄' },
  { value: 'driver_purchase_in_progress', label: 'Driver Purchase In Progress',   icon: '💰' },
  { value: 'driver_owned',                label: 'Driver Owned',                  icon: '👤' },
  { value: 'archived',                    label: 'Archived',                      icon: '📦' },
]

export const STAGE_LABELS = Object.fromEntries(OWNERSHIP_STAGES.map(s => [s.value, s.label]))

// Tailwind classes per stage. Mirrors the project's status-pill convention
// (StatusBadge component, equipmentStatusPill in loanUtils).
export function stagePillClasses(stage) {
  switch (stage) {
    case 'company_owned':
      return 'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-500/30'
    case 'company_leased':
      return 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20'
    case 'driver_purchase_in_progress':
      return 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
    case 'driver_owned':
      return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'archived':
      return 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30 line-through'
    case 'unclassified':
    default:
      return 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'
  }
}

export function StagePill({ stage }) {
  const meta = OWNERSHIP_STAGES.find(s => s.value === stage)
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${stagePillClasses(stage)}`}>
      <span aria-hidden>{meta?.icon || '⚠️'}</span>
      <span>{meta?.label || stage || 'Unclassified'}</span>
    </span>
  )
}

// User-managed operational status (active/inactive/archived). Distinct
// from ownership_stage (financial) and the imported TMS `status` (which
// is uniformly "Active" and overwritten weekly). The pill renders muted
// grey for inactive/archived so they're visually distinct from active.
export const OPERATIONAL_STATUSES = [
  { value: 'active',   label: 'Active'   },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
]
export const OPERATIONAL_STATUS_LABELS = Object.fromEntries(
  OPERATIONAL_STATUSES.map(s => [s.value, s.label])
)

export function operationalStatusPillClasses(status) {
  switch (status) {
    case 'active':
      return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'inactive':
      return 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-600/40'
    case 'archived':
      return 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30 line-through'
    default:
      return 'bg-gray-100 dark:bg-slate-700/40 text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-slate-600/30'
  }
}

export function OperationalStatusPill({ status }) {
  const label = OPERATIONAL_STATUS_LABELS[status] || (status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Active')
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${operationalStatusPillClasses(status)}`}>
      {label}
    </span>
  )
}

export const TRAILER_TYPES = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Conestoga', 'Other']

export function trailerTypePillClasses(type) {
  switch (type) {
    case 'Dry Van':   return 'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300'
    case 'Reefer':    return 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400'
    case 'Flatbed':   return 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400'
    case 'Step Deck': return 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300'
    case 'Conestoga': return 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400'
    case 'Other':     return 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400'
    default:          return 'bg-gray-100 dark:bg-slate-700/40 text-gray-400 dark:text-slate-500'
  }
}

// Days between today (America/Chicago) and the inspection date.
// Returns null if no date. Negative = expired.
export function daysUntilInspection(iso) {
  if (!iso) return null
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const a = new Date(`${today}T00:00:00`)
  const b = new Date(`${iso}T00:00:00`)
  return Math.round((b - a) / 86_400_000)
}

export function inspectionTone(iso) {
  const d = daysUntilInspection(iso)
  if (d == null) return { dot: 'bg-gray-300 dark:bg-slate-600', text: 'text-gray-400 dark:text-slate-500', label: 'No date' }
  if (d < 0)     return { dot: 'bg-red-500',                    text: 'text-red-700 dark:text-red-400',     label: `Expired ${Math.abs(d)}d ago` }
  if (d < 30)    return { dot: 'bg-red-500',                    text: 'text-red-700 dark:text-red-400',     label: `${d}d` }
  if (d <= 90)   return { dot: 'bg-amber-500',                  text: 'text-amber-700 dark:text-amber-400', label: `${d}d` }
  return                  { dot: 'bg-emerald-500',              text: 'text-emerald-700 dark:text-emerald-400', label: `${d}d` }
}

export function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtMoney(n) {
  if (n == null || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

export function chicagoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// ── Driver master helpers ─────────────────────────────────────────────────
export const DRIVER_TYPES = [
  { value: 'Owner Operator',  label: 'Owner Operator',  short: 'Owner Op' },
  { value: 'Leased Owner-Op', label: 'Leased Owner-Op', short: 'Leased OO' },
  { value: 'Contract Driver', label: 'Contract Driver', short: 'Contract' },
  { value: 'Company Driver',  label: 'Company Driver',  short: 'Company' },
]

export function driverTypePillClasses(type) {
  switch (type) {
    case 'Owner Operator':  return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'Leased Owner-Op': return 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20'
    case 'Contract Driver': return 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
    case 'Company Driver':  return 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20'
    default:                return 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
  }
}

export function DriverTypePill({ type, short = false }) {
  if (!type) return <span className="text-gray-400 dark:text-slate-600 text-xs">—</span>
  const meta = DRIVER_TYPES.find(t => t.value === type)
  const label = short ? (meta?.short || type) : (meta?.label || type)
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${driverTypePillClasses(type)}`}>
      {label}
    </span>
  )
}

export const DRIVER_STATUSES = [
  { value: 'active',     label: 'Active',     icon: '🟢' },
  { value: 'inactive',   label: 'Inactive',   icon: '🟡' },
  { value: 'on_leave',   label: 'On Leave',   icon: '🟣' },
  { value: 'terminated', label: 'Terminated', icon: '🔴' },
  { value: 'archived',   label: 'Archived',   icon: '📦' },
]

export const DRIVER_STATUS_LABELS = Object.fromEntries(DRIVER_STATUSES.map(s => [s.value, s.label]))

export function driverStatusPillClasses(status) {
  switch (status) {
    case 'active':     return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
    case 'inactive':   return 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30'
    case 'on_leave':   return 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-500/20'
    case 'terminated': return 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20'
    case 'archived':   return 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30 line-through'
    default:           return 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400'
  }
}

export function DriverStatusPill({ status }) {
  const meta = DRIVER_STATUSES.find(s => s.value === status)
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${driverStatusPillClasses(status)}`}>
      <span aria-hidden>{meta?.icon || ''}</span>
      <span>{meta?.label || status || 'Unknown'}</span>
    </span>
  )
}

// "12% SERVICE CHARGE" / "$0.65 RATE" etc. → readable when raw is missing.
export function fmtCompensation({ compensation_raw, compensation_type, compensation_value }) {
  // Flat rate reads as a weekly salary even when the raw string ("$2000 FLAT
  // RATE") is present, so the column shows "$2,000/wk" rather than the export text.
  if (compensation_type === 'flat_rate' && compensation_value != null) {
    return `$${Number(compensation_value).toLocaleString('en-US')}/wk`
  }
  if (compensation_raw) return compensation_raw
  if (compensation_value == null) return '—'
  switch (compensation_type) {
    case 'service_charge_pct': return `${compensation_value}% service charge`
    case 'rate_pct':           return `${compensation_value}% rate`
    case 'rate_per_mile':      return `$${compensation_value}/mile`
    case 'flat_rate':          return `$${Number(compensation_value).toLocaleString('en-US')}/wk`
    default:                   return String(compensation_value)
  }
}

// Generate initials from a full name for avatar display.
export function monogram(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].substring(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Generate a hue (0-360) from a name for consistent color assignment.
export function nameHue(name) {
  if (!name) return 0
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash) % 360
}
