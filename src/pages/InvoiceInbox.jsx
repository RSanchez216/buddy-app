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

const emptyForm = {
  invoice_number: '', vendor_id: '', amount: '',
  received_date: '', due_date: '',
  billing_period_start: '', billing_period_end: '',
  department_ids: [], notes: '',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isValidDate(val) {
  if (!val) return false
  const d = new Date(val)
  return !isNaN(d.getTime())
}

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [attachmentFile, setAttachmentFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [actionInvoice, setActionInvoice] = useState(null)
  const [actionType, setActionType] = useState('')
  const [actionNotes, setActionNotes] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState([])
  const importRef = useRef()
  const attachRef = useRef()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [invRes, vendRes, deptRes] = await Promise.all([
      supabase.from('invoices')
        .select('*, vendors(name, category), departments(name), invoice_departments(id, department_id, status, reviewed_at, departments(name))')
        .order('created_at', { ascending: false }),
      supabase.from('vendors').select('id, name, category, department_id').eq('is_active', true).order('name'),
      supabase.from('departments').select('*').eq('is_active', true).order('name'),
    ])
    setInvoices(invRes.data || [])
    setVendors(vendRes.data || [])
    setDepartments(deptRes.data || [])
    setLoading(false)
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const deptOptions = buildDeptOptions(departments)

  const vendorOptions = vendors.map(v => ({
    id: v.id,
    name: v.name,
    subtitle: v.category || null,
  }))

  function getInvoiceDeptIds(inv) {
    if (inv.invoice_departments?.length) return inv.invoice_departments.map(d => d.department_id)
    if (inv.department_id) return [inv.department_id]
    return []
  }

  // Dept heads only see invoices assigned to their dept
  const visibleInvoices = (profile?.role === 'department_head' && profile?.department_id)
    ? invoices.filter(inv => getInvoiceDeptIds(inv).includes(profile.department_id))
    : invoices

  const filtered = visibleInvoices.filter(inv => {
    const matchStatus = !filterStatus || inv.status === filterStatus
    const matchDept = filterDepts.length === 0 || getInvoiceDeptIds(inv).some(id => filterDepts.includes(id))
    return matchStatus && matchDept
  })

  const pendingCount = visibleInvoices.filter(i => i.status === 'Pending').length

  // Can this user take action on this invoice?
  function canActionInvoice(inv) {
    if (!canEdit || inv.status === 'Paid') return false
    const depts = inv.invoice_departments || []
    if (!depts.length) return inv.status === 'Pending'
    if (profile?.role === 'admin') return depts.some(d => d.status === 'Pending')
    if (profile?.role === 'department_head') {
      return depts.some(d => d.department_id === profile.department_id && d.status === 'Pending')
    }
    return false
  }

  // ── Save new invoice ──────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.vendor_id) return setError('Vendor is required')
    if (!form.amount || Number(form.amount) <= 0) return setError('Valid amount is required')
    if (!form.department_ids.length) return setError('At least one department is required')
    setSaving(true); setError('')

    // 1. Insert invoice
    const { data: inv, error: invErr } = await supabase.from('invoices').insert({
      invoice_number: form.invoice_number || null,
      vendor_id: form.vendor_id,
      amount: Number(form.amount),
      received_date: form.received_date || null,
      due_date: form.due_date || null,
      billing_period_start: form.billing_period_start || null,
      billing_period_end: form.billing_period_end || null,
      department_id: form.department_ids[0],        // backward compat
      department_ids: form.department_ids,
      notes: form.notes || null,
      source: 'manual',
      status: 'Pending',
    }).select().single()

    if (invErr) { setError(invErr.message); setSaving(false); return }

    // 2. Upload attachment if provided
    if (attachmentFile) {
      const path = `${inv.id}_${attachmentFile.name}`
      const { error: upErr } = await supabase.storage.from('invoice-attachments').upload(path, attachmentFile)
      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage.from('invoice-attachments').getPublicUrl(path)
        await supabase.from('invoices').update({ attachment_url: publicUrl }).eq('id', inv.id)
      }
    }

    // 3. Create per-department records
    await supabase.from('invoice_departments').insert(
      form.department_ids.map(dept_id => ({ invoice_id: inv.id, department_id: dept_id, status: 'Pending' }))
    )

    setShowModal(false)
    setAttachmentFile(null)
    loadData()
    setSaving(false)
  }

  // ── Approve / Dispute ────────────────────────────────────────────────────

  async function handleAction() {
    if (!actionInvoice) return
    const newStatus = actionType === 'Approve' ? 'Approved' : 'Disputed'
    const deptRecords = actionInvoice.invoice_departments || []

    if (deptRecords.length) {
      // Determine which dept records to update
      let toUpdate = []
      if (profile?.role === 'admin') {
        toUpdate = deptRecords.filter(d => d.status === 'Pending')
      } else if (profile?.role === 'department_head' && profile.department_id) {
        toUpdate = deptRecords.filter(d => d.department_id === profile.department_id && d.status === 'Pending')
      }

      await Promise.all(toUpdate.map(d =>
        supabase.from('invoice_departments').update({
          status: newStatus,
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
          notes: actionNotes || null,
        }).eq('id', d.id)
      ))

      // Re-fetch dept records to determine overall invoice status
      const { data: updatedDepts } = await supabase
        .from('invoice_departments').select('status').eq('invoice_id', actionInvoice.id)

      let invoiceStatus = 'Pending'
      if (updatedDepts?.every(d => d.status === 'Approved')) invoiceStatus = 'Approved'
      else if (updatedDepts?.some(d => d.status === 'Disputed')) invoiceStatus = 'Disputed'

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
    } else {
      // Legacy invoice — no dept records, direct update
      await Promise.all([
        supabase.from('invoices').update({
          status: newStatus,
          approved_by: profile.id,
          approved_at: new Date().toISOString(),
          notes: actionNotes || null,
        }).eq('id', actionInvoice.id),
        supabase.from('approvals').insert({
          invoice_id: actionInvoice.id, user_id: profile.id,
          action: newStatus, notes: actionNotes || null,
        }),
      ])
    }

    setActionInvoice(null); setActionNotes(''); loadData()
  }

  async function markPaid(inv) {
    await supabase.from('invoices').update({ status: 'Paid' }).eq('id', inv.id)
    loadData()
  }

  async function removeAttachment(inv) {
    await supabase.from('invoices').update({ attachment_url: null }).eq('id', inv.id)
    loadData()
  }

  // ── Excel template download ───────────────────────────────────────────────

  function downloadTemplate() {
    const wb = XLSX.utils.book_new()

    // Sheet 1: Invoices template
    const headers = ['Invoice Number', 'Vendor Name', 'Amount', 'Received Date', 'Due Date', 'Billing Period Start', 'Billing Period End', 'Department(s)', 'Notes', 'Status']
    const example = ['INV-001', vendors[0]?.name || 'Penske', '9800', '2026-04-01', '2026-04-10', '2026-03-30', '2026-04-05', departments[0]?.name || 'Fleet', 'Contract rental fee', 'Pending']
    const ws = XLSX.utils.aoa_to_sheet([headers, example])
    ws['!cols'] = [15, 22, 10, 14, 14, 18, 16, 22, 30, 10].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, 'Invoices')

    // Sheet 2: Reference data
    const ref = [
      ['VALID VENDOR NAMES (must match exactly)'],
      ...vendors.map(v => [v.name]),
      [''],
      ['VALID DEPARTMENT NAMES'],
      ...departments.map(d => [d.name]),
      [''],
      ['VALID STATUS VALUES'],
      ['Pending'], ['Approved'], ['Disputed'],
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
      if (missing.length) {
        alert(`Missing required columns: ${missing.join(', ')}\n\nDownload the template to see the expected format.`)
        return
      }

      setImportRows(rows.map((r, i) => {
        const vendorName = r['Vendor Name'] || ''
        const deptName = r['Department(s)'] || r['Department'] || ''
        const amtRaw = r['Amount']
        const amount = parseFloat(String(amtRaw || '').replace(/[$,]/g, ''))
        const receivedRaw = r['Received Date']
        const dueRaw = r['Due Date']

        const vendor = vendors.find(v => v.name.toLowerCase() === vendorName.toLowerCase())
        const dept = departments.find(d => d.name.toLowerCase() === deptName.toLowerCase())

        const errors = []
        const warnings = []

        if (!r['Invoice Number']) errors.push('Missing Invoice Number')
        if (!vendorName || !vendor) errors.push(vendorName ? `Vendor "${vendorName}" not found` : 'Missing Vendor Name')
        if (!amtRaw || isNaN(amount) || amount <= 0) errors.push('Amount must be a positive number')
        if (!receivedRaw || !isValidDate(excelDateToStr(receivedRaw))) errors.push('Invalid Received Date')
        if (!dueRaw || !isValidDate(excelDateToStr(dueRaw))) errors.push('Invalid Due Date')
        if (deptName && !dept) warnings.push(`Department "${deptName}" not found — will import without dept`)

        const _status = errors.length ? 'error' : warnings.length ? 'warning' : 'ready'

        return {
          _row: i + 2,
          _status,
          _issues: [...errors, ...warnings],
          invoice_number: String(r['Invoice Number'] || ''),
          vendor_id: vendor?.id || null,
          vendor_name: vendorName,
          amount: isNaN(amount) ? 0 : amount,
          received_date: excelDateToStr(receivedRaw),
          due_date: excelDateToStr(dueRaw),
          department_ids: dept ? [dept.id] : [],
          department_id: dept?.id || null,
          department_name: deptName,
          billing_period_start: excelDateToStr(r['Billing Period Start']) || null,
          billing_period_end: excelDateToStr(r['Billing Period End']) || null,
          notes: r['Notes'] || '',
          status: 'Pending',
          source: 'excel_import',
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

    // Create invoice_departments for rows with depts
    const deptRecords = []
    inserted.forEach((inv, idx) => {
      const row = importable[idx]
      if (row.department_ids?.length) {
        row.department_ids.forEach(dept_id => {
          deptRecords.push({ invoice_id: inv.id, department_id: dept_id, status: 'Pending' })
        })
      }
    })
    if (deptRecords.length) await supabase.from('invoice_departments').insert(deptRecords)

    const skipped = importRows.filter(r => r._status === 'error').length
    alert(`Imported ${inserted.length} invoice${inserted.length !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped due to errors.` : '.'}`)
    setShowImport(false); loadData()
  }

  const canEdit = profile?.role === 'admin' || profile?.role === 'department_head'

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
            <button onClick={downloadTemplate} className={S.btnSecondary} title="Download .xlsx template">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Template
            </button>
            <input type="file" accept=".xlsx" ref={importRef} onChange={handleFileChange} className="hidden" />
            <button onClick={() => importRef.current.click()} className={S.btnSecondary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              Import Excel
            </button>
            <button onClick={() => { setForm(emptyForm); setAttachmentFile(null); setError(''); setShowModal(true) }} className={S.btnPrimary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Add Invoice
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        {['', 'Pending', 'Approved', 'Disputed', 'Paid'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} className={S.filterBtn(filterStatus === s)}>
            {s || 'All'}
          </button>
        ))}
        <div className="ml-auto w-56">
          <MultiSelect
            options={deptOptions}
            value={filterDepts}
            onChange={setFilterDepts}
            placeholder="All Departments"
          />
        </div>
      </div>

      {/* Table */}
      <div className={`${S.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['Invoice #', 'Vendor', 'Amount', 'Billing Period', 'Received', 'Due', 'Status', 'Department(s)', 'Attach', 'Notes', canEdit && 'Actions'].filter(Boolean).map(h => (
                  <th key={h} className={`${S.th} ${h === 'Amount' ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No invoices found</td></tr>
              ) : filtered.map(inv => (
                <tr key={inv.id} className={S.tableRow}>
                  <td className={`${S.td} font-mono text-xs text-gray-400 dark:text-slate-400`}>{inv.invoice_number || '—'}</td>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{inv.vendors?.name || '—'}</td>
                  <td className={`${S.td} text-right font-semibold text-gray-900 dark:text-slate-200`}>${Number(inv.amount).toLocaleString()}</td>
                  <td className={`${S.td} text-gray-400 dark:text-slate-400 text-xs whitespace-nowrap`}>
                    {inv.billing_period_start && inv.billing_period_end
                      ? `${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}`
                      : inv.billing_period_start ? fmtDate(inv.billing_period_start)
                      : '—'}
                  </td>
                  <td className={`${S.td} text-gray-400 dark:text-slate-400 text-xs`}>{inv.received_date || '—'}</td>
                  <td className={`${S.td} text-gray-400 dark:text-slate-400 text-xs`}>{inv.due_date || '—'}</td>
                  <td className={`${S.td} text-center`}><StatusBadge status={inv.status} /></td>

                  {/* Per-department status column */}
                  <td className={S.td}>
                    {inv.invoice_departments?.length ? (
                      <div className="space-y-1">
                        {inv.invoice_departments.map(d => (
                          <div key={d.id} className="flex items-center gap-1.5 flex-wrap">
                            <DeptBadge name={d.departments?.name} />
                            <StatusBadge status={d.status} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <DeptBadge name={inv.departments?.name} />
                    )}
                  </td>

                  {/* Attachment */}
                  <td className={`${S.td} text-center`}>
                    {inv.attachment_url ? (
                      <a href={inv.attachment_url} target="_blank" rel="noopener noreferrer"
                        className="text-cyan-500 hover:text-cyan-400 transition-colors inline-flex justify-center" title="View attachment">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </a>
                    ) : <span className="text-gray-200 dark:text-slate-700">—</span>}
                  </td>

                  <td className={`${S.td} text-gray-400 dark:text-slate-500 text-xs max-w-[120px] truncate`}>{inv.notes || '—'}</td>

                  {canEdit && (
                    <td className={S.td}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {canActionInvoice(inv) && (
                          <>
                            <button onClick={() => { setActionInvoice(inv); setActionType('Approve'); setActionNotes('') }} className={S.btnSuccess}>Approve</button>
                            <button onClick={() => { setActionInvoice(inv); setActionType('Dispute'); setActionNotes('') }} className={S.btnDanger}>Dispute</button>
                          </>
                        )}
                        {inv.status === 'Approved' && profile?.role === 'admin' && (
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

      {/* ── Add Invoice Modal ─────────────────────────────────────────────── */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Invoice">
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
            <ComboBox
              options={vendorOptions}
              value={form.vendor_id}
              onChange={id => setForm(f => ({ ...f, vendor_id: id }))}
              placeholder="Search and select vendor…"
              onAddNew={() => window.open('/vendors', '_blank')}
            />
          </div>

          <div>
            <label className={S.label}>Department(s) *</label>
            <MultiSelect
              options={deptOptions}
              value={form.department_ids}
              onChange={ids => setForm(f => ({ ...f, department_ids: ids }))}
              placeholder="Select department(s)…"
            />
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

          {/* File attachment */}
          <div>
            <label className={S.label}>Attach Invoice Document (optional)</label>
            <input type="file" ref={attachRef} accept=".pdf,.jpg,.jpeg,.png,.xlsx"
              onChange={e => setAttachmentFile(e.target.files[0] || null)} className="hidden" />
            <div
              onClick={() => attachRef.current.click()}
              className="flex items-center gap-3 px-3 py-3 border border-dashed border-gray-300 dark:border-slate-700/60 rounded-xl cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-50/30 dark:hover:bg-cyan-500/5 transition-all"
            >
              <svg className="w-5 h-5 text-gray-400 dark:text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              {attachmentFile ? (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="text-sm text-cyan-600 dark:text-cyan-400 truncate">{attachmentFile.name}</span>
                  <button type="button" onClick={e => { e.stopPropagation(); setAttachmentFile(null) }}
                    className="ml-2 text-gray-400 hover:text-red-500 shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-400 dark:text-slate-500">Click to attach PDF, JPG, PNG or XLSX — max 10 MB</span>
              )}
            </div>
          </div>

          <div className={S.modalFooter}>
            <button onClick={() => setShowModal(false)} className={S.btnCancel}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className={S.btnSave}>
              {saving ? 'Saving…' : 'Add Invoice'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Approve / Dispute Modal ───────────────────────────────────────── */}
      <Modal open={!!actionInvoice} onClose={() => setActionInvoice(null)} title={`${actionType} Invoice`} size="sm">
        <div className={S.modalBody}>
          {actionInvoice && (
            <>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {actionType === 'Approve' ? 'Approve' : 'Dispute'} invoice from{' '}
                <span className="text-gray-900 dark:text-slate-200 font-medium">{actionInvoice.vendors?.name}</span> for{' '}
                <span className="text-gray-900 dark:text-slate-200 font-medium">${Number(actionInvoice.amount).toLocaleString()}</span>
              </p>

              {/* Per-department breakdown */}
              {actionInvoice.invoice_departments?.length > 0 && (
                <div className="rounded-xl border border-gray-100 dark:border-white/5 overflow-hidden">
                  {actionInvoice.invoice_departments.map(d => (
                    <div key={d.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-50 dark:border-white/[0.03] last:border-0">
                      <span className="text-sm text-gray-700 dark:text-slate-300">{d.departments?.name}</span>
                      <StatusBadge status={d.status} />
                    </div>
                  ))}
                </div>
              )}

              {/* Attachment preview in action modal */}
              {actionInvoice.attachment_url && (
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-white/5 rounded-xl">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400">
                    <svg className="w-4 h-4 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    Invoice document attached
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={actionInvoice.attachment_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-cyan-500 hover:text-cyan-400">View</a>
                    {profile?.role === 'admin' && (
                      <button onClick={() => removeAttachment(actionInvoice)} className="text-xs text-red-400 hover:text-red-500">Remove</button>
                    )}
                  </div>
                </div>
              )}
            </>
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
            <button
              onClick={confirmImport}
              disabled={!importRows.filter(r => r._status !== 'error').length}
              className={S.btnSave}
            >
              Import {importRows.filter(r => r._status !== 'error').length} Invoices
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
