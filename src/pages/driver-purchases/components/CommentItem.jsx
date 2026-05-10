import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import CommentBody from './CommentBody'
import CommentComposer from './CommentComposer'
import CollapsibleBody from './CollapsibleBody'
import Attachments from './Attachments'
import { fmtDateTime, fmtRelative } from '../utils/format'

const EDIT_WINDOW_MIN = 5

// Single comment row in the activity feed. Renders avatar, name, body
// (collapsed if long), mention chips, attachments. Owner gets the ⋯
// menu for edit (within 5 min) and delete; admins can also delete others.
// Deleted comments are filtered out upstream in ActivityFeed.
export default function CommentItem({ row, currentUserId, isAdmin, highlight, onToast }) {
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const wrapperRef = useRef(null)

  const isOwn = row.created_by === currentUserId
  const ageMin = (Date.now() - new Date(row.at).getTime()) / 60000
  const canEdit = isOwn && ageMin < EDIT_WINDOW_MIN
  const canDelete = isOwn || isAdmin

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

  function onEditSubmitted() {
    setEditing(false)
    onToast?.({ kind: 'success', text: 'Comment updated' })
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
          {row.edited_at && (
            <span className="text-[11px] text-gray-400 dark:text-slate-500" title={fmtDateTime(row.edited_at)}>
              (edited)
            </span>
          )}
        </div>

        {editing ? (
          <div className="mt-1.5">
            <CommentComposer
              purchaseId={row.driver_purchase_id}
              commentId={row.id}
              initialContent={row.body_json}
              onSubmitted={onEditSubmitted}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="mt-0.5">
            {/* Body is collapsible; attachments stay outside so they
                remain visible regardless of collapse state. */}
            <CollapsibleBody>
              <CommentBody doc={row.body_json} fallbackText={row.body_text} currentUserId={currentUserId} />
            </CollapsibleBody>
            <Attachments items={row.attachments || []} />
          </div>
        )}

        {error && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{error}</div>}
      </div>

      {/* Action menu */}
      {!editing && (canEdit || canDelete) && (
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
              {canEdit && (
                <button onClick={() => { setMenuOpen(false); setEditing(true) }}
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
