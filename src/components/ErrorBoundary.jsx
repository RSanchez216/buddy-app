import { Component } from 'react'

// Minimal class-based error boundary. A render-time throw inside any
// wrapped subtree degrades to a small inline fallback card instead of
// unmounting the whole app (a thrown ReferenceError/TDZ in one route
// should never blank all of BUDDY). Non-blocking — no alert/confirm.
//
// Usage: <ErrorBoundary label="this section"><Thing /></ErrorBoundary>
// Optional `fallback` overrides the default card entirely.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Surface in the console for diagnosis; the UI stays on the fallback.
    console.error('ErrorBoundary caught an error:', error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
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
