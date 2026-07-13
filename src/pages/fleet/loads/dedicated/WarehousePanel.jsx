import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TRAILER_TYPE_COLORS, daysBucket } from './dedicatedData'
import { fmtMoney } from '../spotlight/spotlightShared'
import { StatusPill } from './dedicatedUi'
import { fmtDay, fmtDateTime, formatTelegramMessage, DAYS_TEXT } from './dedicatedFormat'
import TelegramSettings from './TelegramSettings'

// The lane's yard — trailer cards grouped by facility (Origin bays / Destination
// bays) using each trailer's position. On-road trailers (working, no cost) and
// any off-lane/unknown are listed separately. Aging (≥10d) and missing-rate
// trailers are flagged, not hidden.

function TrailerBay({ t, index, onHook }) {
  const bucket = daysBucket(t.idle_days)
  return (
    <div
      className={`dl-bay relative rounded-xl border bg-white dark:bg-white/[0.04] p-3.5 pb-4 transition-all duration-200
        hover:-translate-y-1 hover:shadow-lg dark:hover:shadow-black/40 hover:border-gray-300 dark:hover:border-white/20
        ${t.aging ? 'border-red-300 dark:border-red-500/40 dl-bay-aging' : 'border-gray-200 dark:border-white/10'}`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div className="absolute top-2.5 right-2.5 flex gap-1">
        {t.missing_rate && (
          <span className="text-[8.5px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30" title="Lease has no fixed daily rate — idle cost not computed">
            NO FIXED RATE
          </span>
        )}
        {t.aging && (
          <span className="text-[9px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30">
            AGING
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-extrabold text-gray-900 dark:text-white tabular-nums">{t.unit}</span>
        <span className="text-[9px] font-extrabold tracking-wide text-white rounded-md px-1.5 py-0.5"
          style={{ background: TRAILER_TYPE_COLORS[t.type] || TRAILER_TYPE_COLORS.Unassigned }}>{t.type || 'Unassigned'}</span>
      </div>
      <div className={`mt-2.5 text-[26px] leading-none font-extrabold tabular-nums ${DAYS_TEXT[bucket]}`}>
        {t.idle_days}<span className="text-[13px] font-bold"> d</span>
      </div>
      <div className="text-[10px] text-gray-500 dark:text-slate-400 mb-2.5">
        parked · {t.missing_rate ? 'no rate' : `${fmtMoney(t.idle_cost)} idle cost`}
      </div>
      <dl className="space-y-1 text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-500">Last used</dt>
          <dd className="font-semibold text-gray-700 dark:text-slate-300">{fmtDay(t.last_used)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-slate-500">Last driver</dt>
          <dd className="font-semibold text-gray-700 dark:text-slate-300">{t.last_driver || '—'}</dd>
        </div>
      </dl>
      {onHook && (
        <button onClick={onHook}
          className="mt-2.5 w-full inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/30 rounded-lg py-1.5 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors">
          Hook / depart
        </button>
      )}
    </div>
  )
}

// Labeled endpoint for the lane header: ORIGIN/DESTINATION caption (same style as
// the modal's ORIGIN FACILITY caption), facility name, street address (when
// present), then city/state. Name/address wrap rather than blow out the panel.
function Endpoint({ role, facility }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400">{role}</div>
      <div className="text-[13px] font-bold text-gray-900 dark:text-white leading-snug break-words">{facility?.name || `${facility?.city}, ${facility?.state}`}</div>
      {facility?.address && <div className="text-[11px] text-gray-500 dark:text-slate-400 break-words">{facility.address}</div>}
      <div className="text-[11px] text-gray-500 dark:text-slate-400">{facility?.city}, {facility?.state}</div>
    </div>
  )
}

function BayGroup({ title, facility, trailers, startIndex, onHook }) {
  if (!trailers.length) return null
  return (
    <div>
      <div className="flex items-baseline justify-between px-1 mb-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400">{title}</span>
        <span className="text-[11px] text-gray-400 dark:text-slate-500">
          {facility?.address ? `${facility.address} · ` : ''}{facility ? `${facility.city}, ${facility.state}` : ''} · {trailers.length}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {trailers.map((t, i) => (
          <TrailerBay key={t.trailer_id || t.unit} t={t} index={startIndex + i}
            onHook={onHook && t.trailer_id ? () => onHook({ pickedTrailerId: t.trailer_id, facilityId: facility?.id }) : undefined} />
        ))}
      </div>
    </div>
  )
}

// Onboarding progress — staged of broker target. Lane is active from the first
// drop; the target only drives this progress display, never gates activation.
function OnboardingCard({ stagedCount, required, planned, trailerMap, canEdit, onAddPlanned, onDeletePlanned, onOnboard }) {
  const pct = required > 0 ? Math.min(100, Math.round((stagedCount / required) * 100)) : 0
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3.5 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400">Onboarding</span>
        <span className="text-[13px] font-extrabold tabular-nums text-gray-900 dark:text-white">
          {required ? `${stagedCount} of ${required} staged` : `${stagedCount} staged`}
        </span>
      </div>
      {canEdit && onOnboard && (
        <button onClick={onOnboard}
          className="w-full inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-gray-600 dark:text-slate-300 border border-dashed border-gray-300 dark:border-slate-700 rounded-lg py-1.5 hover:border-orange-300 dark:hover:border-orange-500/40 hover:text-orange-600 dark:hover:text-orange-400 transition-colors">
          ＋ Record onboarding drop <span className="font-normal text-gray-400">(starting location)</span>
        </button>
      )}
      {required > 0 && (
        <div className="h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-white/[0.06]" role="img" aria-label={`${stagedCount} of ${required} staged`}>
          <span className="block h-full bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {(planned.length > 0 || canEdit) && (
        <div className="space-y-1.5">
          {planned.map(p => {
            const label = p.trailer_label || (p.trailer_id ? `#${trailerMap.get(p.trailer_id) || '—'}` : 'unnamed')
            const done = !!p.fulfilled_event_id
            return (
              <div key={p.id} className="flex items-center gap-2 text-[12px]">
                <span className={`inline-flex items-center gap-1 font-semibold ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-slate-600'}`} />
                  {label}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{done ? 'staged' : 'pending'}</span>
                {canEdit && (
                  <button onClick={() => onDeletePlanned(p.id)} className="ml-auto text-gray-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors" aria-label="Remove planned trailer">✕</button>
                )}
              </div>
            )
          })}
          {canEdit && <AddPlanned onAdd={onAddPlanned} />}
        </div>
      )}
    </div>
  )
}

function AddPlanned({ onAdd }) {
  const [label, setLabel] = useState('')
  const add = () => { const v = label.trim(); if (!v) return; onAdd({ trailerLabel: v }); setLabel('') }
  return (
    <div className="flex items-center gap-2 pt-1">
      <input value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
        placeholder="add planned trailer (unit # or label)"
        className="flex-1 px-2.5 py-1.5 text-[12px] bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
      <button onClick={add} disabled={!label.trim()}
        className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-40">Add</button>
    </div>
  )
}

// Copy-to-clipboard button with a brief "Copied" state. Plain text only.
function CopyTelegramButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600) }
    catch (e) { console.error('[copy] clipboard blocked', e) }
  }
  return (
    <button onClick={copy}
      className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-lg border px-2 py-1 transition-colors ${copied
        ? 'border-emerald-300 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
        : 'border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'} ${className}`}>
      {copied ? 'Copied' : 'Copy for Telegram'}
    </button>
  )
}

// Drop / hook audit trail, newest first. Each row carries a Telegram copy action.
function HistoryList({ events, trailerMap, driverMap, truckMap, recipients }) {
  return (
    <div>
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400 px-1 mb-2">Drop / hook history · {events.length}</div>
      {events.length === 0 ? (
        <p className="text-[12px] text-gray-400 dark:text-slate-500 px-1">No yard events recorded yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {events.map(e => {
            const msg = formatTelegramMessage({
              truckUnit: truckMap.get(e.driver_id),
              driverName: driverMap.get(e.driver_id),
              droppedUnit: e.dropped_trailer_id ? trailerMap.get(e.dropped_trailer_id) : null,
              pickedUnit: e.picked_trailer_id ? trailerMap.get(e.picked_trailer_id) : null,
              locationText: e.location_text,
              occurredAt: e.occurred_at,
              recipients,
            })
            return (
              <li key={e.id} className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03] px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-700 dark:text-slate-300 tabular-nums">{fmtDateTime(e.occurred_at)}</span>
                  {e.is_initial && <span className="text-[9px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/30">INITIAL</span>}
                  <CopyTelegramButton text={msg} className="ml-auto" />
                </div>
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-gray-600 dark:text-slate-400">
                  {e.dropped_trailer_id && <span className="text-orange-600 dark:text-orange-400 font-semibold">▼ drop #{trailerMap.get(e.dropped_trailer_id) || '—'}</span>}
                  {e.picked_trailer_id && <span className="text-cyan-600 dark:text-cyan-400 font-semibold">▲ hook #{trailerMap.get(e.picked_trailer_id) || '—'}</span>}
                  {e.driver_id && <span>· {driverMap.get(e.driver_id) || 'driver'}</span>}
                </div>
                {e.notes && <div className="mt-1 text-gray-500 dark:text-slate-500 italic">{e.notes}</div>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function SimpleList({ title, trailers, tone }) {
  if (!trailers.length) return null
  return (
    <div>
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-gray-500 dark:text-slate-400 px-1 mb-2">{title} · {trailers.length}</div>
      <div className="flex flex-wrap gap-1.5">
        {trailers.map(t => (
          <span key={t.trailer_id || t.unit} className={`inline-flex items-center gap-1.5 text-[11px] font-bold rounded-lg px-2 py-1 border ${tone}`}>
            <span className="tabular-nums">{t.unit}</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: TRAILER_TYPE_COLORS[t.type] || TRAILER_TYPE_COLORS.Unassigned }} />
            {t.last_driver && <span className="font-medium opacity-70">{t.last_driver}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

function HomeYardCard({ homeYard, onBack }) {
  return (
    <div key="home" className="dl-panel-in">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rotate-45 rounded-[3px] bg-gray-500 shrink-0" />
            <h3 className="text-[16px] font-extrabold text-gray-900 dark:text-white uppercase">Home Yard</h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1 uppercase">{homeYard.city}, {homeYard.state} · not a dedicated lane</p>
        </div>
        <button onClick={onBack} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors shrink-0">← Back to map</button>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold tabular-nums text-gray-900 dark:text-white">{homeYard.count}</span>
          <span className="text-sm text-gray-500 dark:text-slate-400">trailers sitting with no lane purpose</span>
        </div>
        <p className="text-[13px] leading-relaxed text-gray-600 dark:text-slate-400">
          This is the <b className="text-gray-900 dark:text-slate-200">true-idle</b> bucket. Trailers staged in a dedicated lane are
          positioned to earn; these are parked with nothing scheduled. Idle Review should treat the two very differently.
        </p>
        <Link to="/fleet/profitability/idle" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-500 transition-colors">
          Open Idle Review
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
        </Link>
      </div>
    </div>
  )
}

export default function WarehousePanel({ lane, homeYard, onBack, onEdit, canEdit,
  events = [], planned = [], staged = [], trailerMap = new Map(), driverMap = new Map(), truckMap = new Map(),
  recipients = [], onRecordEvent, onAddPlanned, onDeletePlanned, onSaveRecipients }) {
  if (lane === 'home') return <HomeYardCard homeYard={homeYard} onBack={onBack} />

  if (!lane) {
    return (
      <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-3 p-8 text-center">
        <svg className="w-10 h-10 text-gray-200 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.25}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm text-gray-400 dark:text-slate-500 max-w-[220px]">Select a lane on the map to open its yards.</p>
      </div>
    )
  }

  const trailers = lane.trailers || []
  const originT = trailers.filter(t => t.position === 'origin')
  const destT = trailers.filter(t => t.position === 'destination')
  const onRoad = trailers.filter(t => t.position === 'on_road')
  const offLane = trailers.filter(t => t.position === 'off_lane' || t.position === 'unknown')
  const net = Number(lane.net_mtd) || 0

  return (
    <div key={lane.lane_id} className="dl-panel-in">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-extrabold text-gray-900 dark:text-white truncate">{lane.name}</h3>
            <div className="flex items-start gap-3 mt-2">
              <Endpoint role="Origin" facility={lane.origin} />
              <div className="shrink-0 pt-4 text-gray-300 dark:text-slate-600 text-base leading-none" aria-hidden="true">→</div>
              <Endpoint role="Destination" facility={lane.destination} />
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-2 flex items-center gap-1.5 flex-wrap">
              <span>{lane.customer || 'no customer linked'}</span>
              <StatusPill status={lane.status} days={lane.days_in_status} />
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {canEdit && onRecordEvent && (
              <button onClick={() => onRecordEvent({ facilityId: lane.origin?.id })} className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-400 rounded-lg px-2.5 py-1.5 transition-colors shadow-sm shadow-orange-500/20">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Record event
              </button>
            )}
            {onEdit && (
              <button onClick={() => onEdit(lane)} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-500 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Edit
              </button>
            )}
            <button onClick={onBack} className="text-xs font-semibold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors">← Back to map</button>
          </div>
        </div>
        <dl className="flex gap-6 mt-3.5 flex-wrap">
          {[
            ['trailers', String(lane.trailers_staged ?? trailers.length), null],
            ['avg idle', `${(Number(lane.avg_idle_days) || 0).toFixed(1)}d`, null],
            ['idle cost · MTD', fmtMoney(lane.idle_cost_mtd), null],
            ['net · MTD', `${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))}`, net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'],
          ].map(([k, v, cls]) => (
            <div key={k}>
              <dd className={`text-[15px] font-extrabold tabular-nums ${cls || 'text-gray-900 dark:text-white'}`}>{v}</dd>
              <dt className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{k}</dt>
            </div>
          ))}
        </dl>
        {lane.missing_rate_count > 0 && (
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">⚠ {lane.missing_rate_count} parked trailer{lane.missing_rate_count === 1 ? '' : 's'} with no fixed daily rate — idle cost understated.</p>
        )}
      </div>

      <div className="p-3.5 dl-asphalt space-y-4">
        <OnboardingCard stagedCount={staged.length} required={lane.required_trailers} planned={planned}
          trailerMap={trailerMap} canEdit={canEdit} onAddPlanned={onAddPlanned} onDeletePlanned={onDeletePlanned}
          onOnboard={onRecordEvent ? () => onRecordEvent({ isInitial: true, facilityId: lane.origin?.id }) : undefined} />

        {originT.length === 0 && destT.length === 0 && onRoad.length === 0 && offLane.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400 dark:text-slate-500">No trailers on this lane yet.</p>
        ) : (
          <>
            <BayGroup title="Origin bays" facility={lane.origin} trailers={originT} startIndex={0} onHook={canEdit ? onRecordEvent : undefined} />
            <BayGroup title="Destination bays" facility={lane.destination} trailers={destT} startIndex={originT.length} onHook={canEdit ? onRecordEvent : undefined} />
            <SimpleList title="On the road (working · no cost)" trailers={onRoad} tone="border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" />
            <SimpleList title="Off-lane" trailers={offLane} tone="border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] text-gray-500 dark:text-slate-400" />
          </>
        )}

        <HistoryList events={events} trailerMap={trailerMap} driverMap={driverMap} truckMap={truckMap} recipients={recipients} />

        <TelegramSettings recipients={recipients} canEdit={canEdit} onSave={onSaveRecipients} />
      </div>
    </div>
  )
}
