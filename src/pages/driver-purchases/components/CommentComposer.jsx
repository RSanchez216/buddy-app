import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import Link from '@tiptap/extension-link'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import { mentionSuggestion } from '../utils/mentionSuggestion'
import { extractText, extractMentions, isEmptyDoc } from '../utils/comments'
import { useToast } from '../../../contexts/ToastContext'
// NOTE: intentionally NOT importing 'tippy.js/dist/tippy.css'. See
// src/index.css for the buddy-naked theme override.

const BUCKET = 'comment-attachments'
const MAX_BYTES = 10 * 1024 * 1024              // 10 MB soft cap
const EXT_FROM_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

// Rich-text composer for activity-feed comments.
//
// Attachments flow:
//   • Paperclip / paste / drag-drop all funnel through addFile().
//   • addFile() begins an async upload to comment-attachments under
//     {purchase_id}/{uuid}_{name}, while immediately rendering a local
//     preview (objectURL for images, pill for non-images).
//   • Submit blocks if any item is still 'uploading' — we await the
//     in-flight promises rather than refusing the post.
//   • On submit: comment row → comment_attachments rows referencing
//     each ready item's storage_path.
//   • On remove (×): if the item already finished uploading, the
//     storage object is deleted; objectURL is revoked either way.
//
// Edit mode (initialContent + commentId) only saves text changes — the
// attachments toolbar is hidden. New mentions added during edit do NOT
// fire the notification trigger (only INSERT does).
export default function CommentComposer({
  purchaseId,
  initialContent,
  commentId,
  onSubmitted,
  onCancel,
  placeholder = 'Write a comment…  (@ to mention, paste/drop images, Cmd/Ctrl+Enter to send)',
}) {
  const { user } = useAuth()
  const toast = useToast()
  const isEdit = !!commentId

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState([])     // see addFile() for shape
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)
  // Track in-flight upload promises so submit can await them.
  const uploadPromises = useRef(new Map())       // localId → Promise

  function pushError(msg) { setError(msg); setTimeout(() => setError(e => e === msg ? '' : e), 4000) }

  // ── Pending-attachment lifecycle ───────────────────────────────────
  function addFiles(files) {
    if (isEdit) return
    if (!files || files.length === 0) return
    const arr = Array.from(files)
    for (const f of arr) addFile(f)
  }

  function addFile(file, { fromClipboard = false } = {}) {
    if (file.size > MAX_BYTES) {
      pushError(`${file.name || 'Image'} too large. Maximum size: 10 MB`)
      return
    }
    const isImg = (file.type || '').startsWith('image/')

    // Clipboard images often arrive as 'image.png' or empty name; rename
    // for traceability in the DB.
    let name = file.name && file.name !== 'image.png' ? file.name : null
    if (!name) {
      const ext = EXT_FROM_MIME[file.type] || 'bin'
      name = `pasted-${Date.now()}.${ext}`
    } else if (fromClipboard && /^image\.(png|jpg|jpeg|gif|webp)$/i.test(name)) {
      const ext = name.split('.').pop()
      name = `pasted-${Date.now()}.${ext}`
    }

    const localId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`

    const previewUrl = isImg ? URL.createObjectURL(file) : null

    const item = {
      localId,
      file_name: name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
      is_image: isImg,
      preview_url: previewUrl,
      status: 'uploading',
      storage_path: null,
      error: null,
    }
    setPending(prev => [...prev, item])

    const safe = name.replace(/[^\w.-]/g, '_')
    const path = `${purchaseId}/${localId}_${safe}`

    const p = (async () => {
      const up = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type, cacheControl: '3600', upsert: false,
      })
      if (up.error) {
        setPending(prev => prev.map(x => x.localId === localId
          ? { ...x, status: 'error', error: up.error.message } : x))
        pushError(`Upload failed: ${up.error.message}`)
        return
      }
      setPending(prev => prev.map(x => x.localId === localId
        ? { ...x, status: 'ready', storage_path: path } : x))
    })()

    uploadPromises.current.set(localId, p)
    p.finally(() => uploadPromises.current.delete(localId))
  }

  async function removeFile(localId) {
    const item = pending.find(x => x.localId === localId)
    if (!item) return
    // If it's already up there, clean up storage. Best effort.
    if (item.status === 'ready' && item.storage_path) {
      supabase.storage.from(BUCKET).remove([item.storage_path]).catch(() => {})
    }
    if (item.preview_url) URL.revokeObjectURL(item.preview_url)
    setPending(prev => prev.filter(x => x.localId !== localId))
  }

  // Free objectURLs when the composer unmounts
  useEffect(() => {
    return () => {
      for (const p of pending) if (p.preview_url) URL.revokeObjectURL(p.preview_url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Tiptap ────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'text-cyan-600 dark:text-cyan-400 underline' },
      }),
      Mention.configure({
        HTMLAttributes: { class: 'mention-chip' },
        renderText: ({ node }) => `@${node.attrs.label || node.attrs.id}`,
        suggestion: mentionSuggestion,
      }),
    ],
    content: initialContent || '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[80px] focus:outline-none px-3 py-2 ' +
          'text-sm text-gray-700 dark:text-slate-300',
      },
      handleKeyDown(view, event) {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          const json = view.state.doc.toJSON()
          submitWith(json)
          return true
        }
        return false
      },
      handlePaste(view, event) {
        if (isEdit) return false
        const cd = event.clipboardData
        if (!cd) return false
        const imgs = []
        for (const item of (cd.items || [])) {
          if (item.kind === 'file' && (item.type || '').startsWith('image/')) {
            const f = item.getAsFile()
            if (f) imgs.push(f)
          }
        }
        if (imgs.length === 0) return false      // let default paste run
        event.preventDefault()
        for (const f of imgs) addFile(f, { fromClipboard: true })
        return true
      },
      handleDrop(view, event) {
        if (isEdit) return false
        const dt = event.dataTransfer
        if (!dt || !dt.files || dt.files.length === 0) return false
        event.preventDefault()
        addFiles(dt.files)
        setDragOver(false)
        return true
      },
    },
  })

  // ── Submit ────────────────────────────────────────────────────────
  async function submit() {
    if (!editor) return
    return submitWith(editor.getJSON())
  }

  async function submitWith(json) {
    if (!user?.id) { pushError('Not signed in'); return }
    if (busy) return

    // Wait for any in-flight uploads (option (b) in the spec).
    if (uploadPromises.current.size > 0) {
      setBusy(true)
      await Promise.allSettled(Array.from(uploadPromises.current.values()))
    }

    // After awaiting, refresh the pending snapshot we'll act on.
    const snapshot = pending
    const ready = snapshot.filter(p => p.status === 'ready')
    const errored = snapshot.filter(p => p.status === 'error')

    if (errored.length > 0) {
      setBusy(false)
      pushError('Some attachments failed to upload. Remove them or retry before posting.')
      return
    }

    if (isEmptyDoc(json) && ready.length === 0) {
      setBusy(false)
      pushError('Add some text or an attachment')
      return
    }

    setBusy(true); setError('')

    const body_text = extractText(json)
    const mentioned_user_ids = extractMentions(json)

    let row
    if (isEdit) {
      const { data, error: e } = await supabase
        .from('driver_purchase_comments')
        .update({
          body_json: json,
          body_text,
          mentioned_user_ids,
          edited_at: new Date().toISOString(),
        })
        .eq('id', commentId)
        .select('id')
        .single()
      if (e) { setError(e.message); setBusy(false); toast.error(isEdit ? "Couldn't update comment" : "Couldn't post comment", e); return }
      row = data
    } else {
      const { data, error: e } = await supabase
        .from('driver_purchase_comments')
        .insert({
          driver_purchase_id: purchaseId,
          body_json: json,
          body_text,
          mentioned_user_ids,
          created_by: user.id,
        })
        .select('id')
        .single()
      if (e) { setError(e.message); setBusy(false); toast.error(isEdit ? "Couldn't update comment" : "Couldn't post comment", e); return }
      row = data
    }

    // Insert attachment rows for already-uploaded objects (create only).
    if (!isEdit && ready.length > 0) {
      const inserts = ready.map(p => ({
        comment_id: row.id,
        file_path: p.storage_path,
        file_name: p.file_name,
        file_size_bytes: p.size,
        content_type: p.content_type,
        uploaded_by: user.id,
      }))
      const ins = await supabase.from('comment_attachments').insert(inserts)
      if (ins.error) {
        // Comment already exists; surface the partial failure but don't
        // try to roll back. User can retry the attachments via edit.
        setError(`Comment posted but attachment save failed: ${ins.error.message}`)
      }
    }

    // Free local objectURLs now that the upload is done.
    for (const p of pending) if (p.preview_url) URL.revokeObjectURL(p.preview_url)

    setBusy(false)
    setPending([])
    if (!isEdit) editor.commands.clearContent()
    toast.success(isEdit ? 'Comment updated' : 'Comment posted')
    onSubmitted?.(row.id)
  }

  function pickFiles() { fileRef.current?.click() }

  function insertMentionTrigger() {
    if (!editor) return
    editor.chain().focus().insertContent('@').run()
  }
  function insertLink() {
    const url = window.prompt('Enter URL:')
    if (!url) return
    editor.chain().focus().setLink({ href: url, target: '_blank' }).run()
  }

  // Reset when initial content changes (entering edit mode)
  useEffect(() => {
    if (editor && initialContent) editor.commands.setContent(initialContent)
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [initialContent])

  if (!editor) return null

  const btn =
    'p-1.5 rounded text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-slate-200 transition-colors'
  const btnActive =
    'p-1.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 transition-colors'

  return (
    <div
      onDragOver={(e) => { if (isEdit) return; e.preventDefault(); setDragOver(true) }}
      onDragLeave={(e) => {
        // Only clear when actually leaving the wrapper, not bubbling out of children
        if (e.currentTarget.contains(e.relatedTarget)) return
        setDragOver(false)
      }}
      onDrop={(e) => {
        if (isEdit) return
        e.preventDefault(); setDragOver(false)
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
      }}
      className={`bg-white dark:bg-[#0d0d1f] border rounded-2xl overflow-hidden transition-colors ${
        dragOver
          ? 'border-cyan-400 dark:border-cyan-500/60 ring-2 ring-cyan-500/30'
          : 'border-gray-200 dark:border-white/10 focus-within:ring-2 focus-within:ring-cyan-500/30'
      }`}
    >
      {error && <div className="px-3 pt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}

      <EditorContent editor={editor} placeholder={placeholder} />

      {/* Pending attachments — image thumbs + non-image pills */}
      {pending.length > 0 && (
        <div className="px-3 pb-2 space-y-1.5">
          {pending.some(p => p.is_image) && (
            <div className="flex flex-wrap gap-2">
              {pending.filter(p => p.is_image).map(p => (
                <PendingThumb key={p.localId} item={p} onRemove={() => removeFile(p.localId)} />
              ))}
            </div>
          )}
          {pending.some(p => !p.is_image) && (
            <div className="flex flex-wrap gap-1.5">
              {pending.filter(p => !p.is_image).map(p => (
                <PendingPill key={p.localId} item={p} onRemove={() => removeFile(p.localId)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Toolbar + submit */}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-gray-100 dark:border-white/5">
        <div className="flex items-center gap-0.5">
          <button onClick={() => editor.chain().focus().toggleBold().run()}
                  className={editor.isActive('bold') ? btnActive : btn}
                  title="Bold (Cmd+B)">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6V4zM6 12h9a4 4 0 014 4 4 4 0 01-4 4H6v-8z" /></svg>
          </button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={editor.isActive('italic') ? btnActive : btn}
                  title="Italic (Cmd+I)">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 4h-9M14 20H5M15 4L9 20" /></svg>
          </button>
          <button onClick={() => editor.chain().focus().toggleBulletList().run()}
                  className={editor.isActive('bulletList') ? btnActive : btn}
                  title="Bullet list">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6h.01M4 12h.01M4 18h.01M8 6h12M8 12h12M8 18h12" /></svg>
          </button>
          <button onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  className={editor.isActive('orderedList') ? btnActive : btn}
                  title="Ordered list">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 6h2m-2 6h2m-2 6h2m4-12h12M9 12h12M9 18h12" /></svg>
          </button>
          <button onClick={insertLink} className={editor.isActive('link') ? btnActive : btn} title="Link">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </button>
          <span className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-1" />
          <button onClick={insertMentionTrigger} className={btn} title="Mention a user (@)">
            <span className="text-sm font-semibold">@</span>
          </button>
          {!isEdit && (
            <button onClick={pickFiles} className={btn} title="Attach a file (or paste / drop)">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656L4.586 11.586a6 6 0 008.485 8.485L20 13" /></svg>
            </button>
          )}
          <input ref={fileRef} type="file" multiple className="hidden"
                 onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        </div>

        <div className="flex items-center gap-2">
          {isEdit && (
            <button onClick={onCancel} className="text-xs text-gray-500 dark:text-slate-400 hover:underline">
              Cancel
            </button>
          )}
          <button
            onClick={submit}
            disabled={busy}
            className="px-3 py-1 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-900 rounded-lg transition-all"
          >
            {busy ? (isEdit ? 'Saving…' : 'Posting…') : (isEdit ? 'Save' : 'Comment')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Pending-attachment renderers ──────────────────────────────────────
function PendingThumb({ item, onRemove }) {
  return (
    <div className="relative w-[120px] h-[80px] rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-white/5 group">
      {item.preview_url && (
        <img
          src={item.preview_url}
          alt={item.file_name}
          className="w-full h-full object-cover"
        />
      )}
      {item.status === 'uploading' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
        </div>
      )}
      {item.status === 'error' && (
        <div className="absolute inset-0 bg-red-500/70 flex items-center justify-center text-white text-[10px] font-semibold uppercase tracking-wide">
          Failed
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white text-xs flex items-center justify-center"
        title="Remove"
      >
        ×
      </button>
    </div>
  )
}

function PendingPill({ item, onRemove }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full ${
      item.status === 'error'
        ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
        : 'bg-gray-100 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300'
    }`}>
      {item.status === 'uploading' ? (
        <span className="inline-block w-3 h-3 rounded-full border-2 border-gray-300 border-t-transparent animate-spin" />
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656L4.586 11.586a6 6 0 008.485 8.485L20 13" />
        </svg>
      )}
      <span className="truncate max-w-[12rem]">{item.file_name}</span>
      <button onClick={onRemove} className="text-gray-400 hover:text-red-500" title="Remove">×</button>
    </span>
  )
}
