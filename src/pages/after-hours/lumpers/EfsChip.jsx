// Origin chip — a Lumper/Accessorial record created from an EFS check (source =
// 'efs_import'). It carries driver, date, amount, EFS fee and money code, but the
// broker and load are blank because the EFS file has neither — so the record
// reads as unfinished, not broken. Shown next to the driver name on both boards.
export default function EfsChip() {
  return (
    <span title="Created from an EFS check — broker and load still to confirm"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 whitespace-nowrap">
      EFS import
    </span>
  )
}
