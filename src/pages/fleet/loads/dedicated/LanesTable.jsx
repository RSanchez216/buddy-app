import { useState } from 'react'
import { S } from '../../../../lib/styles'
import { TRAILER_TYPE_COLORS } from './dedicatedData'
import { fmtMoney } from '../spotlight/spotlightShared'
import { StatusPill } from './dedicatedUi'
import { fmtDay, daysClass } from './dedicatedFormat'

// Table view — one row per lane; clicking expands the trailer breakdown.

function Net({ value }) {
  const v = Number(value) || 0
  return (
    <span className={`font-extrabold tabular-nums ${v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {v >= 0 ? '+' : '−'}{fmtMoney(Math.abs(v))}
    </span>
  )
}

const POS_LABEL = { origin: 'Origin', destination: 'Destination', on_road: 'On road', off_lane: 'Off-lane', unknown: '—' }

function TrailerBreakdown({ lane }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-gray-200 dark:border-white/5">
          <th className={`${S.th} !py-2 text-[10px]`}>Trailer</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Type</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Position</th>
          <th className={`${S.th} !py-2 text-[10px] !text-right`}>Idle days</th>
          <th className={`${S.th} !py-2 text-[10px] !text-right`}>Idle cost</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Last used</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Last driver</th>
        </tr>
      </thead>
      <tbody>
        {(lane.trailers || []).map(t => (
          <tr key={t.trailer_id || t.unit} className="border-b border-gray-100 dark:border-white/[0.03] last:border-0">
            <td className="px-4 py-2">
              <span className="font-extrabold text-gray-900 dark:text-white tabular-nums">{t.unit}</span>
              {t.aging && <span className="ml-2 text-[9px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30">AGING</span>}
              {t.missing_rate && <span className="ml-2 text-[9px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">NO FIXED RATE</span>}
            </td>
            <td className="px-4 py-2">
              <span className="text-[9px] font-extrabold tracking-wide text-white rounded-md px-1.5 py-0.5" style={{ background: TRAILER_TYPE_COLORS[t.type] || TRAILER_TYPE_COLORS.Unassigned }}>{t.type || 'Unassigned'}</span>
            </td>
            <td className="px-4 py-2 text-gray-600 dark:text-slate-400">{POS_LABEL[t.position] || t.position}</td>
            <td className={`px-4 py-2 text-right font-extrabold tabular-nums ${t.position === 'on_road' ? 'text-emerald-600 dark:text-emerald-400' : daysClass(t.idle_days)}`}>{t.position === 'on_road' ? '—' : `${t.idle_days}d`}</td>
            <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-slate-300">{t.missing_rate ? 'no rate' : fmtMoney(t.idle_cost)}</td>
            <td className="px-4 py-2 text-gray-700 dark:text-slate-300">{fmtDay(t.last_used)}</td>
            <td className="px-4 py-2 text-gray-700 dark:text-slate-300">{t.last_driver || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function LanesTable({ lanes }) {
  const [openId, setOpenId] = useState(null)

  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Lane</th>
              <th className={S.th}>Route</th>
              <th className={`${S.th} !text-right`}>Trailers</th>
              <th className={`${S.th} !text-right`}>Avg idle</th>
              <th className={`${S.th} !text-right`}>Loads · MTD</th>
              <th className={`${S.th} !text-right`}>Revenue</th>
              <th className={`${S.th} !text-right`}>Idle cost</th>
              <th className={`${S.th} !text-right`}>Net</th>
              <th className={S.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map(lane => {
              const open = openId === lane.lane_id
              return [
                <tr key={lane.lane_id}
                  className={`${S.tableRow} cursor-pointer ${open ? 'bg-orange-50/50 dark:bg-orange-500/[0.04]' : ''}`}
                  onClick={() => setOpenId(open ? null : lane.lane_id)} aria-expanded={open}>
                  <td className={S.td}>
                    <div className="flex items-center gap-2">
                      <span className={`text-gray-400 dark:text-slate-500 text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
                      <div>
                        <div className="font-extrabold text-gray-900 dark:text-white flex items-center gap-1.5">
                          {lane.name}
                          {lane.missing_rate_count > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" title="Parked trailers with no fixed daily rate">{lane.missing_rate_count} no-rate</span>}
                        </div>
                        <div className="text-[11px] text-gray-400 dark:text-slate-500">{lane.customer || 'no customer'}</div>
                      </div>
                    </div>
                  </td>
                  <td className={`${S.td} text-gray-700 dark:text-slate-300 whitespace-nowrap`}>{lane.origin.state} → {lane.destination.state}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-white font-semibold`}>{lane.trailers_staged}</td>
                  <td className={`${S.td} text-right tabular-nums font-bold ${daysClass(lane.avg_idle_days)}`}>{(Number(lane.avg_idle_days) || 0).toFixed(1)}d</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-700 dark:text-slate-300`}>{lane.loads_mtd}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-white font-semibold`}>{fmtMoney(lane.revenue_mtd)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-700 dark:text-slate-300`}>{fmtMoney(lane.idle_cost_mtd)}</td>
                  <td className={`${S.td} text-right`}><Net value={lane.net_mtd} /></td>
                  <td className={S.td}><StatusPill status={lane.status} days={lane.days_in_status} /></td>
                </tr>,
                <tr key={`${lane.lane_id}-drawer`}>
                  <td colSpan={9} className={`p-0 ${open ? 'border-b border-gray-200 dark:border-white/[0.03]' : ''}`}>
                    <div className={`dl-drawer ${open ? 'open' : ''}`}>
                      <div><div className="bg-gray-50/80 dark:bg-white/[0.02] px-2 py-2"><TrailerBreakdown lane={lane} /></div></div>
                    </div>
                  </td>
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
