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
// NOTE: intentionally NOT importing 'tippy.js/dist/tippy.css'. Its
// default dark .tippy-box theme bled through behind our MentionList
// card and made the @ popup look like it came from a different design
// system. MentionList paints its own full surface (light/dark aware),
// and tippy is configured with theme:'buddy-naked' below to stay
// visually transparent. See src/index.css for the override.

const BUCKET = 'comment-attachments'

// Rich-text composer for activity-feed comments.
// Submit creates a row in driver_purchase_comments + uploads any
// attachments. The mention trigger uses @-suggestion that filters
// active BUDDY users from public.users.
//
// In edit mode (initialContent + commentId), saves an UPDATE that
// recomputes body_text and mentioned_user_ids; new mentions added during
// edit do NOT fire the notification trigger (only INSERT does).
export default function CommentComposer({
  purchaseId,
  initialContent,
  commentId,                       // when set, edit mode
  onSubmitted,
  onCancel,
  placeholder = 'Write a comment…  (@ to mention, Cmd/Ctrl+Enter to send)',
}) {
  const { user } = useAuth()
  const isEdit = !!commentId

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])
  const fileRef = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,         // no H1/H2 needed in a comment
      }),
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
        // Cmd/Ctrl+Enter submits
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          // Use the latest snapshot
          const json = view.state.doc.toJSON()
          submitWith(json)
          return true
        }
        return false
      },
    },
  })

  // Keep submit handler stable but reading current editor
  async function submit() {
    if (!editor) return
    const json = editor.getJSON()
    return submitWith(json)
  }

  async function submitWith(json) {
    if (!user?.id) { setError('Not signed in'); return }
    if (busy) return
    if (isEmptyDoc(json) && pendingFiles.length === 0) {
      setError('Add some text or an attachment')
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
      if (e) { setError(e.message); setBusy(false); return }
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
      if (e) { setError(e.message); setBusy(false); return }
      row = data
    }

    // Upload attachments (only on create — edits don't accept new files for now)
    if (!isEdit && pendingFiles.length) {
      for (const file of pendingFiles) {
        const ts = Date.now()
        const safe = file.name.replace(/[^\w.-]/g, '_')
        const path = `${row.id}/${ts}_${safe}`
        const up = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type, cacheControl: '3600', upsert: false,
        })
        if (up.error) { setError('Upload failed: ' + up.error.message); break }
        const ins = await supabase.from('comment_attachments').insert({
          comment_id: row.id,
          file_path: path,
          file_name: file.name,
          file_size_bytes: file.size,
          content_type: file.type || null,
          uploaded_by: user.id,
        })
        if (ins.error) { setError('Save failed: ' + ins.error.message); break }
      }
    }

    setBusy(false)
    setPendingFiles([])
    if (!isEdit) editor.commands.clearContent()
    onSubmitted?.(row.id)
  }

  function pickFiles() { fileRef.current?.click() }

  function onFiles(list) {
    setPendingFiles(prev => [...prev, ...Array.from(list)])
  }

  function removeFile(idx) {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }

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
    <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-cyan-500/30">
      {error && <div className="px-3 pt-2 text-xs text-red-600 dark:text-red-400">{error}</div>}

      <EditorContent editor={editor} placeholder={placeholder} />

      {/* Pending attachments */}
      {pendingFiles.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {pendingFiles.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full bg-gray-100 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656L4.586 11.586a6 6 0 008.485 8.485L20 13" />
              </svg>
              {f.name}
              <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500" title="Remove">×</button>
            </span>
          ))}
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
            <button onClick={pickFiles} className={btn} title="Attach a file">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656L4.586 11.586a6 6 0 008.485 8.485L20 13" /></svg>
            </button>
          )}
          <input ref={fileRef} type="file" multiple className="hidden"
                 onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
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
