import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'

const emptyForm = {
  invoice_number: '', vendor_id: '', amount: '', received_date: '', due_date: '',
  status: 'Pending', department_id: '', notes: '', source: 'manual',
}

export default function InvoiceInbox() {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [vendors, setVendors] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Action modal
  const [actionInvoice, setActionInvoice] = useState(null)
  const [actionType, setActionType] = useState('')
  const [actionNotes, setActionNotes] = useState('')
  // Import
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
  const fileRef = useRef()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [invRes, vendRes, deptRes] = await Promise.all([
      supabase.from('invoices').select('*, vendors(name, category), departments(name)').order('created_at', { ascending: false }),
      supabase.from('vendors').select('*, departments(name)').eq('is_active', true).order('name'),
      supabase.from('departments').select('*').order('name'),
    ])
    setInvoices(invRes.data || [])
    setVendors(vendRes.data || [])
    setDepartments(deptRes.data || [])
    setLoading(false)
  }

  const filtered = invoices.filter(i => {
    const matchStatus = !filterStatus || i.status === filterStatus
    const matchDept = !filterDept || i.department_id === filterDept
    return matchStatus && matchDept
  })

  async function handleSave() {
    if (!form.vendor_id) return setError('Vendor is required')
    if (!form.amount) return setError('Amount is required')
    if (!form.department_id) return setError('Department is required')
    setSaving(true); setError('')
    const res = await supabase.from('invoices').insert({
      ...form, amount: Number(form.amount), source: 'manual',
    })
    if (res.error) setError(res.error.message)
    else { setShowModal(false); loadData() }
    setSaving(false)
  }

  async function handleAction() {
    if (!actionInvoice) return
    const newStatus = actionType === 'Approve' ? 'Approved' : 'Disputed'
    await supabase.from('invoices').update({ status: newStatus, approved_by: profile?.id, approved_at: new Date().toISOString(), notes: actionNotes }).eq('id', actionInvoice.id)
    await supabase.from('approvals').insert({ invoice_id: actionInvoice.id, user_id: profile?.id, action: actionType === 'Approve' ? 'Approved' : 'Disputed', notes: actionNotes })
    setActionInvoice(null); setActionNotes(''); loadData()
  }

  async function markPaid(invoice) {
    await supabase.from('invoices').update({ status: 'Paid' }).eq('id', invoice.id)
    loadData()
  }

  // Excel Import
  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)
      const mapped = rows.map((r, i) => {
        const vendorName = r['Vendor Name'] || r['vendor_name'] || r['Vendor'] || ''
        const vendor = vendors.find(v => v.name.toLowerCase() === vendorName.toLowerCase())
        const deptName = r['Department'] || r['department'] || ''
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        const err = !vendor ? `Vendor "${vendorName}" not found` : !dept ? `Department "${deptName}" not found` : null
        return {
          _row: i + 2,
          invoice_number: r['Invoice Number'] || r['invoice_number'] || r['Invoice #'] || '',
          vendor_id: vendor?.id || null,
          vendor_name: vendorName,
          amount: Number(r['Amount'] || r['amount'] || 0),
          received_date: excelDate(r['Received Date'] || r['received_date']),
          due_date: excelDate(r['Due Date'] || r['due_date']),
          department_id: dept?.id || null,
          department_name: deptName,
          notes: r['Notes'] || r['notes'] || '',
          status: 'Pending',
          source: 'excel_import',
          _error: err,
        }
      })
      setImportRows(mapped)
      setShowImport(true)
    }
    reader.readAsBinaryString(file)
    e.target.value = ''
  }

  function excelDate(val) {
    if (!val) return ''
    if (typeof val === 'number') {
      const d = new Date((val - 25569) * 86400 * 1000)
      return d.toISOString().split('T')[0]
    }
    return String(val).split('T')[0]
  }

  async function confirmImport() {
    const valid = importRows.filter(r => !r._error)
    if (!valid.length) return
    const payload = valid.map(({ _row, _error, vendor_name, department_name, ...rest }) => rest)
    const res = await supabase.from('invoices').insert(payload)
    if (res.error) alert('Import error: ' + res.error.message)
    else { alert(`Imported ${valid.length} invoices.`); setShowImport(false); loadData() }
  }

  const isAdmin = profile?.role === 'admin'
  const isDeptHead = profile?.role === 'department_head'
  const canEdit = isAdmin || isDeptHead

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoice Inbox</h1>
          <p className="text-sm text-gray-500 mt-0.5">{invoices.filter(i => i.status === 'Pending').length} pending approval</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input type="file" accept=".xlsx" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileRef.current.click()} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Excel
            </button>
            <button onClick={() => { setForm(emptyForm); setError(''); setShowModal(true) }}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Invoice
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {['', 'Pending', 'Approved', 'Disputed', 'Paid'].map(s => (
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice #</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vendor</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Received</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Due</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Department</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                {canEdit && <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 text-sm">No invoices found</td></tr>
              ) : filtered.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{inv.invoice_number || '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{inv.vendors?.name || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">${Number(inv.amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{inv.received_date || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{inv.due_date || '—'}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3"><DeptBadge name={inv.departments?.name} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{inv.notes || '—'}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {inv.status === 'Pending' && (
                          <>
                            <button onClick={() => { setActionInvoice(inv); setActionType('Approve'); setActionNotes('') }}
                              className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-md hover:bg-green-200 transition-colors">Approve</button>
                            <button onClick={() => { setActionInvoice(inv); setActionType('Dispute'); setActionNotes('') }}
                              className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors">Dispute</button>
                          </>
                        )}
                        {inv.status === 'Approved' && (
                          <button onClick={() => markPaid(inv)}
                            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors">Mark Paid</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Invoice Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Invoice">
        <div className="p-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number</label>
              <input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
              <select value={form.vendor_id} onChange={e => {
                const v = vendors.find(v => v.id === e.target.value)
                setForm(f => ({ ...f, vendor_id: e.target.value, department_id: v?.department_id || f.department_id }))
              }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                <option value="">Select vendor...</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department *</label>
              <select value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                <option value="">Select...</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Received Date</label>
              <input type="date" value={form.received_date} onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-orange-300">
              {saving ? 'Saving...' : 'Add Invoice'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Action Modal */}
      <Modal open={!!actionInvoice} onClose={() => setActionInvoice(null)} title={`${actionType} Invoice`} size="sm">
        <div className="p-5 space-y-4">
          {actionInvoice && (
            <p className="text-sm text-gray-600">
              {actionType === 'Approve' ? 'Approve' : 'Dispute'} invoice from <strong>{actionInvoice.vendors?.name}</strong> for <strong>${Number(actionInvoice.amount).toLocaleString()}</strong>?
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea value={actionNotes} onChange={e => setActionNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setActionInvoice(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleAction}
              className={`px-4 py-2 text-sm text-white rounded-lg transition-colors ${actionType === 'Approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}>
              {actionType === 'Approve' ? 'Approve' : 'Mark Disputed'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import Preview Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Invoices — Preview" size="xl">
        <div className="p-5">
          <div className="flex gap-4 mb-4 text-sm">
            <span className="font-semibold text-green-600">{importRows.filter(r=>!r._error).length} rows ready</span>
            {importRows.filter(r=>r._error).length > 0 && <span className="font-semibold text-red-600">{importRows.filter(r=>r._error).length} rows with errors (skipped)</span>}
          </div>
          <div className="overflow-x-auto max-h-96 border border-gray-200 rounded-lg overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['Row','Invoice #','Vendor','Amount','Received','Due','Dept','Status'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {importRows.map(r => (
                  <tr key={r._row} className={r._error ? 'bg-red-50' : ''}>
                    <td className="px-3 py-2 text-gray-400">{r._row}</td>
                    <td className="px-3 py-2">{r.invoice_number}</td>
                    <td className="px-3 py-2">{r.vendor_name}</td>
                    <td className="px-3 py-2">${r.amount}</td>
                    <td className="px-3 py-2">{r.received_date}</td>
                    <td className="px-3 py-2">{r.due_date}</td>
                    <td className="px-3 py-2">{r.department_name}</td>
                    <td className="px-3 py-2">{r._error ? <span className="text-red-600">{r._error}</span> : <span className="text-green-600">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={confirmImport} disabled={importRows.filter(r=>!r._error).length === 0}
              className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-orange-300">
              Import {importRows.filter(r=>!r._error).length} Invoices
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
