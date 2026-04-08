import { useState, useRef, useEffect } from 'react'

const EXT_COLORS = {
  pdf: 'text-red-500',
  jpg: 'text-amber-500', jpeg: 'text-amber-500',
  png: 'text-purple-500',
  xlsx: 'text-emerald-500', xls: 'text-emerald-500',
}

function fileExt(name) {
  return (name || '').split('.').pop().toLowerCase()
}

function FileIcon({ name }) {
  const ext = fileExt(name)
  const color = EXT_COLORS[ext] || 'text-gray-400'
  return (
    <svg className={`w-4 h-4 shrink-0 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  )
}

/**
 * Compact attachment badge with popover list.
 * attachments: [{ id, file_url, file_name }]
 */
export default function AttachmentsPopover({ attachments = [] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!attachments.length) return <span className="text-gray-300 dark:text-slate-700 text-xs">—</span>

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 transition-colors"
        title={`${attachments.length} file${attachments.length !== 1 ? 's' : ''}`}
      >
        <svg className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
        <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-400">{attachments.length}</span>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 min-w-[220px] max-w-[300px] bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
              {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="py-1 max-h-52 overflow-y-auto">
            {attachments.map(att => (
              <a
                key={att.id}
                href={att.file_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group"
              >
                <FileIcon name={att.file_name} />
                <span className="text-xs text-gray-700 dark:text-slate-300 truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                  {att.file_name}
                </span>
                <svg className="w-3 h-3 text-gray-300 dark:text-slate-600 group-hover:text-cyan-500 shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
