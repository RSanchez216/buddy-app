import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import LaneMapCanvas from '../lanes/LaneMapCanvas'
import { makeRpmScale, makeWidthScale, CITY_COORDS } from '../lanes/laneData'
import { S } from '../../../../lib/styles'

// Compact lane map for the Boardroom, embedded live. Reuses the existing
// map canvas; lazy-loaded so first paint of the Boardroom is unaffected.

export default function BoardroomLanePanel({ laneAgg }) {
  if (!laneAgg) {
    return (
      <div className={`${S.card} p-5 text-sm text-gray-400 dark:text-slate-500`}>
        No lane data for this period.
      </div>
    )
  }

  const { lanes, cities } = laneAgg
  const rpmScale = useMemo(() => makeRpmScale(lanes), [lanes])
  const widthFor = useMemo(() => makeWidthScale(lanes, 'revenue'), [lanes])
  const colorFor = useMemo(() => (rpm) => rpmScale.color(rpm), [rpmScale])

  return (
    <div className={`${S.card} p-5 flex flex-col gap-3`}>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Lane Flow Map</h2>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">where the money moves — origin → destination arcs colored by $/mile</p>
        </div>
        <Link to="/fleet/profitability/lanes" className="text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:underline whitespace-nowrap">
          Full map →
        </Link>
      </div>
      <div className="bg-gray-50 dark:bg-white/[0.02] rounded-xl overflow-hidden border border-gray-200 dark:border-white/5">
        <LaneMapCanvas lanes={lanes} cities={cities} colorFor={colorFor} widthFor={widthFor} selectedKey={null} onSelect={() => {}} />
      </div>
      <p className="text-[10px] text-gray-400 dark:text-slate-500">
        Revenue and miles are realized, live data. Net margin = profit pending driver pay, fuel, insurance.
      </p>
    </div>
  )
}
