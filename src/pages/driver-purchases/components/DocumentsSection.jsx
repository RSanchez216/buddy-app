import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Select from '../../../components/Select'
import { logEvent } from '../utils/events'
import { fmtDate } from '../utils/format'

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
    { v: 'signed_contract', l: 'Signed contract' },
    { v: 'bill_of_sale',    l: 'Bill of sale' },
    { v: 'title',           l: 'Title' },
    { v: 'payoff_letter',   l: 'Payoff letter' },
    { v: 'other',           l: 'Other' },
  ],
}

// Reusable docs section. Pass kind='driver' for driver-level docs (keyed
// off driver_id) or kind='contract' for purchase-level docs (keyed off
// driver_purchase_id and stored under purchases/{id}/).
export default function DocumentsSection({ kind, ownerId, purchaseId, canEdit, title }) {
  const { user } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadType, setUploadType] = useState(TYPE_OPTIONS[kind][0].v)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

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

  async function handleFiles(files) {
    if (!canEdit || !files?.length) return
    setUploading(true); setError('')
    for (const file of files) {
      const ts = Date.now()
      const safe = file.name.replace(/[^\w.-]/g, '_')
      const path = kind === 'driver'
        ? `drivers/${ownerId}/${ts}_${safe}`
        : `purchases/${ownerId}/${ts}_${safe}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type, cacheControl: '3600', upsert: false,
      })
      if (up.error) { setError('Upload failed: ' + up.error.message); break }
      const insertPayload = kind === 'driver'
        ? { driver_id: ownerId, document_type: uploadType, file_path: path, file_name: file.name, uploaded_by: user?.id || null }
        : { driver_purchase_id: ownerId, document_type: uploadType, file_path: path, file_name: file.name, uploaded_by: user?.id || null }
      const ins = await supabase.from(table).insert(insertPayload)
      if (ins.error) { setError('Save failed: ' + ins.error.message); break }
      if (purchaseId) {
        await logEvent(purchaseId, 'document_added',
          `Uploaded ${file.name} (${labelFor(uploadType, kind)})`,
          { kind, document_type: uploadType, file_name: file.name }, user?.id)
      }
    }
    setUploading(false)
    load()
  }

  async function downloadDoc(doc) {
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
    if (e) { alert('Download failed: ' + e.message); return }
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
    <div className={`${S.card} p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">{title}</p>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Select value={uploadType} onChange={e => setUploadType(e.target.value)}>
              {types.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </Select>
            <button
              onClick={pickFiles}
              disabled={uploading}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/20 rounded-lg hover:bg-cyan-100 dark:hover:bg-cyan-500/20 transition-colors disabled:opacity-60"
            >
              {uploading ? 'Uploading…' : '+ Upload'}
            </button>
            <input
              ref={fileRef}
              type="file"
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
        <p className="text-xs text-gray-400 dark:text-slate-600 italic py-2">No documents yet</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-white/5">
          {docs.map(d => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400 font-semibold uppercase">
                    {labelFor(d.document_type, kind)}
                  </span>
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
    </div>
  )
}

function labelFor(v, kind) {
  return TYPE_OPTIONS[kind].find(t => t.v === v)?.l || v
}
