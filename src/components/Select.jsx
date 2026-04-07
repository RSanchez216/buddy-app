import { S } from '../lib/styles'

/**
 * Styled select that replaces native OS chrome with app-consistent design.
 * `className` is applied to the outer wrapper div (use for width/margin).
 * All other props (value, onChange, disabled, etc.) pass through to <select>.
 */
export default function Select({ className = '', children, ...props }) {
  return (
    <div className={`relative ${className}`}>
      <select
        {...props}
        className="w-full px-3 py-2 pr-8 bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 rounded-xl text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/40 transition-all appearance-none cursor-pointer"
      >
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        <svg className="w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  )
}
