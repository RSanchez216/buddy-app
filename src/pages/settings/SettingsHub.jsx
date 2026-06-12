import { Link } from 'react-router-dom'
import { S } from '../../lib/styles'

// Settings hub — navigation page that consolidates all 9 reference-data screens
// Each screen manages a lookup table / reference data type

const SETTINGS_GROUPS = [
  {
    title: 'Organization',
    items: [
      { label: 'Departments', route: '/settings/departments', description: 'Organizational structure and department hierarchy' },
    ],
  },
  {
    title: 'Vendors & Expenses',
    items: [
      { label: 'Vendor Categories', route: '/settings/vendor-categories', description: 'Categorize vendors by type and industry' },
      { label: 'Expense Categories', route: '/settings/expense-categories', description: 'Define expense types for tracking and reporting' },
      { label: 'Payment Methods', route: '/settings/payment-methods', description: 'Configure payment types and processing methods' },
    ],
  },
  {
    title: 'Lending',
    items: [
      { label: 'Loan Entities', route: '/settings/loan-entities', description: 'Manage legal entities and loan affiliates' },
      { label: 'Loan Lenders', route: '/settings/loan-lenders', description: 'Define lender information and relationships' },
    ],
  },
  {
    title: 'Fleet & Funding',
    items: [
      { label: 'Equipment Types', route: '/settings/equipment-types', description: 'Classify fleet equipment by category' },
      { label: 'Carriers', route: '/settings/carriers', description: 'Manage carrier information and partnerships' },
      { label: 'Funding & Sources', route: '/settings/funding-accounts', description: 'Configure bank accounts and funding sources' },
    ],
  },
]

function SettingCard({ label, route, description }) {
  return (
    <Link
      to={route}
      className={`${S.card} p-5 block transition-all hover:-translate-y-0.5 hover:border-orange-300 dark:hover:border-orange-500/40`}
    >
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{label}</h3>
      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5 leading-relaxed">{description}</p>
    </Link>
  )
}

export default function SettingsHub() {
  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">Reference data and lookups that power BUDDY</p>
      </div>

      {/* Settings Groups */}
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.title}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-3">
            {group.title}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.items.map((item) => (
              <SettingCard
                key={item.route}
                label={item.label}
                route={item.route}
                description={item.description}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
