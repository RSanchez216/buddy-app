import { useNavigate } from 'react-router-dom'

export default function NoAccess() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#09091a] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#0d0d1f] rounded-2xl border border-gray-200 dark:border-white/10 shadow-lg p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 0v2m0-6v-2m0 0V7a2 2 0 012-2h2.586a1 1 0 00.707-.293l5.414-5.414a1 1 0 00.293-.707V4a2 2 0 00-2-2h-5.586a1 1 0 00-.707.293l-5.414 5.414a1 1 0 00-.293.707v2.586a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">No pages yet</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
          No pages have been shared with you yet. Ask your admin to grant you access to pages you need to work on.
        </p>
        <button
          onClick={() => navigate('/')}
          className="inline-block px-4 py-2.5 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-all"
        >
          Back to home
        </button>
      </div>
    </div>
  )
}
