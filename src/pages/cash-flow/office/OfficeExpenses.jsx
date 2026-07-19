import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { useTheme } from '../../../contexts/ThemeContext'
import { useExpenseCategories } from '../../../hooks/useExpenseCategories'
import { S } from '../../../lib/styles'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer,
} from 'recharts'
import {
  listOffices, periodStats, listExpenses, listTransfers, rateFor,
  periodRange, stepPeriod, isCurrentPeriod, prevPeriodLabel, todayISO,
  usd0, usd2, local0, rate2, expensesToCSV, downloadCSV,
} from './officeData'
import AddOfficeExpensesModal from './AddOfficeExpensesModal'
import OfficeTransferModal from './OfficeTransferModal'

const GRAINS = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]
const CHART_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6']
const WINDOW = 6 // periods shown in the charts, ending at the selected period

export default function OfficeExpenses() {
  const { canEdit } = useAuth()
  const toast = useToast()
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const { formatLabel } = useExpenseCategories()

  const [offices, setOffices] = useState([])
  const [officeId, setOfficeId] = useState('')
  const [grain, setGrain] = useState('month')
  const [anchor, setAnchor] = useState(todayISO())
  const [compare, setCompare] = useState(false)

  const [sel, setSel] = useState(null)          // selected-period stats row
  const [windowRows, setWindowRows] = useState([]) // per-period stats for charts
  const [expenses, setExpenses] = useState([])  // selected-period expenses
  const [windowExpenses, setWindowExpenses] = useState([]) // window expenses (charts + compare)
  const [transfersById, setTransfersById] = useState({})
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const office = useMemo(() => offices.find(o => o.id === officeId) || null, [offices, officeId])
  const ccy = office?.currency_code || ''
  const period = useMemo(() => periodRange(grain, anchor), [grain, anchor])
  const winFrom = useMemo(() => periodRange(grain, stepPeriod(grain, anchor, -(WINDOW - 1))).from, [grain, anchor])

  // Offices once.
  useEffect(() => {
    listOffices().then(list => {
      setOffices(list)
      if (list.length) setOfficeId(prev => prev || list[0].id)
    }).catch(e => toast.error("Couldn't load offices", e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reload = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const [win, winExp, tfs] = await Promise.all([
        periodStats(officeId, grain, winFrom, period.to),
        listExpenses(officeId, winFrom, period.to),
        listTransfers(officeId),
      ])
      // period_start may arrive as a full timestamp — normalize to a date.
      const rows = (win || [])
        .map(r => ({ ...r, period_start: String(r.period_start).slice(0, 10) }))
        .sort((a, b) => (a.period_start < b.period_start ? -1 : 1))
      setWindowRows(rows)
      // Selected period = the row whose period_start matches this period's from.
      setSel(rows.find(r => String(r.period_start) === period.from) || rows[rows.length - 1] || null)
      setWindowExpenses(winExp)
      setExpenses(winExp.filter(e => e.expense_date >= period.from && e.expense_date <= period.to))
      const tmap = {}
      for (const t of tfs) tmap[t.id] = t
      setTransfersById(tmap)
    } catch (e) {
      toast.error("Couldn't load office data", e)
    } finally {
      setLoading(false)
    }
  }, [officeId, grain, winFrom, period.from, period.to, toast])

  useEffect(() => { reload() }, [reload])

  // ── derived ────────────────────────────────────────────────────────────────
  const spentUsd = sel?.spent_usd ?? 0
  const inUsd = sel?.in_usd ?? 0
  const balUsd = sel?.balance_usd_end ?? null
  const balLocal = sel?.balance_local_end ?? null
  const periodRate = sel?.period_rate ?? null
  const prevSpent = sel?.prev_spent_usd ?? null
  const prevIn = sel?.prev_in_usd ?? null

  // Opening (carried-in) local balance for the selected period: the closing
  // balance minus this period's transfers-in plus this period's spend = what was
  // already there at the start. Derived from the same office_period_stats row —
  // no new query. Null when there's no closing balance to work from.
  const openingLocal = balLocal != null
    ? Number(balLocal) - Number(sel?.in_local ?? 0) + Number(sel?.spent_local ?? 0)
    : null

  const isInherited = useCallback((e) => {
    const t = e.rate_transfer_id && transfersById[e.rate_transfer_id]
    if (!t) return false
    const d = t.received_date || t.sent_date
    return d && d < period.from
  }, [transfersById, period.from])

  // Stacked spend-by-category (USD) over the window.
  const { chartData, chartCats } = useMemo(() => {
    const byCat = {}
    for (const e of windowExpenses) byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount_usd || 0)
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, CHART_COLORS.length - 1).map(x => x[0])
    const topSet = new Set(top)
    const buckets = {}
    for (let i = WINDOW - 1; i >= 0; i--) {
      const pr = periodRange(grain, stepPeriod(grain, anchor, -i))
      buckets[pr.from] = { period: pr.label, __from: pr.from }
      for (const c of top) buckets[pr.from][c] = 0
      buckets[pr.from].Other = 0
    }
    for (const e of windowExpenses) {
      const pr = periodRange(grain, e.expense_date)
      const b = buckets[pr.from]
      if (!b) continue
      const key = topSet.has(e.category) ? e.category : 'Other'
      b[key] = (b[key] || 0) + Number(e.amount_usd || 0)
    }
    const cats = [...top]
    if (Object.values(buckets).some(b => b.Other > 0)) cats.push('Other')
    return { chartData: Object.values(buckets), chartCats: cats }
  }, [windowExpenses, grain, anchor])

  const balanceData = useMemo(
    () => windowRows.map(r => ({ period: periodRange(grain, r.period_start).label, balance: Number(r.balance_local_end || 0) })),
    [windowRows, grain]
  )

  // Compare: category totals prev vs selected period (USD).
  const compareRows = useMemo(() => {
    if (!compare) return []
    const prev = periodRange(grain, stepPeriod(grain, anchor, -1))
    const cur = {}, prv = {}
    for (const e of windowExpenses) {
      const usd = Number(e.amount_usd || 0)
      if (e.expense_date >= period.from && e.expense_date <= period.to) cur[e.category] = (cur[e.category] || 0) + usd
      else if (e.expense_date >= prev.from && e.expense_date <= prev.to) prv[e.category] = (prv[e.category] || 0) + usd
    }
    const cats = [...new Set([...Object.keys(cur), ...Object.keys(prv)])]
    return cats.map(c => ({ category: c, cur: cur[c] || 0, prev: prv[c] || 0 }))
      .sort((a, b) => b.cur - a.cur)
  }, [compare, windowExpenses, grain, anchor, period.from, period.to])

  // ── edit / delete ────────────────────────────────────────────────────────────
  function startEdit(e) {
    setEditingId(e.id)
    setEditForm({ expense_date: e.expense_date, category: e.category, description: e.description || '', amount_local: String(e.amount_local ?? '') })
  }
  async function saveEdit(orig) {
    const amt = Number(editForm.amount_local)
    if (!editForm.expense_date) { toast.error('Date is required'); return }
    if (!editForm.category) { toast.error('Category is required'); return }
    if (!amt || amt <= 0) { toast.error(`${ccy} amount must be greater than 0`); return }
    const patch = {
      expense_date: editForm.expense_date,
      category: editForm.category,
      description: editForm.description.trim() || null,
      amount_local: amt,
      updated_at: new Date().toISOString(),
    }
    // If the date moved, restamp the rate that applies to the new date.
    if (editForm.expense_date !== orig.expense_date) {
      const info = await rateFor(officeId, editForm.expense_date)
      if (!info?.fx_rate) { toast.error(`No transfer rate exists on or before ${editForm.expense_date}`); return }
      patch.fx_rate = Number(info.fx_rate)
      patch.rate_transfer_id = info.transfer_id || null
      patch.rate_is_manual = false
    }
    const { error: e } = await supabase.from('office_expenses').update(patch).eq('id', orig.id)
    if (e) { toast.error("Couldn't update expense", e); return }
    toast.success('Expense updated')
    setEditingId(null); setEditForm(null); reload()
  }
  async function doDelete(id) {
    const { error: e } = await supabase.from('office_expenses').delete().eq('id', id)
    if (e) { toast.error("Couldn't delete expense", e); return }
    toast.success('Expense deleted')
    setConfirmDelete(null); reload()
  }

  function exportCSV() {
    const csv = expensesToCSV(expenses, ccy)
    downloadCSV(`office-expenses_${office?.name || 'office'}_${period.key}.csv`, csv)
  }

  // ── chart theme ──────────────────────────────────────────────────────────────
  const gridColor = isDark ? '#334155' : '#e5e7eb'
  const tickColor = isDark ? '#94a3b8' : '#6b7280'
  const tooltipStyle = {
    backgroundColor: isDark ? '#1e293b' : '#ffffff',
    border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}`,
    borderRadius: 12, fontSize: 12,
  }

  const spentDelta = prevSpent != null ? spentUsd - prevSpent : null
  const inDelta = prevIn != null ? inUsd - prevIn : null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Office Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Local-currency spend and USD equivalents, derived from real transfer rates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className={S.btnSecondary}>Export</button>
          {canEdit && <button onClick={() => setShowTransfer(true)} className={S.btnSecondary}>Record transfer</button>}
          {canEdit && <button onClick={() => setShowAdd(true)} className={S.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add expenses
          </button>}
        </div>
      </div>

      {/* Control row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {offices.map(o => (
            <button key={o.id} onClick={() => setOfficeId(o.id)} className={S.filterBtn(o.id === officeId)}>{o.name}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {GRAINS.map(g => (
            <button key={g.value} onClick={() => setGrain(g.value)} className={S.filterBtn(g.value === grain)}>{g.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor(a => stepPeriod(grain, a, -1))} className={S.btnSecondary} aria-label="Previous period">◀</button>
          <span className="min-w-[7rem] text-center text-sm font-semibold text-gray-900 dark:text-white">{period.label}</span>
          <button onClick={() => setAnchor(a => stepPeriod(grain, a, 1))} disabled={isCurrentPeriod(grain, anchor)}
            className={`${S.btnSecondary} disabled:opacity-40`} aria-label="Next period">▶</button>
          <button onClick={() => setAnchor(todayISO())} className={S.btnSecondary}>This period</button>
          <button onClick={() => setCompare(c => !c)} className={S.filterBtn(compare)}>Compare</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={`Spent (${period.label})`} value={usd2(spentUsd)} sub={local0(sel?.spent_local, ccy)} delta={spentDelta} deltaLabel={`vs ${prevPeriodLabel(grain, anchor)}`} invertDelta />
            <StatCard label="Transferred in" value={usd2(inUsd)} sub={local0(sel?.in_local, ccy)} delta={inDelta} deltaLabel={`vs ${prevPeriodLabel(grain, anchor)}`} />
            <StatCard
              label={`Balance (end of ${period.label})`}
              value={balUsd != null ? usd2(balUsd) : '—'}
              sub={local0(balLocal, ccy)}
              foot={openingLocal != null ? `Opened at ${local0(openingLocal, ccy)} · carried from prior months` : null}
            />
            <StatCard label="Rate" value={periodRate ? `${rate2(periodRate)} ${ccy}` : '—'} sub={periodRate ? 'per 1 USD' : 'no transfer yet'} />
          </div>

          {/* Compare table */}
          {compare && (
            <div className={`${S.card} overflow-hidden`}>
              <div className="px-4 py-3 border-b border-gray-200 dark:border-white/5 text-sm font-semibold text-gray-900 dark:text-white">
                {prevPeriodLabel(grain, anchor)} vs {period.label} — by category (USD)
              </div>
              <table className="w-full text-sm">
                <thead className={S.tableHead}>
                  <tr>
                    <th className={S.th}>Category</th>
                    <th className={`${S.th} text-right`}>{prevPeriodLabel(grain, anchor)}</th>
                    <th className={`${S.th} text-right`}>{period.label}</th>
                    <th className={`${S.th} text-right`}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 dark:text-slate-600">No spend in either period</td></tr>
                  ) : compareRows.map(r => {
                    const d = r.cur - r.prev
                    return (
                      <tr key={r.category} className={S.tableRow}>
                        <td className={`${S.td} text-gray-900 dark:text-slate-200`}>{formatLabel(r.category)}</td>
                        <td className={`${S.td} text-right text-gray-500 dark:text-slate-400 tabular-nums`}>{usd0(r.prev)}</td>
                        <td className={`${S.td} text-right text-gray-900 dark:text-slate-200 tabular-nums`}>{usd0(r.cur)}</td>
                        <td className={`${S.td} text-right tabular-nums ${d > 0 ? 'text-red-500' : d < 0 ? 'text-emerald-500' : 'text-gray-400'}`}>
                          {d === 0 ? '—' : `${d > 0 ? '+' : ''}${usd0(d)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${S.card} p-4`}>
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Spend by category (USD)</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="period" tick={{ fill: tickColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
                  <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={usd0} width={56} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [usd0(v), formatLabel(n)]} />
                  <Legend formatter={(v) => formatLabel(v)} wrapperStyle={{ fontSize: 11 }} />
                  {chartCats.map((c, i) => (
                    <Bar key={c} dataKey={c} stackId="s" fill={CHART_COLORS[i % CHART_COLORS.length]} radius={i === chartCats.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className={`${S.card} p-4`}>
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Balance ({ccy})</div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={balanceData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="period" tick={{ fill: tickColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
                  <YAxis tick={{ fill: tickColor, fontSize: 11 }} axisLine={false} tickLine={false} width={64}
                    tickFormatter={v => Math.round(v).toLocaleString('en-US')} />
                  <Tooltip contentStyle={tooltipStyle} formatter={v => [local0(v, ccy), 'Balance']} />
                  <Line type="monotone" dataKey="balance" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Expenses table */}
          <div className={`${S.card} overflow-hidden`}>
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={S.th}>Date</th>
                  <th className={S.th}>Category</th>
                  <th className={S.th}>Description</th>
                  <th className={`${S.th} text-right`}>{ccy}</th>
                  <th className={`${S.th} text-right`}>USD</th>
                  <th className={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 dark:text-slate-600">No expenses in {period.label}</td></tr>
                ) : expenses.map(e => {
                  const editing = editingId === e.id
                  if (editing) {
                    return (
                      <tr key={e.id} className={S.tableRow}>
                        <td className={S.td}><input type="date" className={S.input} value={editForm.expense_date} onChange={ev => setEditForm(f => ({ ...f, expense_date: ev.target.value }))} /></td>
                        <td className={S.td}>
                          <select className={S.input} value={editForm.category} onChange={ev => setEditForm(f => ({ ...f, category: ev.target.value }))}>
                            <CategoryOptions current={editForm.category} formatLabel={formatLabel} />
                          </select>
                        </td>
                        <td className={S.td}><input className={S.input} value={editForm.description} onChange={ev => setEditForm(f => ({ ...f, description: ev.target.value }))} /></td>
                        <td className={S.td}><input type="number" step="0.01" min="0" className={`${S.input} text-right`} value={editForm.amount_local} onChange={ev => setEditForm(f => ({ ...f, amount_local: ev.target.value }))} /></td>
                        <td className={`${S.td} text-right text-gray-400 dark:text-slate-500 tabular-nums`}>auto</td>
                        <td className={`${S.td} text-right whitespace-nowrap`}>
                          <button onClick={() => saveEdit(e)} className="text-emerald-600 dark:text-emerald-400 font-medium mr-3">Save</button>
                          <button onClick={() => { setEditingId(null); setEditForm(null) }} className="text-gray-400">Cancel</button>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={e.id} className={`${S.tableRow} group`}>
                      <td className={`${S.td} text-gray-500 dark:text-slate-400 whitespace-nowrap`}>{e.expense_date}</td>
                      <td className={`${S.td} text-gray-900 dark:text-slate-200`}>
                        {formatLabel(e.category)}
                        {isInherited(e) && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 align-middle">inherited rate</span>}
                        {e.rate_is_manual && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-white/10 align-middle">manual rate</span>}
                      </td>
                      <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{e.description || <span className="text-gray-300 dark:text-slate-600">—</span>}</td>
                      <td className={`${S.td} text-right text-gray-900 dark:text-slate-200 tabular-nums`}>{local0(e.amount_local, ccy)}</td>
                      <td className={`${S.td} text-right text-gray-600 dark:text-slate-400 tabular-nums`}>{usd2(e.amount_usd)}</td>
                      <td className={`${S.td} text-right whitespace-nowrap`}>
                        {canEdit && (
                          <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(e)} title="Edit" className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button onClick={() => setConfirmDelete(e.id)} title="Delete" className="text-gray-400 hover:text-red-500">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Delete this expense?</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">This can't be undone.</p>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} className={S.btnCancel}>Cancel</button>
              <button onClick={() => doDelete(confirmDelete)} className="px-4 py-2 text-sm font-semibold bg-red-500 hover:bg-red-400 text-white rounded-xl transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {office && (
        <>
          <AddOfficeExpensesModal open={showAdd} office={office} defaultDate={period.from} periodLabel={period.label}
            onClose={() => setShowAdd(false)} onSaved={reload} />
          <OfficeTransferModal open={showTransfer} office={office}
            onClose={() => setShowTransfer(false)} onSaved={reload} />
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, delta, deltaLabel, invertDelta, foot }) {
  const hasDelta = delta != null && Number.isFinite(delta) && Math.round(delta) !== 0
  // invertDelta: for spend, an increase is "bad" (red).
  const up = delta > 0
  const good = invertDelta ? !up : up
  return (
    <div className={`${S.card} p-4`}>
      <div className="text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">{value}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-400 dark:text-slate-500 tabular-nums">{sub || ''}</span>
        {hasDelta && (
          <span className={`text-xs font-medium tabular-nums ${good ? 'text-emerald-500' : 'text-red-500'}`}>
            {up ? '▲' : '▼'} {usd0(Math.abs(delta))} <span className="text-gray-400 dark:text-slate-500 font-normal">{deltaLabel}</span>
          </span>
        )}
      </div>
      {foot && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/5 text-[11px] text-gray-500 dark:text-slate-400 tabular-nums">
          {foot}
        </div>
      )}
    </div>
  )
}

// Category options for the inline editor: uses office+both categories, and pins
// the row's current category on top if it's outside that set (e.g. archived).
function CategoryOptions({ current, formatLabel }) {
  const { activeOffice } = useExpenseCategories()
  const names = activeOffice.map(c => c.name)
  const opts = names.includes(current) || !current ? activeOffice : [{ name: current, display_label: formatLabel(current) }, ...activeOffice]
  return (
    <>
      <option value="">— Category —</option>
      {opts.map(c => <option key={c.name} value={c.name}>{c.display_label}</option>)}
    </>
  )
}
