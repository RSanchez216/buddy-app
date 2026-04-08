import { useState } from 'react'
import { createPortal } from 'react-dom'

const EXT_COLORS = {
  pdf:  { bg: 'bg-red-50 dark:bg-red-500/10',     text: 'text-red-500',     label: 'PDF' },
  jpg:  { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-500',   label: 'JPG' },
  jpeg: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-500',   label: 'JPG' },
  png:  { bg: 'bg-purple-50 dark:bg-purple-500/10', text: 'text-purple-500', label: 'PNG' },
  xlsx: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-500', label: 'XLS' },
  xls:  { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-500', label: 'XLS' },
}

function fileExt(name) {
  return (name || '').split('.').pop().toLowerCase()
}

function FileTypeBadge({ name }) {
  const ext = fileExt(name)
  const style = EXT_COLORS[ext] || { bg: 'bg-gray-100 dark:bg-slate-700', text: 'text-gray-500', label: ext.toUpperCase() || 'FILE' }
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl text-xs font-bold shrink-0 ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  )
}

/**
 * Compact attachment badge — opens a centered modal listing all files.
 * attachments: [{ id, file_url, file_name }]
 */
export default function AttachmentsPopover({ attachments = [] }) {
  const [open, setOpen] = useState(false)

  if (!attachments.length) return <span className="text-gray-300 dark:text-slate-700 text-xs">—</span>

  const modal = open && createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <div>
            <p className="font-semibold text-gray-900 dark:text-slate-100 text-sm">Attachments</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{attachments.length} file{attachments.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* File list */}
        <div className="p-3 space-y-1.5">
          {attachments.map((att, i) => (
            <a
              key={att.id}
              href={att.file_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group"
            >
              <FileTypeBadge name={att.file_name} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                  {att.file_name}
                </p>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">File {i + 1} of {attachments.length}</p>
              </div>
              <svg className="w-4 h-4 text-gray-300 dark:text-slate-600 group-hover:text-cyan-500 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 transition-colors"
        title={`View ${attachments.length} attachment${attachments.length !== 1 ? 's' : ''}`}
      >
        <svg className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-400">{attachments.length}</span>
      </button>
      {modal}
    </>
  )
}
