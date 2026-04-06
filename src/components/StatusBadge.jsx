const statusConfig = {
  // Invoice statuses
  Pending:   { bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-400' },
  Approved:  { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500' },
  Disputed:  { bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'   },
  Paid:      { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500'  },
  // Transaction statuses
  Matched:   { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500' },
  Unmatched: { bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'   },
  // Vendor status
  Active:    { bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500' },
  Inactive:  { bg: 'bg-gray-100',   text: 'text-gray-500',   dot: 'bg-gray-400'  },
}

export default function StatusBadge({ status }) {
  const cfg = statusConfig[status] || { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  )
}
