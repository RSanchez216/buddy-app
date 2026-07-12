import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { logEvent } from '../utils/events'
import { fmtDate } from '../utils/format'
import { useToast } from '../../../contexts/ToastContext'

const BUCKET = 'driver-documents'

const TYPE_OPTIONS = {
  driver: [
    { v: 'id_front', l: 'ID Front' },
    { v: 'id_back',  l: 'ID Back' },
    { v: 'cdl',      l: 'CDL' },
    { v: 'photo',    l: 'Photo' },
    { v: 'other',    l: 'Other' },
  ],
  contract: [
    // "No label" is first so it's the default upload type — documents are no
    // longer auto-classified as Signed contract; the user labels them after.
    { v: 'unlabeled',       l: 'No label' },
    { v: 'signed_contract', l: 'Signed contract' },
    { v: 'bill_of_sale',    l: 'Bill of sale' },
    { v: 'title',           l: 'Title' },
    { v: 'payoff_letter',         l: 'Payoff letter' },
    { v: 'payment_confirmation',  l: 'Payment confirmation' },
    { v: 'other',                 l: 'Other' },
  ],
}

// Type-badge styling. Unlabeled reads amber ("needs attention") so unclassified
// files stand out and prompt the user; real types keep the neutral gray chip.
function typeChipClass(type, editable) {
  if (type === 'unlabeled') {
    return `bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-500/30${
      editable ? ' hover:bg-amber-200 dark:hover:bg-amber-500/25' : ''}`
  }
  return `bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400${
    editable ? ' hover:bg-gray-200 dark:hover:bg-slate-700/60' : ''}`
}

// Reusable docs section. Pass kind='driver' for driver-level docs (keyed
// off driver_id) or kind='contract' for purchase-level docs (keyed off
// driver_purchase_id and stored under purchases/{id}/).
// Batches at or above this size trigger a one-time confirmation prompt
// so a stray multi-select doesn't silently commit the wrong type to a
// folder full of files. 10 picked per spec; tune if it feels off.
const BULK_CONFIRM_THRESHOLD = 10

export default function DocumentsSection({ kind, ownerId, purchaseId, canEdit, title }) {
  const { user } = useAuth()
  const toast = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [uploadType, setUploadType] = useState(TYPE_OPTIONS[kind][0].v)
  const [error, setError] = useState('')
  const [pendingBatch, setPendingBatch] = useState(null) // 10+ confirm modal
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  // Inline type-edit popover: { docId } when open. Click-outside closes.
  const [editingTypeFor, setEditingTypeFor] = useState(null)
  const fileRef = useRef(null)
  const popoverRef = useRef(null)

  const table = kind === 'driver' ? 'driver_documents' : 'driver_purchase_documents'
  const filterCol = kind === 'driver' ? 'driver_id' : 'driver_purchase_id'
  const types = TYPE_OPTIONS[kind]

  useEffect(() => { if (ownerId) load() /* eslint-disable-line */ }, [ownerId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq(filterCol, ownerId)
      .order('uploaded_at', { ascending: false })
    setDocs(data || [])
    setLoading(false)
  }

  function pickFiles() { fileRef.current?.click() }

  // Bridge to global toast. Accepts { kind, text } shape used through
  // out this file. Kind 'error' → error toast; anything else → success.
  function emitToast(t) {
    if (!t?.text) return
    if (t.kind === 'error') toast.error(t.text)
    else toast.success(t.text)
  }

  // Entry point for picker + drop-zone. Sizes ≥ threshold pause for a
  // confirmation so a 50-file folder grab doesn't silently commit the
  // wrong default type. Smaller batches go straight through.
  function handleFiles(files) {
    if (!canEdit || !files?.length) return
    if (files.length >= BULK_CONFIRM_THRESHOLD) {
      setPendingBatch(files)
      return
    }
    runUpload(files)
  }

  // Uploads a single file. Returns { ok, error?, file } so the caller
  // can aggregate Promise.allSettled results without throwing.
  async function uploadOne(file) {
    const ts = Date.now()
    const safe = file.name.replace(/[^\w.-]/g, '_')
    const path = kind === 'driver'
      ? `drivers/${ownerId}/${ts}_${Math.random().toString(36).slice(2, 6)}_${safe}`
      : `purchases/${ownerId}/${ts}_${Math.random().toString(36).slice(2, 6)}_${safe}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type, cacheControl: '3600', upsert: false,
    })
    if (up.error) return { ok: false, error: up.error.message, file }
    const insertPayload = kind === 'driver'
      ? { driver_id: ownerId, document_type: uploadType, file_path: path, file_name: file.name, uploaded_by: user?.id || null }
      : { driver_purchase_id: ownerId, document_type: uploadType, file_path: path, file_name: file.name, uploaded_by: user?.id || null }
    const ins = await supabase.from(table).insert(insertPayload)
    if (ins.error) {
      // Best-effort cleanup so a failed insert doesn't orphan a blob.
      await supabase.storage.from(BUCKET).remove([path])
      return { ok: false, error: ins.error.message, file }
    }
    if (purchaseId) {
      await logEvent(purchaseId, 'document_added',
        `Uploaded ${file.name} (${labelFor(uploadType, kind)})`,
        { kind, document_type: uploadType, file_name: file.name }, user?.id)
    }
    return { ok: true, file }
  }

  // Runs the actual batch — parallel via allSettled so a single bad
  // file doesn't block the rest. Progress counter ticks per file
  // completion (success or failure) so the indicator stays accurate.
  async function runUpload(files) {
    setUploading(true); setError('')
    setUploadProgress({ done: 0, total: files.length })
    let done = 0
    const tasks = Array.from(files).map(f =>
      uploadOne(f).then(r => {
        done += 1
        setUploadProgress({ done, total: files.length })
        return r
      })
    )
    const results = await Promise.allSettled(tasks)
    const success = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
    const failures = results
      .map(r => r.status === 'fulfilled' ? r.value : { ok: false, error: 'Unknown error', file: { name: '?' } })
      .filter(r => !r.ok)
    setUploading(false)
    setUploadProgress({ done: 0, total: 0 })
    await load()
    if (success > 0 && failures.length === 0) {
      emitToast({ kind: 'success', text: `Uploaded ${success} document${success === 1 ? '' : 's'}` })
    } else if (success > 0 && failures.length > 0) {
      emitToast({ kind: 'error', text: `Uploaded ${success}, failed ${failures.length}: ${failures[0].error}` })
    } else {
      emitToast({ kind: 'error', text: `Upload failed: ${failures[0]?.error || 'Unknown error'}` })
    }
  }

  function confirmPendingBatch() {
    const files = pendingBatch
    setPendingBatch(null)
    if (files) runUpload(files)
  }

  // Drag-and-drop on the card. Only toggles the visual highlight when
  // a file payload is actually being dragged (ignores text drags etc).
  function onDragOver(e) {
    if (!canEdit || uploading) return
    if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setIsDraggingOver(true)
    }
  }
  function onDragLeave(e) {
    // Only clear when leaving the card itself, not when crossing into a child
    if (e.currentTarget.contains(e.relatedTarget)) return
    setIsDraggingOver(false)
  }
  function onDrop(e) {
    if (!canEdit || uploading) return
    e.preventDefault()
    setIsDraggingOver(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length) handleFiles(files)
  }

  // Inline type-edit: optimistic update + persist + audit event. Reverts
  // on error so the badge can't drift away from the DB on a failed write.
  async function changeDocType(doc, nextType) {
    if (!canEdit || nextType === doc.document_type) {
      setEditingTypeFor(null)
      return
    }
    const prevType = doc.document_type
    setDocs(ds => ds.map(d => d.id === doc.id ? { ...d, document_type: nextType } : d))
    setEditingTypeFor(null)
    const { error: e } = await supabase
      .from(table)
      .update({ document_type: nextType })
      .eq('id', doc.id)
    if (e) {
      setDocs(ds => ds.map(d => d.id === doc.id ? { ...d, document_type: prevType } : d))
      emitToast({ kind: 'error', text: 'Could not change type: ' + e.message })
      return
    }
    if (purchaseId) {
      await logEvent(purchaseId, 'document_type_changed',
        `Changed type for "${doc.file_name}": ${labelFor(prevType, kind)} → ${labelFor(nextType, kind)}`,
        { document_id: doc.id, from: prevType, to: nextType, file_name: doc.file_name },
        user?.id)
    }
    emitToast({ kind: 'success', text: `Type changed to ${labelFor(nextType, kind)}` })
  }

  // Click-outside / Escape closes the inline-edit popover.
  useEffect(() => {
    if (!editingTypeFor) return
    function onDocClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setEditingTypeFor(null)
      }
    }
    function onKey(e) { if (e.key === 'Escape') setEditingTypeFor(null) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [editingTypeFor])

  async function downloadDoc(doc) {
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
    if (e) { toast.error("Couldn't download document", e); return }
    window.open(data.signedUrl, '_blank')
  }

  async function removeDoc(doc) {
    if (!canEdit) return
    if (!confirm(`Delete "${doc.file_name}"?`)) return
    await supabase.storage.from(BUCKET).remove([doc.file_path])
    await supabase.from(table).delete().eq('id', doc.id)
    if (purchaseId) {
      await logEvent(purchaseId, 'document_removed',
        `Removed ${doc.file_name}`,
        { kind, file_name: doc.file_name }, user?.id)
    }
    load()
  }

  return (
    <div
      className={`${S.card} p-4 space-y-3 transition-colors ${isDraggingOver ? 'ring-2 ring-cyan-400/60 bg-cyan-50/30 dark:bg-cyan-500/[0.05]' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{title}</p>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Select
              value={uploadType}
              onChange={e => setUploadType(e.target.value)}
              disabled={uploading}
            >
              {types.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </Select>
            <button
              onClick={pickFiles}
              disabled={uploading}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20 rounded-lg hover:bg-cyan-100 dark:hover:bg-cyan-500/20 transition-colors disabled:opacity-60"
            >
              {uploading
                ? (uploadProgress.total > 1
                    ? `Uploading ${uploadProgress.done} of ${uploadProgress.total}…`
                    : 'Uploading…')
                : '+ Upload'}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => { handleFiles(Array.from(e.target.files)); e.target.value = '' }}
            />
          </div>
        )}
      </div>

      {error && <div className={S.errorBox}>{error}</div>}

      {loading ? (
        <p className="text-xs text-gray-400 dark:text-slate-600">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-600 italic py-2">
          No documents yet
          {canEdit && <span className="ml-1">— drag files here or click + Upload</span>}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-white/5">
          {docs.map(d => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  {/* Inline-editable type badge. canEdit users get the
                      popover affordance; viewers see a plain pill. */}
                  {canEdit ? (
                    <div className="relative">
                      <button
                        onClick={() => setEditingTypeFor(editingTypeFor === d.id ? null : d.id)}
                        title="Click to change type"
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase transition-colors ${typeChipClass(d.document_type, true)}`}
                      >
                        {labelFor(d.document_type, kind)}
                        <svg className="w-2.5 h-2.5 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {editingTypeFor === d.id && (
                        <div
                          ref={popoverRef}
                          role="menu"
                          className="absolute z-30 mt-1 left-0 min-w-[12rem] bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl py-1"
                        >
                          {types.map(t => {
                            const isCurrent = t.v === d.document_type
                            return (
                              <button
                                key={t.v}
                                role="menuitem"
                                onClick={() => changeDocType(d, t.v)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                                  isCurrent
                                    ? 'bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-slate-300'
                                    : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
                                }`}
                              >
                                <span>{t.l}</span>
                                {isCurrent && <span className="text-emerald-600 dark:text-emerald-400">✓</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${typeChipClass(d.document_type, false)}`}>
                      {labelFor(d.document_type, kind)}
                    </span>
                  )}
                  <span className="text-gray-700 dark:text-slate-300 truncate">{d.file_name}</span>
                </div>
                <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
                  {fmtDate(d.uploaded_at)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => downloadDoc(d)} className="text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400" title="Download">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </button>
                {canEdit && (
                  <button onClick={() => removeDoc(d)} className="text-gray-400 hover:text-red-500" title="Delete">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Bulk-upload confirmation: catches accidental folder grabs */}
      <Modal open={!!pendingBatch} onClose={() => setPendingBatch(null)} title="Confirm bulk upload" size="sm">
        {pendingBatch && (
          <div className={S.modalBody}>
            <p className="text-sm text-gray-700 dark:text-slate-300">
              Upload <span className="font-semibold">{pendingBatch.length} files</span> as{' '}
              <span className="font-semibold">{labelFor(uploadType, kind)}</span>?
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-500">
              You can change the type on individual rows after upload by clicking the type badge.
            </p>
            <div className={S.modalFooter}>
              <button onClick={() => setPendingBatch(null)} className={S.btnCancel}>Cancel</button>
              <button onClick={confirmPendingBatch} className={S.btnSave}>Upload</button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  )
}

function labelFor(v, kind) {
  return TYPE_OPTIONS[kind].find(t => t.v === v)?.l || v
}
