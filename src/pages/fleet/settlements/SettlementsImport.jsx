import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import TerminatedDriverWarning from '../../../components/TerminatedDriverWarning'
import { fetchTerminatedDrivers } from '../../../lib/terminatedDrivers'
import { parseSettlementWorkbook, matchDrivers, commitSettlements, loadRecentSettlements, getSettlementCount } from './settlementImportData'

const PAY_SCHEDULES = ['Saturday–Friday', 'Tuesday–Monday', 'Monday–Sunday']

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtMoney(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function fmtNum(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SettlementsImport() {
  const { user, canEdit } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  const [step, setStep] = useState('upload') // 'upload' | 'configure' | 'preview' | 'committing' | 'done'
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [payPeriodStart, setPayPeriodStart] = useState('')
  const [payPeriodEnd, setPayPeriodEnd] = useState('')
  const [paySchedule, setPaySchedule] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [recent, setRecent] = useState([])
  const [terminatedEntries, setTerminatedEntries] = useState([]) // drivers in this file who are terminated

  useEffect(() => {
    loadRecentSettlements(5).then(setRecent).catch(err => console.error('Error loading recent imports:', err))
  }, [])

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setBusy(true)
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer)
      const parsed = parseSettlementWorkbook(workbook)

      if (!parsed.length) {
        toast.error('No settlement data found in file')
        return
      }

      // Match drivers
      const matched = await matchDrivers(parsed)
      setRows(matched)
      // Terminated-driver check (warning only) — group by the already-resolved
      // driverId so a driver with several rows is one line.
      const termMap = await fetchTerminatedDrivers(matched.map(r => r.driverId))
      const byDriver = new Map()
      for (const r of matched) {
        if (!r.driverId || !termMap.has(r.driverId)) continue
        const cur = byDriver.get(r.driverId) || { id: r.driverId, count: 0, d: termMap.get(r.driverId) }
        cur.count += 1
        byDriver.set(r.driverId, cur)
      }
      setTerminatedEntries([...byDriver.values()].map(x => ({
        id: x.id, name: x.d.full_name, internalId: x.d.internal_id, terminatedAt: x.d.terminated_at, count: x.count,
      })))
      setFileName(file.name)
      setStep('configure')
    } catch (err) {
      toast.error('Failed to parse file', err)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const handleConfigure = () => {
    if (!payPeriodStart || !payPeriodEnd) {
      toast.error('Pick both start and end dates')
      return
    }
    if (new Date(payPeriodStart) > new Date(payPeriodEnd)) {
      toast.error('Start date must be before or equal to end date')
      return
    }
    setStep('preview')
  }

  const handleCommit = async () => {
    if (!canEdit) {
      toast.error('You don\'t have permission to import settlements')
      return
    }

    setBusy(true)
    setProgress({ current: 0, total: rows.length })

    try {
      // Commit with simulated progress
      const batchSize = Math.max(10, Math.floor(rows.length / 10))
      let offset = 0

      while (offset < rows.length) {
        const batch = rows.slice(offset, offset + batchSize)
        await commitSettlements(batch, payPeriodStart, payPeriodEnd, paySchedule || null, user.id, fileName)
        offset += batchSize
        setProgress({ current: offset, total: rows.length })
      }

      toast.success(`Imported ${rows.length} settlement records`)

      // Reload recent history
      const updated = await loadRecentSettlements(5)
      setRecent(updated)

      setStep('done')
      setTimeout(() => {
        setStep('upload')
        setRows([])
        setFileName('')
        setTerminatedEntries([])
        setPayPeriodStart('')
        setPayPeriodEnd('')
        setPaySchedule('')
      }, 2000)
    } catch (err) {
      toast.error('Failed to commit settlements', err)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const matched = rows.filter(r => r.driverId).length
  const unmatched = rows.length - matched

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settlement Import</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
          Import weekly driver settlement xlsx from payroll.
        </p>
      </div>

      {/* Upload Step */}
      {step === 'upload' && (
        <div className={`${S.card} p-8 text-center border-2 border-dashed border-gray-200 dark:border-slate-700`}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            disabled={busy}
            className="hidden"
          />
          <div className="space-y-3">
            <div className="text-4xl">📄</div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Upload settlement xlsx</h2>
            <p className="text-sm text-gray-500 dark:text-slate-500">
              Expected columns: Driver's number, Driver name, Truck, Pay To, Status, Driver type, $ Per Mile, Miles, % Loaded, % Empty, Linehaul Revenue, Driver Pay, Fuel Total, Adjustment, Settlement, Settlement Date, Carrier
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-400 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {busy ? 'Parsing…' : 'Choose file'}
            </button>
          </div>
        </div>
      )}

      {/* Configure Step */}
      {step === 'configure' && (
        <div className={`${S.card} p-6 space-y-4`}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Pay period & schedule</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Pay period start</label>
              <input
                type="date"
                value={payPeriodStart}
                onChange={(e) => setPayPeriodStart(e.target.value)}
                className={S.input}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Pay period end</label>
              <input
                type="date"
                value={payPeriodEnd}
                onChange={(e) => setPayPeriodEnd(e.target.value)}
                className={S.input}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Pay schedule (optional)</label>
            <select
              value={paySchedule}
              onChange={(e) => setPaySchedule(e.target.value)}
              className={S.input}
            >
              <option value="">Not specified</option>
              {PAY_SCHEDULES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <button
              onClick={() => {
                setRows([])
                setFileName('')
                setTerminatedEntries([])
                setStep('upload')
              }}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-700 rounded-lg text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={handleConfigure}
              className="px-4 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Preview {rows.length} rows
            </button>
          </div>
        </div>
      )}

      {/* Preview Step */}
      {step === 'preview' && (
        <div className="space-y-4">
          <TerminatedDriverWarning entries={terminatedEntries} noun="settlements" />
          <div className={`${S.card} p-4`}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Preview & match status</h2>
            <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
              <div className={`${S.card} p-3`}>
                <div className="text-gray-600 dark:text-slate-400">Total rows</div>
                <div className="text-lg font-bold text-gray-900 dark:text-white">{rows.length}</div>
              </div>
              <div className={`${S.card} p-3 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/[0.05]`}>
                <div className="text-emerald-700 dark:text-emerald-400">Matched</div>
                <div className="text-lg font-bold text-emerald-900 dark:text-emerald-300">{matched} ✓</div>
              </div>
              <div className={`${S.card} p-3 border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/[0.05]`}>
                <div className="text-amber-700 dark:text-amber-400">Unmatched</div>
                <div className="text-lg font-bold text-amber-900 dark:text-amber-300">{unmatched}</div>
              </div>
            </div>
          </div>

          <div className={`${S.card} overflow-hidden`}>
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 border-b border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-[#0d0d1f]">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-600 dark:text-slate-400 font-semibold">Status</th>
                    <th className="px-3 py-2 text-left text-gray-600 dark:text-slate-400 font-semibold">Driver # · Name</th>
                    <th className="px-3 py-2 text-left text-gray-600 dark:text-slate-400 font-semibold">Driver type</th>
                    <th className="px-3 py-2 text-right text-gray-600 dark:text-slate-400 font-semibold">Loads (miles)</th>
                    <th className="px-3 py-2 text-right text-gray-600 dark:text-slate-400 font-semibold">Driver pay</th>
                    <th className="px-3 py-2 text-right text-gray-600 dark:text-slate-400 font-semibold">Settlement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                      <td className="px-3 py-2">
                        {row.matchStatus === 'matched' && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>}
                        {row.matchStatus === 'matched-by-name' && <span className="text-blue-600 dark:text-blue-400 font-semibold">✓*</span>}
                        {row.matchStatus === 'unmatched' && <span className="text-amber-600 dark:text-amber-400 font-semibold">⚠</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono text-gray-700 dark:text-slate-200">{row.driverNumberRaw}</div>
                        <div className="text-gray-600 dark:text-slate-400">{row.driverNameRaw}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{row.driverTypeRaw || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200 font-mono">{row.miles != null ? `${fmtNum(row.miles)} mi` : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-200 font-mono">{fmtMoney(row.driverPay)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(row.settlement)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <button
              onClick={() => setStep('configure')}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-700 rounded-lg text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5"
            >
              Back
            </button>
            <button
              onClick={handleCommit}
              disabled={busy}
              className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {busy ? 'Committing…' : 'Commit'}
            </button>
          </div>
        </div>
      )}

      {/* Committing Step */}
      {step === 'committing' && (
        <div className={`${S.card} p-6 text-center space-y-4`}>
          <div className="text-2xl animate-spin">⏳</div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Importing settlements…</h2>
          <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-sm text-gray-600 dark:text-slate-400">
            {progress.current} / {progress.total}
          </p>
        </div>
      )}

      {/* Done Step */}
      {step === 'done' && (
        <div className={`${S.card} p-6 text-center space-y-3 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/[0.05]`}>
          <div className="text-3xl">✓</div>
          <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-300">Import complete</h2>
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {rows.length} settlement records imported for {fmtDate(payPeriodStart)} – {fmtDate(payPeriodEnd)}
          </p>
        </div>
      )}

      {/* Recent imports history */}
      {recent.length > 0 && (
        <div className={`${S.card} p-4`}>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recent imports</h2>
          <div className="space-y-2">
            {recent.map((imp, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded border border-gray-100 dark:border-white/5 text-xs">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {fmtDate(imp.pay_period_start)} – {fmtDate(imp.pay_period_end)}
                  </div>
                  <div className="text-gray-600 dark:text-slate-400">
                    {imp.source_file} {imp.pay_schedule ? `· ${imp.pay_schedule}` : ''}
                  </div>
                </div>
                <div className="text-gray-600 dark:text-slate-400">
                  {new Date(imp.imported_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
