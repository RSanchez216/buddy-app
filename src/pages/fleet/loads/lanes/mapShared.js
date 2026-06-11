// Shared US-map frame for the lane canvases. The us-atlas topology is
// pre-projected to a 975×610 AlbersUSA frame, so states render with a bare
// geoPath() and cities go through the matching geoAlbersUsa() projection
// (same scale/translate us-atlas used).
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import usTopo from './usStatesAlbers.json'

export const MAP_W = 975
export const MAP_H = 610
export const projection = geoAlbersUsa().scale(1300).translate([MAP_W / 2, MAP_H / 2])

const statePath = geoPath()
export const STATES_OUTLINE = statePath(mesh(usTopo, usTopo.objects.states, (a, b) => a !== b))
export const NATION_OUTLINE = statePath(feature(usTopo, usTopo.objects.nation))

// ── Heat grid ───────────────────────────────────────────────────────────
export const HEAT_CELL = 26 // cell size in the projected frame

// Bin geocoded lanes into heat cells. Each leg contributes its origin and
// destination point; off-map legs are excluded exactly as in the arc view.
// Cells keep stats for the ramp/tooltip plus a deduped leg list so clicking
// a hot spot can show the loads behind it.
export function binHeatCells(lanes) {
  const cells = new Map()
  for (const lane of lanes || []) {
    if (!lane.geocoded) continue
    const o = projection([lane.oCoord[1], lane.oCoord[0]])
    const d = projection([lane.dCoord[1], lane.dCoord[0]])
    if (!o || !d) continue
    for (const leg of lane.legs) {
      const revenue = Number(leg.leg_revenue) || 0
      const miles = Number(leg.leg_total_miles) || 0
      const rpm = miles > 0 ? revenue / miles : null
      for (const [p, city] of [[o, lane.origin], [d, lane.destination]]) {
        const cx = Math.floor(p[0] / HEAT_CELL), cy = Math.floor(p[1] / HEAT_CELL)
        const key = `${cx},${cy}`
        let c = cells.get(key)
        if (!c) { c = { key, cx, cy, revenue: 0, loads: 0, wNum: 0, wDen: 0, cities: new Map(), legMap: new Map() }; cells.set(key, c) }
        c.revenue += revenue
        c.loads++
        // $/mile is an average, never a sum: revenue-weighted so one hot
        // load outweighs many cheap ones, and unpriced legs don't drag.
        if (rpm != null) { c.wNum += rpm * revenue; c.wDen += revenue }
        c.cities.set(city, (c.cities.get(city) || 0) + revenue)
        if (!c.legMap.has(leg.leg_id)) c.legMap.set(leg.leg_id, leg)
      }
    }
  }
  const list = [...cells.values()]
  for (const c of list) {
    c.rpm = c.wDen > 0 ? c.wNum / c.wDen : null
    c.topCity = [...c.cities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    c.legs = [...c.legMap.values()]
    delete c.legMap
  }
  return list
}
