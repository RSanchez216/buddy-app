import { Link } from 'react-router-dom'

// Shared cross-reference card. Used on:
//   • Debt Schedule loan detail → "Sold to driver(s)" (Phase 1)
//   • Driver Purchase detail   → "Underlying bank loan" (Phase 2)
//
// Pass an array of items; the wrapper handles the "1 vs many" headline.
//
// Each item should expose: { primary, secondary?, leftRows, rightRows,
//   coverage: { ok: bool, label }, link }
//
//   leftRows / rightRows = [{ label, value }, ...]
//   coverage.ok=true → green (covered); false → red (underwater)
//   link = { to, label }
export default function CrossReferenceCard({ title, items = [] }) {
  if (!items.length) return null
  const headline = items.length === 1 ? title.singular : title.plural

  return (
    <div className="bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{headline}</h3>
        {items.length > 1 && (
          <span className="text-xs text-gray-500 dark:text-slate-400">{items.length} contracts</span>
        )}
      </div>

      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={i} className="border border-gray-100 dark:border-white/5 rounded-xl p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold text-gray-900 dark:text-slate-200">{it.primary}</div>
                {it.secondary && <div className="text-xs text-gray-500 dark:text-slate-500">{it.secondary}</div>}
              </div>
              {it.link && (
                <Link
                  to={it.link.to}
                  className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline whitespace-nowrap"
                >
                  {it.link.label} →
                </Link>
              )}
            </div>

            {(it.leftRows?.length || it.rightRows?.length) && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {(it.leftRows || []).map((r, j) => (
                  <FactRow key={`l${j}`} label={r.label} value={r.value} />
                ))}
                {(it.rightRows || []).map((r, j) => (
                  <FactRow key={`r${j}`} label={r.label} value={r.value} />
                ))}
              </div>
            )}

            {it.coverage && (
              <div
                className={`rounded-lg px-3 py-2 text-xs ${
                  it.coverage.ok
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                    : 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400'
                }`}
              >
                <span className="font-semibold">{it.coverage.ok ? 'Covered' : 'Underwater'}: </span>
                {it.coverage.label}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function FactRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className="font-mono font-semibold text-gray-700 dark:text-slate-300">{value}</span>
    </div>
  )
}
