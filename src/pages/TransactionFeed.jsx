import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'

export default function TransactionFeed() {
  const { profile } = useAuth()
  const [transactions, setTransactions] = useState([])
  const [vendors, setVendors] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDept, setFilterDept] = useState('')
  // CSV Import
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [txnRes, vendRes, deptRes] = await Promise.all([
      supabase.from('transactions').select('*, vendors(name), departments(name)').order('transaction_date', { ascending: false }),
      supabase.from('vendors').select('*, departments(name)').eq('is_active', true),
      supabase.from('departments').select('*').order('name'),
    ])
    setTransactions(txnRes.data || [])
    setVendors(vendRes.data || [])
    setDepartments(deptRes.data || [])
    setLoading(false)
  }

  const filtered = transactions.filter(t => {
    const matchStatus = !filterStatus || t.status === filterStatus
    const matchDept = !filterDept || t.department_id === filterDept
    return matchStatus && matchDept
  })

  // Weekly summary
  const now = new Date()
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7)
  const weekTxns = transactions.filter(t => new Date(t.transaction_date) >= weekAgo)
  const weekTotal = weekTxns.reduce((s, t) => s + Number(t.amount), 0)
  const weekMatched = weekTxns.filter(t => t.status === 'Matched').length
  const weekUnmatched = weekTxns.filter(t => t.status === 'Unmatched')
  const weekUnmatchedAmt = weekUnmatched.reduce((s, t) => s + Number(t.amount), 0)
  const matchRate = weekTxns.length ? Math.round((weekMatched / weekTxns.length) * 100) : 0

  // CSV parsing
  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target.result
      const lines = text.split('\n').filter(l => l.trim())
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))

      const rows = lines.slice(1).map((line, i) => {
        // Handle quoted CSV
        const cols = parseCSVLine(line)
        const row = {}
        headers.forEach((h, idx) => { row[h] = (cols[idx] || '').replace(/"/g, '').trim() })

        const dateRaw = row['Date'] || row['date'] || row['Transaction Date'] || ''
        const descRaw = row['Description'] || row['description'] || row['Vendor'] || row['vendor'] || row['Name'] || ''
        const amtRaw = row['Amount'] || row['amount'] || row['Debit'] || row['debit'] || ''
        const methodRaw = row['Payment Method'] || row['payment_method'] || row['Type'] || 'ACH'

        const amount = Math.abs(parseFloat(amtRaw.replace(/[$,]/g, '')) || 0)
        const vendor = findVendorMatch(descRaw)

        return {
          _row: i + 2,
          transaction_date: parseDate(dateRaw),
          vendor_name_raw: descRaw,
          amount,
          payment_method: methodRaw || 'ACH',
          vendor_id: vendor?.id || null,
          vendor_name_matched: vendor?.name || null,
          department_id: vendor?.department_id || null,
          status: 'Unmatched',
          source: 'csv_import',
          _matched: !!vendor,
          _overrideVendor: vendor?.id || '',
        }
      }).filter(r => r.amount > 0)

      setImportRows(rows)
      setShowImport(true)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function parseCSVLine(line) {
    const result = []; let cur = ''; let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes }
      else if (line[i] === ',' && !inQuotes) { result.push(cur); cur = '' }
      else { cur += line[i] }
    }
    result.push(cur)
    return result
  }

  function parseDate(raw) {
    if (!raw) return new Date().toISOString().split('T')[0]
    const d = new Date(raw)
    if (!isNaN(d)) return d.toISOString().split('T')[0]
    return raw
  }

  function findVendorMatch(desc) {
    if (!desc) return null
    const lower = desc.toLowerCase()
    return vendors.find(v => lower.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(lower.split(' ')[0])) || null
  }

  function updateImportRow(idx, field, value) {
    setImportRows(rows => rows.map((r, i) => {
      if (i !== idx) return r
      if (field === '_overrideVendor') {
        const vendor = vendors.find(v => v.id === value)
        return { ...r, _overrideVendor: value, vendor_id: value || null, department_id: vendor?.department_id || null, vendor_name_matched: vendor?.name || null }
      }
      return { ...r, [field]: value }
    }))
  }

  async function confirmImport() {
    setSaving(true)
    const payload = importRows.map(({ _row, _matched, _overrideVendor, vendor_name_matched, ...rest }) => ({
      ...rest,
      status: 'Unmatched',
    }))

    const { data: inserted, error } = await supabase.from('transactions').insert(payload).select()
    if (error) { alert('Import error: ' + error.message); setSaving(false); return }

    // Run auto-matching
    await runAutoMatch(inserted)
    setSaving(false)
    setShowImport(false)
    loadData()
  }

  async function runAutoMatch(txns) {
    const { data: approvedInvoices } = await supabase
      .from('invoices').select('*, vendors(name)').eq('status', 'Approved')

    const updates = []
    for (const txn of txns) {
      if (!txn.vendor_id) continue
      const match = approvedInvoices?.find(inv => {
        if (inv.vendor_id !== txn.vendor_id) return false
        const diff = Math.abs(Number(inv.amount) - Number(txn.amount))
        const pct = diff / Number(inv.amount)
        return diff <= 50 || pct <= 0.05
      })
      if (match) {
        updates.push(supabase.from('transactions').update({ status: 'Matched', matched_invoice_id: match.id }).eq('id', txn.id))
      }
    }
    await Promise.all(updates)
  }

  async function manualMatch(txn) {
    // Simple: find best invoice match
    const { data: invoices } = await supabase.from('invoices').select('*, vendors(name)').eq('status', 'Approved').eq('vendor_id', txn.vendor_id)
    if (!invoices?.length) { alert('No approved invoices found for this vendor.'); return }
    const best = invoices[0]
    await supabase.from('transactions').update({ status: 'Matched', matched_invoice_id: best.id }).eq('id', txn.id)
    loadData()
  }

  async function disputeTxn(txn) {
    await supabase.from('transactions').update({ status: 'Disputed' }).eq('id', txn.id)
    loadData()
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transaction Feed</h1>
          <p className="text-sm text-gray-500 mt-0.5">{transactions.length} total transactions</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input type="file" accept=".csv" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileRef.current.click()} className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import CSV
            </button>
          </div>
        )}
      </div>

      {/* Weekly Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total This Week', value: `$${weekTotal.toLocaleString()}`, color: 'text-gray-900' },
          { label: 'Matched', value: weekMatched, color: 'text-green-600' },
          { label: 'Unmatched', value: weekUnmatched.length, color: 'text-red-600' },
          { label: 'Unmatched $', value: `$${weekUnmatchedAmt.toLocaleString()}`, color: 'text-red-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">{c.label}</p>
            <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">Match Rate (this week)</span>
          <div className="flex-1 bg-gray-200 rounded-full h-2">
            <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${matchRate}%` }} />
          </div>
          <span className="text-sm font-semibold text-gray-900">{matchRate}%</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {['', 'Matched', 'Unmatched', 'Disputed'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${filterStatus === s ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {s || 'All'}
          </button>
        ))}
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 ml-auto">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Method</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Department</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                {canEdit && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">No transactions found</td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">{t.transaction_date}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{t.vendors?.name || t.vendor_name_raw}</div>
                    {t.vendor_name_raw && t.vendors?.name !== t.vendor_name_raw && (
                      <div className="text-xs text-gray-400">{t.vendor_name_raw}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">${Number(t.amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{t.payment_method}</td>
                  <td className="px-4 py-3"><DeptBadge name={t.departments?.name} /></td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={t.status} /></td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      {t.status === 'Unmatched' && (
                        <div className="flex gap-1">
                          <button onClick={() => manualMatch(t)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-md hover:bg-green-200">Match</button>
                          <button onClick={() => disputeTxn(t)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-md hover:bg-red-200">Dispute</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CSV Import Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Transactions — Preview" size="xl">
        <div className="p-5">
          <p className="text-sm text-gray-600 mb-4">Review parsed transactions. Auto-matched vendors are highlighted. You can override vendor assignments before saving.</p>
          <div className="overflow-x-auto max-h-[50vh] border border-gray-200 rounded-lg overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['Row','Date','Raw Description','Amount','Method','Vendor Match','Dept'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {importRows.map((r, idx) => (
                  <tr key={r._row} className={r._matched ? 'bg-green-50' : 'bg-amber-50'}>
                    <td className="px-3 py-2 text-gray-400">{r._row}</td>
                    <td className="px-3 py-2">{r.transaction_date}</td>
                    <td className="px-3 py-2 max-w-xs truncate text-gray-600">{r.vendor_name_raw}</td>
                    <td className="px-3 py-2 font-medium">${r.amount.toLocaleString()}</td>
                    <td className="px-3 py-2">{r.payment_method}</td>
                    <td className="px-3 py-2">
                      <select value={r._overrideVendor} onChange={e => updateImportRow(idx, '_overrideVendor', e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-500">
                        <option value="">Unmatched</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {r.department_id ? <DeptBadge name={vendors.find(v=>v.id===r.vendor_id)?.departments?.name} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={confirmImport} disabled={saving}
              className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-orange-300">
              {saving ? 'Saving & Matching...' : `Import ${importRows.length} Transactions`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
