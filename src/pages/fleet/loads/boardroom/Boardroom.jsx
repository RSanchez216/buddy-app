import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../../../contexts/ToastContext'
import { S } from '../../../../lib/styles'
import { fetchBoardroom, pctDelta } from './boardroomData'
import { fmtMoney, fmtNum, fmtRpm, formatRange, shiftYmd, spanDays, thisMonth, thisWeek } from '../spotlight/spotlightShared'

const BoardroomLanePanel = lazy(() => import('./BoardroomLanePanel'))

// The Boardroom — the owner-facing command center. One screen-projectable
// page that assembles the fleet's profit story: pulse metrics counting up,
// customer concentration, auto-derived insights, leaderboards, links into
// the deep views, and an honest roadmap to net margin. Additive route —
// nothing existing is touched; everything shown is live data.

const PRESET_LABEL = { week: 'This week', month: 'This month', custom: 'Custom' }

// ── Count-up ──────────────────────────────────────────────────────────────
// Numbers sweep from 0 to their value on load / period change. All setState
// happens inside rAF callbacks (never synchronously in the effect body), and
// prefers-reduced-motion collapses the sweep to a single final frame.
function CountUp({ value, format, duration = 1300 }) {
  const [anim, setAnim] = useState({ target: null, t: 0 })
  useEffect(() => {
    if (value == null) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    let raf, start
    const step = (now) => {
      if (start == null) start = now
      const t = reduced ? 1 : Math.min(1, (now - start) / duration)
      setAnim({ target: value, t })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    // rAF is paused entirely in hidden tabs — if the page loads in the
    // background, land the final number anyway instead of sitting at $0.
    const failSafe = setTimeout(() => setAnim({ target: value, t: 1 }), duration + 500)
    return () => { cancelAnimationFrame(raf); clearTimeout(failSafe) }
  }, [value, duration])
  if (value == null) return <>{format ? format(null) : '—'}</>
  const eased = anim.target === value ? 1 - Math.pow(1 - anim.t, 3) : 0
  const shown = value * eased
  return <>{format ? format(shown) : Math.round(shown).toLocaleString()}</>
}

function DeltaBadge({ delta, cmpLabel }) {
  if (!delta || delta.flat) return <span className="text-[11px] text-gray-400 dark:text-slate-600">— flat</span>
  if (delta.isNew || Math.abs(delta.pct) > 999) return <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400" title={`No activity ${cmpLabel}`}>new</span>
  const up = delta.dir === 'up', down = delta.dir === 'down'
  const cls = up ? 'text-emerald-600 dark:text-emerald-400' : down ? 'text-rose-600 dark:text-rose-400' : 'text-gray-400 dark:text-slate-600'
  return (
    <span className={`text-[11px] font-medium ${cls}`} title={cmpLabel}>
      {up ? '▲' : down ? '▼' : '■'} {Math.abs(delta.pct).toFixed(0)}%
    </span>
  )
}

// ── Fleet Pulse hero stat ─────────────────────────────────────────────────
const PULSE_TONES = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  cyan: 'text-cyan-600 dark:text-cyan-400',
  amber: 'text-amber-600 dark:text-amber-400',
  slate: 'text-gray-900 dark:text-white',
}
function PulseStat({ label, tone, value, format, sub, delta, cmpLabel, hero }) {
  return (
    <div className={hero ? 'col-span-2' : ''}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`font-mono font-semibold leading-none mt-1.5 ${PULSE_TONES[tone] || PULSE_TONES.slate} ${hero ? 'text-5xl lg:text-6xl tracking-tight' : 'text-3xl lg:text-4xl'}`}>
        <CountUp value={value} format={format} />
      </p>
      <div className="flex items-center gap-2 mt-2">
        <DeltaBadge delta={delta} cmpLabel={cmpLabel} />
        {sub && <span className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</span>}
      </div>
    </div>
  )
}

// Hero stat with company/owner-op ownership split
function PulseStatWithOwnership({ label, pulseData, pulsePrior, cmpLabel }) {
  if (!pulseData) return null
  const totalRealized = pulseData.total.realized
  const companyRealized = pulseData.company.realized
  const ownerOpRealized = pulseData.ownerOp.realized
  const companyPct = totalRealized > 0 ? ((companyRealized / totalRealized) * 100).toFixed(0) : 0
  const ownerOpPct = totalRealized > 0 ? ((ownerOpRealized / totalRealized) * 100).toFixed(0) : 0
  const totalDelta = pulsePrior ? pctDelta(totalRealized, pulsePrior.total.realized) : null

  return (
    <div className="col-span-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">{label}</p>
      <p className="font-mono font-semibold leading-none mt-1.5 text-emerald-600 dark:text-emerald-400 text-5xl lg:text-6xl tracking-tight">
        <CountUp value={totalRealized} format={fmtMoney} />
      </p>
      <div className="flex items-center gap-2 mt-2 mb-3">
        <DeltaBadge delta={totalDelta} cmpLabel={cmpLabel} />
      </div>
      <div className="space-y-1.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-gray-600 dark:text-slate-400">Company</span>
          <span className="font-mono text-gray-900 dark:text-white">{fmtMoney(companyRealized)} <span className="text-gray-500 dark:text-slate-400">({companyPct}%)</span></span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-gray-600 dark:text-slate-400">Owner-op <span className="text-[10px] text-gray-400 dark:text-slate-500">(pass-through)</span></span>
          <span className="font-mono text-gray-900 dark:text-white">{fmtMoney(ownerOpRealized)} <span className="text-gray-500 dark:text-slate-400">({ownerOpPct}%)</span></span>
        </div>
      </div>
    </div>
  )
}

// ── Customer concentration donut ──────────────────────────────────────────
const DONUT_COLORS = ['#f97316', '#06b6d4', '#34d399', '#a78bfa', '#fbbf24', '#f43f5e']
const OTHER_COLOR = '#64748b'

function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function Donut({ segments, centerTop, centerBottom }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  let angle = 0
  return (
    <svg viewBox="0 0 180 180" className="w-44 h-44 shrink-0">
      {total > 0 && segments.map((seg) => {
        const sweep = seg.value / total * 360
        const a0 = angle; angle += sweep
        if (sweep <= 0.5) return null
        // Full-circle arcs degenerate (start == end), so a lone segment
        // renders as a plain ring instead.
        if (sweep >= 359.5) return <circle key={seg.name} cx="90" cy="90" r="70" fill="none" stroke={seg.color} strokeWidth="24" />
        const pad = Math.min(1.4, sweep * 0.15)
        return (
          <path
            key={seg.name}
            d={arcPath(90, 90, 70, a0 + pad, a0 + sweep - pad)}
            fill="none" stroke={seg.color} strokeWidth="24" strokeLinecap="butt"
          >
            <title>{`${seg.name} — ${(seg.value / total * 100).toFixed(1)}%`}</title>
          </path>
        )
      })}
      <text x="90" y="86" textAnchor="middle" className="fill-gray-900 dark:fill-white font-mono font-semibold" fontSize="26">{centerTop}</text>
      <text x="90" y="104" textAnchor="middle" className="fill-gray-500 dark:fill-slate-400" fontSize="9.5" letterSpacing="1.5">{centerBottom}</text>
    </svg>
  )
}

function ConcentrationCard({ concentration }) {
  const [metric, setMetric] = useState('loads') // loads | revenue
  if (!concentration) {
    return (
      <div className={`${S.card} p-5 text-sm text-gray-400 dark:text-slate-500`}>
        No customer activity in this window.
      </div>
    )
  }
  const { rows, top, top4Loads, top4Revenue } = concentration
  const pctKey = metric === 'loads' ? 'pctLoads' : 'pctRevenue'
  const shown = rows.slice(0, 6)
  const otherPct = Math.max(0, 100 - shown.reduce((s, r) => s + r[pctKey], 0))
  const segments = [
    ...shown.map((r, i) => ({ name: r.name, value: r[pctKey], color: DONUT_COLORS[i % DONUT_COLORS.length] })),
    ...(otherPct > 0.5 ? [{ name: `Other (${rows.length - shown.length})`, value: otherPct, color: OTHER_COLOR }] : []),
  ]
  const severity = top.pctLoads >= 25 || top4Loads >= 60
    ? { label: 'High concentration', cls: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30' }
    : top.pctLoads >= 15 || top4Loads >= 45
      ? { label: 'Concentrated', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30' }
      : { label: 'Diversified', cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30' }

  return (
    <div className={`${S.card} p-5 flex flex-col gap-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Customer concentration</h2>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">share of {metric === 'loads' ? 'loads' : 'revenue (incl. booked)'} by broker</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-[11px] shrink-0">
          {[['loads', 'Loads'], ['revenue', 'Revenue']].map(([k, lbl]) => (
            <button key={k} onClick={() => setMetric(k)} className={`px-2.5 py-1 ${metric === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-5 flex-wrap">
        <Donut
          segments={segments}
          centerTop={`${top[pctKey].toFixed(0)}%`}
          centerBottom="TOP BROKER"
        />
        <div className="flex-1 min-w-[14rem] space-y-1.5">
          {shown.map((r, i) => (
            <div key={r.name} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
              <span className="flex-1 truncate text-gray-700 dark:text-slate-300">{r.name}</span>
              <span className="font-mono text-gray-900 dark:text-slate-200 w-12 text-right">{r[pctKey].toFixed(1)}%</span>
              <span className="font-mono text-[10px] text-gray-400 dark:text-slate-500 w-14 text-right">{metric === 'loads' ? `${r.pctRevenue.toFixed(0)}% rev` : `${r.pctLoads.toFixed(0)}% lds`}</span>
            </div>
          ))}
          {otherPct > 0.5 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: OTHER_COLOR }} />
              <span className="flex-1 truncate text-gray-400 dark:text-slate-500">Other · {rows.length - shown.length} brokers</span>
              <span className="font-mono text-gray-500 dark:text-slate-400 w-12 text-right">{otherPct.toFixed(1)}%</span>
              <span className="w-14" />
            </div>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2.5 pt-1 border-t border-gray-100 dark:border-white/5">
        <span className={`mt-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${severity.cls}`}>{severity.label}</span>
        <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed pt-1">
          <span className="font-medium text-gray-700 dark:text-slate-300">{top.name}</span> alone carries{' '}
          <span className="font-mono">{top.pctLoads.toFixed(0)}%</span> of loads; the top 4 brokers carry{' '}
          <span className="font-mono">{top4Loads.toFixed(0)}%</span> of volume and <span className="font-mono">{top4Revenue.toFixed(0)}%</span> of revenue.
        </p>
      </div>
    </div>
  )
}

// ── Auto-insights ─────────────────────────────────────────────────────────
const INSIGHT_TONES = {
  emerald: 'border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-400',
  cyan:    'border-cyan-200 dark:border-cyan-500/25 bg-cyan-50/60 dark:bg-cyan-500/[0.06] text-cyan-700 dark:text-cyan-400',
  amber:   'border-amber-200 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-500/[0.06] text-amber-700 dark:text-amber-400',
  rose:    'border-rose-200 dark:border-rose-500/25 bg-rose-50/60 dark:bg-rose-500/[0.06] text-rose-700 dark:text-rose-400',
  violet:  'border-violet-200 dark:border-violet-500/25 bg-violet-50/60 dark:bg-violet-500/[0.06] text-violet-700 dark:text-violet-400',
  orange:  'border-orange-200 dark:border-orange-500/25 bg-orange-50/60 dark:bg-orange-500/[0.06] text-orange-700 dark:text-orange-400',
}
function InsightCard({ insight }) {
  const tone = INSIGHT_TONES[insight.tone] || INSIGHT_TONES.orange
  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-80">{insight.kicker}</p>
      <p className="text-sm font-semibold mt-1 leading-snug text-gray-900 dark:text-white">{insight.headline}</p>
      <p className="text-[11px] mt-1 text-gray-500 dark:text-slate-400 leading-relaxed">{insight.detail}</p>
    </>
  )
  const cls = `rounded-2xl border p-3.5 ${tone} ${insight.to ? 'transition-transform hover:-translate-y-0.5 block' : ''}`
  return insight.to ? <Link to={insight.to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}

// ── Leaderboards ──────────────────────────────────────────────────────────
function LeaderRow({ rank, name, value, sub, barPct, tone = 'orange' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-4 text-[10px] font-mono text-gray-400 dark:text-slate-500 text-right shrink-0">{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-gray-800 dark:text-slate-200 truncate">{name}</span>
          <span className="text-xs font-mono text-gray-900 dark:text-white shrink-0">{value}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="flex-1 h-1 rounded-full bg-gray-100 dark:bg-white/[0.05] overflow-hidden">
            <div className={`h-full rounded-full ${tone === 'rose' ? 'bg-rose-400/80' : 'bg-orange-400/80'}`} style={{ width: `${Math.max(2, Math.min(100, barPct))}%` }} />
          </div>
          {sub && <span className="text-[10px] font-mono text-gray-400 dark:text-slate-500 shrink-0">{sub}</span>}
        </div>
      </div>
    </div>
  )
}

function LeaderCard({ title, subtitle, rows, trailing, footer }) {
  return (
    <div className={`${S.card} p-5 flex flex-col gap-3`}>
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        {subtitle && <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-2.5">
        {rows.length === 0 && <p className="text-xs text-gray-400 dark:text-slate-500">No realized activity in this window.</p>}
        {rows.map(({ key, ...r }, i) => <LeaderRow key={key} rank={i + 1} {...r} />)}
      </div>
      {trailing && trailing.length > 0 && (
        <div className="pt-2 border-t border-gray-100 dark:border-white/5 space-y-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-600/80 dark:text-rose-400/80">Trailing</p>
          {trailing.map(({ key, ...r }, i) => <LeaderRow key={key} rank={i + 1} tone="rose" {...r} />)}
        </div>
      )}
      {footer && <p className="text-[11px] text-gray-400 dark:text-slate-500 pt-2 border-t border-gray-100 dark:border-white/5 mt-auto">{footer}</p>}
    </div>
  )
}

// rollup rows → leaderboard rows (top by gross, with $/mile alongside)
function boardRows(rollupRows, { top = 5, bottom = 3 } = {}) {
  const realized = (rollupRows || [])
    .filter(r => (r.key_name || r.key_id) && Number(r.realized_loads) > 0)
    .map(r => ({
      key: r.key_id || `raw:${r.key_name}`,
      name: r.key_name || '(unassigned)',
      gross: Number(r.realized_revenue) || 0,
      rpm: r.realized_rpm == null ? null : Number(r.realized_rpm),
      miles: Number(r.total_miles) || 0,
      activeDays: Number(r.active_days) || 0,
    }))
    .sort((a, b) => b.gross - a.gross)
  const max = realized[0]?.gross || 1
  const toRow = (r) => ({
    key: r.key, name: r.name,
    value: fmtMoney(r.gross),
    sub: r.rpm == null ? null : fmtRpm(r.rpm) + '/mi',
    barPct: r.gross / max * 100,
  })
  return {
    top: realized.slice(0, top).map(toRow),
    bottom: realized.length > top ? realized.slice(-bottom).reverse().map(toRow) : [],
    all: realized,
  }
}

// ── Deep-view hub cards ───────────────────────────────────────────────────
function HubCard({ to, title, blurb, stat, art }) {
  return (
    <Link to={to} className={`${S.card} p-5 group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:border-orange-300 dark:hover:border-orange-500/40 block`}>
      <div className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-orange-500/[0.07] blur-2xl group-hover:bg-orange-500/[0.14] transition-colors" />
      <div className="flex items-start justify-between gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/25 flex items-center justify-center text-orange-600 dark:text-orange-400">{art}</div>
        <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity">Open →</span>
      </div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mt-3">{title}</h3>
      <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 leading-relaxed">{blurb}</p>
      {stat && <p className="text-[11px] font-mono text-gray-700 dark:text-slate-300 mt-2.5 pt-2.5 border-t border-gray-100 dark:border-white/5 truncate">{stat}</p>}
    </Link>
  )
}

const HUB_ART = {
  map: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
  bars: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  cards: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-6 4h4" /></svg>,
}

// ── Roadmap to net margin ─────────────────────────────────────────────────
// The honest framing of what's NOT here yet: each cost input below lands in
// the same rollup these numbers come from. Live items are real today; the
// rest render as a plan, never as a number.
const ROADMAP = [
  { label: 'Equipment carrying cost', status: 'live', note: 'powering Contribution today' },
  { label: 'Truck purchase payments', status: 'live', note: 'deducted per unit' },
  { label: 'Debt service', status: 'next', note: 'Debt Schedule already tracks every loan' },
  { label: 'Driver pay', status: 'coming', note: 'settlement import' },
  { label: 'Fuel', status: 'coming', note: 'fuel-card feed' },
  { label: 'Insurance', status: 'coming', note: 'policy allocation' },
]
function RoadmapPanel() {
  const live = ROADMAP.filter(r => r.status === 'live').length
  return (
    <div className={`${S.card} relative overflow-hidden p-5 lg:p-6`}>
      <div className="pointer-events-none absolute inset-x-0 -top-20 h-40 bg-gradient-to-b from-cyan-500/[0.06] to-transparent" />
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">Roadmap</p>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mt-0.5">Net margin — unlocking next</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Every gross dollar on this screen is real. The cost inputs below connect into the same data spine — as each
            one lands, gross turns into true net on this very page. Until then, BUDDY shows the plan, never an estimate.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-mono font-semibold text-gray-900 dark:text-white">{live}<span className="text-gray-400 dark:text-slate-500 text-base"> / {ROADMAP.length}</span></p>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">inputs connected</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-4">
        {ROADMAP.map(item => (
          <div key={item.label} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
            item.status === 'live'
              ? 'border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/50 dark:bg-emerald-500/[0.05]'
              : item.status === 'next'
                ? 'border-cyan-200 dark:border-cyan-500/25 bg-cyan-50/40 dark:bg-cyan-500/[0.04]'
                : 'border-gray-200 dark:border-white/[0.07] bg-gray-50/50 dark:bg-white/[0.02]'
          }`}>
            {item.status === 'live' ? (
              <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              </span>
            ) : (
              <span className="w-5 h-5 flex items-center justify-center shrink-0">
                <span className={`w-2 h-2 rounded-full ${item.status === 'next' ? 'bg-cyan-400 animate-pulse' : 'border-2 border-gray-300 dark:border-slate-600'}`} />
              </span>
            )}
            <div className="min-w-0">
              <p className={`text-xs font-medium truncate ${item.status === 'coming' ? 'text-gray-500 dark:text-slate-400' : 'text-gray-800 dark:text-slate-200'}`}>{item.label}</p>
              <p className="text-[10px] text-gray-400 dark:text-slate-500 truncate">
                {item.status === 'live' ? '✓ live · ' : item.status === 'next' ? 'connecting · ' : 'coming · '}{item.note}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Boardroom() {
  const toast = useToast()
  const [preset, setPreset] = useState('week')
  const [range, setRange] = useState(thisWeek)
  const [basis, setBasis] = useState('delivery')

  // Period-keyed async state (the Spotlight derivation pattern): a range or
  // basis change invalidates the data by key, no reset-effects needed.
  const dataKey = `${range.from}|${range.to}|${basis}`
  const [state, setState] = useState({ key: null, data: null })
  useEffect(() => {
    let stale = false
    fetchBoardroom({ from: range.from, to: range.to, basis })
      .then(d => { if (!stale) setState({ key: dataKey, data: d }) })
      .catch(err => {
        if (!stale) {
          toast.error("Couldn't load the Boardroom", err)
          setState({ key: dataKey, data: null })
        }
      })
    return () => { stale = true }
  }, [dataKey, range.from, range.to, basis, toast])

  const loading = state.key !== dataKey
  const data = loading ? null : state.data

  function setPresetRange(p) {
    setPreset(p)
    if (p === 'week') setRange(thisWeek())
    else if (p === 'month') setRange(thisMonth())
  }
  function shiftRange(dir) {
    setRange(r => {
      const span = spanDays(r.from, r.to)
      return { from: shiftYmd(r.from, dir * span), to: shiftYmd(r.to, dir * span) }
    })
  }

  const isWeek = spanDays(range.from, range.to) === 7
  const cmpLabel = isWeek ? 'vs last week' : 'vs prior period'
  const pulse = data?.pulse
  const drivers = data ? boardRows(data.driverRows) : null
  const dispatchers = data ? boardRows(data.dispatcherRows) : null
  const totalDrivers = (data?.driverRows || []).filter(r => r.key_id || r.key_name).length
  const activeDriverRows = drivers?.all || []
  const avgActiveDays = activeDriverRows.length
    ? activeDriverRows.reduce((s, r) => s + r.activeDays, 0) / activeDriverRows.length
    : null

  const hubStats = {
    lanes: data?.lanes?.payers?.best
      ? `${data.lanes.count} lanes live · best ${data.lanes.payers.best.origin.split(',')[0]} → ${data.lanes.payers.best.destination.split(',')[0]} ${fmtRpm(data.lanes.payers.best.rpm)}/mi`
      : data?.lanes ? `${data.lanes.count} lanes in this window` : null,
    contribution: data?.contribution
      ? `${data.contribution.count} units ranked · ${data.contribution.top.name} leads, ${data.contribution.bottom.name} trails`
      : 'revenue − equipment − purchase, per unit',
    spotlight: pulse ? `${pulse.cur.activeEntities} drivers ran loads — deck opens weakest-first` : null,
  }

  return (
    <div className="space-y-5">
      {/* ── Header: brand + period controls ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Manas Express · BUDDY
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">The Boardroom</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            The fleet's profit story, live — one screen for the owners.
            <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 align-middle whitespace-nowrap" title="Revenue, miles, lanes, concentration, utilization, and equipment-cost contribution are live data. Driver pay, fuel, and insurance aren't connected yet, so true net margin is shown as a roadmap — never an estimate.">
              Revenue & partial contribution — net margin on the roadmap
            </span>
          </p>
        </div>
        <div className="flex flex-col gap-1.5 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => shiftRange(-1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Previous period">◀</button>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0">
              {[['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, lbl]) => (
                <button key={k} onClick={() => setPresetRange(k)} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${preset === k ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>{lbl}</button>
              ))}
            </div>
            <button onClick={() => shiftRange(1)} className="px-2 py-1.5 text-xs font-medium rounded border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors" title="Next period">▶</button>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0">
              <button onClick={() => setBasis('delivery')} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${basis === 'delivery' ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>By delivery</button>
              <button onClick={() => setBasis('pickup')} className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${basis === 'pickup' ? 'bg-orange-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>By pickup</button>
            </div>
            {preset === 'custom' && (
              <>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
                <span className="text-gray-400 text-xs shrink-0">→</span>
                <input type="date" className={`${S.input} w-auto shrink-0 min-w-[8.5rem]`} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
              </>
            )}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">{PRESET_LABEL[preset]} · <span className="font-medium text-gray-500 dark:text-slate-400">{formatRange(range.from, range.to)}</span> · by {basis} date</p>
        </div>
      </div>

      {/* ── 1 · Fleet Pulse hero ── */}
      <div className="relative overflow-hidden rounded-3xl border border-gray-200 dark:border-white/10 bg-gradient-to-br from-white via-gray-50 to-white dark:from-[#15163a] dark:via-[#0d0d1f] dark:to-[#0a0a18] p-6 lg:p-8">
        <div className="pointer-events-none absolute -top-28 -right-20 w-96 h-96 rounded-full bg-orange-500/[0.10] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 w-96 h-96 rounded-full bg-cyan-500/[0.07] blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400 dark:text-slate-500 mb-5">Fleet pulse · {formatRange(range.from, range.to)}</p>
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className={i === 0 ? 'col-span-2' : ''}>
                  <div className="h-3 w-20 rounded bg-gray-200 dark:bg-white/[0.06] animate-pulse" />
                  <div className={`mt-2 rounded bg-gray-200 dark:bg-white/[0.08] animate-pulse ${i === 0 ? 'h-14 w-48' : 'h-9 w-28'}`} />
                </div>
              ))}
            </div>
          ) : pulse && data?.pulseWithOwnership ? (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-x-6 gap-y-7 items-end">
              <PulseStatWithOwnership label="Total billed freight" pulseData={data.pulseWithOwnership} pulsePrior={data.pulseWithOwnershipPrior} cmpLabel={cmpLabel} />
              <PulseStat label="Realized $/mile" tone="amber" value={pulse.cur.rpm} format={n => (n == null ? '—' : `$${n.toFixed(2)}`)}
                delta={pctDelta(pulse.cur.rpm, pulse.prior.rpm)} cmpLabel={cmpLabel} />
              <PulseStat label="Booked pipeline" tone="cyan" value={pulse.cur.projected} format={fmtMoney}
                sub={`${fmtNum(pulse.cur.bookedLoads)} loads · incl. owner-op`}
                delta={pctDelta(pulse.cur.projected, pulse.prior.projected)} cmpLabel={cmpLabel} />
              <PulseStat label="Realized miles" tone="slate" value={pulse.cur.miles} format={n => fmtNum(n)}
                delta={pctDelta(pulse.cur.miles, pulse.prior.miles)} cmpLabel={cmpLabel} />
              <PulseStat label="Active drivers" tone="slate" value={pulse.cur.activeEntities} format={n => fmtNum(n)}
                sub={`of ${totalDrivers}`}
                delta={pctDelta(pulse.cur.activeEntities, pulse.prior.activeEntities)} cmpLabel={cmpLabel} />
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-slate-500 py-6">Couldn't load the pulse — check the connection and try another period.</p>
          )}
        </div>
      </div>

      {/* ── 3 · Auto-insights strip ── */}
      {data && data.insights.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-500 mb-2 flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-orange-500 animate-pulse" />
            Auto-insights · derived live from this period's data
          </p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {data.insights.map(ins => <InsightCard key={ins.key} insight={ins} />)}
          </div>
        </div>
      )}

      {/* ── 2 + 4 · Concentration & leaderboards ── */}
      <div className="grid lg:grid-cols-3 gap-4 items-stretch">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className={`${S.card} h-72 animate-pulse`} />)
        ) : (
          <>
            <ConcentrationCard concentration={data?.concentration} />
            <LeaderCard
              title="Drivers"
              subtitle="realized gross · $/mile alongside"
              rows={drivers?.top || []}
              trailing={drivers?.bottom || []}
              footer={pulse ? `Utilization: ${pulse.cur.activeEntities} of ${totalDrivers} drivers ran loads${avgActiveDays != null ? ` · avg ${avgActiveDays.toFixed(1)} of ${data.effDays} elapsed days active` : ''}` : null}
            />
            <LeaderCard
              title="Dispatchers"
              subtitle="realized gross · $/mile alongside"
              rows={dispatchers?.top || []}
              trailing={dispatchers?.bottom || []}
              footer={data ? `${(dispatchers?.all || []).length} dispatchers moved freight in this window` : null}
            />
          </>
        )}
      </div>

      {/* ── Lane Flow Map (embedded live) ── */}
      {loading ? (
        <div className={`${S.card} h-96 animate-pulse`} />
      ) : (
        <Suspense fallback={<div className={`${S.card} h-96 animate-pulse`} />}>
          <BoardroomLanePanel laneAgg={data?.lanes} />
        </Suspense>
      )}

      {/* ── 5 · Deep views hub ── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-slate-500 mb-2">Go deeper</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <HubCard
            to="/fleet/profitability/contribution"
            title="Profit Contribution"
            blurb="The partial-margin leaderboard — which units carry the fleet and which ones burn money."
            stat={hubStats.contribution}
            art={HUB_ART.bars}
          />
          <HubCard
            to="/fleet/profitability/spotlight"
            title="Driver Spotlight"
            blurb="Flip through per-driver dossiers, weakest first — benchmark, lanes, and utilization per card."
            stat={hubStats.spotlight}
            art={HUB_ART.cards}
          />
        </div>
      </div>

      {/* ── 6 · Roadmap teaser ── */}
      <RoadmapPanel />

      {/* ── Honesty footer ── */}
      <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center max-w-3xl mx-auto pb-2">
        Revenue, miles, $/mile, lanes (map embedded live), broker concentration, ownership split, utilization, and the
        equipment-cost contribution are real BUDDY data for the selected window. Driver pay, fuel, insurance — and
        therefore true net margin — are not connected yet and are never estimated on this screen.
      </p>
    </div>
  )
}
