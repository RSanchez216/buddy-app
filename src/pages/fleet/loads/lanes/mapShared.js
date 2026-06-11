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
