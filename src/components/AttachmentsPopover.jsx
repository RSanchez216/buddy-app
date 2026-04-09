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

function FileTypeBadge({ name, size = 'md' }) {
  const ext = fileExt(name)
  const style = EXT_COLORS[ext] || { bg: 'bg-gray-100 dark:bg-slate-700', text: 'text-gray-500', label: ext.toUpperCase() || 'FILE' }
  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-xs'
  return (
    <span className={`inline-flex items-center justify-center rounded-xl font-bold shrink-0 ${sz} ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  )
}

function isImage(name) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt(name))
}

function isPdf(name) {
  return fileExt(name) === 'pdf'
}

export default function AttachmentsPopover({ attachments = [] }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  if (!attachments.length) return <span className="text-gray-300 dark:text-slate-700 text-xs">—</span>

  const total = attachments.length
  const current = attachments[Math.min(index, total - 1)]

  function prev() { setIndex(i => (i - 1 + total) % total) }
  function next() { setIndex(i => (i + 1) % total) }

  function handleKey(e) {
    if (e.key === 'ArrowLeft') prev()
    if (e.key === 'ArrowRight') next()
    if (e.key === 'Escape') setOpen(false)
  }

  const modal = open && createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch p-4 lg:p-8" onKeyDown={handleKey} tabIndex={-1}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="relative z-10 flex flex-col w-full rounded-2xl overflow-hidden bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-2xl">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-white/5 shrink-0">

          {/* Prev/Next arrows */}
          {total > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={prev}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="text-xs text-gray-400 dark:text-slate-500 font-medium w-10 text-center">{index + 1} / {total}</span>
              <button onClick={next}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Filename */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileTypeBadge name={current.file_name} size="sm" />
            <span className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{current.file_name}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Download */}
            <a href={current.file_url} download={current.file_name}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-600 dark:text-slate-300 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>

            {/* Open in new tab */}
            <a href={current.file_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-600 dark:text-slate-300 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              New tab
            </a>

            {/* Close */}
            <button onClick={() => setOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors ml-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-black/20 relative">
          {isPdf(current.file_name) ? (
            <iframe
              key={current.file_url}
              src={current.file_url}
              title={current.file_name}
              className="w-full h-full border-0"
            />
          ) : isImage(current.file_name) ? (
            <div className="w-full h-full flex items-center justify-center p-6">
              <img
                key={current.file_url}
                src={current.file_url}
                alt={current.file_name}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-center p-8">
              <FileTypeBadge name={current.file_name} />
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Preview not available</p>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Use Download or New Tab to open this file</p>
              </div>
              <a href={current.file_url} download={current.file_name}
                className="px-4 py-2 text-sm font-semibold rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white transition-colors">
                Download file
              </a>
            </div>
          )}

          {/* Left/Right click zones for multi-file navigation */}
          {total > 1 && (
            <>
              <button onClick={prev}
                className="absolute left-0 inset-y-0 w-16 flex items-center justify-start pl-3 opacity-0 hover:opacity-100 transition-opacity group">
                <div className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm group-hover:bg-black/60 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </div>
              </button>
              <button onClick={next}
                className="absolute right-0 inset-y-0 w-16 flex items-center justify-end pr-3 opacity-0 hover:opacity-100 transition-opacity group">
                <div className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm group-hover:bg-black/60 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </>
          )}
        </div>

        {/* Thumbnail strip — shown only for multiple files */}
        {total > 1 && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-gray-100 dark:border-white/5 overflow-x-auto">
            {attachments.map((att, i) => (
              <button key={att.id || i} onClick={() => setIndex(i)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all shrink-0 ${
                  i === index
                    ? 'border-cyan-400 bg-cyan-50 dark:bg-cyan-500/10'
                    : 'border-gray-100 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                }`}>
                <FileTypeBadge name={att.file_name} size="sm" />
                <span className={`text-xs font-medium max-w-[100px] truncate ${i === index ? 'text-cyan-700 dark:text-cyan-400' : 'text-gray-500 dark:text-slate-400'}`}>
                  {att.file_name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )

  return (
    <>
      <button
        type="button"
        onClick={() => { setIndex(0); setOpen(true) }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 transition-colors"
        title={`View ${total} attachment${total !== 1 ? 's' : ''}`}
      >
        <svg className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-400">{total}</span>
      </button>
      {modal}
    </>
  )
}
