import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ACCEPT_ATTR, ACCEPTED_HINT, DOC_TYPES, docTypeLabel, fileKind, fmtBytes, fmtUploadedAt,
  listDocuments, uploadDocument, removeDocument, signedUrl, signedDownloadUrl, validateFile,
} from './officeDocsData'

// One documents module, three surfaces:
//   <DocsChip>        the table cell — count + click target
//   <DocumentsPopover> mode 'live'   — parent exists, uploads immediately
//   <StagedFiles>     mode 'staged'  — parent doesn't exist yet, held in memory
//                                      and flushed by the modal after insert
//
// Errors are always inline. alert()/confirm() block the page and the browser
// automation this gets verified with, so removal confirms in the row itself.

// ── The table cell ──────────────────────────────────────────────────────────
export function DocsChip({ count = 0, open, onClick }) {
  const base = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors'
  const cls = open
    ? 'bg-cyan-500 text-white border-cyan-500'
    : count > 0
      ? 'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30 hover:bg-cyan-100 dark:hover:bg-cyan-500/25'
      : 'border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}
      title={count > 0 ? `${count} document${count === 1 ? '' : 's'}` : 'Attach a document'}>
      <Clip />
      {count > 0 ? count : 'Add'}
    </button>
  )
}

function Clip({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

// ── mode: 'live' — the table popover ────────────────────────────────────────
// Portalled: the table sits inside a `overflow-hidden` card, which clips any
// in-flow absolute child regardless of z-index.
export function DocumentsPopover({ anchorRef, expense, officeName, canEdit, onClose, onCountChange, toast }) {
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rejects, setRejects] = useState([])   // [{ name, reason }]
  const [confirmId, setConfirmId] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [pos, setPos] = useState(null)
  const popRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const d = await listDocuments('expense', expense.id)
      setDocs(d)
      onCountChange?.(expense.id, d.length)
    } catch (e) {
      setError(e?.message || 'Could not load documents.')
      setDocs([])
    }
  }, [expense.id, onCountChange])

  useEffect(() => { load() }, [load])

  useLayoutEffect(() => {
    const place = () => {
      const r = anchorRef?.current?.getBoundingClientRect()
      if (!r) return
      const W = 420, H = 360
      const below = window.innerHeight - r.bottom
      setPos({
        top: below < H + 12 && r.top > H + 12 ? Math.max(8, r.top - H - 6) : r.bottom + 6,
        left: Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8)),
        width: W,
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchorRef])

  useEffect(() => {
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchorRef, onClose])

  async function addFiles(fileList) {
    const files = [...(fileList || [])]
    if (!files.length) return
    setError(''); setRejects([]); setBusy(true)
    const bad = []
    for (const f of files) {
      const v = validateFile(f)
      if (!v.ok) { bad.push({ name: f.name, reason: v.reason }); continue }
      try {
        await uploadDocument({ officeId: expense.office_id, parentKind: 'expense', parentId: expense.id, file: f })
      } catch (e) {
        bad.push({ name: f.name, reason: e?.message || 'Upload failed' })
      }
    }
    setRejects(bad)
    if (bad.length === 0) toast?.success(files.length === 1 ? 'Document attached' : `${files.length} documents attached`)
    await load()
    setBusy(false)
  }

  async function open(doc, download) {
    try {
      const url = download ? await signedDownloadUrl(doc.file_path, doc.file_name) : await signedUrl(doc.file_path)
      if (url) window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError(e?.message || 'Could not open the file.')
    }
  }

  async function doRemove(doc) {
    setBusy(true); setError('')
    try {
      await removeDocument(doc.id)
      setConfirmId(null)
      await load()
      toast?.success('Document removed')
    } catch (e) {
      setError(e?.message || 'Could not remove the document.')
    } finally { setBusy(false) }
  }

  if (!pos) return null

  return createPortal(
    <div ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
      className="z-[120] rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0d0d1f] shadow-2xl flex flex-col max-h-[360px]">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5 border-b border-gray-100 dark:border-white/5 shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-bold text-gray-900 dark:text-white truncate">
            Documents{expense.description ? ` · ${expense.description}` : ''}
          </p>
        </div>
        <p className="text-[11px] text-gray-400 dark:text-slate-500 shrink-0">
          {officeName} · {docs?.length ?? 0} file{(docs?.length ?? 0) === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
        {error && <div className="text-[11px] text-red-600 dark:text-red-400 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-2 py-1.5">{error}</div>}
        {rejects.map(r => (
          <div key={r.name} className="text-[11px] text-amber-700 dark:text-amber-400 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2 py-1.5">
            <span className="font-medium break-all">{r.name}</span> — {r.reason}
          </div>
        ))}

        {docs === null ? (
          <div className="h-12 rounded-lg bg-gray-100 dark:bg-white/5 animate-pulse" />
        ) : docs.length === 0 ? (
          <p className="text-[11px] text-gray-400 dark:text-slate-500 italic py-2">Nothing attached yet.</p>
        ) : docs.map(d => (
          <div key={d.id} className="rounded-lg border border-gray-200 dark:border-white/10 px-2 py-1.5">
            <div className="flex items-start gap-2">
              <span className="shrink-0 mt-px px-1 py-0.5 rounded text-[9px] font-bold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-slate-300">{fileKind(d)}</span>
              {/* Wraps rather than truncating — these names carry invoice numbers. */}
              <p className="text-[11px] text-gray-800 dark:text-slate-200 break-all min-w-0 leading-snug">{d.file_name}</p>
              <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/30">
                {docTypeLabel(d.document_type)}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">
              {fmtBytes(d.file_size_bytes)} · {d.uploaded_by_name || 'Unknown'} · {fmtUploadedAt(d.uploaded_at)}
            </p>
            {confirmId === d.id ? (
              <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                <span className="text-gray-600 dark:text-slate-300">Remove this file?</span>
                <button disabled={busy} onClick={() => doRemove(d)} className="font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50">Remove</button>
                <button onClick={() => setConfirmId(null)} className="text-gray-400 hover:underline">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-3 mt-1 text-[11px]">
                <button onClick={() => open(d, false)} className="font-medium text-cyan-700 dark:text-cyan-400 hover:underline">View</button>
                <button onClick={() => open(d, true)} className="font-medium text-gray-500 dark:text-slate-400 hover:underline">Download</button>
                {canEdit && <button onClick={() => setConfirmId(d.id)} className="ml-auto text-gray-400 hover:text-red-500">Remove</button>}
              </div>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <div className="shrink-0 border-t border-gray-100 dark:border-white/5 p-2.5">
          <DropZone busy={busy} dragging={dragging} setDragging={setDragging} onFiles={addFiles} />
        </div>
      )}
    </div>,
    document.body,
  )
}

function DropZone({ busy, dragging, setDragging, onFiles, compact }) {
  const inputRef = useRef(null)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files) }}
      className={`rounded-lg border border-dashed text-center transition-colors ${compact ? 'py-2' : 'py-3'} ${
        dragging ? 'border-cyan-400 bg-cyan-50/60 dark:bg-cyan-500/10' : 'border-gray-300 dark:border-slate-600'
      }`}>
      <p className="text-[11px] text-gray-500 dark:text-slate-400">
        {busy ? 'Uploading…' : (
          <>Drop files here or{' '}
            <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-cyan-700 dark:text-cyan-400 hover:underline">browse</button>
          </>
        )}
      </p>
      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{ACCEPTED_HINT}</p>
      <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden"
        onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
    </div>
  )
}

// ── mode: 'staged' — modals ─────────────────────────────────────────────────
// The caller owns the array, so cancelling the modal drops it and nothing was
// ever written. flushStaged() in officeDocuments.js does the upload afterwards.
export function StagedFiles({ files, onChange, multiple = true, label, docTypeNote, compact }) {
  const [dragging, setDragging] = useState(false)
  const [rejects, setRejects] = useState([])

  function add(fileList) {
    const incoming = [...(fileList || [])]
    if (!incoming.length) return
    const ok = [], bad = []
    for (const f of incoming) {
      const v = validateFile(f)
      v.ok ? ok.push(f) : bad.push({ name: f.name, reason: v.reason })
    }
    setRejects(bad)
    onChange(multiple ? [...files, ...ok] : ok.slice(0, 1))
  }
  const drop = (i) => onChange(files.filter((_, j) => j !== i))

  return (
    <div>
      {label && <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">{label}</label>}
      {files.length > 0 && (
        <div className="space-y-1 mb-1.5">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50/70 dark:bg-cyan-500/10 px-2 py-1">
              <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-white/70 dark:bg-white/10 text-cyan-800 dark:text-cyan-300">{fileKind(f)}</span>
              <span className="text-[11px] text-gray-800 dark:text-slate-200 break-all min-w-0 leading-snug">{f.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-gray-500 dark:text-slate-400 tabular-nums">{fmtBytes(f.size)}</span>
              <button type="button" onClick={() => drop(i)} aria-label={`Remove ${f.name}`}
                className="shrink-0 text-gray-400 hover:text-red-500">✕</button>
            </div>
          ))}
        </div>
      )}
      {rejects.map(r => (
        <div key={r.name} className="text-[11px] text-amber-700 dark:text-amber-400 mb-1.5 break-all">
          <span className="font-medium">{r.name}</span> — {r.reason}
        </div>
      ))}
      {(multiple || files.length === 0) && (
        <DropZone busy={false} dragging={dragging} setDragging={setDragging} onFiles={add} compact={compact} />
      )}
      {docTypeNote && <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{docTypeNote}</p>}
    </div>
  )
}

// A compact staged trigger for a table row — chip in, popover-less. Opens a
// hidden file input directly; the staged list renders under the rows.
export function StagedRowChip({ count, onFiles }) {
  const inputRef = useRef(null)
  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()}
        title={count > 0 ? `${count} file${count === 1 ? '' : 's'} ready to attach` : 'Attach files to this expense'}
        className={`w-full inline-flex items-center justify-center gap-1 px-1.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-colors ${
          count > 0
            ? 'bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/30'
            : 'border-dashed border-gray-300 dark:border-slate-600 text-gray-400 dark:text-slate-500 hover:border-cyan-400 hover:text-cyan-600'
        }`}>
        <Clip className="w-3 h-3" />
        {count > 0 ? count : 'Attach'}
      </button>
      <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden"
        onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
    </>
  )
}

export { DOC_TYPES }
