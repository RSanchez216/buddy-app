import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Types ──────────────────────────────────────────────────────────────────

interface ParseurPayload {
  vendor_name?: string
  invoice_number?: string
  invoice_date?: string
  due_date?: string
  total_amount?: string | number
  file_url?: string
  file_data?: string       // base64-encoded PDF
  file_name?: string
  email_subject?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseAmount(raw: string | number | undefined): number {
  if (raw == null) return 0
  if (typeof raw === 'number') return raw
  const cleaned = String(raw).replace(/[$,\s]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const notes_prefix = payload.email_subject
    ? `Auto-imported via Parseur — ${payload.email_subject}`
    : 'Auto-imported via Parseur'

  // ── 3. Vendor matching ───────────────────────────────────────────────────
  const rawVendorName = (payload.vendor_name || '').trim()
  let vendorId: string | null = null
  let deptIds: string[] = []
  let needsVendorMatch = false

  if (rawVendorName) {
    const { data: vendors } = await supabase
      .from('vendors')
      .select('id, name, department_id, department_ids')
      .eq('is_active', true)

    if (vendors?.length) {
      // Exact match (case-insensitive)
      let match = vendors.find(
        v => v.name.toLowerCase() === rawVendorName.toLowerCase()
      )
      // Partial match
      if (!match) {
        match = vendors.find(
          v =>
            v.name.toLowerCase().includes(rawVendorName.toLowerCase()) ||
            rawVendorName.toLowerCase().includes(v.name.toLowerCase())
        )
      }
      if (match) {
        vendorId = match.id
        deptIds = match.department_ids?.length
          ? match.department_ids
          : match.department_id
          ? [match.department_id]
          : []
      } else {
        needsVendorMatch = true
      }
    } else {
      needsVendorMatch = true
    }
  } else {
    needsVendorMatch = true
  }

  // ── 4. Build invoice record ──────────────────────────────────────────────
  const invoiceNumber =
    payload.invoice_number?.trim() ||
    `PARSEUR-${Date.now()}`

  const invoicePayload = {
    invoice_number: invoiceNumber,
    vendor_id:      vendorId,
    vendor_name_raw: rawVendorName || null,
    amount:          parseAmount(payload.total_amount),
    received_date:   todayISO(),
    due_date:        payload.due_date || null,
    department_id:   deptIds[0] || null,
    department_ids:  deptIds,
    status:          'Pending',
    source:          'parseur',
    needs_vendor_match: needsVendorMatch,
    notes:           notes_prefix,
    attachment_url:  null as string | null,
  }

  // ── 5. Insert invoice first to get the ID ────────────────────────────────
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert(invoicePayload)
    .select()
    .single()

  if (invErr || !invoice) {
    console.error('Invoice insert failed:', invErr)
    return new Response(
      JSON.stringify({ error: 'Failed to create invoice', detail: invErr?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const invoiceId = invoice.id

  // ── 6. Download & upload PDF ─────────────────────────────────────────────
  let attachmentUrl: string | null = null

  try {
    let fileBytes: Uint8Array | null = null
    let fileName = sanitizeFilename(payload.file_name || `invoice_${invoiceNumber}.pdf`)

    if (payload.file_url) {
      const res = await fetch(payload.file_url)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        fileBytes = new Uint8Array(buf)
      } else {
        console.warn('Could not fetch file_url:', payload.file_url, res.status)
      }
    } else if (payload.file_data) {
      // base64 decode
      const binary = atob(payload.file_data)
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

        // Insert into invoice_attachments table
        await supabase.from('invoice_attachments').insert({
          invoice_id: invoiceId,
          file_url:   publicUrl,
          file_name:  fileName,
        })

        // Update invoice with attachment_url
        await supabase
          .from('invoices')
          .update({ attachment_url: publicUrl })
          .eq('id', invoiceId)
      } else {
        console.warn('Storage upload failed:', upErr.message)
        await supabase
          .from('invoices')
          .update({ notes: `${notes_prefix} (attachment upload failed: ${upErr.message})` })
          .eq('id', invoiceId)
      }
    }
  } catch (err) {
    console.warn('File handling error:', err)
  }

  // ── 7. Create invoice_departments records ────────────────────────────────
  if (deptIds.length) {
    await supabase.from('invoice_departments').insert(
      deptIds.map(dept_id => ({
        invoice_id:    invoiceId,
        department_id: dept_id,
        status:        'Pending',
      }))
    )
  }

  // ── 8. Respond ───────────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({
      success:        true,
      invoice_id:     invoiceId,
      vendor_matched: !needsVendorMatch,
      attachment_url: attachmentUrl,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
