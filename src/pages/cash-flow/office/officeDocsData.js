import { supabase } from '../../../lib/supabase'

// Receipts, invoices and wire confirmations for Office Expenses.
//
// Read from v_office_documents (it resolves office_name and uploaded_by_name and
// hides soft-deleted rows); insert into office_documents. `office_id` is set by a
// BEFORE trigger from the parent row, so anything we send is ignored — we don't
// send it.
//
// The bucket is PRIVATE. Every link is a short-lived signed URL; getPublicUrl
// returns a URL that resolves to nothing here and fails silently, which is the
// worst kind of broken.

export const BUCKET = 'office-documents'
export const MAX_BYTES = 10 * 1024 * 1024

// Mirrors the bucket's allowed_mime_types exactly. Validating here as well isn't
// belt-and-braces: the storage rejection is an opaque 400, so the only way to
// tell someone *why* their file bounced is to check before sending it.
export const ACCEPTED = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
}
// Extensions too — iOS reports HEIC with an empty type often enough to matter.
const EXT_KIND = {
  pdf: 'PDF', jpg: 'JPG', jpeg: 'JPG', png: 'PNG', webp: 'WEBP',
  heic: 'HEIC', heif: 'HEIF', xlsx: 'XLSX', docx: 'DOCX',
}
export const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.xlsx,.docx'
export const ACCEPTED_HINT = 'PDF, JPG, PNG, WEBP, HEIC, XLSX or DOCX · up to 10 MB'

export const DOC_TYPES = [
  ['receipt', 'Receipt'],
  ['invoice', 'Invoice'],
  ['wire_confirmation', 'Wire confirmation'],
  ['contract', 'Contract'],
  ['other', 'Other'],
]
export const docTypeLabel = (t) => DOC_TYPES.find(d => d[0] === t)?.[1] || t || 'Document'

const extOf = (name) => (String(name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
// The badge on each row. Falls back to the extension when the browser gives no
// type, and to a generic label when it gives neither.
export const fileKind = (file) =>
  ACCEPTED[file?.mime_type || file?.type] || EXT_KIND[extOf(file?.file_name || file?.name)] || 'FILE'

export function fmtBytes(n) {
  const b = Number(n)
  if (!Number.isFinite(b) || b <= 0) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

// Reject before uploading so the reason can be shown next to the file.
export function validateFile(file) {
  if (!file) return { ok: false, reason: 'No file' }
  if (file.size > MAX_BYTES) return { ok: false, reason: `${fmtBytes(file.size)} — over the 10 MB limit` }
  const byMime = !!ACCEPTED[file.type]
  const byExt = !!EXT_KIND[extOf(file.name)]
  if (!byMime && !byExt) return { ok: false, reason: 'Type not accepted' }
  return { ok: true }
}

// The storage key is ASCII-only and derived from a UUID; the ORIGINAL name is
// kept in file_name. Bishkek and Tashkent upload Cyrillic filenames, and non-ASCII
// storage keys are unreliable — but "Чек №128,45.pdf" must still render as typed.
export function buildKey(officeId, parentKind, parentId, file) {
  const ext = (String(file?.name || '').match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase()
  return `${officeId}/${parentKind}/${parentId}/${crypto.randomUUID()}${ext}`
}

// ── Reads ───────────────────────────────────────────────────────────────────
const parentColumn = (parentKind) => (parentKind === 'transfer' ? 'office_transfer_id' : 'office_expense_id')

export async function listDocuments(parentKind, parentId) {
  if (!parentId) return []
  const { data, error } = await supabase.from('v_office_documents')
    .select('*').eq(parentColumn(parentKind), parentId)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return data || []
}

// One query for every visible row, grouped client-side. A count per row would be
// N queries for a table that routinely shows fifty expenses.
export async function countsForExpenses(expenseIds) {
  const ids = [...new Set((expenseIds || []).filter(Boolean))]
  const out = new Map()
  if (!ids.length) return out
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('v_office_documents')
      .select('office_expense_id').in('office_expense_id', ids.slice(i, i + 200))
    if (error) throw error
    for (const r of data || []) out.set(r.office_expense_id, (out.get(r.office_expense_id) || 0) + 1)
  }
  return out
}

// Private bucket → signed URL only, and short-lived.
export async function signedUrl(path, seconds = 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data?.signedUrl || null
}
export async function signedDownloadUrl(path, fileName, seconds = 60) {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, seconds, { download: fileName || true })
  if (error) throw error
  return data?.signedUrl || null
}

// ── Writes ──────────────────────────────────────────────────────────────────
// Upload FIRST, insert second. The other order leaves a row pointing at nothing
// if the upload fails; this order leaves an orphan object if the insert fails, so
// the object is removed on that path. An orphan object is recoverable, a broken
// link isn't.
export async function uploadDocument({ officeId, parentKind, parentId, file, documentType = 'receipt', note = null }) {
  const check = validateFile(file)
  if (!check.ok) throw new Error(check.reason)

  const key = buildKey(officeId, parentKind, parentId, file)
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(key, file, { contentType: file.type || undefined, upsert: false })
  if (upErr) throw upErr

  const row = {
    [parentColumn(parentKind)]: parentId,
    document_type: documentType,
    file_path: key,
    file_name: file.name,        // verbatim — never sanitised
    mime_type: file.type || null,
    file_size_bytes: file.size ?? null,
    note: note?.trim() || null,
  }
  const { data, error } = await supabase.from('office_documents').insert(row).select('id').single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([key]).catch(() => {}) // don't strand the object
    throw error
  }
  return data
}

// Soft delete. The storage object is deliberately retained.
export async function removeDocument(id) {
  const { error } = await supabase.rpc('delete_office_document', { p_id: id })
  if (error) {
    if (error.code === '42501') throw new Error('Only an admin or manager can remove office documents.')
    throw error
  }
}

// Staged uploads: the parent row doesn't exist until the modal saves, so files are
// held in component state and flushed afterwards. Nothing reaches storage if the
// modal is cancelled.
//
// Returns { uploaded, failed } and never throws — a failed attachment must not
// roll back an expense that saved fine.
export async function flushStaged(files, { officeId, parentKind, parentId, documentType = 'receipt' }) {
  const failed = []
  let uploaded = 0
  for (const f of files || []) {
    try {
      await uploadDocument({ officeId, parentKind, parentId, file: f, documentType })
      uploaded += 1
    } catch (e) {
      failed.push({ name: f?.name || 'file', reason: e?.message || 'Upload failed' })
    }
  }
  return { uploaded, failed }
}

export function fmtUploadedAt(ts) {
  if (!ts) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ts))
  } catch { return '—' }
}
