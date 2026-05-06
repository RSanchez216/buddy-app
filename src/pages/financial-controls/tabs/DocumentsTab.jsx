import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { FC, DOCUMENT_TYPES, fmtDate } from '../loanUtils'

const BUCKET = 'loan-documents'

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  const n = Number(bytes)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function DocumentsTab({ loanId, canEdit, userRole, onChange }) {
  const { user } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()
  const [error, setError] = useState('')

  // Delete-confirmation modal state
  const [confirmDoc, setConfirmDoc] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Lightweight toast (auto-dismisses after 3s)
  const [toast, setToast] = useState(null)         // { kind: 'success'|'error', text }
  function showToast(kind, text) {
    setToast({ kind, text })
    setTimeout(() => setToast(t => (t && t.text === text ? null : t)), 3000)
  }

  useEffect(() => { load() /* eslint-disable-line */ }, [loanId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('loan_documents')
      .select('*, uploader:users!loan_documents_uploaded_by_fkey(full_name)')
      .eq('loan_id', loanId)
      .order('uploaded_at', { ascending: false })
    setDocs(data || [])
    setLoading(false)
  }

  async function handleFiles(fileList) {
    if (!canEdit || !fileList?.length) return
    setUploading(true); setError('')
    for (const file of fileList) {
      const ts = Date.now()
      const safeName = file.name.replace(/[^\w.-]/g, '_')
      const path = `${loanId}/${ts}_${safeName}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      })
      if (up.error) { setError('Upload failed: ' + up.error.message); break }
      const ins = await supabase.from('loan_documents').insert({
        loan_id: loanId,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type || null,
        document_type: 'other',
        uploaded_by: user?.id || null,
      })
      if (ins.error) { setError('DB insert failed: ' + ins.error.message); break }
    }
    setUploading(false)
    load()
    onChange?.()
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  async function changeType(doc, type) {
    if (!canEdit) return
    await supabase.from('loan_documents').update({ document_type: type }).eq('id', doc.id)
    load()
  }

  async function downloadDoc(doc) {
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
    if (e) { showToast('error', 'Download failed: ' + e.message); return }
    window.open(data.signedUrl, '_blank')
  }

  // Click filename = open in a new tab. Browser previews PDFs/images
  // inline; non-renderable types (.docx etc) trigger the native save
  // dialog — both are acceptable v1 behavior. Signed URL is generated
  // lazily on click rather than per-row at render time.
  async function openDoc(doc) {
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 3600)
    if (e) {
      console.error('Couldn\'t open document:', e)
      showToast('error', "Couldn't open document")
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  // DB row first, then storage object. If the DB delete fails we abort
  // and never touch storage. If the storage remove fails after the DB
  // succeeded, we keep the user-facing op as success — the orphaned
  // object is harmless and a maintenance script can sweep it later.
  async function confirmDelete() {
    if (!confirmDoc) return
    setDeleting(true); setDeleteError('')
    const doc = confirmDoc

    const { error: dbErr } = await supabase.from('loan_documents').delete().eq('id', doc.id)
    if (dbErr) {
      setDeleting(false)
      setDeleteError(dbErr.message)
      showToast('error', 'Delete failed: ' + dbErr.message)
      return
    }

    const { error: stErr } = await supabase.storage.from(BUCKET).remove([doc.file_path])
    if (stErr) {
      console.warn('Storage remove failed (DB row already deleted):', stErr.message, doc.file_path)
    }

    setDeleting(false)
    setConfirmDoc(null)
    showToast('success', 'Document deleted')
    load()
    onChange?.()
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
            dragOver
              ? 'border-orange-400 bg-orange-50 dark:bg-orange-500/5'
              : 'border-gray-300 dark:border-white/10 hover:border-orange-300 dark:hover:border-orange-500/30 hover:bg-gray-50 dark:hover:bg-white/[0.02]'
          }`}>
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
            {uploading ? 'Uploading…' : 'Drag & drop files here, or click to browse'}
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Multiple files supported</p>
          <input ref={fileRef} type="file" multiple className="hidden"
            onChange={e => { handleFiles(Array.from(e.target.files)); e.target.value = '' }} />
        </div>
      )}

      {error && <div className={S.errorBox}>{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
      ) : (
        <div className={`${S.card} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className={S.tableHead}>
              <tr>
                {['File', 'Size', 'Type', 'Uploaded By', 'Uploaded At', ''].map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No documents yet</td></tr>
              ) : docs.map(d => (
                <tr key={d.id} className={`${S.tableRow} group`}>
                  <td className={`${S.td} max-w-xs`}>
                    <button
                      onClick={() => openDoc(d)}
                      className="font-medium text-gray-900 dark:text-slate-200 hover:text-orange-600 dark:hover:text-orange-400 hover:underline truncate text-left max-w-full block"
                      title={`Open ${d.file_name}`}
                    >
                      {d.file_name}
                    </button>
                  </td>
                  <td className={`${S.td} text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap`}>{fmtSize(d.file_size)}</td>
                  <td className={S.td}>
                    {canEdit ? (
                      <Select className="w-36" value={d.document_type || 'other'} onChange={e => changeType(d, e.target.value)}>
                        {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-slate-400 capitalize">{d.document_type || 'other'}</span>
                    )}
                  </td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{d.uploader?.full_name || '—'}</td>
                  <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs whitespace-nowrap`}>{fmtDate(d.uploaded_at)}</td>
                  <td className={`${S.td} text-right whitespace-nowrap`}>
                    <button onClick={() => downloadDoc(d)} className="text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 mr-3" title="Download">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => { setDeleteError(''); setConfirmDoc(d) }}
                        className="text-gray-400 hover:text-red-500 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation modal */}
      <Modal open={!!confirmDoc} onClose={() => !deleting && setConfirmDoc(null)} title="Delete document?" size="sm">
        <div className={S.modalBody}>
          {deleteError && <div className={S.errorBox}>{deleteError}</div>}
          <p className="text-sm text-gray-700 dark:text-slate-300">
            Delete <span className="font-mono font-semibold break-all">{confirmDoc?.file_name}</span>?
            This cannot be undone.
          </p>
          <div className={S.modalFooter}>
            <button
              onClick={() => setConfirmDoc(null)}
              disabled={deleting}
              className={S.btnCancel}
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="px-4 py-2 text-sm font-semibold bg-red-500 hover:bg-red-400 disabled:opacity-60 text-white rounded-xl transition-all"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
             role="status"
             style={{
               borderColor: toast.kind === 'success' ? 'rgb(110 231 183 / 0.4)' : 'rgb(252 165 165 / 0.6)',
             }}>
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${toast.kind === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">{toast.text}</div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
