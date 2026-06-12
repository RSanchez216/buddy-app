// The Rig — Phase 1 config. Every visual in the scene keys off RIG_STATES;
// Phase 2 will derive `rigState` and the net figure from live profitability
// data instead of the demo switcher.

export const TRACTOR_URL = '/models/tractor.glb'
export const TRAILER_URL = '/models/trailer-dryvan.glb'
export const MANAS_LOGO_URL = '/brand/manas-logo.png'

// Phase 2: read from load_profit_rollup('customer', …) — hardcoded for now.
export const MOCK_TOP_CUSTOMER = 'Amazon Logistics Inc'

// Tractor GLB is authored ~1 unit = 1 m (cab height 4.1, wheel Ø 1.08).
// Trailer GLB is ~3.2× oversized (height 12.84); normalize by height so its
// wheels (Ø 3.24 → ~1.04 m) match the tractor's.
export const TRAILER_SCALE = 0.315
export const WHEEL_RADIUS = 0.54 // tractor tire radius, meters

// Hitch geometry. Tractor faces +z, rear tandem at z −6.7/−8.13, fifth wheel
// just ahead of tandem center. Trailer local front face z −2.44, kingpin
// ~4 local units behind it; solve so kingpin lands on the fifth wheel.
export const FIFTH_WHEEL_Z = -7.0
const KINGPIN_LOCAL_Z = -6.4
export const TRAILER_GROUP_Z = FIFTH_WHEEL_Z - KINGPIN_LOCAL_Z * TRAILER_SCALE // ≈ −4.98

// Full day→night→day cycle length, seconds.
export const DAY_NIGHT_PERIOD = 80

export const RIG_STATES = {
  cruising: {
    word: 'CRUISING',
    net: '+$8,420',
    accent: '#54d6a0',
    bg: '#071420',
    fogColor: '#0b2230',
    fogNear: 30,
    fogFar: 110,
    keyColor: '#d8ecff',
    keyIntensity: 2.6,
    rimColor: '#54d6a0',
    rimIntensity: 0.8,
    hemiIntensity: 0.4,
    envPreset: 'dawn',
    envIntensity: 0.9,
    laneSpeed: 9, // m/s — drives lane-line scroll and wheel spin
    bobAmp: 0.02,
    bobFreq: 1.3,
    tilt: 0,
    shudder: 0,
  },
  headwind: {
    word: 'HEADWIND',
    net: '+$1,180',
    accent: '#f3b352',
    bg: '#170e05',
    fogColor: '#2a1808',
    fogNear: 18,
    fogFar: 62,
    keyColor: '#f3b352',
    keyIntensity: 1.4,
    rimColor: '#f3b352',
    rimIntensity: 0.55,
    hemiIntensity: 0.22,
    envPreset: 'sunset',
    envIntensity: 0.5,
    laneSpeed: 4.2,
    bobAmp: 0.026,
    bobFreq: 1.05,
    tilt: 0.009, // slight nose-down
    shudder: 1,
  },
  stalling: {
    word: 'STALLING',
    net: '−$2,340',
    accent: '#f2675f',
    bg: '#0a0407',
    fogColor: '#150509',
    fogNear: 7,
    fogFar: 34,
    keyColor: '#39435a',
    keyIntensity: 0.55,
    rimColor: '#f2675f',
    rimIntensity: 1.5,
    hemiIntensity: 0.07,
    envPreset: 'night',
    envIntensity: 0.15,
    laneSpeed: 0.35,
    bobAmp: 0.01,
    bobFreq: 0.45,
    tilt: 0.022, // deeper nose-down
    shudder: 0,
  },
}

export const TRAILER_OPTIONS = [
  { id: 'auto', label: 'AUTO' },
  { id: 'dryvan', label: 'DRY VAN' },
  { id: 'reefer', label: 'REEFER' },
  { id: 'flatbed', label: 'FLATBED' },
]
