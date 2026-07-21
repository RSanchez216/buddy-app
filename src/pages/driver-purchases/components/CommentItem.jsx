import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import CommentBody from './CommentBody'
import CollapsibleBody from './CollapsibleBody'
import Attachments from './Attachments'
import { fmtDateTime, fmtRelative } from '../utils/format'

// Minimal Tiptap doc from plain text — a single paragraph with hardBreaks
// between lines so multi-line week-lists keep their line breaks when
// re-rendered. v1 inline edits only touch wording, so we don't re-parse
// mentions/marks; mentioned_user_ids is left as-is on save.
function textToDoc(text) {
  const lines = String(text ?? '').split('\n')
  const content = []
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line })
  })
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}

// Single comment row in the activity feed. Renders avatar, name, body
// (collapsed if long), mention chips, attachments. The body is click-to-edit
// inline for the author or an admin (blur/Enter saves, Esc cancels); the ⋯
// menu offers the same Edit plus Copy link and Delete. System/audit events
// are rendered elsewhere and are never editable. Deleted comments are
// filtered out upstream in ActivityFeed.
export default function CommentItem({ row, currentUserId, isAdmin, highlight, onToast }) {
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  // Optimistic override of body_text/body_json/edited_at after a save, held
  // until realtime brings the server row in sync (see reconcile effect).
  const [localBody, setLocalBody] = useState(null)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const wrapperRef = useRef(null)
  const taRef = useRef(null)
  // Set when Escape cancels, so the resulting blur doesn't save.
  const skipBlurSave = useRef(false)

  const isOwn = row.created_by === currentUserId
  const canEditInline = isOwn || isAdmin
  const canDelete = isOwn || isAdmin

  // Effective body — the optimistic override wins until the server catches up.
  const bodyText = localBody ? localBody.text : row.body_text
  const bodyJson = localBody ? localBody.json : row.body_json
  const editedAt = localBody ? localBody.edited_at : row.edited_at

  // Once realtime refetch delivers the saved text, drop the local override so
  // a later edit by someone else isn't masked by our stale copy.
  useEffect(() => {
    if (localBody && row.body_text === localBody.text) setLocalBody(null)
  }, [row.body_text, localBody])

  function autosize(ta) {
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }

  // Focus the textarea at the end + size it to content when edit mode opens.
  useEffect(() => {
    if (!editing) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    const len = ta.value.length
    ta.setSelectionRange(len, len)
    autosize(ta)
  }, [editing])

  function enterEdit() {
    if (!canEditInline || editing) return
    setMenuOpen(false)
    setDraft(bodyText || '')
    setEditing(true)
  }

  // Ignore clicks that land on an interactive child (Show more, links) so
  // those keep working; anything else in the body opens the inline editor.
  function onBodyClick(e) {
    if (e.target.closest('button, a')) return
    enterEdit()
  }

  function cancelEdit() {
    skipBlurSave.current = true
    setEditing(false)
    setDraft('')
  }

  function onEditKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.blur()   // blur handler performs the save
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  function onEditBlur() {
    if (skipBlurSave.current) { skipBlurSave.current = false; return }
    saveEdit()
  }

  async function saveEdit() {
    if (saving) return
    const next = draft.trim()
    const current = (bodyText || '').trim()
    setEditing(false)
    // No-op on unchanged (don't write / don't stamp edited_at). Empty text is
    // treated as a cancel — deletion goes through the explicit Delete action.
    if (next === '' || next === current) return

    const nowIso = new Date().toISOString()
    const nextJson = textToDoc(next)
    const prevOverride = localBody
    setLocalBody({ text: next, json: nextJson, edited_at: nowIso })   // optimistic
    setSaving(true); setError('')

    // Preserve mentioned_user_ids as-is (v1 edits wording, not mentions).
    const { error: e } = await supabase
      .from('driver_purchase_comments')
      .update({ body_text: next, body_json: nextJson, edited_at: nowIso })
      .eq('id', row.id)
    setSaving(false)
    if (e) {
      setLocalBody(prevOverride ?? null)   // rollback
      setError(e.message)
      onToast?.({ kind: 'error', text: "Couldn't save note" })
      return
    }
    onToast?.({ kind: 'success', text: 'Note updated' })
  }

  // Click-away for the ⋯ menu and the delete-confirm popover.
  useEffect(() => {
    if (!menuOpen && !confirmDelete) return
    function onClick(e) {
      if (!wrapperRef.current?.contains(e.target)) {
        setMenuOpen(false)
        setConfirmDelete(false)
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') { setMenuOpen(false); setConfirmDelete(false) }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, confirmDelete])

  async function copyLink() {
    const url = `${window.location.origin}/financial-controls/driver-purchases/${row.driver_purchase_id}?comment=${row.id}`
    try { await navigator.clipboard.writeText(url) } catch {/* noop */}
    setMenuOpen(false)
  }

  async function softDelete() {
    setBusy(true); setError('')
    const { error: e } = await supabase
      .from('driver_purchase_comments')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id || null })
      .eq('id', row.id)
    setBusy(false); setMenuOpen(false); setConfirmDelete(false)
    if (e) { setError(e.message); return }
    onToast?.({ kind: 'success', text: 'Comment deleted' })
  }

  return (
    <div
      ref={wrapperRef}
      data-comment-id={row.id}
      className={`flex items-start gap-2.5 group transition-all ${
        highlight ? 'rounded-xl ring-2 ring-orange-400/60' : ''
      }`}
    >
      <Avatar name={row.created_by_name || row.created_by_email || '?'} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 dark:text-slate-200">
            {row.created_by_name || row.created_by_email || 'Unknown'}
          </span>
          <span className="text-[11px] text-gray-400 dark:text-slate-500" title={fmtDateTime(row.at)}>
            {fmtRelative(row.at)}
          </span>
          {saving ? (
            <span className="text-[11px] text-gray-400 dark:text-slate-500">Saving…</span>
          ) : editedAt && (
            <span className="text-[11px] text-gray-400 dark:text-slate-500" title={fmtDateTime(editedAt)}>
              (edited)
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5">
            <textarea
              ref={taRef}
              value={draft}
              onChange={e => { setDraft(e.target.value); autosize(e.target) }}
              onBlur={onEditBlur}
              onKeyDown={onEditKeyDown}
              rows={1}
              className="w-full resize-none rounded-md border border-cyan-400 dark:border-cyan-500/60 bg-white dark:bg-[#0d0d1f] px-2 py-1.5 text-sm text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
            <p className="mt-1 text-[10px] text-gray-400 dark:text-slate-500">
              Enter to save · Esc to cancel
            </p>
          </div>
        ) : (
          <div className="mt-0.5">
            {/* Body is collapsible; attachments stay outside so they
                remain visible regardless of collapse state. When the current
                user can edit, the body is click-to-edit with a hover cue. */}
            {canEditInline ? (
              <div
                onClick={onBodyClick}
                title="Click to edit"
                className="cursor-text rounded-md -mx-1.5 px-1.5 py-0.5 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors"
              >
                <CollapsibleBody>
                  <CommentBody doc={bodyJson} fallbackText={bodyText} currentUserId={currentUserId} />
                </CollapsibleBody>
              </div>
            ) : (
              <CollapsibleBody>
                <CommentBody doc={bodyJson} fallbackText={bodyText} currentUserId={currentUserId} />
              </CollapsibleBody>
            )}
            <Attachments items={row.attachments || []} />
          </div>
        )}

        {error && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{error}</div>}
      </div>

      {/* Action menu */}
      {!editing && (canEditInline || canDelete) && (
        <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setMenuOpen(o => !o)}
            disabled={busy}
            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 rounded"
            title="More"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-40 rounded-lg bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-xl py-1 z-20">
              {canEditInline && (
                <button onClick={enterEdit}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-slate-300">
                  Edit
                </button>
              )}
              <button onClick={copyLink}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-slate-300">
                Copy link
              </button>
              {canDelete && (
                <button onClick={() => { setMenuOpen(false); setConfirmDelete(true) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400">
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Inline delete confirmation popover — anchored to the ⋯
              button. Stays close to where the click happened instead of
              throwing up a full-screen modal for a one-click action. */}
          {confirmDelete && (
            <div className="absolute right-0 mt-1 w-56 rounded-lg bg-white dark:bg-[#0d0d1f] border border-red-200 dark:border-red-500/30 shadow-xl p-3 z-20">
              <p className="text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Delete this comment?</p>
              <p className="text-[11px] text-gray-500 dark:text-slate-500 mb-3">It will be hidden from the feed. The record stays for audit.</p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className="text-[11px] px-2 py-1 rounded text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={softDelete}
                  disabled={busy}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded bg-red-500 hover:bg-red-400 text-white disabled:opacity-50"
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Avatar({ name, muted = false }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold text-white ${
      muted
        ? 'bg-gray-300 dark:bg-slate-600'
        : 'bg-gradient-to-br from-cyan-500 to-fuchsia-500'
    }`}>
      {initial}
    </div>
  )
}
