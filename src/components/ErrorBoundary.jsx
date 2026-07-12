import { Component } from 'react'
import { isChunkLoadError, reloadOnce } from '../lib/chunkReload'

// Minimal class-based error boundary. A render-time throw inside any
// wrapped subtree degrades to a small inline fallback card instead of
// unmounting the whole app (a thrown ReferenceError/TDZ in one route
// should never blank all of BUDDY). Non-blocking — no alert/confirm.
//
// A chunk-load failure (stale hashed chunk after a deploy) is special-cased:
// it auto-reloads into the new build (loop-guarded) and shows a brief
// "Updating…" line instead of the error card.
//
// Usage: <ErrorBoundary label="this section"><Thing /></ErrorBoundary>
// Optional `fallback` overrides the default card entirely.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, isChunk: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, isChunk: isChunkLoadError(error) }
  }

  componentDidCatch(error, info) {
    // Surface in the console for diagnosis; the UI stays on the fallback.
    console.error('ErrorBoundary caught an error:', error, info)
    // Stale chunk after a deploy → reload into the new build (guarded so it
    // can't loop) rather than sitting on an error card / blank page.
    if (isChunkLoadError(error)) reloadOnce()
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.state.isChunk) {
        return (
          <div className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400 flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-orange-500 border-b-transparent animate-spin" />
            Updating to the latest version…
          </div>
        )
      }
      if (this.props.fallback) return this.props.fallback
      const label = this.props.label || 'this section'
      return (
        <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/[0.06] px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between flex-wrap gap-2">
          <span>Something went wrong loading {label}. The rest of the app is unaffected.</span>
          <button
            onClick={this.handleRetry}
            className="text-red-700 dark:text-red-300 font-medium hover:underline shrink-0"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
