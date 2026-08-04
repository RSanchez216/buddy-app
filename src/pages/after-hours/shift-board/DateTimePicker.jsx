import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// A datetime field with a framed popup.
//
// The native <input type="datetime-local"> stays — it is the best keyboard entry
// there is (locale-aware, validating, no calendar needed), and §4 requires typing
// to keep working. What it cannot do is present a usable popup: Chrome's picker
// is browser chrome, unstyleable, transparent over the table and easy to lose. So
// the native indicator is hidden and this opens its own bordered, opaque panel.
//
// Values are the same 'YYYY-MM-DDTHH:mm' strings the input uses, which the caller
// already treats as Chicago wall-clock time.

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n) => String(n).padStart(2, '0')

function parts(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] }
}
const compose = (y, mo, d, h, mi) => `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`

// Half-hour rungs for the time column; any exact minute is still typeable.
const SLOTS = Array.from({ length: 48 }, (_, i) => ({ h: Math.floor(i / 2), mi: i % 2 ? 30 : 0 }))
const slotLabel = ({ h, mi }) => {
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(mi)} ${ampm}`
}

export default function DateTimePicker({ value, onChange, disabled, tone = 'plain' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const wrapRef = useRef(null)
  const popRef = useRef(null)
  const timeColRef = useRef(null)

  const p = parts(value)
  const today = new Date()
  // The month shown follows the value, so opening always lands on the right one.
  // The arrows set an override, cleared each time the popup opens — derived this
  // way rather than synced by an effect, which would cascade a render per open.
  const [monthOverride, setMonthOverride] = useState(null)
  const view = monthOverride ?? { y: p?.y ?? today.getFullYear(), mo: p?.mo ?? today.getMonth() + 1 }
  const toggleOpen = () => setOpen(o => { if (!o) setMonthOverride(null); return !o })

  // Anchor to the input. Portalled to the body so the table's overflow can't clip
  // it, and flipped upward when there isn't room below.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return
    const place = () => {
      const r = wrapRef.current.getBoundingClientRect()
      const H = 268, W = 300
      const below = window.innerHeight - r.bottom
      setPos({
        top: below < H + 8 && r.top > H + 8 ? r.top - H - 6 : r.bottom + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
        width: W,
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Click-away + Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Bring the selected time into view rather than making them scroll to find it.
  useEffect(() => {
    if (!open || !timeColRef.current) return
    const el = timeColRef.current.querySelector('[data-selected="true"]')
    if (el) el.scrollIntoView({ block: 'center' })
  }, [open, pos])

  function pickDay(d) {
    const q = parts(value)
    onChange(compose(view.y, view.mo, d, q?.h ?? 8, q?.mi ?? 0))
  }
  function pickTime(s) {
    const q = parts(value)
    const base = q || { y: today.getFullYear(), mo: today.getMonth() + 1, d: today.getDate() }
    onChange(compose(base.y, base.mo, base.d, s.h, s.mi))
    setOpen(false)
  }
  const shiftMonth = (n) => {
    const mo = view.mo + n
    if (mo < 1) setMonthOverride({ y: view.y - 1, mo: 12 })
    else if (mo > 12) setMonthOverride({ y: view.y + 1, mo: 1 })
    else setMonthOverride({ y: view.y, mo })
  }

  const first = new Date(view.y, view.mo - 1, 1).getDay()
  const count = new Date(view.y, view.mo, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]

  const filled = !!p
  const inputCls = `w-full pl-2 pr-7 py-1 rounded-lg border text-xs bg-white dark:bg-slate-800/80 text-gray-900 dark:text-slate-100
    focus:outline-none focus:ring-2 focus:ring-orange-500/40 transition-all
    [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none
    ${tone === 'saved' && filled
      ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-500/10'
      : 'border-gray-300 dark:border-slate-600'}`

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="datetime-local"
        className={inputCls}
        value={value || ''}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      <button
        type="button" tabIndex={-1} disabled={disabled}
        onClick={toggleOpen}
        aria-label="Open the calendar"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-orange-500 disabled:opacity-40"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="z-[200] rounded-xl border border-gray-200 dark:border-white/15 bg-white dark:bg-[#141432] shadow-2xl overflow-hidden"
        >
          <div className="flex">
            {/* Date */}
            <div className="flex-1 p-2">
              <div className="flex items-center justify-between mb-1">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month"
                  className="w-6 h-6 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10">‹</button>
                <span className="text-[11px] font-semibold text-gray-800 dark:text-slate-200">{MONTHS[view.mo - 1]} {view.y}</span>
                <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month"
                  className="w-6 h-6 inline-flex items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10">›</button>
              </div>
              <div className="grid grid-cols-7 gap-px">
                {DAYS.map((d, i) => (
                  <span key={i} className="text-[9px] text-center text-gray-400 dark:text-slate-500 py-0.5">{d}</span>
                ))}
                {cells.map((d, i) => {
                  if (d == null) return <span key={`e${i}`} />
                  const isSel = p && p.y === view.y && p.mo === view.mo && p.d === d
                  const isToday = today.getFullYear() === view.y && today.getMonth() + 1 === view.mo && today.getDate() === d
                  return (
                    <button key={d} type="button" onClick={() => pickDay(d)}
                      className={`h-6 text-[11px] rounded transition-colors ${
                        isSel ? 'bg-orange-500 text-white font-semibold'
                          : isToday ? 'text-orange-600 dark:text-orange-400 font-semibold hover:bg-gray-100 dark:hover:bg-white/10'
                            : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
                      }`}>{d}</button>
                  )
                })}
              </div>
            </div>

            {/* Time — its own column with a visible boundary from the date grid */}
            <div ref={timeColRef} className="w-[86px] shrink-0 max-h-[238px] overflow-y-auto border-l border-gray-200 dark:border-white/15 bg-gray-50/70 dark:bg-white/[0.03]">
              {SLOTS.map(s => {
                const sel = p && p.h === s.h && p.mi === s.mi
                return (
                  <button key={`${s.h}:${s.mi}`} type="button" data-selected={sel ? 'true' : undefined}
                    onClick={() => pickTime(s)}
                    className={`block w-full text-left px-2 py-1 text-[11px] tabular-nums transition-colors ${
                      sel ? 'bg-orange-500 text-white font-semibold'
                        : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/10'
                    }`}>{slotLabel(s)}</button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04]">
            <span className="text-[10px] text-gray-400 dark:text-slate-500">Central time · or type it</span>
            <button type="button" onClick={() => setOpen(false)}
              className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 hover:underline">Done</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
