// ═══════════════════════════════════════════════════════════════════════════
// DEDICATED LANES — MOCK DATA LAYER
//
// ⚠ SINGLE SWAP POINT for the real Supabase queries. Every row the Dedicated
// Lanes page renders comes from this module — the UI holds zero hardcoded
// data. When the schema lands, replace the exported constants below with
// fetchers and keep the shapes identical:
//
//   · daysParked / lastUsed / lastDriver  ← each trailer's most-recent leg
//     in v_load_leg_profit
//   · facility lat/lng                    ← geo_norm() → geo_places
//   · idleCostMTD                         ← idle days × equipCostPerDay
//   · lastService                         ← repair history (future feature;
//     null renders as "coming soon")
//
// Shapes (mirrors the agreed TS interfaces):
//
// @typedef {'profitable'|'watch'|'underwater'} LaneStatus
// @typedef {'Dry Van'|'Reefer'|'Flatbed'|'Step Deck'} TrailerType
//
// @typedef {Object} StagedTrailer
// @property {string} unit                  "#5521"
// @property {TrailerType} type
// @property {number} daysParked
// @property {string} lastUsed              ISO date
// @property {string|null} lastDriver
// @property {string|null} lastService      future — "coming soon" when null
// @property {string[]} [flags]             e.g. ["AGING"]
//
// @typedef {Object} DedicatedLane
// @property {string} id
// @property {string} name
// @property {string|null} customer
// @property {{city:string, state:string, lat:number, lng:number}} facility
// @property {{origin?:string, destination?:string}} [route]
// @property {LaneStatus} status
// @property {number} equipCostPerDay       drives idle cost
// @property {{trailers:number, avgIdleDays:number, loadsMTD:number,
//             revenueMTD:number, idleCostMTD:number, netMTD:number}} metrics
// @property {StagedTrailer[]} trailers
//
// @typedef {Object} IdleSplit
// @property {number} totalUnattached
// @property {number} stagedInLanes
// @property {{count:number, city:string, state:string, lat:number, lng:number}} homeYard
// ═══════════════════════════════════════════════════════════════════════════

// ── Thresholds & semantic buckets ───────────────────────────────────────────
// Days-parked grading: < 4d fresh · 4–9d watch · ≥ 10d aging (money loser).
export const DAYS_AMBER_AT = 4
export const DAYS_RED_AT = 10

/** @returns {'green'|'amber'|'red'} */
export function daysBucket(days) {
  return days >= DAYS_RED_AT ? 'red' : days >= DAYS_AMBER_AT ? 'amber' : 'green'
}

// Trailer type palette — fixed BUDDY-wide assignments.
export const TRAILER_TYPE_COLORS = {
  'Dry Van': '#06b6d4',
  'Flatbed': '#ef4444',
  'Reefer': '#10b981',
  'Step Deck': '#f59e0b',
  'Unassigned': '#6b7280',
}
export const TRAILER_TYPES = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck']

// Lane P&L status — label + hex (markers/SVG) per status key.
export const LANE_STATUS = {
  profitable: { label: 'Profitable', hex: '#10b981' },
  watch: { label: 'Watch', hex: '#f59e0b' },
  underwater: { label: 'Underwater', hex: '#ef4444' },
}
export const HOME_YARD_HEX = '#6b7280' // neutral — true idle, not a lane

// ── The four seed lanes ─────────────────────────────────────────────────────
/** @type {DedicatedLane[]} */
export const DEDICATED_LANES = [
  {
    id: 'laredo',
    name: 'Laredo Produce',
    customer: 'Del Campo Produce',
    facility: { city: 'Laredo', state: 'TX', lat: 27.5306, lng: -99.4803 },
    route: { origin: 'Laredo, TX', destination: 'Dallas, TX' },
    status: 'profitable',
    equipCostPerDay: 35,
    metrics: { trailers: 4, avgIdleDays: 6.8, loadsMTD: 18, revenueMTD: 42300, idleCostMTD: 3150, netMTD: 12400 },
    trailers: [
      { unit: '#5521', type: 'Reefer', daysParked: 3, lastUsed: '2026-07-06', lastDriver: 'Bektur U.', lastService: null },
      { unit: '#5540', type: 'Reefer', daysParked: 1, lastUsed: '2026-07-08', lastDriver: 'Seyit T.', lastService: null },
      { unit: '#5533', type: 'Reefer', daysParked: 9, lastUsed: '2026-06-30', lastDriver: 'Dastan T.', lastService: null },
      { unit: '#4820', type: 'Dry Van', daysParked: 14, lastUsed: '2026-06-25', lastDriver: 'Ariet E.', lastService: null, flags: ['AGING'] },
    ],
  },
  {
    id: 'socal',
    name: 'SoCal Retail',
    customer: 'PacWest Distribution',
    facility: { city: 'Ontario', state: 'CA', lat: 34.0633, lng: -117.6509 },
    status: 'watch',
    equipCostPerDay: 42,
    metrics: { trailers: 3, avgIdleDays: 9.7, loadsMTD: 11, revenueMTD: 28900, idleCostMTD: 4620, netMTD: 5100 },
    trailers: [
      { unit: '#4102', type: 'Dry Van', daysParked: 5, lastUsed: '2026-07-04', lastDriver: 'James O.', lastService: null },
      { unit: '#4125', type: 'Dry Van', daysParked: 2, lastUsed: '2026-07-07', lastDriver: 'Kadyraly', lastService: null },
      { unit: '#4110', type: 'Dry Van', daysParked: 22, lastUsed: '2026-06-17', lastDriver: 'Hunter A.', lastService: null, flags: ['AGING'] },
    ],
  },
  {
    id: 'atl',
    name: 'Atlanta DC',
    customer: null,
    facility: { city: 'McDonough', state: 'GA', lat: 33.4473, lng: -84.1469 },
    status: 'profitable',
    equipCostPerDay: 28,
    metrics: { trailers: 2, avgIdleDays: 4.0, loadsMTD: 14, revenueMTD: 31200, idleCostMTD: 1120, netMTD: 9800 },
    trailers: [
      { unit: '#4301', type: 'Dry Van', daysParked: 3, lastUsed: '2026-07-06', lastDriver: 'Sean B.', lastService: null },
      { unit: '#4315', type: 'Dry Van', daysParked: 5, lastUsed: '2026-07-04', lastDriver: 'Sam S.', lastService: null },
    ],
  },
  {
    id: 'kc',
    name: 'KC Midwest',
    customer: null,
    facility: { city: 'Kansas City', state: 'MO', lat: 39.0997, lng: -94.5786 },
    status: 'underwater',
    equipCostPerDay: 45,
    metrics: { trailers: 2, avgIdleDays: 11.5, loadsMTD: 6, revenueMTD: 12400, idleCostMTD: 3980, netMTD: -1200 },
    trailers: [
      { unit: '#5201', type: 'Reefer', daysParked: 8, lastUsed: '2026-07-01', lastDriver: 'Dastan T.', lastService: null },
      { unit: '#4402', type: 'Dry Van', daysParked: 15, lastUsed: '2026-06-24', lastDriver: null, lastService: null, flags: ['AGING'] },
    ],
  },
]

// ── Idle Review split ───────────────────────────────────────────────────────
// The headline reclassification: staged-in-lane (working idle) vs Home Yard
// (true idle). Later: unattached trailers not assigned to any lane fall into
// the Home Yard bucket.
/** @type {IdleSplit} */
export const IDLE_SPLIT = {
  totalUnattached: 23,
  stagedInLanes: 11,
  homeYard: { count: 12, city: 'Aurora', state: 'IL', lat: 41.7606, lng: -88.3201 },
}

// Unattached / available units the "+ New Dedicated Lane" modal offers for
// assignment. Later: trailers with no open assignment and no lane membership.
export const UNATTACHED_POOL = [
  '#4118', '#4136', '#4144', '#4227', '#4233', '#4258',
  '#5210', '#5247', '#5302', '#5318', '#5410', '#5427',
]

// ── Rollups for the KPI band ────────────────────────────────────────────────
export function computeKpis(lanes = DEDICATED_LANES, split = IDLE_SPLIT) {
  const laneCount = lanes.length
  const underwater = lanes.filter(l => l.status === 'underwater').length
  const staged = lanes.reduce((s, l) => s + l.metrics.trailers, 0)
  const totalDays = lanes.reduce((s, l) => s + l.trailers.reduce((a, t) => a + t.daysParked, 0), 0)
  const idleCostMTD = lanes.reduce((s, l) => s + l.metrics.idleCostMTD, 0)
  const netMTD = lanes.reduce((s, l) => s + l.metrics.netMTD, 0)
  return {
    laneCount,
    active: laneCount - underwater,
    underwater,
    staged,
    totalUnattached: split.totalUnattached,
    avgIdleDays: staged > 0 ? totalDays / staged : 0,
    idleCostMTD,
    netMTD,
  }
}
