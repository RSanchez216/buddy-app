import { useEffect, useRef, useState } from 'react'
import { S } from '../../../lib/styles'
import { presetRange, todayYmd } from './usageFormat'

// Date-range selector, reused across the app (usage reports, lumpers, …).
// Self-contained — owns its own state and calls onChange({ start, end, mode,
// label }) whenever the effective range changes (including on mount), so parents
// just stash the latest range.
//
// `presets` is an array of [key, label, days] (days omitted for 'custom').
// Defaults to the usage-report set so existing callers are unchanged; pass a
// different set + `defaultMode` to reuse the same pills elsewhere.

const DEFAULT_PRESETS = [
  ['7', 'Last 7 days', 7],
  ['30', 'Last 30 days', 30],
  ['custom', 'Custom'],
]

export default function UsageRangeControl({ onChange, size = 'sm', presets = DEFAULT_PRESETS, defaultMode }) {
  const initialMode = defaultMode || presets[0][0]
  const initialDays = presets.find(p => p[0] === initialMode)?.[2] || 30
  const [mode, setMode] = useState(initialMode)
  const [customStart, setCustomStart] = useState(() => presetRange(initialDays).start)
  const [customEnd, setCustomEnd] = useState(() => todayYmd())
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Emit the effective range whenever the selection changes. Custom stays valid
  // (start ≤ end) by clamping in the inputs below.
  useEffect(() => {
    const preset = presets.find(p => p[0] === mode)
    const range = mode === 'custom'
      ? { start: customStart, end: customEnd }
      : presetRange(preset?.[2] || 30)
    const label = preset?.[1] || 'Custom'
    onChangeRef.current?.({ ...range, mode, label })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, customStart, customEnd])

  const btn = (active) =>
    `px-3 ${size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm'} rounded-lg font-medium border transition-colors ${
      active
        ? 'bg-orange-500 text-white border-orange-500'
        : 'border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
    }`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1.5">
        {presets.map(([k, lbl]) => (
          <button key={k} type="button" onClick={() => setMode(k)} className={btn(mode === k)}>{lbl}</button>
        ))}
      </div>
      {mode === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customStart}
            max={customEnd}
            onChange={e => setCustomStart(e.target.value || customStart)}
            className={`${S.select} !py-1.5 text-xs`}
          />
          <span className="text-gray-400 text-xs">→</span>
          <input
            type="date"
            value={customEnd}
            min={customStart}
            max={todayYmd()}
            onChange={e => setCustomEnd(e.target.value || customEnd)}
            className={`${S.select} !py-1.5 text-xs`}
          />
        </div>
      )}
    </div>
  )
}
