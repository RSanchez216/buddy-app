import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { S } from '../lib/styles'
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
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
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
    return matchSearch && (!filterDept || v.department_id === filterDept)
  })

  function openAdd() { setEditVendor(null); setForm(emptyForm); setError(''); setShowModal(true) }
  function openEdit(v) {
    setEditVendor(v)
    setForm({ name: v.name, category: v.category, frequency: v.frequency, payment_method: v.payment_method, department_id: v.department_id, expected_amount: v.expected_amount, is_active: v.is_active })
    setError(''); setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return setError('Vendor name is required')
    if (!form.department_id) return setError('Department is required')
    setSaving(true); setError('')
    const payload = { ...form, expected_amount: Number(form.expected_amount) || 0 }
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

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      setImportRows(rows.map((r, i) => {
        const deptName = r['Department'] || r['department'] || ''
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        return {
          _row: i + 2,
          name: r['Vendor Name'] || r['Name'] || '',
          category: r['Category'] || 'Other',
          frequency: r['Frequency'] || 'Monthly',
          payment_method: r['Payment Method'] || 'ACH',
          department_id: dept?.id || null,
          department_name: deptName,
          expected_amount: Number(r['Expected Amount'] || 0),
          is_active: true,
          _error: !dept ? `Dept "${deptName}" not found` : null,
        }
      }))
      setShowImport(true)
    }
    reader.readAsArrayBuffer(file); e.target.value = ''
  }

  async function confirmImport() {
    const valid = importRows.filter(r => !r._error)
    if (!valid.length) return
    const res = await supabase.from('vendors').insert(valid.map(({ _row, _error, department_name, ...rest }) => rest))
    if (res.error) alert('Import error: ' + res.error.message)
    else { alert(`Imported ${valid.length} vendors.`); setShowImport(false); loadData() }
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vendor Master</h1>
          <p className="text-sm text-slate-500 mt-0.5">{vendors.filter(v=>v.is_active).length} active vendors</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
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

      <div className="flex gap-3 flex-wrap">
        <input type="text" placeholder="Search by name or category…" value={search} onChange={e => setSearch(e.target.value)}
          className={`${S.input} w-64`} />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className={S.select}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Name','Category','Frequency','Payment','Department','Expected','Status', canEdit && ''].filter(Boolean).map(h => (
                  <th key={h} className={`${S.th} ${h === 'Expected' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-600 text-sm">No vendors found</td></tr>
              ) : filtered.map(v => (
                <tr key={v.id} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-slate-200`}>{v.name}</td>
                  <td className={`${S.td} text-slate-400`}>{v.category}</td>
                  <td className={`${S.td} text-slate-400`}>{v.frequency}</td>
                  <td className={`${S.td} text-slate-400`}>{v.payment_method}</td>
                  <td className={S.td}><DeptBadge name={v.departments?.name} /></td>
                  <td className={`${S.td} text-right text-slate-300`}>${Number(v.expected_amount).toLocaleString()}</td>
                  <td className={`${S.td} text-center`}><StatusBadge status={v.is_active ? 'Active' : 'Inactive'} /></td>
                  {canEdit && (
                    <td className={`${S.td} text-right`}>
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openEdit(v)} className="text-slate-600 hover:text-cyan-400 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={() => toggleActive(v)} className={`text-xs font-medium transition-colors ${v.is_active ? 'text-slate-600 hover:text-red-400' : 'text-slate-600 hover:text-emerald-400'}`}>
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
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={`${S.select} w-full`}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Frequency</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))} className={`${S.select} w-full`}>
                {FREQUENCIES.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={S.label}>Payment Method</label>
              <select value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))} className={`${S.select} w-full`}>
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Department *</label>
              <select value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))} className={`${S.select} w-full`}>
                <option value="">Select…</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
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

      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Vendors — Preview" size="xl">
        <div className="p-5">
          <div className="flex gap-4 mb-4 text-sm">
            <span className="text-emerald-400 font-semibold">{importRows.filter(r=>!r._error).length} ready</span>
            {importRows.filter(r=>r._error).length > 0 && <span className="text-red-400 font-semibold">{importRows.filter(r=>r._error).length} errors (skipped)</span>}
          </div>
          <div className="overflow-x-auto max-h-96 border border-white/5 rounded-xl overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#09091a] sticky top-0">
                <tr>{['Row','Name','Category','Frequency','Payment','Department','Expected','Status'].map(h=><th key={h} className="px-3 py-2 text-left text-slate-500">{h}</th>)}</tr>
              </thead>
              <tbody>
                {importRows.map(r => (
                  <tr key={r._row} className={`border-b border-white/[0.03] ${r._error ? 'bg-red-500/5' : ''}`}>
                    <td className="px-3 py-2 text-slate-600">{r._row}</td>
                    <td className="px-3 py-2 text-slate-200">{r.name}</td>
                    <td className="px-3 py-2 text-slate-400">{r.category}</td>
                    <td className="px-3 py-2 text-slate-400">{r.frequency}</td>
                    <td className="px-3 py-2 text-slate-400">{r.payment_method}</td>
                    <td className="px-3 py-2 text-slate-400">{r.department_name}</td>
                    <td className="px-3 py-2 text-slate-400">${r.expected_amount}</td>
                    <td className="px-3 py-2">{r._error ? <span className="text-red-400">{r._error}</span> : <span className="text-emerald-400">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${S.modalFooter} mt-4`}>
            <button onClick={() => setShowImport(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={confirmImport} disabled={!importRows.filter(r=>!r._error).length} className={S.btnSave}>
              Import {importRows.filter(r=>!r._error).length} Vendors
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
