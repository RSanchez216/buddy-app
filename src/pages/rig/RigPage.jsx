// The Rig — standalone 3D company-health preview (/rig, direct URL only).
// Phase 1: mock data via the demo state switcher; Phase 2 wires live
// profitability + cash-flow data into rigState and the net figure.
import { useEffect, useState } from 'react'
import RigScene from './RigScene'
import { MOCK_TOP_CUSTOMER, RIG_STATES, TRAILER_OPTIONS } from './rigConfig'

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'

const MONO = "'JetBrains Mono', ui-monospace, monospace"
const DISPLAY = "'Space Grotesk', system-ui, sans-serif"
const FIGURES = "'Sora', system-ui, sans-serif"

export default function RigPage() {
  const [rigState, setRigState] = useState('cruising')
  const [picker, setPicker] = useState('auto')
  const [interacted, setInteracted] = useState(false)

  useEffect(() => {
    if (document.getElementById('rig-fonts')) return
    const link = document.createElement('link')
    link.id = 'rig-fonts'
    link.rel = 'stylesheet'
    link.href = FONTS_HREF
    document.head.appendChild(link)
  }, [])

  const conf = RIG_STATES[rigState]
  const autoIsCustomer = /amazon/i.test(MOCK_TOP_CUSTOMER)
  const trailerType = picker === 'auto' ? (autoIsCustomer ? 'customer' : 'dryvan') : picker

  const markInteracted = () => {
    if (!interacted) setInteracted(true)
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#05060d]"
      onPointerDown={markInteracted}
      onWheel={markInteracted}
    >
      <RigScene rigState={rigState} trailerType={trailerType} />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-7">
        {/* top row */}
        <div className="flex items-start justify-between">
          <div>
            <div
              className="text-[10px] sm:text-[11px] text-slate-400/90 tracking-[0.32em]"
              style={{ fontFamily: MONO }}
            >
              MANAS EXPRESS — COMPANY HEALTH
            </div>
            <div
              className="mt-2 text-4xl sm:text-5xl font-bold leading-none transition-colors duration-700"
              style={{ fontFamily: FIGURES, color: conf.accent }}
            >
              {conf.net}
              <span
                className="ml-2 align-baseline text-[11px] font-normal text-slate-400 tracking-[0.18em]"
                style={{ fontFamily: MONO }}
              >
                NET TODAY
              </span>
            </div>
            <div
              className="mt-2 text-sm font-semibold tracking-[0.42em] transition-colors duration-700"
              style={{ fontFamily: DISPLAY, color: conf.accent }}
            >
              {conf.word}
            </div>
          </div>

          {/* hint chip */}
          <div
            className={`rounded-full border border-slate-700/60 bg-black/40 px-4 py-1.5 text-[10px] text-slate-400 tracking-[0.22em] backdrop-blur transition-opacity duration-700 ${
              interacted ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ fontFamily: MONO }}
          >
            DRAG TO ROTATE · SCROLL TO ZOOM
          </div>
        </div>

        {/* bottom row */}
        <div className="flex items-end justify-between gap-4">
          <div
            className="text-[9px] text-slate-600 tracking-[0.18em]"
            style={{ fontFamily: MONO }}
          >
            MODEL: COMMUNITY ASSET · PHASE 1 PREVIEW
          </div>

          {/* trailer picker */}
          <div className="pointer-events-auto flex flex-col items-center gap-1.5">
            <div className="flex overflow-hidden rounded-full border border-slate-700/70 bg-black/45 backdrop-blur">
              {TRAILER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPicker(opt.id)}
                  className={`px-3.5 py-1.5 text-[10px] tracking-[0.18em] transition-colors ${
                    picker === opt.id
                      ? 'bg-[#e9c984]/15 text-[#e9c984]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  style={{ fontFamily: DISPLAY, fontWeight: 600 }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div
              className={`text-[9px] tracking-[0.14em] text-slate-500 transition-opacity ${
                picker === 'auto' ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ fontFamily: MONO }}
            >
              auto · top revenue: {MOCK_TOP_CUSTOMER}
            </div>
          </div>

          {/* demo health-state switcher */}
          <div className="pointer-events-auto flex gap-1.5">
            {Object.entries(RIG_STATES).map(([id, s]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRigState(id)}
                className="rounded-full border px-3 py-1.5 text-[10px] tracking-[0.16em] backdrop-blur transition-colors"
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 600,
                  borderColor: rigState === id ? s.accent : 'rgba(71,85,105,0.6)',
                  color: rigState === id ? s.accent : 'rgb(148,163,184)',
                  background: rigState === id ? `${s.accent}1f` : 'rgba(0,0,0,0.45)',
                }}
              >
                {s.word.charAt(0) + s.word.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
