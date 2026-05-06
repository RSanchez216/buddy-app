import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import CommentBody from './CommentBody'
import CommentComposer from './CommentComposer'
import Attachments from './Attachments'
import { fmtDateTime, fmtRelative } from '../utils/format'

const EDIT_WINDOW_MIN = 5

// Single comment row in the activity feed. Renders avatar, name, body,
// mention chips (via CommentBody), attachments. Owner gets the ⋯ menu
// for edit (within 5 min) and delete; admins can also delete others.
export default function CommentItem({ row, currentUserId, isAdmin, highlight }) {
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState('')
  const wrapperRef = useRef(null)

  const isOwn = row.created_by === currentUserId
  const ageMin = (Date.now() - new Date(row.at).getTime()) / 60000
  const canEdit = isOwn && ageMin < EDIT_WINDOW_MIN && !row.is_deleted
  const canDelete = (isOwn || isAdmin) && !row.is_deleted

  // Click-away for the ⋯ menu
  useEffect(() => {
    if (!menuOpen) return
    function onClick(e) {
      if (!wrapperRef.current?.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  async function copyLink() {
    const url = `${window.location.origin}/financial-controls/driver-purchases/${row.driver_purchase_id}?comment=${row.id}`
    try { await navigator.clipboard.writeText(url) } catch {/* noop */}
    setMenuOpen(false)
  }

  async function softDelete() {
    if (!confirm('Delete this comment?')) return
    setBusy(true); setError('')
    const { error: e } = await supabase
      .from('driver_purchase_comments')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id || null })
      .eq('id', row.id)
    setBusy(false); setMenuOpen(false)
    if (e) { setError(e.message); return }
  }

  // Soft-deleted: muted placeholder, preserve chronology.
  if (row.is_deleted) {
    return (
      <div className="flex items-start gap-2.5 opacity-70">
        <Avatar name="" muted />
        <div className="flex-1 min-w-0">
          <p className="text-xs italic text-gray-400 dark:text-slate-500">
            Comment deleted
            {row.deleted_at && <> · {fmtRelative(row.deleted_at)}</>}
          </p>
        </div>
      </div>
    )
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
              onSubmitted={() => setEditing(false)}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="mt-0.5">
            <CommentBody doc={row.body_json} fallbackText={row.body_text} currentUserId={currentUserId} />
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
                <button onClick={softDelete}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400">
                  Delete
                </button>
              )}
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
