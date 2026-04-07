import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { S } from '../lib/styles'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'

const emptyForm = { invoice_number: '', vendor_id: '', amount: '', received_date: '', due_date: '', department_id: '', notes: '' }

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
  const [actionInvoice, setActionInvoice] = useState(null)
  const [actionType, setActionType] = useState('')
  const [actionNotes, setActionNotes] = useState('')
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

  const filtered = invoices.filter(i =>
    (!filterStatus || i.status === filterStatus) && (!filterDept || i.department_id === filterDept)
  )

  async function handleSave() {
    if (!form.vendor_id) return setError('Vendor is required')
    if (!form.amount) return setError('Amount is required')
    if (!form.department_id) return setError('Department is required')
    setSaving(true); setError('')
    const res = await supabase.from('invoices').insert({ ...form, amount: Number(form.amount), source: 'manual', status: 'Pending' })
    if (res.error) setError(res.error.message)
    else { setShowModal(false); loadData() }
    setSaving(false)
  }

  async function handleAction() {
    if (!actionInvoice) return
    const newStatus = actionType === 'Approve' ? 'Approved' : 'Disputed'
    await Promise.all([
      supabase.from('invoices').update({ status: newStatus, approved_by: profile?.id, approved_at: new Date().toISOString(), notes: actionNotes }).eq('id', actionInvoice.id),
      supabase.from('approvals').insert({ invoice_id: actionInvoice.id, user_id: profile?.id, action: newStatus, notes: actionNotes }),
    ])
    setActionInvoice(null); setActionNotes(''); loadData()
  }

  async function markPaid(inv) {
    await supabase.from('invoices').update({ status: 'Paid' }).eq('id', inv.id)
    loadData()
  }

  function excelDate(val) {
    if (!val) return ''
    if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0]
    return String(val).split('T')[0]
  }

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      setImportRows(rows.map((r, i) => {
        const vendorName = r['Vendor Name'] || r['Vendor'] || ''
        const vendor = vendors.find(v => v.name.toLowerCase() === vendorName.toLowerCase())
        const deptName = r['Department'] || r['department'] || ''
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        return {
          _row: i + 2,
          invoice_number: r['Invoice Number'] || r['Invoice #'] || '',
          vendor_id: vendor?.id || null, vendor_name: vendorName,
          amount: Number(r['Amount'] || 0),
          received_date: excelDate(r['Received Date']),
          due_date: excelDate(r['Due Date']),
          department_id: dept?.id || null, department_name: deptName,
          notes: r['Notes'] || '',
          status: 'Pending', source: 'excel_import',
          _error: !vendor ? `Vendor "${vendorName}" not found` : !dept ? `Dept "${deptName}" not found` : null,
        }
      }))
      setShowImport(true)
    }
    reader.readAsArrayBuffer(file); e.target.value = ''
  }

  async function confirmImport() {
    const valid = importRows.filter(r => !r._error)
    if (!valid.length) return
    const res = await supabase.from('invoices').insert(valid.map(({ _row, _error, vendor_name, department_name, ...rest }) => rest))
    if (res.error) alert('Import error: ' + res.error.message)
    else { alert(`Imported ${valid.length} invoices.`); setShowImport(false); loadData() }
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Invoice Inbox</h1>
          <p className="text-sm text-slate-500 mt-0.5">{invoices.filter(i=>i.status==='Pending').length} pending approval</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input type="file" accept=".xlsx" ref={fileRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileRef.current.click()} className={S.btnSecondary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Excel
            </button>
            <button onClick={() => { setForm(emptyForm); setError(''); setShowModal(true) }} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Invoice
            </button>
          </div>
        )}
      </div>

      {/* Status filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'Pending', 'Approved', 'Disputed', 'Paid'].map(s => (
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
                {['Invoice #','Vendor','Amount','Received','Due','Status','Department','Notes', canEdit && 'Actions'].filter(Boolean).map(h => (
                  <th key={h} className={`${S.th} ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-600 text-sm">No invoices found</td></tr>
              ) : filtered.map(inv => (
                <tr key={inv.id} className={S.tableRow}>
                  <td className={`${S.td} font-mono text-xs text-slate-400`}>{inv.invoice_number || '—'}</td>
                  <td className={`${S.td} font-medium text-slate-200`}>{inv.vendors?.name || '—'}</td>
                  <td className={`${S.td} text-right font-semibold text-slate-200`}>${Number(inv.amount).toLocaleString()}</td>
                  <td className={`${S.td} text-slate-400 text-xs`}>{inv.received_date || '—'}</td>
                  <td className={`${S.td} text-slate-400 text-xs`}>{inv.due_date || '—'}</td>
                  <td className={`${S.td} text-center`}><StatusBadge status={inv.status} /></td>
                  <td className={S.td}><DeptBadge name={inv.departments?.name} /></td>
                  <td className={`${S.td} text-slate-500 text-xs max-w-[140px] truncate`}>{inv.notes || '—'}</td>
                  {canEdit && (
                    <td className={S.td}>
                      <div className="flex items-center gap-1.5">
                        {inv.status === 'Pending' && <>
                          <button onClick={() => { setActionInvoice(inv); setActionType('Approve'); setActionNotes('') }} className={S.btnSuccess}>Approve</button>
                          <button onClick={() => { setActionInvoice(inv); setActionType('Dispute'); setActionNotes('') }} className={S.btnDanger}>Dispute</button>
                        </>}
                        {inv.status === 'Approved' && (
                          <button onClick={() => markPaid(inv)} className={S.btnBlue}>Mark Paid</button>
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
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={S.label}>Invoice Number</label>
              <input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} className={S.input} />
            </div>
            <div>
              <label className={S.label}>Vendor *</label>
              <select value={form.vendor_id} onChange={e => {
                const v = vendors.find(v => v.id === e.target.value)
                setForm(f => ({ ...f, vendor_id: e.target.value, department_id: v?.department_id || f.department_id }))
              }} className={`${S.select} w-full`}>
                <option value="">Select vendor…</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={S.label}>Amount *</label>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={S.input} />
            </div>
            <div>
              <label className={S.label}>Department *</label>
              <select value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))} className={`${S.select} w-full`}>
                <option value="">Select…</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={S.label}>Received Date</label>
              <input type="date" value={form.received_date} onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))} className={S.input} />
            </div>
            <div>
              <label className={S.label}>Due Date</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={S.input} />
            </div>
          </div>
          <div>
            <label className={S.label}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={S.textarea} />
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : 'Add Invoice'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Action Modal */}
      <Modal open={!!actionInvoice} onClose={() => setActionInvoice(null)} title={`${actionType} Invoice`} size="sm">
        <div className={S.modalBody}>
          {actionInvoice && (
            <p className="text-sm text-slate-400">
              {actionType === 'Approve' ? 'Approve' : 'Dispute'} invoice from{' '}
              <span className="text-slate-200 font-medium">{actionInvoice.vendors?.name}</span> for{' '}
              <span className="text-slate-200 font-medium">${Number(actionInvoice.amount).toLocaleString()}</span>?
            </p>
          )}
          <div>
            <label className={S.label}>Notes (optional)</label>
            <textarea value={actionNotes} onChange={e => setActionNotes(e.target.value)} rows={2} className={S.textarea} />
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setActionInvoice(null)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleAction}
              className={`px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all ${actionType === 'Approve' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-red-500 hover:bg-red-400'}`}>
              {actionType === 'Approve' ? 'Approve' : 'Mark Disputed'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import Preview */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Invoices — Preview" size="xl">
        <div className="p-5">
          <div className="flex gap-4 mb-4 text-sm">
            <span className="text-emerald-400 font-semibold">{importRows.filter(r=>!r._error).length} ready</span>
            {importRows.filter(r=>r._error).length > 0 && <span className="text-red-400 font-semibold">{importRows.filter(r=>r._error).length} errors (skipped)</span>}
          </div>
          <div className="overflow-x-auto max-h-96 border border-white/5 rounded-xl overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#09091a] sticky top-0">
                <tr>{['Row','Invoice #','Vendor','Amount','Received','Due','Dept','Status'].map(h=><th key={h} className="px-3 py-2 text-left text-slate-500">{h}</th>)}</tr>
              </thead>
              <tbody>
                {importRows.map(r => (
                  <tr key={r._row} className={`border-b border-white/[0.03] ${r._error ? 'bg-red-500/5' : ''}`}>
                    <td className="px-3 py-2 text-slate-600">{r._row}</td>
                    <td className="px-3 py-2 text-slate-400">{r.invoice_number}</td>
                    <td className="px-3 py-2 text-slate-200">{r.vendor_name}</td>
                    <td className="px-3 py-2 text-slate-300">${r.amount}</td>
                    <td className="px-3 py-2 text-slate-400">{r.received_date}</td>
                    <td className="px-3 py-2 text-slate-400">{r.due_date}</td>
                    <td className="px-3 py-2 text-slate-400">{r.department_name}</td>
                    <td className="px-3 py-2">{r._error ? <span className="text-red-400">{r._error}</span> : <span className="text-emerald-400">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${S.modalFooter} mt-4`}>
            <button onClick={() => setShowImport(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={confirmImport} disabled={!importRows.filter(r=>!r._error).length} className={S.btnSave}>
              Import {importRows.filter(r=>!r._error).length} Invoices
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
