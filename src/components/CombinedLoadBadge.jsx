// Neutral, quiet badge for a `Dont Factor` load — the TMS's own combined load
// for a multi-stop trip. Not an error: the record is correctly excluded from all
// revenue/mileage reporting (its component loads carry those), and it's kept for
// reference and per-component review. Render this wherever a raw load status of
// `Dont Factor` is shown (importer, raw load search/detail) — never on a
// profit/lane/miles view, where these rows are already excluded.
export default function CombinedLoadBadge({ className = '' }) {
  return (
    <span
      title="The TMS's own combined load for a multi-stop trip. Its component loads are imported separately and carry the revenue and miles, so this record is excluded from all revenue and mileage reporting."
      className={`inline-flex items-center whitespace-nowrap rounded-[4px] border text-[9.3px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-[#EEF0F2] border-[#D6DBE1] text-[#52606D] dark:bg-white/[0.06] dark:border-white/15 dark:text-slate-300 ${className}`}
    >
      Combined load · Not counted
    </span>
  )
}
