import { useEffect, useState } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const CATEGORY_COLORS = [
  '#f97316','#3b82f6','#22c55e','#a855f7','#ef4444','#f59e0b','#06b6d4','#84cc16',
]

function getMonthLabel(offset) {
  const d = new Date()
  d.setMonth(d.getMonth() - offset)
  return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth() }
}

export default function MonthlyReport() {
  const [invoices, setInvoices] = useState([])
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [months] = useState(() => Array.from({ length: 6 }, (_, i) => getMonthLabel(5 - i)))

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [invRes, vendRes] = await Promise.all([
      supabase.from('invoices').select('*, vendors(name, category), departments(name)'),
      supabase.from('vendors').select('*').eq('is_active', true).order('name'),
    ])
    setInvoices(invRes.data || [])
    setVendors(vendRes.data || [])
    setLoading(false)
  }

  function getSpend(vendorId, year, month) {
    return invoices
      .filter(i => {
        const d = new Date(i.received_date || i.created_at)
        return i.vendor_id === vendorId && d.getFullYear() === year && d.getMonth() === month
      })
      .reduce((s, i) => s + Number(i.amount), 0)
  }

  function getCategorySpend(category, year, month) {
    return invoices
      .filter(i => {
        const d = new Date(i.received_date || i.created_at)
        return i.vendors?.category === category && d.getFullYear() === year && d.getMonth() === month
      })
      .reduce((s, i) => s + Number(i.amount), 0)
  }

  // Stacked bar chart data
  const categories = [...new Set(invoices.map(i => i.vendors?.category).filter(Boolean))]
  const chartData = {
    labels: months.map(m => m.label),
    datasets: categories.map((cat, idx) => ({
      label: cat,
      backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
      data: months.map(m => getCategorySpend(cat, m.year, m.month)),
    })),
  }

  // Vendor table with anomaly detection
  const recentMonths = months.slice(-5) // last 5 months
  const vendorRows = vendors.map(v => {
    const spends = recentMonths.map(m => getSpend(v.id, m.year, m.month))
    const currentSpend = spends[spends.length - 1]
    const priorSpend = spends[spends.length - 2]
    const change = priorSpend > 0 ? currentSpend - priorSpend : 0
    const changePct = priorSpend > 0 ? (change / priorSpend) * 100 : 0
    const flagged = priorSpend > 0 && (Math.abs(change) > 50 || Math.abs(changePct) > 5) && currentSpend > 0
    return { ...v, spends, currentSpend, priorSpend, change, changePct, flagged }
  }).filter(v => v.spends.some(s => s > 0))

  const flaggedVendors = vendorRows.filter(v => v.flagged)
  const summaryText = flaggedVendors.length === 0
    ? 'No anomalies detected this month. All vendor charges are within expected ranges.'
    : `${flaggedVendors.length} vendor${flaggedVendors.length > 1 ? 's' : ''} flagged for review: ` +
      flaggedVendors.map(v =>
        `${v.name} (${v.change > 0 ? '+' : ''}$${Math.abs(v.change).toLocaleString()}, ${v.changePct > 0 ? '+' : ''}${v.changePct.toFixed(1)}%)`
      ).join('; ') + '.'

  function changeColor(change, pct) {
    if (Math.abs(change) <= 50 && Math.abs(pct) <= 5) return 'text-gray-500'
    return change > 0 ? 'text-red-600' : 'text-green-600'
  }

  function handlePrint() { window.print() }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-6" id="monthly-report">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Monthly Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">Spend analysis & anomaly detection</p>
        </div>
        <button onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Stacked bar chart - 6 months */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Total Spend by Category — Last 6 Months</h2>
        {categories.length > 0 ? (
          <Bar data={chartData} options={{
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
            scales: {
              x: { stacked: true, grid: { display: false } },
              y: { stacked: true, ticks: { callback: v => `$${(v / 1000).toFixed(0)}k` } },
            },
          }} />
        ) : (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No invoice data available</div>
        )}
      </div>

      {/* Anomaly Summary */}
      <div className={`rounded-xl border p-4 ${flaggedVendors.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
        <div className="flex items-start gap-3">
          <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${flaggedVendors.length > 0 ? 'text-amber-600' : 'text-green-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={flaggedVendors.length > 0
              ? "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              : "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"} />
          </svg>
          <div>
            <p className={`text-sm font-semibold ${flaggedVendors.length > 0 ? 'text-amber-800' : 'text-green-800'}`}>
              {flaggedVendors.length > 0 ? `${flaggedVendors.length} Anomalies Detected` : 'No Anomalies'}
            </p>
            <p className={`text-sm mt-1 ${flaggedVendors.length > 0 ? 'text-amber-700' : 'text-green-700'}`}>{summaryText}</p>
          </div>
        </div>
      </div>

      {/* Vendor Comparison Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Vendor-Level Spend Comparison</h2>
          <p className="text-xs text-gray-400 mt-0.5">Flagged if change &gt; $50 or &gt; 5% vs prior month</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                {recentMonths.map(m => (
                  <th key={m.label} className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{m.label}</th>
                ))}
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Expected</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Change</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vendorRows.length === 0 ? (
                <tr><td colSpan={9 + recentMonths.length} className="px-4 py-12 text-center text-gray-400 text-sm">No vendor data</td></tr>
              ) : vendorRows.map(v => (
                <tr key={v.id} className={`hover:bg-gray-50 ${v.flagged ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{v.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{v.category}</td>
                  {v.spends.map((s, i) => (
                    <td key={i} className="px-4 py-3 text-right text-gray-700">
                      {s > 0 ? `$${s.toLocaleString()}` : <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right text-gray-500">${Number(v.expected_amount).toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right font-medium ${changeColor(v.change, v.changePct)}`}>
                    {v.priorSpend > 0 && v.currentSpend > 0 ? (
                      <span>{v.change > 0 ? '+' : ''}{v.changePct.toFixed(1)}%</span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {v.flagged ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        Flag
                      </span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
