import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'

const CATEGORIES = ['Fuel', 'Insurance', 'Equipment Rental', 'Tolls', 'Pre-Pass', 'Fuel Cards', 'Tires & Parts', 'Other']
const FREQUENCIES = ['Weekly', 'Monthly', 'One-Time']
const PAYMENT_METHODS = ['ACH', 'Credit Card', 'Check']

const emptyForm = { name: '', category: 'Fuel', frequency: 'Monthly', payment_method: 'ACH', department_id: '', expected_amount: '', is_active: true }

export default function VendorMaster() {
  const { profile } = useAuth()
  const [vendors, setVendors] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editVendor, setEditVendor] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Import state
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
  const [importErrors, setImportErrors] = useState([])
  const fileRef = useRef()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [vendRes, deptRes] = await Promise.all([
      supabase.from('vendors').select('*, departments(name)').order('name'),
      supabase.from('departments').select('*').order('name'),
    ])
    setVendors(vendRes.data || [])
    setDepartments(deptRes.data || [])
    setLoading(false)
  }

  const filtered = vendors.filter(v => {
    const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase()) || v.category.toLowerCase().includes(search.toLowerCase())
    const matchDept = !filterDept || v.department_id === filterDept
    return matchSearch && matchDept
  })

  function openAdd() {
    setEditVendor(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  function openEdit(v) {
    setEditVendor(v)
    setForm({ name: v.name, category: v.category, frequency: v.frequency, payment_method: v.payment_method, department_id: v.department_id, expected_amount: v.expected_amount, is_active: v.is_active })
    setError('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return setError('Vendor name is required')
    if (!form.department_id) return setError('Department is required')
    setSaving(true)
    setError('')
    const payload = { ...form, expected_amount: Number(form.expected_amount) || 0 }
    let res
    if (editVendor) {
      res = await supabase.from('vendors').update(payload).eq('id', editVendor.id)
    } else {
      res = await supabase.from('vendors').insert(payload)
    }
    if (res.error) setError(res.error.message)
    else { setShowModal(false); loadData() }
    setSaving(false)
  }

  async function toggleActive(v) {
    await supabase.from('vendors').update({ is_active: !v.is_active }).eq('id', v.id)
    loadData()
  }

  // Excel Import
  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)
      const mapped = rows.map((r, i) => {
        const deptName = r['Department'] || r['department'] || ''
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        return {
          _row: i + 2,
          name: r['Vendor Name'] || r['vendor_name'] || r['Name'] || '',
          category: r['Category'] || r['category'] || 'Other',
          frequency: r['Frequency'] || r['frequency'] || 'Monthly',
          payment_method: r['Payment Method'] || r['payment_method'] || 'ACH',
          department_id: dept?.id || null,
          department_name: deptName,
          expected_amount: Number(r['Expected Amount'] || r['expected_amount'] || 0),
          is_active: true,
          _error: !dept ? `Department "${deptName}" not found` : (!r['Vendor Name'] && !r['Name'] ? 'Missing vendor name' : null),
        }
      })
      setImportRows(mapped)
      setImportErrors(mapped.filter(r => r._error))
      setShowImport(true)
    }
    reader.readAsBinaryString(file)
    e.target.value = ''
  }

  async function confirmImport() {
    const valid = importRows.filter(r => !r._error)
    if (!valid.length) return
    const payload = valid.map(({ _row, _error, department_name, ...rest }) => rest)
    const res = await supabase.from('vendors').insert(payload)
    if (res.error) alert('Import error: ' + res.error.message)
    else {
      alert(`Successfully imported ${valid.length} vendors${importErrors.length ? `, ${importErrors.length} rows skipped.` : '.'}`)
      setShowImport(false)
      loadData()
    }
  }

  const isAdmin = profile?.role === 'admin'
  const isDeptHead = profile?.role === 'department_head'
  const canEdit = isAdmin || isDeptHead

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Master</h1>
          <p className="text-sm text-gray-500 mt-0.5">{vendors.filter(v=>v.is_active).length} active vendors</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input type="file" accept=".xlsx" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileRef.current.click()} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Excel
            </button>
            <button onClick={openAdd} className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Vendor
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          type="text" placeholder="Search by name or category..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 w-64"
        />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Frequency</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Payment</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Department</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Expected</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                {canEdit && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">No vendors found</td></tr>
              ) : filtered.map(v => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{v.name}</td>
                  <td className="px-4 py-3 text-gray-600">{v.category}</td>
                  <td className="px-4 py-3 text-gray-600">{v.frequency}</td>
                  <td className="px-4 py-3 text-gray-600">{v.payment_method}</td>
                  <td className="px-4 py-3"><DeptBadge name={v.departments?.name} /></td>
                  <td className="px-4 py-3 text-right text-gray-700">${Number(v.expected_amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={v.is_active ? 'Active' : 'Inactive'} /></td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(v)} className="text-gray-400 hover:text-blue-600 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => toggleActive(v)} className={`text-gray-400 hover:${v.is_active ? 'text-red-500' : 'text-green-500'} transition-colors text-xs font-medium`}>
                          {v.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editVendor ? 'Edit Vendor' : 'Add Vendor'}>
        <div className="p-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Frequency</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
              <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expected Amount ($)</label>
            <input type="number" value={form.expected_amount} onChange={e => setForm(f => ({ ...f, expected_amount: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:bg-orange-300 transition-colors">
              {saving ? 'Saving...' : (editVendor ? 'Update' : 'Add Vendor')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import Preview Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Vendors — Preview" size="xl">
        <div className="p-5">
          <div className="flex gap-4 mb-4">
            <div className="text-sm"><span className="font-semibold text-green-600">{importRows.filter(r=>!r._error).length}</span> rows ready</div>
            {importErrors.length > 0 && <div className="text-sm"><span className="font-semibold text-red-600">{importErrors.length}</span> rows with errors (will be skipped)</div>}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500">Row</th>
                  <th className="px-3 py-2 text-left text-gray-500">Name</th>
                  <th className="px-3 py-2 text-left text-gray-500">Category</th>
                  <th className="px-3 py-2 text-left text-gray-500">Frequency</th>
                  <th className="px-3 py-2 text-left text-gray-500">Payment</th>
                  <th className="px-3 py-2 text-left text-gray-500">Department</th>
                  <th className="px-3 py-2 text-right text-gray-500">Expected</th>
                  <th className="px-3 py-2 text-left text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {importRows.map(r => (
                  <tr key={r._row} className={r._error ? 'bg-red-50' : ''}>
                    <td className="px-3 py-2 text-gray-500">{r._row}</td>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">{r.category}</td>
                    <td className="px-3 py-2">{r.frequency}</td>
                    <td className="px-3 py-2">{r.payment_method}</td>
                    <td className="px-3 py-2">{r.department_name}</td>
                    <td className="px-3 py-2 text-right">${r.expected_amount}</td>
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
              Import {importRows.filter(r=>!r._error).length} Vendors
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
