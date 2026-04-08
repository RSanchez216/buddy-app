import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { S } from '../lib/styles'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import DeptBadge from '../components/DeptBadge'
import MultiSelect from '../components/MultiSelect'
import ComboBox from '../components/ComboBox'
import { buildDeptOptions } from '../lib/deptUtils'
import AttachmentsPopover from '../components/AttachmentsPopover'

const emptyForm = {
  invoice_number: '', vendor_id: '', amount: '',
  received_date: '', due_date: '',
  billing_period_start: '', billing_period_end: '',
  department_ids: [], notes: '',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isValidDate(val) {
  if (!val) return false
  return !isNaN(new Date(val).getTime())
}

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function excelDateToStr(val) {
  if (!val) return ''
  if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000).toISOString().split('T')[0]
  return String(val).split('T')[0]
}


// ── Component ──────────────────────────────────────────────────────────────

export default function InvoiceInbox() {
  const { profile } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [vendors, setVendors] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDepts, setFilterDepts] = useState([])

  // Add / Edit modal
  const [showModal, setShowModal] = useState(false)
  const [editInvoice, setEditInvoice] = useState(null)  // null = add, object = edit
  const [form, setForm] = useState(emptyForm)
  const [newFiles, setNewFiles] = useState([])           // files staged for upload
  const [existingAttachments, setExistingAttachments] = useState([]) // [{id,file_url,file_name}]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Deleted invoices view
  const [showDeleted, setShowDeleted] = useState(false)
  const [deletedInvoices, setDeletedInvoices] = useState([])
  const [restoring, setRestoring] = useState(null)

  // Delete confirmation
  const [deleteInvoice, setDeleteInvoice] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Per-dept action modal
  const [actionInvoice, setActionInvoice] = useState(null)
  const [actionDeptRecord, setActionDeptRecord] = useState(null) // specific dept row
  const [actionType, setActionType] = useState('')
  const [actionNotes, setActionNotes] = useState('')

  // Assign vendor (Parseur unmatched)
  const [assignInvoice, setAssignInvoice] = useState(null)
  const [assignVendorId, setAssignVendorId] = useState('')
  const [assigning, setAssigning] = useState(false)

  // Source filter
  const [filterSource, setFilterSource] = useState('')

  // Import
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])

  const importRef = useRef()
  const attachRef = useRef()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [invRes, vendRes, deptRes] = await Promise.all([
      supabase.from('invoices')
        .select('*, vendors(name, category), departments(name), invoice_departments(id, department_id, status, reviewed_at, departments(name)), invoice_attachments(id, file_url, file_name)')
        .is('deleted_at', null)   // exclude soft-deleted
        .order('created_at', { ascending: false }),
      supabase.from('vendors').select('id, name, category, department_id, department_ids').eq('is_active', true).order('name'),
      supabase.from('departments').select('*').eq('is_active', true).order('name'),
    ])
    setInvoices(invRes.data || [])
    setVendors(vendRes.data || [])
    setDepartments(deptRes.data || [])
    setLoading(false)
  }

  // ── Audit helper ──────────────────────────────────────────────────────────

  async function writeAudit(action, inv, extra = {}) {
    await supabase.from('audit_log').insert({
      table_name: 'invoices',
      record_id: inv.id,
      action,
      performed_by: profile?.id || null,
      performed_by_email: profile?.email || null,
      metadata: {
        invoice_number: inv.invoice_number,
        vendor: inv.vendors?.name || inv.vendor_name_raw,
        amount: inv.amount,
        status: inv.status,
        ...extra,
      },
    })
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const deptOptions = buildDeptOptions(departments)
  const vendorOptions = vendors.map(v => ({ id: v.id, name: v.name, subtitle: v.category || null }))

  function getInvoiceDeptIds(inv) {
    if (inv.invoice_departments?.length) return inv.invoice_departments.map(d => d.department_id)
    if (inv.department_id) return [inv.department_id]
    return []
  }

  const visibleInvoices = (profile?.role === 'department_head' && profile?.department_id)
    ? invoices.filter(inv => getInvoiceDeptIds(inv).includes(profile.department_id))
    : invoices

  const filtered = visibleInvoices.filter(inv => {
    const matchStatus = !filterStatus || inv.status === filterStatus
    const matchDept = filterDepts.length === 0 || getInvoiceDeptIds(inv).some(id => filterDepts.includes(id))
    const matchSource = !filterSource || inv.source === filterSource
    return matchStatus && matchDept && matchSource
  })

  const pendingCount = visibleInvoices.filter(i => i.status === 'Pending').length
  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

  // Which dept records can this user action?

  // ── Open add / edit modal ─────────────────────────────────────────────────

  function openAdd() {
    setEditInvoice(null)
    setForm(emptyForm)
    setNewFiles([])
    setExistingAttachments([])
    setError('')
    setShowModal(true)
  }

  function openEdit(inv) {
    setEditInvoice(inv)
    setForm({
      invoice_number: inv.invoice_number || '',
      vendor_id: inv.vendor_id || '',
      amount: inv.amount || '',
      received_date: inv.received_date || '',
      due_date: inv.due_date || '',
      billing_period_start: inv.billing_period_start || '',
      billing_period_end: inv.billing_period_end || '',
      department_ids: inv.invoice_departments?.map(d => d.department_id) || (inv.department_id ? [inv.department_id] : []),
      notes: inv.notes || '',
    })
    setNewFiles([])
    setExistingAttachments(inv.invoice_attachments || [])
    setError('')
    setShowModal(true)
  }

  // ── File staging ──────────────────────────────────────────────────────────

  function handleAttachChange(e) {
    const picked = Array.from(e.target.files || [])
    setNewFiles(prev => [...prev, ...picked])
    e.target.value = ''
  }

  function removeNewFile(idx) {
    setNewFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function removeExistingAttachment(att) {
    await supabase.from('invoice_attachments').delete().eq('id', att.id)
    setExistingAttachments(prev => prev.filter(a => a.id !== att.id))
    loadData()
  }

  // ── Upload helper ─────────────────────────────────────────────────────────

  async function uploadFiles(invoiceId, files) {
    const records = []
    for (const file of files) {
      const path = `${invoiceId}_${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('invoice-attachments').upload(path, file)
      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage.from('invoice-attachments').getPublicUrl(path)
        records.push({ invoice_id: invoiceId, file_url: publicUrl, file_name: file.name })
      }
    }
    if (records.length) await supabase.from('invoice_attachments').insert(records)
  }

  // ── Save (add or update) ──────────────────────────────────────────────────

  async function handleSave() {
    if (!form.vendor_id) return setError('Vendor is required')
    if (!form.amount || Number(form.amount) <= 0) return setError('Valid amount is required')
    if (!form.department_ids.length) return setError('At least one department is required')
    setSaving(true); setError('')

    const payload = {
      invoice_number: form.invoice_number || null,
      vendor_id: form.vendor_id,
      amount: Number(form.amount),
      received_date: form.received_date || null,
      due_date: form.due_date || null,
      billing_period_start: form.billing_period_start || null,
      billing_period_end: form.billing_period_end || null,
      department_id: form.department_ids[0],
      department_ids: form.department_ids,
      notes: form.notes || null,
    }

    if (editInvoice) {
      // ── UPDATE ──
      const { error: updErr } = await supabase.from('invoices').update(payload).eq('id', editInvoice.id)
      if (updErr) { setError(updErr.message); setSaving(false); return }

      // Sync invoice_departments: add new depts, keep existing ones intact
      const existingDeptIds = editInvoice.invoice_departments?.map(d => d.department_id) || []
      const toAdd = form.department_ids.filter(id => !existingDeptIds.includes(id))
      if (toAdd.length) {
        await supabase.from('invoice_departments').insert(
          toAdd.map(dept_id => ({ invoice_id: editInvoice.id, department_id: dept_id, status: 'Pending' }))
        )
      }

      // Upload new files
      if (newFiles.length) await uploadFiles(editInvoice.id, newFiles)

      await writeAudit('edit', { ...editInvoice, ...payload, id: editInvoice.id })

    } else {
      // ── INSERT ──
      const { data: inv, error: invErr } = await supabase.from('invoices').insert({
        ...payload, source: 'manual', status: 'Pending',
      }).select().single()
      if (invErr) { setError(invErr.message); setSaving(false); return }

      await supabase.from('invoice_departments').insert(
        form.department_ids.map(dept_id => ({ invoice_id: inv.id, department_id: dept_id, status: 'Pending' }))
      )
      if (newFiles.length) await uploadFiles(inv.id, newFiles)

      await writeAudit('create', inv)
    }

    setShowModal(false); setNewFiles([]); loadData(); setSaving(false)
  }

  // ── Per-dept action ───────────────────────────────────────────────────────

  function openDeptAction(inv, deptRecord, type) {
    setActionInvoice(inv)
    setActionDeptRecord(deptRecord)
    setActionType(type)
    setActionNotes('')
  }

  async function handleDeptAction() {
    if (!actionInvoice || !actionDeptRecord) return
    const newStatus = actionType === 'Approve' ? 'Approved' : 'Disputed'

    await supabase.from('invoice_departments').update({
      status: newStatus,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      notes: actionNotes || null,
    }).eq('id', actionDeptRecord.id)

    // Recalculate overall invoice status
    const { data: allDepts } = await supabase
      .from('invoice_departments').select('status').eq('invoice_id', actionInvoice.id)

    let invoiceStatus = 'Pending'
    if (allDepts?.every(d => d.status === 'Approved')) invoiceStatus = 'Approved'
    else if (allDepts?.some(d => d.status === 'Disputed')) invoiceStatus = 'Disputed'

    await Promise.all([
      supabase.from('invoices').update({
        status: invoiceStatus,
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
      }).eq('id', actionInvoice.id),
      supabase.from('approvals').insert({
        invoice_id: actionInvoice.id, user_id: profile.id,
        action: newStatus, notes: actionNotes || null,
      }),
    ])

    await writeAudit(newStatus === 'Approved' ? 'approve' : 'dispute', actionInvoice, {
      dept_id: actionDeptRecord.department_id,
      dept_name: actionDeptRecord.departments?.name,
      notes: actionNotes || null,
    })

    setActionInvoice(null); setActionDeptRecord(null); setActionNotes(''); loadData()
  }

  async function resetDeptRecord(inv, deptRecord) {
    await supabase.from('invoice_departments').update({
      status: 'Pending', reviewed_by: null, reviewed_at: null, notes: null,
    }).eq('id', deptRecord.id)

    // Recalculate overall invoice status — if any dept goes back to Pending, invoice goes back to Pending
    const { data: allDepts } = await supabase
      .from('invoice_departments').select('status').eq('invoice_id', inv.id)

    let invoiceStatus = 'Pending'
    if (allDepts?.every(d => d.status === 'Approved')) invoiceStatus = 'Approved'
    else if (allDepts?.some(d => d.status === 'Disputed')) invoiceStatus = 'Disputed'

    await supabase.from('invoices').update({ status: invoiceStatus }).eq('id', inv.id)
    loadData()
  }

  async function handleDelete() {
    if (!deleteInvoice) return
    setDeleting(true)
    await supabase.from('invoices').update({
      deleted_at: new Date().toISOString(),
      deleted_by: profile?.id || null,
    }).eq('id', deleteInvoice.id)
    await writeAudit('delete', deleteInvoice)
    setDeleteInvoice(null)
    setDeleting(false)
    loadData()
  }

  async function handleAssignVendor() {
    if (!assignInvoice || !assignVendorId) return
    setAssigning(true)
    const vendor = vendors.find(v => v.id === assignVendorId)
    const deptIds = vendor?.department_ids?.length
      ? vendor.department_ids
      : vendor?.department_id ? [vendor.department_id] : []

    await supabase.from('invoices').update({
      vendor_id: assignVendorId,
      needs_vendor_match: false,
      department_id: deptIds[0] || null,
      department_ids: deptIds,
    }).eq('id', assignInvoice.id)

    // Add dept records if not already present
    if (deptIds.length) {
      const existing = assignInvoice.invoice_departments?.map(d => d.department_id) || []
      const toAdd = deptIds.filter(id => !existing.includes(id))
      if (toAdd.length) {
        await supabase.from('invoice_departments').insert(
          toAdd.map(dept_id => ({ invoice_id: assignInvoice.id, department_id: dept_id, status: 'Pending' }))
        )
      }
    }

    await writeAudit('assign_vendor', assignInvoice, {
      vendor_id: assignVendorId,
      vendor_name: vendor?.name,
    })
    setAssignInvoice(null); setAssignVendorId(''); setAssigning(false); loadData()
  }

  async function loadDeletedInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*, vendors(name), departments(name), invoice_attachments(id, file_url, file_name)')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    setDeletedInvoices(data || [])
  }

  async function handleRestore(inv) {
    setRestoring(inv.id)
    await supabase.from('invoices').update({ deleted_at: null, deleted_by: null }).eq('id', inv.id)
    await writeAudit('restore', inv)
    await loadDeletedInvoices()
    setRestoring(null)
  }

  async function markPaid(inv) {
    await supabase.from('invoices').update({ status: 'Paid' }).eq('id', inv.id)
    await writeAudit('mark_paid', inv)
    loadData()
  }

  // ── Excel template ────────────────────────────────────────────────────────

  function downloadTemplate() {
    const wb = XLSX.utils.book_new()
    const headers = ['Invoice Number', 'Vendor Name', 'Amount', 'Received Date', 'Due Date', 'Billing Period Start', 'Billing Period End', 'Department(s)', 'Notes', 'Status']
    const example = ['INV-001', vendors[0]?.name || 'Penske', '9800', '2026-04-01', '2026-04-10', '2026-03-30', '2026-04-05', departments[0]?.name || 'Fleet', 'Contract rental fee', 'Pending']
    const ws = XLSX.utils.aoa_to_sheet([headers, example])
    ws['!cols'] = [15, 22, 10, 14, 14, 18, 16, 22, 30, 10].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices')
    const ref = [
      ['VALID VENDOR NAMES (must match exactly)'], ...vendors.map(v => [v.name]),
      [''], ['VALID DEPARTMENT NAMES'], ...departments.map(d => [d.name]),
      [''], ['VALID STATUS VALUES'], ['Pending'], ['Approved'], ['Disputed'],
    ]
    const wsRef = XLSX.utils.aoa_to_sheet(ref)
    wsRef['!cols'] = [{ wch: 40 }]
    XLSX.utils.book_append_sheet(wb, wsRef, 'Reference')
    XLSX.writeFile(wb, 'buddy_invoice_import_template.xlsx')
  }

  // ── Excel import ──────────────────────────────────────────────────────────

  const REQUIRED_COLS = ['Invoice Number', 'Vendor Name', 'Amount', 'Received Date', 'Due Date']

  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      if (!rows.length) { alert('The file appears to be empty.'); return }
      const firstRow = Object.keys(rows[0])
      const missing = REQUIRED_COLS.filter(c => !firstRow.includes(c))
      if (missing.length) { alert(`Missing required columns: ${missing.join(', ')}\n\nDownload the template first.`); return }
      setImportRows(rows.map((r, i) => {
        const vendorName = r['Vendor Name'] || ''
        const deptName = r['Department(s)'] || r['Department'] || ''
        const amtRaw = r['Amount']
        const amount = parseFloat(String(amtRaw || '').replace(/[$,]/g, ''))
        const receivedRaw = r['Received Date']
        const dueRaw = r['Due Date']
        const vendor = vendors.find(v => v.name.toLowerCase() === vendorName.toLowerCase())
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())
        const errors = [], warnings = []
        if (!r['Invoice Number']) errors.push('Missing Invoice Number')
        if (!vendorName || !vendor) errors.push(vendorName ? `Vendor "${vendorName}" not found` : 'Missing Vendor Name')
        if (!amtRaw || isNaN(amount) || amount <= 0) errors.push('Amount must be positive')
        if (!receivedRaw || !isValidDate(excelDateToStr(receivedRaw))) errors.push('Invalid Received Date')
        if (!dueRaw || !isValidDate(excelDateToStr(dueRaw))) errors.push('Invalid Due Date')
        if (deptName && !dept) warnings.push(`Dept "${deptName}" not found — will import without`)
        return {
          _row: i + 2, _status: errors.length ? 'error' : warnings.length ? 'warning' : 'ready',
          _issues: [...errors, ...warnings],
          invoice_number: String(r['Invoice Number'] || ''),
          vendor_id: vendor?.id || null, vendor_name: vendorName,
          amount: isNaN(amount) ? 0 : amount,
          received_date: excelDateToStr(receivedRaw), due_date: excelDateToStr(dueRaw),
          billing_period_start: excelDateToStr(r['Billing Period Start']) || null,
          billing_period_end: excelDateToStr(r['Billing Period End']) || null,
          department_ids: dept ? [dept.id] : [], department_id: dept?.id || null, department_name: deptName,
          notes: r['Notes'] || '', status: 'Pending', source: 'excel_import',
        }
      }))
      setShowImport(true)
    }
    reader.readAsArrayBuffer(file); e.target.value = ''
  }

  async function confirmImport() {
    const importable = importRows.filter(r => r._status !== 'error')
    if (!importable.length) return
    const payload = importable.map(({ _row, _status, _issues, vendor_name, department_name, department_ids, ...rest }) => rest)
    const { data: inserted, error: impErr } = await supabase.from('invoices').insert(payload).select()
    if (impErr) { alert('Import error: ' + impErr.message); return }
    const deptRecords = []
    inserted.forEach((inv, idx) => {
      const row = importable[idx]
      if (row.department_ids?.length) row.department_ids.forEach(dept_id => deptRecords.push({ invoice_id: inv.id, department_id: dept_id, status: 'Pending' }))
    })
    if (deptRecords.length) await supabase.from('invoice_departments').insert(deptRecords)
    const skipped = importRows.filter(r => r._status === 'error').length
    alert(`Imported ${inserted.length} invoice${inserted.length !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped.` : '.'}`)
    setShowImport(false); loadData()
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" /></div>

  // ── JSX ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Invoice Inbox</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">{pendingCount} pending approval</p>
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={downloadTemplate} className={S.btnSecondary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Template
            </button>
            <input type="file" accept=".xlsx" ref={importRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => importRef.current.click()} className={S.btnSecondary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Excel
            </button>
            <button onClick={openAdd} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Invoice
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        {['', 'Pending', 'Approved', 'Disputed', 'Paid'].map(s => (
          <button key={s} onClick={() => { setFilterStatus(s); setShowDeleted(false) }} className={S.filterBtn(!showDeleted && filterStatus === s)}>{s || 'All'}</button>
        ))}
        <div className="w-px h-4 bg-gray-200 dark:bg-slate-700 mx-1" />
        {[['', 'All Sources'], ['manual', 'Manual'], ['parseur', 'Parseur'], ['excel_import', 'Excel Import']].map(([val, label]) => (
          <button key={val} onClick={() => { setFilterSource(val); setShowDeleted(false) }} className={S.filterBtn(!showDeleted && filterSource === val)}>{label}</button>
        ))}
        {profile?.role === 'admin' && (
          <>
            <div className="w-px h-4 bg-gray-200 dark:bg-slate-700 mx-1" />
            <button
              onClick={() => { setShowDeleted(v => { const next = !v; if (next) loadDeletedInvoices(); return next }) }}
              className={S.filterBtn(showDeleted)}
            >
              Deleted
            </button>
          </>
        )}
        <div className="ml-auto w-56">
          <MultiSelect options={deptOptions} value={filterDepts} onChange={setFilterDepts} placeholder="All Departments" />
        </div>
      </div>

      {/* Deleted Invoices Table */}
      {showDeleted && (
        <div className={`${S.card} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-gray-100 dark:border-white/5 flex items-center gap-2">
            <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Deleted Invoices</span>
            <span className="ml-1 text-xs text-gray-400 dark:text-slate-500">({deletedInvoices.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  {['Invoice #', 'Vendor', 'Amount', 'Deleted At', 'Notes', 'Restore'].map(h => (
                    <th key={h} className={`${S.th} ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deletedInvoices.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No deleted invoices</td></tr>
                ) : deletedInvoices.map(inv => (
                  <tr key={inv.id} className={S.tableRow}>
                    <td className={`${S.td} font-mono text-xs text-gray-400 dark:text-slate-400`}>{inv.invoice_number || '—'}</td>
                    <td className={S.td}>{inv.vendors?.name || inv.vendor_name_raw || '—'}</td>
                    <td className={`${S.td} text-right font-semibold`}>${Number(inv.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td className={`${S.td} text-xs text-gray-400 dark:text-slate-500`}>{inv.deleted_at ? new Date(inv.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className={`${S.td} text-xs text-gray-400 dark:text-slate-500 max-w-[180px] truncate`}>{inv.notes || '—'}</td>
                    <td className={S.td}>
                      <button
                        onClick={() => handleRestore(inv)}
                        disabled={restoring === inv.id}
                        className="text-xs font-semibold text-cyan-600 dark:text-cyan-400 hover:underline disabled:opacity-50"
                      >
                        {restoring === inv.id ? 'Restoring…' : 'Restore'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Main Table */}
      {!showDeleted && <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Invoice #', 'Vendor', 'Amount', 'Billing Period', 'Received', 'Due', 'Status', 'Department(s)', 'Files', 'Notes', canEdit && 'Actions'].filter(Boolean).map(h => (
                  <th key={h} className={`${S.th} ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No invoices found</td></tr>
              ) : filtered.map(inv => {
                const attachments = inv.invoice_attachments || []
                return (
                  <tr key={inv.id} className={S.tableRow}>
                    <td className={`${S.td} font-mono text-xs text-gray-400 dark:text-slate-400`}>
                      <div className="flex items-center gap-1.5">
                        {inv.invoice_number || '—'}
                        {inv.source === 'parseur' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400">PARSEUR</span>
                        )}
                        {inv.source === 'excel_import' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400">XLS</span>
                        )}
                      </div>
                    </td>
                    <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>
                      {inv.needs_vendor_match ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-amber-500 text-xs font-medium">{inv.vendor_name_raw || 'Unknown vendor'}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400">UNMATCHED</span>
                          </div>
                          {canEdit && (
                            <button
                              onClick={() => { setAssignInvoice(inv); setAssignVendorId('') }}
                              className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                            >
                              Assign vendor →
                            </button>
                          )}
                        </div>
                      ) : (
                        inv.vendors?.name || '—'
                      )}
                    </td>
                    <td className={`${S.td} text-right font-semibold text-gray-900 dark:text-slate-200`}>${Number(inv.amount).toLocaleString()}</td>
                    <td className={`${S.td} text-gray-400 dark:text-slate-400 text-xs whitespace-nowrap`}>
                      {inv.billing_period_start && inv.billing_period_end
                        ? `${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}`
                        : inv.billing_period_start ? fmtDate(inv.billing_period_start) : '—'}
                    </td>
                    <td className={`${S.td} text-gray-400 dark:text-slate-400 text-xs`}>{inv.received_date || '—'}</td>
                    <td className={`${S.td} text-gray-400 dark:text-slate-400 text-xs`}>{inv.due_date || '—'}</td>
                    <td className={`${S.td} text-center`}><StatusBadge status={inv.status} /></td>

                    {/* Per-dept status + independent action buttons */}
                    <td className={S.td}>
                      {inv.invoice_departments?.length ? (
                        <div className="space-y-1.5">
                          {inv.invoice_departments.map(d => {
                            const isPending = d.status === 'Pending'
                            const canAct = canEdit && (
                              profile?.role === 'admin' ||
                              (profile?.role === 'department_head' && d.department_id === profile?.department_id)
                            )
                            return (
                              <div key={d.id} className="flex items-center gap-1.5 flex-wrap">
                                <DeptBadge name={d.departments?.name} />
                                <StatusBadge status={d.status} />
                                {canAct && isPending && (
                                  <>
                                    <button onClick={() => openDeptAction(inv, d, 'Approve')} className={S.btnSuccess}>✓</button>
                                    <button onClick={() => openDeptAction(inv, d, 'Dispute')} className={S.btnDanger}>✗</button>
                                  </>
                                )}
                                {canAct && !isPending && inv.status !== 'Paid' && (
                                  <button
                                    onClick={() => resetDeptRecord(inv, d)}
                                    title="Reset to Pending"
                                    className="px-2 py-1 text-xs font-medium text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-slate-700 rounded-lg hover:border-amber-400 hover:text-amber-500 dark:hover:text-amber-400 transition-colors"
                                  >↺</button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <DeptBadge name={inv.departments?.name} />
                      )}
                    </td>

                    {/* Attachments — popover */}
                    <td className={S.td}>
                      <AttachmentsPopover attachments={attachments} />
                    </td>

                    <td className={`${S.td} text-gray-400 dark:text-slate-500 text-xs max-w-[120px] truncate`}>{inv.notes || '—'}</td>

                    {canEdit && (
                      <td className={S.td}>
                        <div className="flex items-center gap-1.5">
                          {/* Edit */}
                          <button onClick={() => openEdit(inv)} title="Edit invoice"
                            className="text-gray-400 dark:text-slate-600 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Delete (admin only) */}
                          {profile?.role === 'admin' && (
                            <button onClick={() => setDeleteInvoice(inv)} title="Delete invoice"
                              className="text-gray-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                          {/* Mark Paid (admin only, fully approved) */}
                          {inv.status === 'Approved' && profile?.role === 'admin' && (
                            <button onClick={() => markPaid(inv)} className={S.btnBlue}>Mark Paid</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>}

      {/* ── Add / Edit Invoice Modal ──────────────────────────────────────── */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editInvoice ? 'Edit Invoice' : 'Add Invoice'}>
        <div className={S.modalBody}>
          {error && <div className={S.errorBox}>{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={S.label}>Invoice Number</label>
              <input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} className={S.input} placeholder="INV-001" />
            </div>
            <div>
              <label className={S.label}>Amount *</label>
              <input type="number" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={S.input} placeholder="0.00" />
            </div>
          </div>

          <div>
            <label className={S.label}>Vendor *</label>
            <ComboBox options={vendorOptions} value={form.vendor_id}
              onChange={id => setForm(f => ({ ...f, vendor_id: id }))}
              placeholder="Search and select vendor…"
              onAddNew={() => window.open('/vendors', '_blank')} />
          </div>

          <div>
            <label className={S.label}>Department(s) *</label>
            <MultiSelect options={deptOptions} value={form.department_ids}
              onChange={ids => setForm(f => ({ ...f, department_ids: ids }))}
              placeholder="Select department(s)…" />
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
            <label className={S.label}>Billing Period</label>
            <div className="flex items-center gap-2">
              <input type="date" value={form.billing_period_start} onChange={e => setForm(f => ({ ...f, billing_period_start: e.target.value }))} className={S.input} />
              <span className="text-gray-400 dark:text-slate-500 text-sm shrink-0">to</span>
              <input type="date" value={form.billing_period_end} onChange={e => setForm(f => ({ ...f, billing_period_end: e.target.value }))} className={S.input} />
            </div>
          </div>

          <div>
            <label className={S.label}>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={S.textarea} />
          </div>

          {/* File attachments */}
          <div>
            <label className={S.label}>Attachments</label>

            {/* Existing files (edit mode) */}
            {existingAttachments.length > 0 && (
              <div className="mb-2 space-y-1">
                {existingAttachments.map(att => (
                  <div key={att.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-white/5 rounded-xl">
                    <a href={att.file_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-cyan-600 dark:text-cyan-400 hover:underline min-w-0">
                      <svg className="w-4 h-4 shrink-0 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                      <span className="truncate">{att.file_name}</span>
                    </a>
                    <button type="button" onClick={() => removeExistingAttachment(att)}
                      className="ml-3 shrink-0 text-gray-400 hover:text-red-500 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* New files staged */}
            {newFiles.length > 0 && (
              <div className="mb-2 space-y-1">
                {newFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-cyan-50 dark:bg-cyan-500/10 rounded-xl">
                    <span className="text-sm text-cyan-700 dark:text-cyan-400 truncate">{f.name}</span>
                    <button type="button" onClick={() => removeNewFile(i)}
                      className="ml-3 shrink-0 text-gray-400 hover:text-red-500 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload trigger */}
            <input type="file" ref={attachRef} accept=".pdf,.jpg,.jpeg,.png,.xlsx" multiple
              onChange={handleAttachChange} className="hidden" />
            <button type="button" onClick={() => attachRef.current.click()}
              className="w-full flex items-center gap-3 px-3 py-3 border border-dashed border-gray-300 dark:border-slate-700/60 rounded-xl hover:border-cyan-500/50 hover:bg-cyan-50/30 dark:hover:bg-cyan-500/5 transition-all">
              <svg className="w-5 h-5 text-gray-400 dark:text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              <span className="text-sm text-gray-400 dark:text-slate-500">
                {newFiles.length || existingAttachments.length ? 'Add more files…' : 'Click to attach PDF, JPG, PNG or XLSX — max 10 MB each'}
              </span>
            </button>
          </div>

          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : editInvoice ? 'Update Invoice' : 'Add Invoice'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Per-Dept Action Modal ─────────────────────────────────────────── */}
      <Modal open={!!actionInvoice} onClose={() => { setActionInvoice(null); setActionDeptRecord(null) }}
        title={`${actionType} — ${actionDeptRecord?.departments?.name || ''}`} size="sm">
        <div className={S.modalBody}>
          {actionInvoice && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {actionType === 'Approve' ? 'Approve' : 'Dispute'} this invoice on behalf of{' '}
              <span className="font-medium text-gray-900 dark:text-slate-200">{actionDeptRecord?.departments?.name}</span>
              {' '}— from{' '}
              <span className="font-medium text-gray-900 dark:text-slate-200">{actionInvoice.vendors?.name}</span>
              {' '}for{' '}
              <span className="font-medium text-gray-900 dark:text-slate-200">${Number(actionInvoice.amount).toLocaleString()}</span>
            </p>
          )}

          {/* All dept statuses for context */}
          {actionInvoice?.invoice_departments?.length > 1 && (
            <div className="rounded-xl border border-gray-100 dark:border-white/5 overflow-hidden">
              {actionInvoice.invoice_departments.map(d => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-50 dark:border-white/[0.03] last:border-0">
                  <span className={`text-sm ${d.id === actionDeptRecord?.id ? 'font-semibold text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}>
                    {d.departments?.name} {d.id === actionDeptRecord?.id && '← you'}
                  </span>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
          )}

          <div>
            <label className={S.label}>Notes (optional)</label>
            <textarea value={actionNotes} onChange={e => setActionNotes(e.target.value)} rows={2} className={S.textarea} />
          </div>

          <div className={S.modalFooter}>
            <button onClick={() => { setActionInvoice(null); setActionDeptRecord(null) }} className={S.btnCancel}>Cancel</button>
            <button onClick={handleDeptAction}
              className={`px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all ${actionType === 'Approve' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-red-500 hover:bg-red-400'}`}>
              {actionType === 'Approve' ? 'Approve for this Dept' : 'Mark Disputed'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Import Preview Modal ──────────────────────────────────────────── */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import Invoices — Preview" size="xl">
        <div className="p-5">
          <div className="flex gap-4 mb-4 text-sm flex-wrap">
            {['ready', 'warning', 'error'].map(s => {
              const count = importRows.filter(r => r._status === s).length
              if (!count) return null
              const colors = { ready: 'text-emerald-600 dark:text-emerald-400', warning: 'text-amber-500', error: 'text-red-600 dark:text-red-400' }
              const labels = { ready: 'ready', warning: 'warnings (will import)', error: 'errors (will skip)' }
              return <span key={s} className={`font-semibold ${colors[s]}`}>{count} {labels[s]}</span>
            })}
          </div>
          <div className="overflow-x-auto max-h-96 border border-gray-200 dark:border-white/5 rounded-xl overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-[#09091a] sticky top-0">
                <tr>{['Row', 'Invoice #', 'Vendor', 'Amount', 'Received', 'Due', 'Dept', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-gray-500 dark:text-slate-500 font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {importRows.map(r => (
                  <tr key={r._row} className={`border-b border-gray-50 dark:border-white/[0.03] ${r._status === 'error' ? 'bg-red-50 dark:bg-red-500/5' : r._status === 'warning' ? 'bg-amber-50 dark:bg-amber-500/5' : ''}`}>
                    <td className="px-3 py-2 text-gray-400 dark:text-slate-600">{r._row}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{r.invoice_number}</td>
                    <td className={`px-3 py-2 font-medium ${r._issues.some(i => i.includes('Vendor')) ? 'text-red-500' : 'text-gray-900 dark:text-slate-200'}`}>{r.vendor_name}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">${r.amount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.received_date}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.due_date}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{r.department_name || '—'}</td>
                    <td className="px-3 py-2">
                      {r._status === 'ready' && <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Ready</span>}
                      {r._status === 'warning' && <span className="text-amber-500" title={r._issues.join(' | ')}>⚠ {r._issues[0]}</span>}
                      {r._status === 'error' && <span className="text-red-500" title={r._issues.join(' | ')}>✗ {r._issues[0]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${S.modalFooter} mt-4`}>
            <button onClick={() => setShowImport(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={confirmImport} disabled={!importRows.filter(r => r._status !== 'error').length} className={S.btnSave}>
              Import {importRows.filter(r => r._status !== 'error').length} Invoices
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
      <Modal open={!!deleteInvoice} onClose={() => setDeleteInvoice(null)} title="Delete Invoice" size="sm">
        <div className={S.modalBody}>
          {deleteInvoice && (
            <>
              <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl">
                <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">This invoice will be moved to Deleted</p>
                  <p className="text-sm text-red-600 dark:text-red-400/80 mt-0.5">
                    Admins can restore it at any time from the Deleted tab.
                  </p>
                </div>
              </div>
              <div className="px-3 py-3 bg-gray-50 dark:bg-white/5 rounded-xl space-y-1">
                <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide font-medium">Invoice to delete</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{deleteInvoice.vendors?.name || '—'}</p>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
                  <span>#{deleteInvoice.invoice_number || 'No number'}</span>
                  <span>·</span>
                  <span>${Number(deleteInvoice.amount).toLocaleString()}</span>
                  <span>·</span>
                  <span>{deleteInvoice.status}</span>
                </div>
              </div>
            </>
          )}
          <div className={S.modalFooter}>
            <button onClick={() => setDeleteInvoice(null)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleDelete} disabled={deleting}
              className="px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-xl transition-all">
              {deleting ? 'Deleting…' : 'Delete Invoice'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Assign Vendor Modal (Parseur unmatched) ───────────────────────── */}
      <Modal open={!!assignInvoice} onClose={() => setAssignInvoice(null)} title="Assign Vendor" size="sm">
        <div className={S.modalBody}>
          {assignInvoice && (
            <div className="px-3 py-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl text-sm">
              <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold uppercase tracking-wide mb-0.5">Parsed vendor name</p>
              <p className="text-gray-900 dark:text-slate-100 font-medium">{assignInvoice.vendor_name_raw || 'Unknown'}</p>
            </div>
          )}
          <div>
            <label className={S.label}>Match to Vendor *</label>
            <ComboBox
              options={vendorOptions}
              value={assignVendorId}
              onChange={setAssignVendorId}
              placeholder="Search vendors…"
            />
          </div>
          <div className={S.modalFooter}>
            <button onClick={() => setAssignInvoice(null)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleAssignVendor} disabled={assigning || !assignVendorId} className={S.btnSave}>
              {assigning ? 'Saving…' : 'Assign Vendor'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
