import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { S } from '../lib/styles'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'
import { buildDeptOptions, pmLabel } from '../lib/deptUtils'
import Select from '../components/Select'

const FREQUENCIES = ['Weekly', 'Bi-Weekly', 'Monthly', 'Yearly', 'One-Time']

const emptyForm = {
  name: '', category_id: '', frequency: 'Monthly',
  payment_method_id: '', department_id: '', expected_amount: '', is_active: true,
}

export default function VendorMaster() {
  const { profile } = useAuth()
  const [vendors, setVendors] = useState([])
  const [departments, setDepartments] = useState([])
  const [categories, setCategories] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editVendor, setEditVendor] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
  const fileRef = useRef()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [vendRes, deptRes, catRes, pmRes] = await Promise.all([
      supabase.from('vendors').select('*, departments(name), vendor_categories(name), payment_methods(name, account_reference)').order('name'),
      supabase.from('departments').select('*').eq('is_active', true).order('name'),
      supabase.from('vendor_categories').select('*').order('name'),
      supabase.from('payment_methods').select('*').order('name'),
    ])
    setVendors(vendRes.data || [])
    setDepartments(deptRes.data || [])
    setCategories(catRes.data || [])
    setPaymentMethods(pmRes.data || [])
    setLoading(false)
  }

  const deptOptions = buildDeptOptions(departments)

  const filtered = vendors.filter(v => {
    const catName = v.vendor_categories?.name || ''
    const matchSearch = !search || v.name.toLowerCase().includes(search.toLowerCase()) || catName.toLowerCase().includes(search.toLowerCase())
    const matchDept = !filterDept || v.department_id === filterDept
    const matchCat = !filterCat || v.category_id === filterCat
    return matchSearch && matchDept && matchCat
  })

  function openAdd() { setEditVendor(null); setForm(emptyForm); setError(''); setShowModal(true) }
  function openEdit(v) {
    setEditVendor(v)
    setForm({ name: v.name, category_id: v.category_id || '', frequency: v.frequency, payment_method_id: v.payment_method_id || '', department_id: v.department_id || '', expected_amount: v.expected_amount, is_active: v.is_active })
    setError(''); setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return setError('Vendor name is required')
    if (!form.department_id) return setError('Department is required')
    setSaving(true); setError('')
    const payload = {
      name: form.name.trim(),
      category_id: form.category_id || null,
      // store legacy text fields too for compatibility
      category: categories.find(c => c.id === form.category_id)?.name || null,
      frequency: form.frequency,
      payment_method_id: form.payment_method_id || null,
      payment_method: paymentMethods.find(p => p.id === form.payment_method_id)?.name || null,
      department_id: form.department_id,
      expected_amount: Number(form.expected_amount) || 0,
      is_active: form.is_active,
    }
    const res = editVendor
      ? await supabase.from('vendors').update(payload).eq('id', editVendor.id)
      : await supabase.from('vendors').insert(payload)
    if (res.error) setError(res.error.message)
    else { setShowModal(false); loadData() }
    setSaving(false)
  }

  async function toggleActive(v) {
    await supabase.from('vendors').update({ is_active: !v.is_active }).eq('id', v.id)
    loadData()
  }

  // ── Excel template download ─────────────────────────────────────────────
  function downloadTemplate() {
    const headers = ['Vendor Name', 'Category', 'Frequency', 'Payment Method', 'Department', 'Expected Amount', 'Active (Yes/No)']
    const example = [
      'Pilot Flying J',
      categories[0]?.name || 'Fuel',
      'Monthly',
      paymentMethods[0]?.name || 'ACH',
      departments[0]?.name || 'Fleet',
      '5000',
      'Yes',
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, example])
    // column widths
    ws['!cols'] = headers.map((_, i) => ({ wch: [20, 20, 12, 18, 15, 16, 14][i] }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Vendors')
    XLSX.writeFile(wb, 'buddy_vendor_import_template.xlsx')
  }

  // ── Excel import ────────────────────────────────────────────────────────
  const REQUIRED_COLS = ['Vendor Name', 'Department']

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)

      if (!rows.length) { alert('The file appears to be empty.'); return }

      // Validate required columns
      const firstRow = Object.keys(rows[0])
      const missing = REQUIRED_COLS.filter(c => !firstRow.includes(c))
      if (missing.length) { alert(`Missing required columns: ${missing.join(', ')}\n\nDownload the template to see the expected format.`); return }

      setImportRows(rows.map((r, i) => {
        const deptName = r['Department'] || ''
        const catName = r['Category'] || ''
        const pmName = r['Payment Method'] || ''
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        const cat = categories.find(c => c.name.toLowerCase() === catName.toLowerCase())
        const pm = paymentMethods.find(p => p.name.toLowerCase() === pmName.toLowerCase())
        const errs = []
        if (!r['Vendor Name']) errs.push('Missing vendor name')
        if (!dept) errs.push(`Dept "${deptName}" not found`)
        return {
          _row: i + 2,
          name: r['Vendor Name'] || '',
          category_id: cat?.id || null,
          category: catName,
          category_name: cat?.name || catName,
          frequency: r['Frequency'] || 'Monthly',
          payment_method_id: pm?.id || null,
          payment_method: pmName,
          department_id: dept?.id || null,
          department_name: deptName,
          expected_amount: Number(String(r['Expected Amount'] || '0').replace(/[$,]/g, '')) || 0,
          is_active: String(r['Active (Yes/No)'] || 'Yes').toLowerCase() !== 'no',
          _error: errs.length ? errs.join('; ') : null,
        }
      }))
      setShowImport(true)
    }
    reader.readAsArrayBuffer(file); e.target.value = ''
  }

  async function confirmImport() {
    const valid = importRows.filter(r => !r._error)
    if (!valid.length) return
    const payload = valid.map(({ _row, _error, category, payment_method, department_name, category_name, ...rest }) => ({
      ...rest,
      category: category_name,
      payment_method,
    }))
    const res = await supabase.from('vendors').insert(payload)
    if (res.error) alert('Import error: ' + res.error.message)
    else {
      alert(`Successfully imported ${valid.length} vendor${valid.length > 1 ? 's' : ''}${importRows.filter(r => r._error).length ? `, ${importRows.filter(r => r._error).length} skipped.` : '.'}`)
      setShowImport(false); loadData()
    }
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Vendor Master</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">{vendors.filter(v => v.is_active).length} active vendors</p>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={downloadTemplate} className={S.btnSecondary} title="Download blank .xlsx template">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Template
            </button>
            <input type="file" accept=".xlsx" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileRef.current.click()} className={S.btnSecondary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Excel
            </button>
            <button onClick={openAdd} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Vendor
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input type="text" placeholder="Search by name or category…" value={search} onChange={e => setSearch(e.target.value)}
          className={`${S.input} w-56`} />
        <Select value={filterDept} onChange={e => setFilterDept(e.target.value)}>
          <option value="">All Departments</option>
          {deptOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
        <Select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Name', 'Category', 'Frequency', 'Payment Method', 'Department', 'Expected', 'Status', canEdit && ''].filter(Boolean).map(h => (
                  <th key={h} className={`${S.th} ${h === 'Expected' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No vendors found</td></tr>
              ) : filtered.map(v => (
                <tr key={v.id} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{v.name}</td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{v.vendor_categories?.name || v.category || '—'}</td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400`}>{v.frequency}</td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400`}>
                    {v.payment_methods ? pmLabel(v.payment_methods) : (v.payment_method || '—')}
                  </td>
                  <td className={S.td}><DeptBadge name={v.departments?.name} /></td>
                  <td className={`${S.td} text-right text-gray-700 dark:text-slate-300`}>${Number(v.expected_amount).toLocaleString()}</td>
                  <td className={`${S.td} text-center`}><StatusBadge status={v.is_active ? 'Active' : 'Inactive'} /></td>
                  {canEdit && (
                    <td className={`${S.td} text-right`}>
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openEdit(v)} className="text-gray-400 dark:text-slate-600 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => toggleActive(v)} className={`text-xs font-medium transition-colors ${v.is_active ? 'text-gray-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400' : 'text-gray-400 dark:text-slate-600 hover:text-emerald-600 dark:hover:text-emerald-400'}`}>
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
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div>
            <label className={S.label}>Vendor Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={S.input} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={S.label}>Category</label>
              <Select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                <option value="">Select…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <label className={S.label}>Frequency</label>
              <Select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={S.label}>Payment Method</label>
              <Select value={form.payment_method_id} onChange={e => setForm(f => ({ ...f, payment_method_id: e.target.value }))}>
                <option value="">Select…</option>
                {paymentMethods.map(p => <option key={p.id} value={p.id}>{pmLabel(p)}</option>)}
              </Select>
            </div>
            <div>
              <label className={S.label}>Department *</label>
              <Select value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                <option value="">Select…</option>
                {deptOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label className={S.label}>Expected Amount ($)</label>
            <input type="number" value={form.expected_amount} onChange={e => setForm(f => ({ ...f, expected_amount: e.target.value }))} className={S.input} />
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editVendor ? 'Update Vendor' : 'Add Vendor'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import Preview Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Vendors — Preview" size="xl">
        <div className="p-5">
          <div className="flex gap-4 mb-4 text-sm flex-wrap">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{importRows.filter(r => !r._error).length} rows ready</span>
            {importRows.filter(r => r._error).length > 0 && (
              <span className="text-red-600 dark:text-red-400 font-semibold">{importRows.filter(r => r._error).length} rows with errors (will be skipped)</span>
            )}
          </div>
          <div className="overflow-x-auto max-h-96 border border-gray-200 dark:border-white/5 rounded-xl overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-[#09091a] sticky top-0">
                <tr>{['Row', 'Name', 'Category', 'Frequency', 'Payment', 'Department', 'Expected', 'Active', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-gray-500 dark:text-slate-500 font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {importRows.map(r => (
                  <tr key={r._row} className={`border-b border-gray-50 dark:border-white/[0.03] ${r._error ? 'bg-red-50 dark:bg-red-500/5' : ''}`}>
                    <td className="px-3 py-2 text-gray-400 dark:text-slate-600">{r._row}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-slate-200 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.category_name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.frequency}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.payment_method}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.department_name}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">${r.expected_amount}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.is_active ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2">
                      {r._error ? <span className="text-red-600 dark:text-red-400">{r._error}</span> : <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${S.modalFooter} mt-4`}>
            <button onClick={() => setShowImport(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={confirmImport} disabled={!importRows.filter(r => !r._error).length} className={S.btnSave}>
              Import {importRows.filter(r => !r._error).length} Vendors
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
