import { useState } from 'react'
import { S } from '../../../../lib/styles'
import { TRAILER_TYPE_COLORS } from '../../../../data/dedicatedLanesMock'
import { fmtMoney } from '../spotlight/spotlightShared'
import { StatusPill } from './dedicatedUi'
import { fmtDay, daysClass } from './dedicatedFormat'

// Table view — one row per lane; clicking expands the full trailer breakdown
// (same fields as the warehouse bays). Numbers are tabular so columns of
// money and days line up.

function Net({ value }) {
  return (
    <span className={`font-extrabold tabular-nums ${value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {value >= 0 ? '+' : '−'}{fmtMoney(Math.abs(value))}
    </span>
  )
}

function TrailerBreakdown({ lane }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-gray-200 dark:border-white/5">
          <th className={`${S.th} !py-2 text-[10px]`}>Trailer</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Type</th>
          <th className={`${S.th} !py-2 text-[10px] !text-right`}>Days parked</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Last used</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Last driver</th>
          <th className={`${S.th} !py-2 text-[10px]`}>Last service</th>
        </tr>
      </thead>
      <tbody>
        {lane.trailers.map(t => {
          const aging = (t.flags || []).includes('AGING')
          return (
            <tr key={t.unit} className="border-b border-gray-100 dark:border-white/[0.03] last:border-0">
              <td className="px-4 py-2">
                <span className="font-extrabold text-gray-900 dark:text-white tabular-nums">{t.unit}</span>
                {aging && (
                  <span className="ml-2 text-[9px] font-extrabold tracking-wide px-1.5 py-0.5 rounded-md bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30">
                    AGING
                  </span>
                )}
              </td>
              <td className="px-4 py-2">
                <span className="text-[9px] font-extrabold tracking-wide text-white rounded-md px-1.5 py-0.5"
                  style={{ background: TRAILER_TYPE_COLORS[t.type] || TRAILER_TYPE_COLORS.Unassigned }}>
                  {t.type}
                </span>
              </td>
              <td className={`px-4 py-2 text-right font-extrabold tabular-nums ${daysClass(t.daysParked)}`}>{t.daysParked}d</td>
              <td className="px-4 py-2 text-gray-700 dark:text-slate-300">{fmtDay(t.lastUsed)}</td>
              <td className="px-4 py-2 text-gray-700 dark:text-slate-300">{t.lastDriver || '—'}</td>
              <td className="px-4 py-2 italic text-gray-300 dark:text-slate-600">
                {t.lastService ? fmtDay(t.lastService) : 'coming soon'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function LanesTable({ lanes }) {
  const [openId, setOpenId] = useState(null)

  return (
    <div className={`${S.card} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className={S.tableHead}>
            <tr>
              <th className={S.th}>Lane</th>
              <th className={S.th}>Facility</th>
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
              const m = lane.metrics
              const open = openId === lane.id
              return [
                <tr key={lane.id}
                  className={`${S.tableRow} cursor-pointer ${open ? 'bg-orange-50/50 dark:bg-orange-500/[0.04]' : ''}`}
                  onClick={() => setOpenId(open ? null : lane.id)}
                  aria-expanded={open}>
                  <td className={S.td}>
                    <div className="flex items-center gap-2">
                      <span className={`text-gray-400 dark:text-slate-500 text-[10px] transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
                      <div>
                        <div className="font-extrabold text-gray-900 dark:text-white">{lane.name}</div>
                        <div className="text-[11px] text-gray-400 dark:text-slate-500">{lane.customer || 'no customer'}</div>
                      </div>
                    </div>
                  </td>
                  <td className={`${S.td} text-gray-700 dark:text-slate-300`}>{lane.facility.city}, {lane.facility.state}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-white font-semibold`}>{m.trailers}</td>
                  <td className={`${S.td} text-right tabular-nums font-bold ${daysClass(m.avgIdleDays)}`}>{m.avgIdleDays.toFixed(1)}d</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-700 dark:text-slate-300`}>{m.loadsMTD}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-900 dark:text-white font-semibold`}>{fmtMoney(m.revenueMTD)}</td>
                  <td className={`${S.td} text-right tabular-nums text-gray-700 dark:text-slate-300`}>{fmtMoney(m.idleCostMTD)}</td>
                  <td className={`${S.td} text-right`}><Net value={m.netMTD} /></td>
                  <td className={S.td}><StatusPill status={lane.status} /></td>
                </tr>,
                <tr key={`${lane.id}-drawer`}>
                  <td colSpan={9} className={`p-0 ${open ? 'border-b border-gray-200 dark:border-white/[0.03]' : ''}`}>
                    <div className={`dl-drawer ${open ? 'open' : ''}`}>
                      <div>
                        <div className="bg-gray-50/80 dark:bg-white/[0.02] px-2 py-2">
                          <TrailerBreakdown lane={lane} />
                        </div>
                      </div>
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
