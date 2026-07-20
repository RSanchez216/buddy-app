// In-modal notice shown when an importer blocks a write because a newer build
// shipped. Additive to the global buddy:needs-refresh banner — not a second
// global banner. The user clicks Refresh when ready (their selected file /
// parsed rows are preserved until they do).
export default function StaleBuildNotice() {
  return (
    <div className="rounded-2xl border border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-500/10 p-4 flex items-start gap-3">
      <div className="text-xl leading-none">⚠️</div>
      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold text-orange-900 dark:text-orange-200">A new version of BUDDY is available.</p>
        <p className="text-xs text-orange-800 dark:text-orange-300/90">
          Refresh before importing so you&apos;re not running an outdated version. Your selected file and preview are kept.
        </p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 hover:bg-orange-400 text-white transition-colors"
      >
        Refresh
      </button>
    </div>
  )
}
