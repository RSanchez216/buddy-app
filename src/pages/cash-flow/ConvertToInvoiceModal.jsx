import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { CF, fmtMoney, toISO } from './calendarUtils'

export default function ConvertToInvoiceModal({ open, planned, onClose, onConverted }) {
  // `planned` is the custom_outflows row (from ChipDetailPanel's loaded row)
  const [vendors, setVendors] = useState([])
  const [vendorId, setVendorId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef()

  useEffect(() => {
    if (!open || !planned) return
    setError(''); setVendorId(''); setInvoiceNumber(''); setFiles([])
    setAmount(planned.amount ?? '')
    setDueDate(planned.planned_pay_date || planned.due_date || toISO(new Date()))
    setNotes(planned.description ? `${planned.description}${planned.notes ? `\n\n${planned.notes}` : ''}` : (planned.notes || ''))
    supabase.from('vendors').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setVendors(data || []))
  }, [open, planned])

  function handleFileChange(e) {
    setFiles(Array.from(e.target.files || []))
  }

  // Match the invoice-attachments storage pattern used by InvoiceInbox
  async function uploadFiles(invoiceId, fileList) {
    if (!fileList?.length) return
    const records = []
    for (const file of fileList) {
      const path = `${invoiceId}_${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('invoice-attachments').upload(path, file)
      if (upErr) continue
      const { data: { publicUrl } } = supabase.storage.from('invoice-attachments').getPublicUrl(path)
      records.push({ invoice_id: invoiceId, file_url: publicUrl, file_name: file.name })
    }
    if (records.length) await supabase.from('invoice_attachments').insert(records)
  }

  async function convert() {
    if (!planned) return
    if (!vendorId) return setError('Vendor is required')
    if (!Number(amount) || Number(amount) <= 0) return setError('Amount is required')
    if (!dueDate) return setError('Due date is required')

    setSaving(true); setError('')

    // 1. Insert invoice
    const { data: inv, error: invErr } = await supabase.from('invoices').insert({
      vendor_id: vendorId,
      invoice_number: invoiceNumber.trim() || null,
      amount: Number(amount),
      due_date: dueDate,
      status: 'Pending',
      source: 'converted_from_planned',
      notes: notes.trim() || null,
    }).select('id').single()
    if (invErr) { setError(invErr.message); setSaving(false); return }

    // 2. Upload attachment(s) if any
    if (files.length) {
      try { await uploadFiles(inv.id, files) }
      catch (e) { /* non-fatal — invoice created */ }
    }

    // 3. Mark the planned outflow as converted
    const { error: updErr } = await supabase.from('custom_outflows').update({
      status: 'converted',
      converted_to_invoice_id: inv.id,
      converted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', planned.id)

    setSaving(false)
    if (updErr) {
      setError('Invoice created, but failed to mark planned expense as converted: ' + updErr.message)
      return
    }
    onConverted?.(inv.id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Convert planned expense to invoice" size="lg">
      <div className={S.modalBody}>
        {error && <div className={S.errorBox}>{error}</div>}

        <div className="rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 p-3 text-xs text-orange-700 dark:text-orange-400">
          A new invoice will be created in AP Control. The planned expense will be marked as <span className="font-semibold">converted</span> and disappear from the calendar — it will reappear as a blue AP bill chip.
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Vendor *">
            <Select value={vendorId} onChange={e => setVendorId(e.target.value)}>
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Invoice number">
            <input className={S.input} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Amount ($) *">
            <input type="number" step="0.01" className={S.input} value={amount} onChange={e => setAmount(e.target.value)} />
            {planned && Number(amount) !== Number(planned.amount) && (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Original planned: {fmtMoney(planned.amount)}</p>
            )}
          </Field>
          <Field label="Due date *">
            <input type="date" className={S.input} value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Notes">
          <textarea className={S.textarea} rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>

        <Field label="Attachment">
          <input ref={fileRef} type="file" multiple onChange={handleFileChange}
            className="block text-sm text-gray-600 dark:text-slate-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-orange-50 dark:file:bg-orange-500/10 file:text-orange-700 dark:file:text-orange-400 hover:file:bg-orange-100 dark:hover:file:bg-orange-500/20"
          />
          {files.length > 0 && (
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">{files.length} file{files.length === 1 ? '' : 's'} selected</p>
          )}
        </Field>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={convert} disabled={saving} className={CF.btnSave}>
            {saving ? 'Converting…' : 'Convert to invoice'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className={S.label}>{label}</label>
      {children}
    </div>
  )
}
