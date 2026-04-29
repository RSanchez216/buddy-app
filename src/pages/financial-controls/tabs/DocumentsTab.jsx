import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
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

export default function DocumentsTab({ loanId, canEdit, userRole }) {
  const { user } = useAuth()
  const isAdmin = userRole === 'admin'
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()
  const [error, setError] = useState('')

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
    if (e) { alert('Download failed: ' + e.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function deleteDoc(doc) {
    if (!isAdmin) return
    if (!confirm(`Delete "${doc.file_name}"?`)) return
    await supabase.storage.from(BUCKET).remove([doc.file_path])
    await supabase.from('loan_documents').delete().eq('id', doc.id)
    load()
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
                <tr key={d.id} className={S.tableRow}>
                  <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200 truncate max-w-xs`} title={d.file_name}>{d.file_name}</td>
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
                    {isAdmin && (
                      <button onClick={() => deleteDoc(d)} className="text-gray-400 hover:text-red-500" title="Delete (admin only)">
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
    </div>
  )
}
