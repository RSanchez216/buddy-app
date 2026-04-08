import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Types ──────────────────────────────────────────────────────────────────

// Accept any key from Parseur — field names vary per vendor template
// deno-lint-ignore no-explicit-any
type ParseurPayload = Record<string, any>

// ── Field resolver ─────────────────────────────────────────────────────────

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

function contractTypeKeyword(contractType: string): [string, string | null] {
  const ct = contractType.trim().toUpperCase()
  if (ct.includes('LEASE TO PURCHASE') || ct.includes('LEASE TO BUY')) return ['Lease to Purchase', null]
  if (ct.includes('LEASE')) return ['Lease', 'Purchase']
  if (ct.includes('RENTAL') || ct.includes('RENT')) return ['Rental', null]
  return [contractType, null]
}

/**
 * Parse a messy date string into YYYY-MM-DD.
 * Handles formats like:
 *   "Invoice Date: Apr 06, 2026"  → "2026-04-06"
 *   "Apr 06, 2026"                → "2026-04-06"
 *   "04/06/2026"                  → "2026-04-06"
 *   "2026-04-06"                  → "2026-04-06"
 *   "April 6, 2026"               → "2026-04-06"
 * Returns null if unparseable.
 */
function parseDate(raw: string | null): string | null {
  if (!raw) return null
  // Strip any label prefix (e.g. "Invoice Date: ", "Due Date: ")
  const stripped = raw.replace(/^[^:]+:\s*/i, '').trim()
  // Try JS Date parsing on the cleaned string
  const d = new Date(stripped)
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0]
  }
  // Try MM/DD/YYYY
  const mdy = stripped.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const d2 = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]))
    if (!isNaN(d2.getTime())) return d2.toISOString().split('T')[0]
  }
  console.warn('[parseur] could not parse date:', raw)
  return null
}

/**
 * Parse a billing period string like:
 *   "Billing Period: Mar 30, 2026 - Apr 05, 2026"
 * Returns [startISO, endISO] or [null, null].
 */
function parseBillingPeriod(raw: string | null): [string | null, string | null] {
  if (!raw) return [null, null]
  const stripped = raw.replace(/^billing period[:\s]*/i, '').trim()
  const parts = stripped.split(/\s+[–\-]\s+/)
  if (parts.length >= 2) {
    return [parseDate(parts[0].trim()), parseDate(parts[1].trim())]
  }
  return [null, null]
}

/**
 * Strip common label prefixes from short values.
 * "Invoice #: 60058641" → "60058641"
 * "Unit # RN630092"     → "RN630092"
 */
function stripLabel(raw: string | null): string | null {
  if (!raw) return null
  return raw.replace(/^.*[:#]\s*/i, '').trim() || null
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const secret = Deno.env.get('PARSEUR_WEBHOOK_SECRET')
  const token  = req.headers.get('x-parseur-token')
  if (!secret || token !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  // ── 2. Parse body ────────────────────────────────────────────────────────
  let payload: ParseurPayload
  try { payload = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // ── 3. Resolve fields ────────────────────────────────────────────────────
  const receivedFields = Object.keys(payload)
  console.log('[parseur] incoming fields:', receivedFields.join(', '))
  console.log('[parseur] full payload keys:', JSON.stringify(Object.keys(payload)))
  console.log('[parseur] attachments field:', JSON.stringify(payload.Attachments || payload.attachments || payload.attachment || 'not found'))

  const fVendorName    = getField(payload, 'vendor_name', 'supplier_name', 'company_name', 'from_name', 'biller_name', 'remit_to_name')
  const fContractType  = getField(payload, 'contract_type', 'service_type', 'billing_type', 'agreement_type', 'type', 'description_type')
  const fInvoiceNum    = getField(payload, 'invoice_number', 'invoice_no', 'inv_number', 'inv_no', 'invoice_num', 'document_number', 'doc_no', 'reference')
  const fInvoiceDate   = getField(payload, 'invoice_date', 'bill_date', 'invoice_dt', 'billing_date', 'service_date', 'doc_date', 'date')
  const fDueDate       = getField(payload, 'due_date', 'payment_due', 'due', 'payment_date', 'date_due', 'pay_by', 'expiry_date')
  const fAmount        = getField(payload, 'total_due_this_invoice', 'total_amount', 'amount', 'total', 'invoice_total', 'amount_due', 'balance_due', 'total_due', 'grand_total', 'net_amount')
  const fTerms         = getField(payload, 'terms', 'payment_terms', 'net_terms', 'payment_conditions', 'conditions')
  const fUnitNumber    = getField(payload, 'unit_number', 'unit_no', 'unit', 'asset_number', 'equipment_number', 'truck_number', 'vehicle_number', 'Unit #')
  const fBillingPeriod = getField(payload, 'billing_period', 'billing_period_range', 'service_period', 'Billing Period:', 'Billing Period')
  const fFileName      = getField(payload, 'file_name')
  const fFileData      = getField(payload, 'file_data')

  // Resolve file URL — handles string scalar, array of strings, or array of objects with .url
  const fileUrl: string | null = (() => {
    const direct = payload.file_url || payload.document_url || payload.attachment_url ||
                   payload.pdf_url  || payload.file_link    || payload.attachment
    if (direct && typeof direct === 'string') return direct
    const arr = payload.Attachments ?? payload.attachments
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0]
      if (typeof first === 'string') return first
      if (first && typeof first === 'object' && first.url) return String(first.url)
    }
    return null
  })()
  const fEmailSubject  = getField(payload, 'email_subject')

  console.log('[parseur] resolved fields:', JSON.stringify({
    vendor_name: fVendorName.key, contract_type: fContractType.key,
    invoice_number: fInvoiceNum.key, invoice_date: fInvoiceDate.key,
    due_date: fDueDate.key, amount: fAmount.key, terms: fTerms.key,
    unit_number: fUnitNumber.key, billing_period: fBillingPeriod.key,
    file_url: fileUrl ?? null,
  }))

  if (!fAmount.value)      console.error('[parseur] MISSING amount — payload keys were:', receivedFields.join(', '))
  if (!fInvoiceDate.value) console.warn('[parseur] no invoice_date found — will use today. payload keys:', receivedFields.join(', '))

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const notes_prefix = fEmailSubject.value ? `Auto-imported via Parseur — ${fEmailSubject.value}` : 'Auto-imported via Parseur'

  // ── 4. Smart vendor matching ─────────────────────────────────────────────
  // Order: exact name → partial+contract_type → vendor_aliases → UNMATCHED
  const rawVendorName   = fVendorName.value?.trim() || ''
  const rawContractType = fContractType.value?.trim() || ''

  let vendorId: string | null = null
  let deptIds: string[] = []
  let needsVendorMatch = false
  let notesExtra = ''

  if (rawVendorName) {
    const { data: vendors } = await supabase
      .from('vendors').select('id, name, department_id, department_ids').eq('is_active', true)

    if (vendors?.length) {
      // Step 1 — Exact name match
      const exactMatch = vendors.find(v => v.name.toLowerCase() === rawVendorName.toLowerCase())

      if (exactMatch) {
        console.log('[parseur] vendor exact match:', exactMatch.name)
        vendorId = exactMatch.id
        deptIds = exactMatch.department_ids?.length ? exactMatch.department_ids : (exactMatch.department_id ? [exactMatch.department_id] : [])
      } else {
        // Step 2 — Partial name + contract_type keyword
        const nameLower = rawVendorName.toLowerCase()
        let candidates = vendors.filter(v =>
          v.name.toLowerCase().includes(nameLower) || nameLower.includes(v.name.toLowerCase())
        )

        if (candidates.length > 1 && rawContractType) {
          const [includeKw, excludeKw] = contractTypeKeyword(rawContractType)
          const refined = candidates.filter(v => {
            const vn = v.name.toLowerCase()
            return vn.includes(includeKw.toLowerCase()) && !(excludeKw ? vn.includes(excludeKw.toLowerCase()) : false)
          })
          if (refined.length > 0) candidates = refined
        }

        if (candidates.length === 1) {
          console.log('[parseur] vendor matched via name+contract_type:', candidates[0].name)
          vendorId = candidates[0].id
          deptIds = candidates[0].department_ids?.length ? candidates[0].department_ids : (candidates[0].department_id ? [candidates[0].department_id] : [])
        } else {
          // Step 3 — Check vendor_aliases table (may return multiple rows for same alias)
          const { data: aliasRows } = await supabase
            .from('vendor_aliases')
            .select('vendor_id')
            .ilike('alias', rawVendorName)

          console.log(`[parseur] alias lookup for "${rawVendorName}":`, aliasRows?.length ?? 0, 'rows')

          if (aliasRows?.length) {
            // If multiple aliases map to different vendors, use contract_type to narrow
            let aliasVendors = aliasRows
              .map(r => vendors.find(v => v.id === r.vendor_id))
              .filter(Boolean) as typeof vendors

            if (aliasVendors.length > 1 && rawContractType) {
              const [includeKw, excludeKw] = contractTypeKeyword(rawContractType)
              const refined = aliasVendors.filter(v => {
                const vn = v.name.toLowerCase()
                return vn.includes(includeKw.toLowerCase()) && !(excludeKw ? vn.includes(excludeKw.toLowerCase()) : false)
              })
              if (refined.length > 0) aliasVendors = refined
            }

            if (aliasVendors.length >= 1) {
              const matched = aliasVendors[0]
              console.log('[parseur] vendor matched via alias:', matched.name)
              vendorId = matched.id
              deptIds = matched.department_ids?.length ? matched.department_ids : (matched.department_id ? [matched.department_id] : [])
            } else {
              needsVendorMatch = true
            }
          } else {
            // Step 4 — No match at all
            if (candidates.length > 1) {
              console.warn('[parseur] multiple vendor candidates, no alias:', candidates.map(v => v.name).join(', '))
              notesExtra = ` | Multiple vendor matches: ${candidates.map(v => v.name).join(', ')}`
            } else {
              console.warn('[parseur] no vendor match for:', rawVendorName)
            }
            needsVendorMatch = true
          }
        }
      }
    } else {
      needsVendorMatch = true
    }
  } else {
    needsVendorMatch = true
  }

  // ── 5. Parse dates & billing period ─────────────────────────────────────
  const invoiceDate = parseDate(fInvoiceDate.value)
  let dueDate = parseDate(fDueDate.value)
  if (!dueDate && fTerms.value && invoiceDate) {
    dueDate = calcDueDate(invoiceDate, fTerms.value)
    if (dueDate) console.log(`[parseur] due_date calculated from "${fTerms.value}": ${dueDate}`)
  }
  const [billingStart, billingEnd] = parseBillingPeriod(fBillingPeriod.value)
  console.log(`[parseur] dates — received_date: ${invoiceDate ?? 'today'}, due_date: ${dueDate}, billing: ${billingStart} – ${billingEnd}`)

  // ── 6. Build & insert invoice ────────────────────────────────────────────
  // Strip label prefixes from invoice number and unit number
  const invoiceNumber = stripLabel(fInvoiceNum.value) || `PARSEUR-${Date.now()}`

  // Duplicate guard — skip if same invoice_number from parseur already exists (not soft-deleted)
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('invoice_number', invoiceNumber)
    .eq('source', 'parseur')
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    console.log('[parseur] duplicate detected, skipping:', invoiceNumber)
    return new Response(
      JSON.stringify({ success: true, message: 'duplicate invoice skipped', invoice_id: existing.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const { data: invoice, error: invErr } = await supabase.from('invoices').insert({
    invoice_number:       invoiceNumber,
    vendor_id:            vendorId,
    vendor_name_raw:      rawVendorName || null,
    amount:               parseAmount(fAmount.value),
    received_date:        invoiceDate || todayISO(),
    due_date:             dueDate,
    billing_period_start: billingStart,
    billing_period_end:   billingEnd,
    department_id:        deptIds[0] || null,
    department_ids:       deptIds,
    status:               'Pending',
    source:               'parseur',
    needs_vendor_match:   needsVendorMatch,
    contract_type:        rawContractType || null,
    payment_terms:        fTerms.value || null,
    unit_number:          stripLabel(fUnitNumber.value),
    notes:                notes_prefix + notesExtra,
    raw_payload:          payload,
    attachment_url:       null as string | null,
  }).select().single()

  if (invErr || !invoice) {
    console.error('[parseur] invoice insert failed:', invErr)
    return new Response(JSON.stringify({ error: 'Failed to create invoice', detail: invErr?.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const invoiceId = invoice.id
  console.log('[parseur] invoice created:', invoiceId)

  // ── 7. Download & upload PDF ─────────────────────────────────────────────
  let attachmentUrl: string | null = null
  try {
    let fileBytes: Uint8Array | null = null
    const fileName = sanitizeFilename(fFileName.value || `invoice_${invoiceNumber}.pdf`)

    if (fileUrl) {
      console.log('[parseur] fetching attachment from:', fileUrl)
      const res = await fetch(fileUrl)
      if (res.ok) fileBytes = new Uint8Array(await res.arrayBuffer())
      else console.warn('[parseur] could not fetch file_url:', fileUrl, res.status)
    } else if (fFileData.value) {
      const binary = atob(fFileData.value)
      fileBytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) fileBytes[i] = binary.charCodeAt(i)
    }

    if (!fileUrl && !fFileData.value) {
      console.warn('[parseur] no file_url or file_data in payload — no attachment will be saved')
    }

    if (fileBytes) {
      const storagePath = `parseur/${invoiceId}_${fileName}`
      const { error: upErr } = await supabase.storage.from('invoice-attachments').upload(storagePath, fileBytes, { contentType: 'application/pdf', upsert: true })
      if (!upErr) {
        const { data: { publicUrl } } = supabase.storage.from('invoice-attachments').getPublicUrl(storagePath)
        attachmentUrl = publicUrl
        await supabase.from('invoice_attachments').insert({ invoice_id: invoiceId, file_url: publicUrl, file_name: fileName })
        await supabase.from('invoices').update({ attachment_url: publicUrl }).eq('id', invoiceId)
        console.log('[parseur] attachment uploaded:', storagePath)
      } else {
        console.warn('[parseur] storage upload failed:', upErr.message)
        await supabase.from('invoices').update({ notes: `${notes_prefix}${notesExtra} (attachment upload failed: ${upErr.message})` }).eq('id', invoiceId)
      }
    }
  } catch (err) {
    console.warn('[parseur] file handling error:', err)
  }

  // ── 8. Create invoice_departments records ────────────────────────────────
  if (deptIds.length) {
    await supabase.from('invoice_departments').insert(
      deptIds.map(dept_id => ({ invoice_id: invoiceId, department_id: dept_id, status: 'Pending' }))
    )
  }

  // ── 9. Respond ───────────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({ success: true, invoice_id: invoiceId, vendor_matched: !needsVendorMatch, due_date: dueDate, attachment_url: attachmentUrl }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
