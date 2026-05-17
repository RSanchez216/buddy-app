import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Global toast system. Promotes the previously-cloned inline toast
// pattern (kind + text + bottom-right portal) into a single provider
// every component can call via useToast().
//
// Convention:
//   - toast.success('Loan updated')                  short confirmation
//   - toast.error('Couldn\'t save changes', err)     err can be Error or string
//   - toast.show({ kind, text, description, ttl })   manual control
//
// Stacks vertically bottom-right. Success auto-dismisses at 3s; errors at
// 7s (longer dwell for the user to read). Both are dismissible.

const ToastContext = createContext({
  success: () => {},
  error:   () => {},
  show:    () => {},
  dismiss: () => {},
})

let _id = 0
const nextId = () => ++_id

const SUCCESS_TTL = 3000
const ERROR_TTL   = 7000

function readableError(err) {
  if (!err) return null
  if (typeof err === 'string') return err
  if (err.message) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setItems(arr => arr.filter(t => t.id !== id))
    const handle = timers.current.get(id)
    if (handle) { clearTimeout(handle); timers.current.delete(id) }
  }, [])

  const show = useCallback((opts) => {
    const id = nextId()
    const kind = opts.kind === 'error' ? 'error' : 'success'
    const ttl = opts.ttl != null ? opts.ttl : (kind === 'error' ? ERROR_TTL : SUCCESS_TTL)
    const t = {
      id,
      kind,
      text: opts.text || (kind === 'error' ? 'Something went wrong' : 'Done'),
      description: opts.description || null,
    }
    setItems(arr => [...arr, t])
    if (ttl > 0) {
      const handle = setTimeout(() => dismiss(id), ttl)
      timers.current.set(id, handle)
    }
    return id
  }, [dismiss])

  const success = useCallback((text, opts = {}) => {
    return show({ kind: 'success', text, description: opts.description, ttl: opts.ttl })
  }, [show])

  // error(text, errOrDescription, opts?) — second arg can be Error/string
  // (extracted into description) or a plain options object.
  const error = useCallback((text, errOrOpts, maybeOpts) => {
    let description = null
    let opts = {}
    if (errOrOpts && typeof errOrOpts === 'object' && !('message' in errOrOpts) && !(errOrOpts instanceof Error)) {
      opts = errOrOpts
    } else if (errOrOpts) {
      description = readableError(errOrOpts)
      opts = maybeOpts || {}
    }
    return show({
      kind: 'error',
      text,
      description: opts.description || description,
      ttl: opts.ttl,
    })
  }, [show])

  useEffect(() => {
    const handles = timers.current
    return () => { for (const h of handles.values()) clearTimeout(h); handles.clear() }
  }, [])

  return (
    <ToastContext.Provider value={{ success, error, show, dismiss }}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

function ToastViewport({ items, onDismiss }) {
  if (!items.length) return null
  return createPortal(
    <div className="fixed bottom-6 right-6 z-[1000] flex flex-col gap-2 pointer-events-none max-w-sm w-[min(22rem,calc(100vw-3rem))]">
      {items.map(t => <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>,
    document.body
  )
}

function ToastItem({ toast, onDismiss }) {
  const isErr = toast.kind === 'error'
  return (
    <div
      role={isErr ? 'alert' : 'status'}
      className={`pointer-events-auto bg-white dark:bg-[#0d0d1f] border rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3 animate-[fadeIn_120ms_ease-out]`}
      style={{ borderColor: isErr ? 'rgb(252 165 165 / 0.6)' : 'rgb(110 231 183 / 0.4)' }}
    >
      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${isErr ? 'bg-red-500' : 'bg-emerald-500'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-700 dark:text-slate-300 break-words">{toast.text}</div>
        {toast.description && (
          <div className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 break-words">{toast.description}</div>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0"
        aria-label="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
