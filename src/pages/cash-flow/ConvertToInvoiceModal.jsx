import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { S } from '../../lib/styles'
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

  // Lock body scroll while open (mirrors Modal behavior)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

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

  // Match the invoice-attachments storage pattern used by InvoiceInbox exactly
  async function uploadFiles(invoiceId, fileList) {
    if (!fileList?.length) return
    const records = []
    for (const file of fileList) {
      const path = `${invoiceId}_${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('invoice-attachments').upload(path, file)
      if (upErr) {
        console.error('[Convert→Invoice] attachment upload failed:', upErr)
        continue
      }
      const { data: { publicUrl } } = supabase.storage.from('invoice-attachments').getPublicUrl(path)
      records.push({ invoice_id: invoiceId, file_url: publicUrl, file_name: file.name })
    }
    if (records.length) {
      const insRes = await supabase.from('invoice_attachments').insert(records)
      if (insRes.error) console.error('[Convert→Invoice] attachment row insert failed:', insRes.error)
    }
  }

  async function convert() {
    if (!planned) return
    if (!vendorId) return setError('Vendor is required')
    if (!Number(amount) || Number(amount) <= 0) return setError('Amount is required')
    if (!dueDate) return setError('Due date is required')

    console.log('[Convert→Invoice] click — planned id:', planned.id, 'amount:', amount, 'vendor:', vendorId)
    setSaving(true); setError('')

    try {
      // 1) INSERT invoice
      const insertPayload = {
        vendor_id: vendorId,
        invoice_number: invoiceNumber.trim() || null,
        amount: Number(amount),
        received_date: toISO(new Date()),
        due_date: dueDate,
        status: 'Pending',                       // Pascal-case to satisfy DB CHECK constraint
        source: 'planned_expense',
        notes: notes.trim() || null,
        department_ids: [],
      }
      console.log('[Convert→Invoice] inserting invoice:', insertPayload)
      const { data: inv, error: invErr } = await supabase
        .from('invoices')
        .insert(insertPayload)
        .select()
        .single()
      if (invErr) throw new Error('Invoice insert failed: ' + invErr.message)
      console.log('[Convert→Invoice] invoice inserted:', inv.id)

      // 2) Attachments (best-effort, non-blocking on errors)
      if (files.length) {
        console.log('[Convert→Invoice] uploading', files.length, 'attachment(s)')
        await uploadFiles(inv.id, files)
      }

      // 3) UPDATE planned outflow → converted
      const updPayload = {
        status: 'converted',
        converted_to_invoice_id: inv.id,
        converted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      console.log('[Convert→Invoice] marking planned as converted:', planned.id, updPayload)
      const { error: updErr } = await supabase
        .from('custom_outflows')
        .update(updPayload)
        .eq('id', planned.id)
      if (updErr) throw new Error('Planned expense update failed: ' + updErr.message)

      console.log('[Convert→Invoice] success — refetching calendar + closing UI')
      setSaving(false)
      onConverted?.(inv.id)
    } catch (err) {
      console.error('[Convert→Invoice] aborted:', err)
      setError(err?.message || 'Conversion failed')
      setSaving(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Backdrop — clicking it closes ONLY the modal, not the drawer behind */}
      <div
        className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Convert planned expense to invoice</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className={S.modalBody}>
            {error && <div className={S.errorBox}>{error}</div>}

            <div className="rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 p-3 text-xs text-orange-700 dark:text-orange-400">
              A new invoice will be created in AP Control. The planned expense will be marked as <span className="font-semibold">converted</span> and reappear on the calendar as a blue AP bill chip.
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
        </div>
      </div>
    </div>,
    document.body
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
