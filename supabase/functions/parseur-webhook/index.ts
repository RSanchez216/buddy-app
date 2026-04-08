import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Types ──────────────────────────────────────────────────────────────────

// Accept any key from Parseur — field names vary per vendor template
// deno-lint-ignore no-explicit-any
type ParseurPayload = Record<string, any>

// ── Field resolver ─────────────────────────────────────────────────────────

/**
 * Returns the value of the first candidate key that is present and non-empty
 * in the payload, plus the key name that matched (for logging).
 */
function getField(payload: ParseurPayload, ...candidates: string[]): { value: string | null; key: string | null } {
  for (const key of candidates) {
    const v = payload[key]
    if (v !== undefined && v !== null && v !== '') {
      return { value: String(v), key }
    }
  }
  return { value: null, key: null }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseAmount(raw: string | null | undefined): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[$,\s]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Given invoice_date (YYYY-MM-DD) and a terms string like "Net 10",
 * returns the due date as YYYY-MM-DD, or null if unparseable.
 */
function calcDueDate(invoiceDate: string | null, terms: string | null): string | null {
  if (!invoiceDate || !terms) return null
  const match = terms.match(/net\s*(\d+)/i)
  if (!match) return null
  const days = parseInt(match[1], 10)
  const base = new Date(invoiceDate)
  if (isNaN(base.getTime())) return null
  base.setDate(base.getDate() + days)
  return base.toISOString().split('T')[0]
}

/**
 * Map a contract_type string to [includeKeyword, excludeKeyword|null]
 * for vendor name disambiguation.
 */
function contractTypeKeyword(contractType: string): [string, string | null] {
  const ct = contractType.trim().toUpperCase()
  if (ct.includes('LEASE TO PURCHASE') || ct.includes('LEASE TO BUY')) {
    return ['Lease to Purchase', null]
  }
  if (ct.includes('LEASE')) {
    return ['Lease', 'Purchase']
  }
  if (ct.includes('RENTAL') || ct.includes('RENT')) {
    return ['Rental', null]
  }
  return [contractType, null]
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const secret = Deno.env.get('PARSEUR_WEBHOOK_SECRET')
  const token  = req.headers.get('x-parseur-token')

  if (!secret || token !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── 2. Parse body ────────────────────────────────────────────────────────
  let payload: ParseurPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── 3. Resolve fields (flexible mapping) ─────────────────────────────────
  const receivedFields = Object.keys(payload)
  console.log('[parseur] incoming fields:', receivedFields.join(', '))

  const fVendorName   = getField(payload, 'vendor_name', 'supplier_name', 'company_name', 'from_name', 'biller_name', 'remit_to_name')
  const fContractType = getField(payload, 'contract_type', 'service_type', 'billing_type', 'agreement_type', 'type', 'description_type')
  const fInvoiceNum   = getField(payload, 'invoice_number', 'invoice_no', 'inv_number', 'inv_no', 'invoice_num', 'document_number', 'doc_no', 'reference')
  const fInvoiceDate  = getField(payload, 'received_date', 'invoice_date', 'date', 'bill_date', 'invoice_dt', 'billing_date', 'service_date', 'doc_date')
  const fDueDate      = getField(payload, 'due_date', 'payment_due', 'due', 'payment_date', 'date_due', 'pay_by', 'expiry_date')
  const fAmount       = getField(payload, 'total_due_this_invoice', 'total_amount', 'amount', 'total', 'invoice_total', 'amount_due', 'balance_due', 'total_due', 'grand_total', 'net_amount')
  const fTerms        = getField(payload, 'terms', 'payment_terms', 'net_terms', 'payment_conditions', 'conditions')
  const fUnitNumber   = getField(payload, 'unit_number', 'unit_no', 'unit', 'asset_number', 'equipment_number', 'truck_number', 'vehicle_number')
  const fFileName     = getField(payload, 'file_name')
  const fFileUrl      = getField(payload, 'file_url')
  const fFileData     = getField(payload, 'file_data')
  const fEmailSubject = getField(payload, 'email_subject')

  // Log resolved field sources
  console.log('[parseur] resolved fields:', JSON.stringify({
    vendor_name:    fVendorName.key,
    contract_type:  fContractType.key,
    invoice_number: fInvoiceNum.key,
    invoice_date:   fInvoiceDate.key,
    due_date:       fDueDate.key,
    amount:         fAmount.key,
    terms:          fTerms.key,
    unit_number:    fUnitNumber.key,
  }))

  // Warn on missing required fields
  if (!fAmount.value) {
    console.error('[parseur] MISSING amount — payload keys were:', receivedFields.join(', '))
  }
  if (!fInvoiceDate.value) {
    console.error('[parseur] MISSING invoice_date — payload keys were:', receivedFields.join(', '))
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const notes_prefix = fEmailSubject.value
    ? `Auto-imported via Parseur — ${fEmailSubject.value}`
    : 'Auto-imported via Parseur'

  // ── 4. Smart vendor matching ─────────────────────────────────────────────
  const rawVendorName   = fVendorName.value?.trim() || ''
  const rawContractType = fContractType.value?.trim() || ''

  let vendorId: string | null = null
  let deptIds: string[] = []
  let needsVendorMatch = false
  let notesExtra = ''

  if (rawVendorName) {
    const { data: vendors } = await supabase
      .from('vendors')
      .select('id, name, department_id, department_ids')
      .eq('is_active', true)

    if (vendors?.length) {
      // Step 1 — Exact match (case-insensitive)
      let match = vendors.find(
        v => v.name.toLowerCase() === rawVendorName.toLowerCase()
      )

      if (match) {
        console.log('[parseur] vendor exact match:', match.name)
        vendorId = match.id
        deptIds = match.department_ids?.length
          ? match.department_ids
          : match.department_id ? [match.department_id] : []
      } else {
        // Step 2 — Combined name + contract_type keyword match
        const nameLower = rawVendorName.toLowerCase()

        let candidates = vendors.filter(v =>
          v.name.toLowerCase().includes(nameLower) ||
          nameLower.includes(v.name.toLowerCase())
        )

        if (candidates.length > 1 && rawContractType) {
          const [includeKw, excludeKw] = contractTypeKeyword(rawContractType)
          const refined = candidates.filter(v => {
            const vn = v.name.toLowerCase()
            const hasInclude = vn.includes(includeKw.toLowerCase())
            const hasExclude = excludeKw ? vn.includes(excludeKw.toLowerCase()) : false
            return hasInclude && !hasExclude
          })
          if (refined.length > 0) candidates = refined
        }

        if (candidates.length === 1) {
          console.log('[parseur] vendor matched via name+contract_type:', candidates[0].name)
          vendorId = candidates[0].id
          deptIds = candidates[0].department_ids?.length
            ? candidates[0].department_ids
            : candidates[0].department_id ? [candidates[0].department_id] : []
        } else if (candidates.length > 1) {
          console.warn('[parseur] multiple vendor candidates:', candidates.map(v => v.name).join(', '))
          needsVendorMatch = true
          const names = candidates.map(v => v.name).join(', ')
          notesExtra = ` | Multiple vendor matches: ${names}`
        } else {
          console.warn('[parseur] no vendor match for:', rawVendorName)
          needsVendorMatch = true
        }
      }
    } else {
      needsVendorMatch = true
    }
  } else {
    needsVendorMatch = true
  }

  // ── 5. Due date from terms ───────────────────────────────────────────────
  const invoiceDate = fInvoiceDate.value || null
  let dueDate = fDueDate.value || null

  if (!dueDate && fTerms.value && invoiceDate) {
    dueDate = calcDueDate(invoiceDate, fTerms.value)
    if (dueDate) console.log(`[parseur] due_date calculated from "${fTerms.value}": ${dueDate}`)
  }

  // ── 6. Build invoice record ──────────────────────────────────────────────
  const invoiceNumber =
    fInvoiceNum.value?.trim() ||
    `PARSEUR-${Date.now()}`

  const invoicePayload = {
    invoice_number:     invoiceNumber,
    vendor_id:          vendorId,
    vendor_name_raw:    rawVendorName || null,
    amount:             parseAmount(fAmount.value),
    received_date:      todayISO(),
    invoice_date:       invoiceDate,
    due_date:           dueDate,
    department_id:      deptIds[0] || null,
    department_ids:     deptIds,
    status:             'Pending',
    source:             'parseur',
    needs_vendor_match: needsVendorMatch,
    contract_type:      rawContractType || null,
    payment_terms:      fTerms.value || null,
    unit_number:        fUnitNumber.value?.trim() || null,
    notes:              notes_prefix + notesExtra,
    raw_payload:        payload,
    attachment_url:     null as string | null,
  }

  // ── 7. Insert invoice ────────────────────────────────────────────────────
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert(invoicePayload)
    .select()
    .single()

  if (invErr || !invoice) {
    console.error('[parseur] invoice insert failed:', invErr)
    return new Response(
      JSON.stringify({ error: 'Failed to create invoice', detail: invErr?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const invoiceId = invoice.id
  console.log('[parseur] invoice created:', invoiceId)

  // ── 8. Download & upload PDF ─────────────────────────────────────────────
  let attachmentUrl: string | null = null

  try {
    let fileBytes: Uint8Array | null = null
    let fileName = sanitizeFilename(fFileName.value || `invoice_${invoiceNumber}.pdf`)

    if (fFileUrl.value) {
      const res = await fetch(fFileUrl.value)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        fileBytes = new Uint8Array(buf)
      } else {
        console.warn('[parseur] could not fetch file_url:', fFileUrl.value, res.status)
      }
    } else if (fFileData.value) {
      const binary = atob(fFileData.value)
      fileBytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        fileBytes[i] = binary.charCodeAt(i)
      }
    }

    if (fileBytes) {
      const storagePath = `parseur/${invoiceId}_${fileName}`
      const { error: upErr } = await supabase.storage
        .from('invoice-attachments')
        .upload(storagePath, fileBytes, {
          contentType: 'application/pdf',
          upsert: true,
        })

      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage
          .from('invoice-attachments')
          .getPublicUrl(storagePath)
        attachmentUrl = publicUrl

        await supabase.from('invoice_attachments').insert({
          invoice_id: invoiceId,
          file_url:   publicUrl,
          file_name:  fileName,
        })

        await supabase
          .from('invoices')
          .update({ attachment_url: publicUrl })
          .eq('id', invoiceId)

        console.log('[parseur] attachment uploaded:', storagePath)
      } else {
        console.warn('[parseur] storage upload failed:', upErr.message)
        await supabase
          .from('invoices')
          .update({ notes: `${notes_prefix}${notesExtra} (attachment upload failed: ${upErr.message})` })
          .eq('id', invoiceId)
      }
    }
  } catch (err) {
    console.warn('[parseur] file handling error:', err)
  }

  // ── 9. Create invoice_departments records ────────────────────────────────
  if (deptIds.length) {
    await supabase.from('invoice_departments').insert(
      deptIds.map(dept_id => ({
        invoice_id:    invoiceId,
        department_id: dept_id,
        status:        'Pending',
      }))
    )
  }

  // ── 10. Respond ───────────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({
      success:        true,
      invoice_id:     invoiceId,
      vendor_matched: !needsVendorMatch,
      due_date:       dueDate,
      attachment_url: attachmentUrl,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
