const deptConfig = {
  Fleet:      { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  Safety:     { bg: 'bg-green-100',  text: 'text-green-700'  },
  Operations: { bg: 'bg-amber-100',  text: 'text-amber-700'  },
  Finance:    { bg: 'bg-purple-100', text: 'text-purple-700' },
}

export default function DeptBadge({ name }) {
  const cfg = deptConfig[name] || { bg: 'bg-gray-100', text: 'text-gray-600' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {name || '—'}
    </span>
  )
}
