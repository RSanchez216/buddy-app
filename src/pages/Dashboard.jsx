import { useEffect, useState } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { useTheme } from '../contexts/ThemeContext'
import StatusBadge from '../components/StatusBadge'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const CATEGORY_COLORS = ['#22d3ee','#a855f7','#34d399','#f59e0b','#f43f5e','#60a5fa','#fb7185','#84cc16']
const DEPT_COLORS = { Fleet: '#60a5fa', Safety: '#34d399', Operations: '#f59e0b', Finance: '#c084fc' }

function MetricCard({ label, value, color = 'cyan', icon }) {
  const colors = {
    cyan:   'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10',
    amber:  'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
    red:    'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
    green:  'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
  }
  return (
    <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-5 hover:border-gray-300 dark:hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">{label}</p>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${colors[color]}`}>{icon}</div>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [metrics, setMetrics] = useState({ paidThisWeek: 0, pendingCount: 0, unmatchedCount: 0, disputedCount: 0, vendorCount: 0 })
  const [alerts, setAlerts] = useState([])
  const [spendByCategory, setSpendByCategory] = useState(null)
  const [spendByDept, setSpendByDept] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const [invoiceRes, transRes, vendorRes] = await Promise.all([
      supabase.from('invoices').select('*, vendors(name, category), departments(name)').is('deleted_at', null),
      supabase.from('transactions').select('*'),
      supabase.from('vendors').select('id').eq('is_active', true),
    ])
    const invoices = invoiceRes.data || []
    const transactions = transRes.data || []
    setMetrics({
      paidThisWeek: invoices.filter(i => i.status === 'Paid' && new Date(i.created_at) >= weekAgo).reduce((s, i) => s + Number(i.amount), 0),
      pendingCount: invoices.filter(i => i.status === 'Pending').length,
      unmatchedCount: transactions.filter(t => t.status === 'Unmatched').length,
      disputedCount: invoices.filter(i => i.status === 'Disputed').length,
      vendorCount: vendorRes.data?.length || 0,
    })
    setAlerts([
      ...invoices.filter(i => i.status === 'Disputed').map(i => ({ type: 'Disputed Invoice', message: `${i.vendors?.name || 'Unknown'} — $${Number(i.amount).toLocaleString()}`, status: 'Disputed' })),
      ...invoices.filter(i => i.status === 'Pending').slice(0, 4).map(i => ({ type: 'Pending Approval', message: `${i.vendors?.name || 'Unknown'} — $${Number(i.amount).toLocaleString()}`, status: 'Pending' })),
      ...transactions.filter(t => t.status === 'Unmatched').slice(0, 4).map(t => ({ type: 'Unmatched TXN', message: `${t.vendor_name_raw || 'Unknown'} — $${Number(t.amount).toLocaleString()}`, status: 'Unmatched' })),
    ].slice(0, 10))
    buildCategoryChart(invoices)
    buildDeptChart(invoices)
    setLoading(false)
  }

  function getMonths(count) {
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (count - 1 - i))
      return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function buildCategoryChart(invoices) {
    const months = getMonths(5)
    const categories = [...new Set(invoices.map(i => i.vendors?.category).filter(Boolean))]
    setSpendByCategory({
      labels: months.map(m => m.label),
      datasets: categories.map((cat, idx) => ({
        label: cat,
        backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
        data: months.map(m => invoices.filter(i => {
          const d = new Date(i.received_date || i.created_at)
          return i.vendors?.category === cat && d.getFullYear() === m.year && d.getMonth() === m.month
        }).reduce((s, i) => s + Number(i.amount), 0)),
      })),
    })
  }

  function buildDeptChart(invoices) {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const depts = ['Fleet', 'Safety', 'Operations', 'Finance']
    setSpendByDept({
      labels: depts,
      datasets: [{
        label: 'Spend this week',
        data: depts.map(dept => invoices.filter(i => i.departments?.name === dept && new Date(i.created_at) >= weekAgo).reduce((s, i) => s + Number(i.amount), 0)),
        backgroundColor: depts.map(d => DEPT_COLORS[d]),
        borderRadius: 4,
      }],
    })
  }

  const tickColor = isDark ? '#64748b' : '#9ca3af'
  const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'
  const legendColor = isDark ? '#94a3b8' : '#6b7280'

  const baseChartOptions = {
    responsive: true,
    plugins: { legend: { position: 'bottom', labels: { color: legendColor, boxWidth: 10, font: { size: 11 } } } },
    scales: {
      x: { stacked: true, grid: { color: gridColor }, ticks: { color: tickColor } },
      y: { stacked: true, grid: { color: gridColor }, ticks: { color: tickColor, callback: v => `$${(v/1000).toFixed(0)}k` } },
    },
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">AP overview for Manas Express</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCard label="Paid This Week" value={`$${metrics.paidThisWeek.toLocaleString()}`} color="green"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <MetricCard label="Pending Approvals" value={metrics.pendingCount} color="amber"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <MetricCard label="Unmatched TXNs" value={metrics.unmatchedCount} color="red"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
        />
        <MetricCard label="Active Disputes" value={metrics.disputedCount} color="red"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
        />
        <MetricCard label="Active Vendors" value={metrics.vendorCount} color="cyan"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">Spend by Category — Last 5 Months</h2>
          {spendByCategory
            ? <Bar key={theme} data={spendByCategory} options={baseChartOptions} />
            : <div className="h-48 flex items-center justify-center text-gray-400 dark:text-slate-600 text-sm">No data yet</div>}
        </div>
        <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">Spend by Department — This Week</h2>
          {spendByDept
            ? <Bar key={`dept-${theme}`} data={spendByDept} options={{
                indexAxis: 'y', responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                  x: { grid: { color: gridColor }, ticks: { color: tickColor, callback: v => `$${(v/1000).toFixed(0)}k` } },
                  y: { grid: { display: false }, ticks: { color: tickColor } },
                },
              }} />
            : <div className="h-48 flex items-center justify-center text-gray-400 dark:text-slate-600 text-sm">No data yet</div>}
        </div>
      </div>

      <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Alerts & Flagged Items</h2>
          {alerts.length > 0 && <span className="bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 text-xs px-2 py-0.5 rounded-full">{alerts.length}</span>}
        </div>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-slate-600">
            <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <p className="text-sm">All clear — no flagged items</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/5">
                <StatusBadge status={a.status} />
                <span className="text-xs text-gray-400 dark:text-slate-500 font-medium">{a.type}</span>
                <span className="text-sm text-gray-700 dark:text-slate-300 flex-1">{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
