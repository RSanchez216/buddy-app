import { useEffect, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const DEPT_COLORS = {
  Fleet: '#3b82f6',
  Safety: '#22c55e',
  Operations: '#f59e0b',
  Finance: '#a855f7',
}

const CATEGORY_COLORS = [
  '#f97316', '#3b82f6', '#22c55e', '#a855f7',
  '#ef4444', '#f59e0b', '#06b6d4', '#84cc16',
]

function MetricCard({ label, value, sub, color = 'orange', icon }) {
  const colors = {
    orange: 'text-orange-600 bg-orange-50',
    red:    'text-red-600 bg-red-50',
    amber:  'text-amber-600 bg-amber-50',
    blue:   'text-blue-600 bg-blue-50',
    green:  'text-green-600 bg-green-50',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-gray-500">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState({
    paidThisWeek: 0, pendingCount: 0, unmatchedCount: 0,
    disputedCount: 0, vendorCount: 0,
  })
  const [alerts, setAlerts] = useState([])
  const [spendByCategory, setSpendByCategory] = useState(null)
  const [spendByDept, setSpendByDept] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const now = new Date()
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7)
    const weekAgoStr = weekAgo.toISOString().split('T')[0]

    const [invoiceRes, transRes, vendorRes] = await Promise.all([
      supabase.from('invoices').select('*, vendors(name, category), departments(name)'),
      supabase.from('transactions').select('*'),
      supabase.from('vendors').select('id').eq('is_active', true),
    ])

    const invoices = invoiceRes.data || []
    const transactions = transRes.data || []

    const paidThisWeek = invoices
      .filter(i => i.status === 'Paid' && i.created_at >= weekAgoStr)
      .reduce((s, i) => s + Number(i.amount), 0)

    setMetrics({
      paidThisWeek,
      pendingCount: invoices.filter(i => i.status === 'Pending').length,
      unmatchedCount: transactions.filter(t => t.status === 'Unmatched').length,
      disputedCount: invoices.filter(i => i.status === 'Disputed').length,
      vendorCount: vendorRes.data?.length || 0,
    })

    // Alerts
    const alertItems = [
      ...invoices.filter(i => i.status === 'Disputed').map(i => ({
        type: 'Disputed Invoice', message: `${i.vendors?.name || 'Unknown'} — $${Number(i.amount).toLocaleString()}`, status: 'Disputed',
      })),
      ...invoices.filter(i => i.status === 'Pending').slice(0, 5).map(i => ({
        type: 'Pending Approval', message: `${i.vendors?.name || 'Unknown'} — $${Number(i.amount).toLocaleString()}`, status: 'Pending',
      })),
      ...transactions.filter(t => t.status === 'Unmatched').slice(0, 5).map(t => ({
        type: 'Unmatched Transaction', message: `${t.vendor_name_raw || 'Unknown'} — $${Number(t.amount).toLocaleString()}`, status: 'Unmatched',
      })),
    ]
    setAlerts(alertItems.slice(0, 10))

    // Spend by category - last 5 months
    buildCategoryChart(invoices)
    buildDeptChart(invoices)
    setLoading(false)
  }

  function buildCategoryChart(invoices) {
    const months = []
    for (let i = 4; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      months.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth() })
    }

    const categories = [...new Set(invoices.map(i => i.vendors?.category).filter(Boolean))]

    const datasets = categories.map((cat, idx) => ({
      label: cat,
      backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
      data: months.map(m => {
        return invoices
          .filter(i => {
            const d = new Date(i.received_date || i.created_at)
            return i.vendors?.category === cat && d.getFullYear() === m.year && d.getMonth() === m.month
          })
          .reduce((s, i) => s + Number(i.amount), 0)
      }),
    }))

    setSpendByCategory({ labels: months.map(m => m.label), datasets })
  }

  function buildDeptChart(invoices) {
    const now = new Date()
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7)

    const depts = ['Fleet', 'Safety', 'Operations', 'Finance']
    const data = depts.map(dept =>
      invoices
        .filter(i => i.departments?.name === dept && new Date(i.created_at) >= weekAgo)
        .reduce((s, i) => s + Number(i.amount), 0)
    )

    setSpendByDept({
      labels: depts,
      datasets: [{
        label: 'Spend this week',
        data,
        backgroundColor: depts.map(d => DEPT_COLORS[d]),
        borderRadius: 4,
      }],
    })
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">AP overview for Monas Express</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard label="Paid This Week" value={`$${metrics.paidThisWeek.toLocaleString()}`} color="green"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <MetricCard label="Pending Approvals" value={metrics.pendingCount} color="amber"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <MetricCard label="Unmatched TXNs" value={metrics.unmatchedCount} color="red"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
        />
        <MetricCard label="Active Disputes" value={metrics.disputedCount} color="red"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
        />
        <MetricCard label="Active Vendors" value={metrics.vendorCount} color="blue"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Spend by Category — Last 5 Months</h2>
          {spendByCategory ? (
            <Bar data={spendByCategory} options={{
              responsive: true, maintainAspectRatio: true,
              plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
              scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => `$${(v/1000).toFixed(0)}k` } } },
            }} />
          ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Spend by Department — This Week</h2>
          {spendByDept ? (
            <Bar data={spendByDept} options={{
              indexAxis: 'y', responsive: true,
              plugins: { legend: { display: false } },
              scales: { x: { grid: { display: false }, ticks: { callback: v => `$${(v/1000).toFixed(0)}k` } }, y: { grid: { display: false } } },
            }} />
          ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>}
        </div>
      </div>

      {/* Alerts */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          Alerts & Flagged Items
          {alerts.length > 0 && (
            <span className="ml-2 bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full">{alerts.length}</span>
          )}
        </h2>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">No flagged items — everything looks good!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                <StatusBadge status={a.status} />
                <span className="text-xs text-gray-500 font-medium">{a.type}</span>
                <span className="text-sm text-gray-700 flex-1">{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
