import { LANE_STATUS } from '../../../../data/dedicatedLanesMock'

// Shared presentation components for the Dedicated Lanes page. Non-component
// helpers (day grading, date formatting) live in dedicatedFormat.js.

const STATUS_PILL = {
  profitable: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  watch: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  underwater: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
}

export function StatusPill({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide rounded-full border px-2 py-0.5 ${STATUS_PILL[status]}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: LANE_STATUS[status].hex }} />
      {LANE_STATUS[status].label}
    </span>
  )
}

// Page-scoped keyframes + the asphalt/bay treatments. Injected once by the
// page shell; plain CSS so we stay off new dependencies (no framer-motion
// in the project).
export function DedicatedKeyframes() {
  return (
    <style>{`
      @keyframes dlFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes dlBayIn { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes dlAgingPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        50% { box-shadow: 0 0 14px 1px rgba(239, 68, 68, 0.28); }
      }
      .dl-view-in { animation: dlFadeUp .28s ease both; }
      .dl-panel-in { animation: dlFadeUp .3s ease both; }
      .dl-bay { animation: dlBayIn .35s ease both; }
      .dl-bay-aging { animation: dlBayIn .35s ease both, dlAgingPulse 2.4s ease-in-out .5s infinite; }
      .dl-asphalt {
        background:
          repeating-linear-gradient(135deg, rgba(100, 116, 139, 0.05) 0 1px, transparent 1px 14px),
          linear-gradient(180deg, rgba(148, 163, 184, 0.09), rgba(148, 163, 184, 0.03));
      }
      .dark .dl-asphalt {
        background:
          repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 14px),
          linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent);
      }
      .dl-bay-stripes {
        background: repeating-linear-gradient(45deg, rgba(148, 163, 184, 0.06) 0 8px, transparent 8px 16px);
      }
      .dl-drawer { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .3s ease; }
      .dl-drawer.open { grid-template-rows: 1fr; }
      .dl-drawer > div { overflow: hidden; }
      @media (prefers-reduced-motion: reduce) {
        .dl-view-in, .dl-panel-in, .dl-bay, .dl-bay-aging { animation: none; }
        .dl-drawer { transition: none; }
      }
    `}</style>
  )
}
