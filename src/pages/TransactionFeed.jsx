import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { S } from '../lib/styles'
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

  const filtered = transactions.filter(t =>
    (!filterStatus || t.status === filterStatus) && (!filterDept || t.department_id === filterDept)
  )

  // Weekly summary
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
  const weekTxns = transactions.filter(t => new Date(t.transaction_date) >= weekAgo)
  const weekTotal = weekTxns.reduce((s, t) => s + Number(t.amount), 0)
  const weekMatched = weekTxns.filter(t => t.status === 'Matched').length
  const weekUnmatched = weekTxns.filter(t => t.status === 'Unmatched')
  const weekUnmatchedAmt = weekUnmatched.reduce((s, t) => s + Number(t.amount), 0)
  const matchRate = weekTxns.length ? Math.round((weekMatched / weekTxns.length) * 100) : 0

  function parseCSVLine(line) {
    const result = []; let cur = ''; let inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
      else cur += ch
    }
    result.push(cur)
    return result
  }

  function parseDate(raw) {
    if (!raw) return new Date().toISOString().split('T')[0]
    const d = new Date(raw)
    return isNaN(d) ? raw : d.toISOString().split('T')[0]
  }

  function findVendor(desc) {
    if (!desc) return null
    const lower = desc.toLowerCase()
    return vendors.find(v => lower.includes(v.name.toLowerCase()) || v.name.toLowerCase().split(' ').some(w => w.length > 3 && lower.includes(w))) || null
  }

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const lines = evt.target.result.split('\n').filter(l => l.trim())
      const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/"/g, ''))
      const rows = lines.slice(1).map((line, i) => {
        const cols = parseCSVLine(line)
        const row = {}
        headers.forEach((h, idx) => { row[h] = (cols[idx] || '').replace(/"/g, '').trim() })
        const desc = row['Description'] || row['description'] || row['Vendor'] || row['Name'] || ''
        const amtRaw = row['Amount'] || row['amount'] || row['Debit'] || ''
        const amount = Math.abs(parseFloat(amtRaw.replace(/[$,]/g, '')) || 0)
        const vendor = findVendor(desc)
        return {
          _row: i + 2,
          transaction_date: parseDate(row['Date'] || row['date'] || row['Transaction Date'] || ''),
          vendor_name_raw: desc,
          amount,
          payment_method: row['Payment Method'] || row['Type'] || 'ACH',
          vendor_id: vendor?.id || null,
          department_id: vendor?.department_id || null,
          _overrideVendor: vendor?.id || '',
          vendor_name_matched: vendor?.name || null,
          status: 'Unmatched',
          source: 'csv_import',
        }
      }).filter(r => r.amount > 0)
      setImportRows(rows)
      setShowImport(true)
    }
    reader.readAsText(file); e.target.value = ''
  }

  function updateRow(idx, vendorId) {
    const vendor = vendors.find(v => v.id === vendorId)
    setImportRows(rows => rows.map((r, i) => i !== idx ? r : {
      ...r, _overrideVendor: vendorId, vendor_id: vendorId || null,
      department_id: vendor?.department_id || null,
      vendor_name_matched: vendor?.name || null,
    }))
  }

  async function confirmImport() {
    setSaving(true)
    const payload = importRows.map(({ _row, _overrideVendor, vendor_name_matched, ...rest }) => ({ ...rest, status: 'Unmatched' }))
    const { data: inserted, error } = await supabase.from('transactions').insert(payload).select()
    if (error) { alert('Import error: ' + error.message); setSaving(false); return }
    await runAutoMatch(inserted)
    setSaving(false); setShowImport(false); loadData()
  }

  async function runAutoMatch(txns) {
    const { data: approved } = await supabase.from('invoices').select('*, vendors(name)').eq('status', 'Approved')
    const updates = txns
      .filter(t => t.vendor_id)
      .map(t => {
        const match = approved?.find(inv => {
          if (inv.vendor_id !== t.vendor_id) return false
          const diff = Math.abs(Number(inv.amount) - Number(t.amount))
          return diff <= 50 || diff / Number(inv.amount) <= 0.05
        })
        return match ? supabase.from('transactions').update({ status: 'Matched', matched_invoice_id: match.id }).eq('id', t.id) : null
      }).filter(Boolean)
    await Promise.all(updates)
  }

  async function manualMatch(t) {
    const { data: invoices } = await supabase.from('invoices').select('*').eq('status', 'Approved').eq('vendor_id', t.vendor_id)
    if (!invoices?.length) { alert('No approved invoices found for this vendor.'); return }
    await supabase.from('transactions').update({ status: 'Matched', matched_invoice_id: invoices[0].id }).eq('id', t.id)
    loadData()
  }

  async function disputeTxn(t) {
    await supabase.from('transactions').update({ status: 'Disputed' }).eq('id', t.id)
    loadData()
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Transaction Feed</h1>
          <p className="text-sm text-slate-500 mt-0.5">{transactions.length} total transactions</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input type="file" accept=".csv" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileRef.current.click()} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import CSV
            </button>
          </div>
        )}
      </div>

      {/* Weekly summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total This Week', value: `$${weekTotal.toLocaleString()}`, color: 'text-white' },
          { label: 'Matched', value: weekMatched, color: 'text-emerald-400' },
          { label: 'Unmatched Count', value: weekUnmatched.length, color: 'text-red-400' },
          { label: 'Unmatched $', value: `$${weekUnmatchedAmt.toLocaleString()}`, color: 'text-red-400' },
        ].map(c => (
          <div key={c.label} className={`${S.card} p-4`}>
            <p className="text-xs text-slate-500 mb-1">{c.label}</p>
            <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Match rate bar */}
      <div className={`${S.card} p-4`}>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 w-32 shrink-0">Match Rate (week)</span>
          <div className="flex-1 bg-slate-800 rounded-full h-1.5">
            <div className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-1.5 rounded-full transition-all" style={{ width: `${matchRate}%` }} />
          </div>
          <span className="text-sm font-bold text-white w-10 text-right">{matchRate}%</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'Matched', 'Unmatched', 'Disputed'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} className={S.filterBtn(filterStatus === s)}>
            {s || 'All'}
          </button>
        ))}
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className={`${S.select} ml-auto`}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Date','Vendor','Amount','Method','Department','Status', canEdit && ''].filter(Boolean).map(h => (
                  <th key={h} className={`${S.th} ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-600 text-sm">No transactions found</td></tr>
              ) : filtered.map(t => (
                <tr key={t.id} className={S.tableRow}>
                  <td className={`${S.td} text-slate-400 text-xs`}>{t.transaction_date}</td>
                  <td className={S.td}>
                    <div className="font-medium text-slate-200">{t.vendors?.name || t.vendor_name_raw}</div>
                    {t.vendor_name_raw && t.vendors?.name && t.vendors.name !== t.vendor_name_raw && (
                      <div className="text-xs text-slate-500 mt-0.5">{t.vendor_name_raw}</div>
                    )}
                  </td>
                  <td className={`${S.td} text-right font-semibold text-slate-200`}>${Number(t.amount).toLocaleString()}</td>
                  <td className={`${S.td} text-slate-400`}>{t.payment_method}</td>
                  <td className={S.td}><DeptBadge name={t.departments?.name} /></td>
                  <td className={`${S.td} text-center`}><StatusBadge status={t.status} /></td>
                  {canEdit && (
                    <td className={S.td}>
                      {t.status === 'Unmatched' && (
                        <div className="flex gap-1.5">
                          <button onClick={() => manualMatch(t)} className={S.btnSuccess}>Match</button>
                          <button onClick={() => disputeTxn(t)} className={S.btnDanger}>Dispute</button>
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
          <p className="text-xs text-slate-500 mb-4">Auto-matched vendors shown in green. Override any vendor assignment before saving.</p>
          <div className="overflow-x-auto max-h-[50vh] border border-white/5 rounded-xl overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#09091a] sticky top-0">
                <tr>{['Row','Date','Description','Amount','Method','Vendor Match','Dept'].map(h=><th key={h} className="px-3 py-2 text-left text-slate-500">{h}</th>)}</tr>
              </thead>
              <tbody>
                {importRows.map((r, idx) => (
                  <tr key={r._row} className={`border-b border-white/[0.03] ${r._overrideVendor ? 'bg-emerald-500/[0.03]' : 'bg-amber-500/[0.03]'}`}>
                    <td className="px-3 py-2 text-slate-600">{r._row}</td>
                    <td className="px-3 py-2 text-slate-400">{r.transaction_date}</td>
                    <td className="px-3 py-2 text-slate-300 max-w-[160px] truncate">{r.vendor_name_raw}</td>
                    <td className="px-3 py-2 font-medium text-slate-200">${r.amount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-400">{r.payment_method}</td>
                    <td className="px-3 py-2">
                      <select value={r._overrideVendor} onChange={e => updateRow(idx, e.target.value)}
                        className="px-2 py-1 bg-slate-800 border border-slate-700/40 rounded-lg text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/40">
                        <option value="">Unmatched</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {r.department_id ? <DeptBadge name={vendors.find(v=>v.id===r.vendor_id)?.departments?.name} /> : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${S.modalFooter} mt-4`}>
            <button onClick={() => setShowImport(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={confirmImport} disabled={saving || !importRows.length} className={S.btnSave}>
              {saving ? 'Saving & Matching…' : `Import ${importRows.length} Transactions`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
