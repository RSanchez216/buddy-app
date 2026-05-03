import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

// Floating popup the @-mention extension renders above the cursor.
// Receives the filtered user list and a `command` callback. Up/Down/Enter
// navigates and selects; Escape is handled by the suggestion plugin.
const MentionList = forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  useEffect(() => setSelectedIndex(0), [props.items])

  function selectItem(index) {
    const item = props.items[index]
    if (item) props.command({ id: item.id, label: item.full_name || item.email })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((selectedIndex + 1) % props.items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  if (!props.items?.length) {
    return (
      <div className="rounded-xl bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-xl px-3 py-2 text-xs text-gray-400 dark:text-slate-500">
        No matches
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 shadow-xl overflow-hidden max-h-72 overflow-y-auto min-w-[14rem]">
      {props.items.map((item, idx) => (
        <button
          key={item.id}
          onClick={() => selectItem(idx)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
            idx === selectedIndex
              ? 'bg-cyan-50 dark:bg-cyan-500/10'
              : 'hover:bg-gray-50 dark:hover:bg-white/5'
          }`}
        >
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
            {(item.full_name || item.email || '?').charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-slate-200 truncate">
              {item.full_name || item.email}
            </div>
            {item.full_name && item.email && (
              <div className="text-[11px] text-gray-400 dark:text-slate-500 truncate">{item.email}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
})

MentionList.displayName = 'MentionList'
export default MentionList
