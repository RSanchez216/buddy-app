import { useEffect, useState } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { S } from '../lib/styles'
import { useTheme } from '../contexts/ThemeContext'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const CATEGORY_COLORS = ['#22d3ee','#a855f7','#34d399','#f59e0b','#f43f5e','#60a5fa','#fb7185','#84cc16']

function getMonthLabel(offset) {
  const d = new Date(); d.setMonth(d.getMonth() - offset)
  return { label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), year: d.getFullYear(), month: d.getMonth() }
}

export default function MonthlyReport() {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
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
      .filter(i => { const d = new Date(i.received_date || i.created_at); return i.vendor_id === vendorId && d.getFullYear() === year && d.getMonth() === month })
      .reduce((s, i) => s + Number(i.amount), 0)
  }

  function getCategorySpend(category, year, month) {
    return invoices
      .filter(i => { const d = new Date(i.received_date || i.created_at); return i.vendors?.category === category && d.getFullYear() === year && d.getMonth() === month })
      .reduce((s, i) => s + Number(i.amount), 0)
  }

  const categories = [...new Set(invoices.map(i => i.vendors?.category).filter(Boolean))]
  const chartData = {
    labels: months.map(m => m.label),
    datasets: categories.map((cat, idx) => ({
      label: cat,
      backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
      data: months.map(m => getCategorySpend(cat, m.year, m.month)),
    })),
  }

  const recentMonths = months.slice(-5)
  const vendorRows = vendors.map(v => {
    const spends = recentMonths.map(m => getSpend(v.id, m.year, m.month))
    const cur = spends[spends.length - 1]
    const prev = spends[spends.length - 2]
    const change = prev > 0 ? cur - prev : 0
    const changePct = prev > 0 ? (change / prev) * 100 : 0
    const flagged = prev > 0 && cur > 0 && (Math.abs(change) > 50 || Math.abs(changePct) > 5)
    return { ...v, spends, cur, prev, change, changePct, flagged }
  }).filter(v => v.spends.some(s => s > 0))

  const flaggedVendors = vendorRows.filter(v => v.flagged)
  const summaryText = flaggedVendors.length === 0
    ? 'No anomalies detected. All vendor charges are within expected ranges.'
    : `${flaggedVendors.length} vendor${flaggedVendors.length > 1 ? 's' : ''} flagged: ` +
      flaggedVendors.map(v => `${v.name} (${v.change > 0 ? '+' : ''}$${Math.abs(v.change).toFixed(0)}, ${v.changePct > 0 ? '+' : ''}${v.changePct.toFixed(1)}%)`).join('; ') + '.'

  function changeStyle(change, pct) {
    if (Math.abs(change) <= 50 && Math.abs(pct) <= 5) return 'text-slate-500'
    return change > 0 ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold'
  }

  const tickColor = isDark ? '#64748b' : '#9ca3af'
  const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'
  const legendColor = isDark ? '#94a3b8' : '#6b7280'

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'bottom', labels: { color: legendColor, boxWidth: 10, font: { size: 11 } } },
    },
    scales: {
      x: { stacked: true, grid: { color: gridColor }, ticks: { color: tickColor } },
      y: { stacked: true, grid: { color: gridColor }, ticks: { color: tickColor, callback: v => `$${(v/1000).toFixed(0)}k` } },
    },
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" /></div>

  return (
    <div className="space-y-6" id="monthly-report">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Monthly Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">Spend analysis & anomaly detection</p>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl transition-all">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Chart */}
      <div className={`${S.card} p-5`}>
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Total Spend by Category — Last 6 Months</h2>
        {categories.length > 0
          ? <Bar key={theme} data={chartData} options={chartOptions} />
          : <div className="h-48 flex items-center justify-center text-slate-600 text-sm">No invoice data available</div>
        }
      </div>

      {/* Anomaly summary */}
      <div className={`rounded-2xl border p-4 ${flaggedVendors.length > 0 ? 'bg-amber-500/5 border-amber-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
        <div className="flex items-start gap-3">
          <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${flaggedVendors.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={flaggedVendors.length > 0
              ? "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              : "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"} />
          </svg>
          <div>
            <p className={`text-sm font-semibold ${flaggedVendors.length > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
              {flaggedVendors.length > 0 ? `${flaggedVendors.length} Anomal${flaggedVendors.length > 1 ? 'ies' : 'y'} Detected` : 'No Anomalies'}
            </p>
            <p className={`text-sm mt-1 ${flaggedVendors.length > 0 ? 'text-amber-400/80' : 'text-emerald-400/80'}`}>{summaryText}</p>
          </div>
        </div>
      </div>

      {/* Vendor table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-slate-300">Vendor-Level Spend Comparison</h2>
          <p className="text-xs text-slate-500 mt-0.5">Flagged if change &gt; $50 or &gt; 5% vs prior month</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                <th className={S.th}>Vendor</th>
                <th className={S.th}>Category</th>
                {recentMonths.map(m => <th key={m.label} className={`${S.th} text-right`}>{m.label}</th>)}
                <th className={`${S.th} text-right`}>Expected</th>
                <th className={`${S.th} text-right`}>Change</th>
                <th className={`${S.th} text-center`}>Flag</th>
              </tr>
            </thead>
            <tbody>
              {vendorRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-600 text-sm">No vendor data</td></tr>
              ) : vendorRows.map(v => (
                <tr key={v.id} className={`${S.tableRow} ${v.flagged ? 'bg-amber-500/[0.03]' : ''}`}>
                  <td className={`${S.td} font-medium text-slate-200`}>{v.name}</td>
                  <td className={`${S.td} text-slate-500 text-xs`}>{v.category}</td>
                  {v.spends.map((s, i) => (
                    <td key={i} className={`${S.td} text-right ${s > 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                      {s > 0 ? `$${s.toLocaleString()}` : '—'}
                    </td>
                  ))}
                  <td className={`${S.td} text-right text-slate-500`}>${Number(v.expected_amount).toLocaleString()}</td>
                  <td className={`${S.td} text-right ${changeStyle(v.change, v.changePct)}`}>
                    {v.prev > 0 && v.cur > 0 ? `${v.change > 0 ? '+' : ''}${v.changePct.toFixed(1)}%` : <span className="text-slate-700">—</span>}
                  </td>
                  <td className={`${S.td} text-center`}>
                    {v.flagged ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        Flag
                      </span>
                    ) : <span className="text-slate-700 text-xs">—</span>}
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
