import { useMemo } from 'react'
import { createPortal } from 'react-dom'

// Manage simple view — bookmark the pages that appear in the sidebar's Simple
// mode. Lists ONLY pages from my_pages() (what the user can reach); writes go
// straight to user_page_bookmarks (RLS scopes to the caller). Never filters or
// invents pages — my_pages() is the single source of truth.

const SECTION_ORDER = ['Today', 'Money', 'Profitability', 'Fleet', 'Payables']

function BookmarkIcon({ filled }) {
  return filled ? (
    <svg className="w-5 h-5 text-cyan-500 dark:text-cyan-400" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 3a2 2 0 00-2 2v16l8-3.6 8 3.6V5a2 2 0 00-2-2H6z" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-gray-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 4a1 1 0 00-1 1v15.5l7-3.15 7 3.15V5a1 1 0 00-1-1H6z" />
    </svg>
  )
}

export default function ManageSimpleViewModal({ open, onClose, pages, onToggle, onReset }) {
  const grouped = useMemo(() => {
    const g = {}
    for (const p of pages) (g[p.nav_group] ||= []).push(p)
    Object.values(g).forEach(arr => arr.sort((a, b) => a.sort_order - b.sort_order))
    return g
  }, [pages])

  const count = useMemo(() => pages.filter(p => p.is_bookmarked).length, [pages])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-white/5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Manage simple view</h3>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Bookmark the pages you want in your simple view. You can only bookmark pages you have access to.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — grouped page list */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {SECTION_ORDER.map(group => {
            const items = grouped[group] || []
            if (!items.length) return null
            return (
              <div key={group}>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5 px-1">{group}</h4>
                <div className="space-y-0.5">
                  {items.map(p => (
                    <div key={p.page_key} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                      <span className={`text-sm ${p.is_bookmarked ? 'font-medium text-gray-900 dark:text-slate-200' : 'text-gray-500 dark:text-slate-400'}`}>{p.label}</span>
                      <button
                        onClick={() => onToggle(p.page_key, p.sort_order, p.is_bookmarked)}
                        title={p.is_bookmarked ? 'Remove from simple view' : 'Add to simple view'}
                        aria-pressed={p.is_bookmarked}
                        className="shrink-0 -mr-1 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                      >
                        <BookmarkIcon filled={p.is_bookmarked} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 dark:border-white/5 p-4">
          <button
            onClick={onReset}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            Reset
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-slate-400">{count} in your simple view</span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
