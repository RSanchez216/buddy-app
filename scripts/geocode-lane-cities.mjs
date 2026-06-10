// One-time / re-runnable geocode pass for the Lane Flow Map.
//
// Reads every distinct origin/destination label from v_load_leg_profit,
// matches them against the US Census Gazetteer (public domain; places +
// county subdivisions, so townships match too), and writes a static
// lookup the app bundles — no geocoding API is ever called at render time.
//
// Usage:
//   node scripts/geocode-lane-cities.mjs [--gaz-dir <dir>]
//
// --gaz-dir should contain 2023_Gaz_place_national.txt and
// 2023_Gaz_cousubs_national.txt (downloaded automatically into a temp
// dir when omitted). Re-run after big load imports to pick up new cities;
// unmatched labels are listed on stdout and simply skipped by the map.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'pages', 'fleet', 'loads', 'lanes', 'laneCityCoords.json')

const GAZ_BASE = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer'
const GAZ_FILES = ['2023_Gaz_place_national.txt', '2023_Gaz_cousubs_national.txt']

// Labels the gazetteer can't resolve (neighborhoods, industrial areas).
// Coordinates are the locality's well-known center — extend as needed.
const ALIASES = {
  'Canoga Park, CA': [34.2011, -118.597], // Los Angeles neighborhood
  'The Bronx, NY': [40.8448, -73.8648],
  'Antioch, TN': [36.0595, -86.6722], // Nashville neighborhood
  'Arden, NC': [35.4651, -82.5165], // unincorporated, near Asheville
  'Battleboro, NC': [36.0432, -77.7494], // unincorporated, Rocky Mount area
  'East Pensacola Heights, FL': [30.4252, -87.1842], // Pensacola neighborhood
  'Laveen, AZ': [33.3628, -112.1691], // village within Phoenix
  'Macon, GA': [32.8407, -83.6324], // gazetteer lists it as "Macon-Bibb County"
  'Sparrows Point, MD': [39.2173, -76.4383], // industrial area (Tradepoint Atlantic)
  'Wilmington, CA': [33.7775, -118.2625], // LA harbor neighborhood
}

// ── Name normalization ────────────────────────────────────────────────
// "St. Peters city" / "Saint Peters" / "O'Fallon" / "Winston-Salem" all
// need to land on the same key. Legal-type suffixes are stripped from the
// gazetteer side ("Milton city", "Clinton charter township", "Hollins CDP").
const SUFFIX_RE = /\s+(city|town|village|borough|cdp|municipality|plantation|gore|grant|location|purchase|district|township|charter township|comunidad|zona urbana|urbana|\(balance\)|balance)$/
function normalize(name) {
  let s = String(name).toLowerCase().trim()
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(SUFFIX_RE, '') }
  s = s.replace(/^the\s+/, '')
  s = s.replace(/\bsaint\b/g, 'st')
  s = s.replace(/[.'’()]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  return s
}

async function loadGazetteer(gazDir) {
  if (!gazDir) {
    gazDir = join(tmpdir(), 'buddy-gazetteer-2023')
    mkdirSync(gazDir, { recursive: true })
  }
  // index: "ST|normname" -> { lat, lng, aland } — places win over cousubs,
  // and among same-key entries the larger land area wins (the incorporated
  // city beats a same-named speck elsewhere in the state).
  const index = new Map()
  for (const file of GAZ_FILES) {
    const path = join(gazDir, file)
    if (!existsSync(path)) {
      console.log(`downloading ${file}…`)
      const zipName = file.replace('.txt', '.zip').replace('2023_Gaz_', '2023_Gaz_')
      const res = await fetch(`${GAZ_BASE}/${zipName}`)
      if (!res.ok) throw new Error(`download failed: ${zipName} (${res.status})`)
      // The gazetteer ships zipped; require a pre-extracted dir if we can't unzip.
      const { default: zlib } = await import('node:zlib').catch(() => ({ default: null }))
      void zlib
      throw new Error(`Please extract ${zipName} into ${gazDir} and re-run (zip extraction is left to the shell).`)
    }
    const isPlace = file.includes('place')
    const lines = readFileSync(path, 'utf8').split('\n')
    const header = lines[0].split('\t').map(h => h.trim())
    const iState = header.indexOf('USPS'), iName = header.indexOf('NAME')
    const iLat = header.indexOf('INTPTLAT'), iLng = header.indexOf('INTPTLONG')
    const iLand = header.indexOf('ALAND')
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t')
      if (cols.length < 5) continue
      const norm = normalize(cols[iName])
      const entry = { lat: +cols[iLat], lng: +cols[iLng], aland: +cols[iLand] || 0, isPlace }
      for (const key of [`${cols[iState].trim()}|${norm}`, `${cols[iState].trim()}|${norm.replace(/ /g, '')}~nospace`]) {
        const prev = index.get(key)
        if (!prev || (entry.isPlace && !prev.isPlace) || (entry.isPlace === prev.isPlace && entry.aland > prev.aland)) {
          index.set(key, entry)
        }
      }
    }
  }
  return index
}

async function fetchDistinctCities() {
  const env = readFileSync(join(ROOT, '.env'), 'utf8')
  const url = env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim()
  const key = env.match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)?.[1]?.trim()
  if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found in .env')
  const cities = new Set()
  for (let page = 0; ; page++) {
    const res = await fetch(`${url}/rest/v1/v_load_leg_profit?select=origin,destination&limit=1000&offset=${page * 1000}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!res.ok) throw new Error(`supabase fetch failed: ${res.status}`)
    const rows = await res.json()
    for (const r of rows) {
      if (r.origin) cities.add(r.origin.trim())
      if (r.destination) cities.add(r.destination.trim())
    }
    if (rows.length < 1000) break
  }
  return [...cities].sort()
}

const gazDirArg = process.argv.indexOf('--gaz-dir')
const gazDir = gazDirArg > -1 ? process.argv[gazDirArg + 1] : null

const [index, cities] = await Promise.all([loadGazetteer(gazDir), fetchDistinctCities()])
console.log(`${cities.length} distinct city labels, ${index.size} gazetteer entries`)

const out = {}
const misses = []
for (const label of cities) {
  if (ALIASES[label]) { out[label] = ALIASES[label]; continue }
  const m = label.match(/^(.+),\s*([A-Z]{2})$/)
  if (!m) { misses.push(label); continue } // state-only / malformed → map skips it
  // Exact key first, then space-insensitive ("De Forest" vs gazetteer "DeForest").
  const hit = index.get(`${m[2]}|${normalize(m[1])}`)
    || index.get(`${m[2]}|${normalize(m[1]).replace(/ /g, '')}~nospace`)
  if (hit) out[label] = [Math.round(hit.lat * 1e4) / 1e4, Math.round(hit.lng * 1e4) / 1e4]
  else misses.push(label)
}

writeFileSync(OUT, JSON.stringify({
  source: 'US Census Bureau 2023 Gazetteer (places + county subdivisions), public domain',
  generated: new Date().toISOString().slice(0, 10),
  cities: out,
}, null, 1))

const pct = (Object.keys(out).length / cities.length * 100).toFixed(1)
console.log(`matched ${Object.keys(out).length}/${cities.length} (${pct}%) → ${OUT}`)
if (misses.length) console.log(`unmatched (skipped by the map):\n  ${misses.join('\n  ')}`)
