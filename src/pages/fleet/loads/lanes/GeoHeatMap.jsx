import { useEffect, useMemo, useState, useCallback } from 'react'
import { feature } from 'topojson-client'
import { geoAlbersUsa, geoPath } from 'd3-geo'
import { interpolateRgbBasis } from 'd3-interpolate'
import { supabase } from '../../../../lib/supabase'
import { S } from '../../../../lib/styles'
import { fmtMoney, fmtNum, fmtRpm } from '../spotlight/spotlightShared'

// State-to-region mapping (source of truth mirrors DB)
const REGIONS = {
  West: ['WA', 'OR', 'NV', 'ID', 'MT', 'WY', 'UT', 'CO', 'AK', 'HI'],
  Southwest: ['CA', 'AZ', 'NM', 'TX', 'OK'],
  Midwest: ['ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'IN', 'MI', 'OH'],
  Southeast: ['AR', 'LA', 'MS', 'AL', 'GA', 'FL', 'TN', 'KY', 'SC', 'NC', 'VA', 'WV'],
  Northeast: ['PA', 'NY', 'NJ', 'ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'MD', 'DE', 'DC'],
}

// Reverse lookup: state → region
const STATE_TO_REGION = {}
Object.entries(REGIONS).forEach(([region, states]) => {
  states.forEach(state => {
    STATE_TO_REGION[state] = region
  })
})

// Full state name → abbreviation
const STATE_NAME_TO_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'District of Columbia': 'DC',
}

// Light/dark mode color ramps (low → high)
const COLOR_RAMPS = {
  light: ['#FDE9A8', '#F7C13F', '#EF8E2A', '#DE5A2C', '#B82F1E', '#7A1A12'],
  dark: ['#7A5A1E', '#B08020', '#E0A030', '#E8742E', '#E5462F', '#F2B45A'],
}

const NO_DATA_COLORS = {
  light: '#ECEAE3',
  dark: '#2c2c2a',
}

function Pills({ value, onChange, options, title }) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs shrink-0" title={title}>
      {options.map(([k, lbl, tooltip]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          title={tooltip}
          className={`px-3 py-1.5 whitespace-nowrap shrink-0 ${
            value === k
              ? 'bg-orange-500 text-slate-900 font-semibold'
              : 'text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
          }`}
        >
          {lbl}
        </button>
      ))}
    </div>
  )
}

// Format a number compactly for on-map labels
function formatCompact(value, metric) {
  if (metric === 'legs') {
    return Math.round(value).toString()
  }
  if (metric === 'rpm') {
    return `$${value.toFixed(2)}`
  }
  // gross or avg (in dollars)
  const abs = Math.abs(value)
  if (abs < 10000) {
    return `$${(value / 1000).toFixed(1)}k`
  }
  return `$${(value / 1000).toFixed(0)}k`
}

// Format a number fully for tooltips/captions
function formatFull(value, metric) {
  if (metric === 'legs') {
    return Math.round(value).toString()
  }
  if (metric === 'rpm') {
    return `$${value.toFixed(2)}`
  }
  // gross or avg (in dollars)
  return fmtMoney(value)
}

export default function GeoHeatMap({ range, phases, pageTitle = 'Lanes by region & state' }) {
  const [view, setView] = useState('region') // region | state
  const [colorBy, setColorBy] = useState('gross') // loads | gross | avg | rpm
  const [basis, setBasis] = useState('origin') // origin | destination
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Determine theme (we'll use dark: class from Tailwind)
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  // Note: topology is loaded in SVGMap component

  // Fetch data when filters change
  const dataKey = `${range.from}|${range.to}|${basis}|${[...phases].sort().join(',')}`
  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)

    async function fetchData() {
      try {
        const phasesArray = Array.from(phases)
        const { data: rows, error: err } = await supabase.rpc('lane_geo_rollup', {
          page_start: range.from,
          page_end: range.to,
          basis: basis,
          grain: view,
          phases: phasesArray,
        })

        if (err) throw err

        if (!stale) {
          // Build lookup: unit (state/region) → metrics
          const lookup = new Map()
          for (const row of rows || []) {
            lookup.set(row.unit, {
              unit: row.unit,
              legs: row.legs,
              gross: row.gross,
              avg: row.avg_rev_per_load,
              rpm: row.rpm,
            })
          }
          setData(lookup)
        }
      } catch (err) {
        if (!stale) {
          console.error('Failed to fetch geo data:', err)
          setError(err.message || 'Failed to load data')
          setData(new Map())
        }
      } finally {
        if (!stale) setLoading(false)
      }
    }

    fetchData()
    return () => {
      stale = true
    }
  }, [dataKey, range, basis, view, phases])

  // Compute color scale
  const colorScale = useMemo(() => {
    if (!data || data.size === 0) return null

    const metric = colorBy
    const values = Array.from(data.values())
      .map(d => {
        if (metric === 'legs') return d.legs
        if (metric === 'gross') return d.gross
        if (metric === 'avg') return d.avg
        if (metric === 'rpm') return d.rpm
        return 0
      })
      .filter(v => v != null && v > 0)

    if (values.length === 0) return null

    const min = Math.min(...values)
    const max = Math.max(...values)
    const ramp = isDark ? COLOR_RAMPS.dark : COLOR_RAMPS.light
    const interpolator = interpolateRgbBasis(ramp)

    return {
      domain: [min, max],
      color: (value) => {
        if (value == null || value <= 0) return isDark ? NO_DATA_COLORS.dark : NO_DATA_COLORS.light
        const normalized = (value - min) / (max - min)
        return interpolator(Math.max(0, Math.min(1, normalized)))
      },
      colorAt: (t) => interpolator(Math.max(0, Math.min(1, t))),
    }
  }, [data, colorBy, isDark])

  // Get top 3 units for caption
  const top3 = useMemo(() => {
    if (!data || data.size === 0) return []
    const metric = colorBy
    const sorted = Array.from(data.values())
      .sort((a, b) => {
        const aVal = metric === 'legs' ? a.legs : metric === 'gross' ? a.gross : metric === 'avg' ? a.avg : a.rpm
        const bVal = metric === 'legs' ? b.legs : metric === 'gross' ? b.gross : metric === 'avg' ? b.avg : b.rpm
        return (bVal ?? 0) - (aVal ?? 0)
      })
      .slice(0, 3)
    return sorted
  }, [data, colorBy])

  const metricLabel = {
    legs: 'loads',
    gross: 'gross $',
    avg: 'avg $/load',
    rpm: 'RPM',
  }[colorBy]

  return (
    <div className={`${S.card} space-y-4`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-3">
          {pageTitle}
        </p>

        {/* Controls */}
        <div className="flex items-center flex-wrap gap-2 mb-4">
          <Pills
            value={view}
            onChange={setView}
            options={[
              ['region', 'Region', 'Group lanes into the 5 freight regions'],
              ['state', 'State', 'Break the map down to individual states, with the number shown on each'],
            ]}
            title="View grain"
          />
          <Pills
            value={colorBy}
            onChange={setColorBy}
            options={[
              ['loads', 'Loads', 'Number of delivered + in-transit legs'],
              ['gross', 'Gross $', 'Total billed freight revenue'],
              ['avg', 'Avg $/load', 'Average revenue per leg (load)'],
              ['rpm', 'RPM', 'Revenue ÷ total miles (rate per mile)'],
            ]}
            title="Color metric"
          />
          <Pills
            value={basis}
            onChange={setBasis}
            options={[
              ['origin', 'Origin', 'Attribute each leg to where it was picked up'],
              ['destination', 'Destination', 'Attribute each leg to where it was delivered'],
            ]}
            title="Geographic basis"
          />
        </div>

        {/* Caption */}
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mb-3">
          {basis === 'origin' ? 'Origin' : 'Destination'} basis · {Array.from(phases).sort().map(p => p === 'in_transit' ? 'In transit' : p.charAt(0).toUpperCase() + p.slice(1)).join(' + ')} ·{' '}
          {range.from} to {range.to} · hover a state for full detail
        </p>
      </div>

      {/* Map area */}
      <div className="relative">
        {loading && (
          <div className="aspect-[900/560] rounded-lg bg-gray-100 dark:bg-white/[0.03] animate-pulse flex items-center justify-center">
            <div className="text-sm text-gray-400 dark:text-slate-500">Loading map…</div>
          </div>
        )}

        {error && (
          <div className="aspect-[900/560] rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center p-4 text-center">
            <div className="text-sm text-red-600 dark:text-red-400">Failed to load data: {error}</div>
          </div>
        )}

        {!loading && !error && (!data || data.size === 0) && (
          <div className="aspect-[900/560] rounded-lg bg-gray-50 dark:bg-white/[0.03] flex items-center justify-center">
            <div className="text-sm text-gray-400 dark:text-slate-500">No lanes in this window</div>
          </div>
        )}

        {!loading && !error && data && data.size > 0 && colorScale && (
          <SVGMap
            view={view}
            data={data}
            colorScale={colorScale}
            colorBy={colorBy}
            isDark={isDark}
          />
        )}
      </div>

      {/* Legend */}
      {colorScale && (
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 dark:text-slate-400 font-mono">
              {formatFull(colorScale.domain[0], colorBy)}
            </span>
            <div className="h-2 w-32 rounded-full" style={{
              background: `linear-gradient(90deg, ${colorScale.colorAt(0)}, ${colorScale.colorAt(0.5)}, ${colorScale.colorAt(1)})`,
            }} />
            <span className="text-gray-500 dark:text-slate-400 font-mono">
              {formatFull(colorScale.domain[1], colorBy)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded"
              style={{ background: isDark ? NO_DATA_COLORS.dark : NO_DATA_COLORS.light }}
            />
            <span className="text-gray-500 dark:text-slate-400">No/low data</span>
          </div>
        </div>
      )}

      {/* Top 3 caption */}
      {top3.length > 0 && (
        <div className="text-[11px] text-gray-500 dark:text-slate-400">
          Top {view === 'region' ? 'regions' : 'states'} by {metricLabel}:{' '}
          {top3.map((item, i) => {
            const val = colorBy === 'legs' ? item.legs : colorBy === 'gross' ? item.gross : colorBy === 'avg' ? item.avg : item.rpm
            return (
              <span key={i}>
                {i > 0 && ' · '}
                {item.unit} {formatFull(val, colorBy)}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// SVG Map renderer
function SVGMap({ view, data, colorScale, colorBy, isDark }) {
  const [topoData, setTopoData] = useState(null)
  const [topoError, setTopoError] = useState(null)

  useEffect(() => {
    async function loadTopo() {
      try {
        const response = await import('us-atlas/states-10m.json')
        const topo = response.default
        const states = feature(topo, topo.objects.states)
        setTopoData(states)
      } catch (err) {
        console.error('Failed to load topology:', err)
        setTopoError(err.message)
      }
    }
    loadTopo()
  }, [])

  if (topoError) {
    return <div className="aspect-[900/560] rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center text-sm text-red-600 dark:text-red-400">Failed to load map data</div>
  }

  if (!topoData) return <div className="aspect-[900/560] rounded-lg bg-gray-100 dark:bg-white/[0.03] animate-pulse" />

  const projection = geoAlbersUsa().scale(1100).translate([450, 280])
  const pathGenerator = geoPath().projection(projection)

  // Map state names to abbreviations
  const getStateAbbr = (name) => STATE_NAME_TO_ABBR[name] || name

  // Small states that get external leader-line labels in State view
  const SMALL_STATES = new Set(['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC'])

  // Render state paths
  const statePaths = topoData.features.map((state) => {
    const abbr = getStateAbbr(state.properties.name)
    const stateData = data.get(abbr)
    const metricValue = stateData ? (
      colorBy === 'legs' ? stateData.legs :
      colorBy === 'gross' ? stateData.gross :
      colorBy === 'avg' ? stateData.avg :
      stateData.rpm
    ) : null

    const color = colorScale.color(metricValue)
    const path = pathGenerator(state)
    const centroid = pathGenerator.centroid(state)
    const isSmallState = SMALL_STATES.has(abbr)
    const showOnMapLabel = view === 'state' && metricValue != null && centroid && !isSmallState

    return (
      <g key={abbr}>
        <path
          d={path}
          fill={color}
          stroke={isDark ? 'rgba(255,255,255,.18)' : '#fff'}
          strokeWidth={1}
        />
        {showOnMapLabel && (
          <>
            {/* State abbreviation */}
            <text
              x={centroid[0]}
              y={centroid[1] - 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight="500"
              fill={isDark ? '#e2e8f0' : '#1f2937'}
            >
              {abbr}
            </text>
            {/* Metric value */}
            <text
              x={centroid[0]}
              y={centroid[1] + 6}
              textAnchor="middle"
              fontSize="11"
              fill={isDark ? '#cbd5e1' : '#4b5563'}
            >
              {formatCompact(metricValue, colorBy)}
            </text>
          </>
        )}
        <title>
          {`${abbr}${
            stateData
              ? `\ngross: ${formatFull(stateData.gross, 'gross')}\nloads: ${stateData.legs}\navg: ${formatFull(stateData.avg, 'avg')}\nRPM: ${formatFull(stateData.rpm, 'rpm')}`
              : '\nNo/low data'
          }`}
        </title>
      </g>
    )
  })

  // External labels for small states (State view only)
  const externalLabels = view === 'state' ? (() => {
    const smallStatesWithData = []

    // Collect small states that have data, with their centroids
    topoData.features.forEach((state) => {
      const abbr = getStateAbbr(state.properties.name)
      if (!SMALL_STATES.has(abbr)) return

      const stateData = data.get(abbr)
      const metricValue = stateData ? (
        colorBy === 'legs' ? stateData.legs :
        colorBy === 'gross' ? stateData.gross :
        colorBy === 'avg' ? stateData.avg :
        stateData.rpm
      ) : null

      if (metricValue == null) return

      const centroid = pathGenerator.centroid(state)
      smallStatesWithData.push({ abbr, metricValue, centroid })
    })

    // Sort by centroid y (top to bottom)
    smallStatesWithData.sort((a, b) => a.centroid[1] - b.centroid[1])

    // Position external labels in a vertical stack on the right
    const gutterX = 930
    const labelRowHeight = 34
    const startY = 40
    const lineColor = isDark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)'
    const labelBg = isDark ? '#1e293b' : '#f3f4f6'
    const labelBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'

    return smallStatesWithData.map((item, idx) => {
      const labelY = startY + idx * labelRowHeight
      const labelMidY = labelY + 17 // middle of label pill

      return (
        <g key={`external-${item.abbr}`}>
          {/* Leader line from label to state centroid */}
          <line
            x1={gutterX - 6}
            y1={labelMidY}
            x2={item.centroid[0]}
            y2={item.centroid[1]}
            stroke={lineColor}
            strokeWidth={0.75}
          />
          {/* Dot at state centroid */}
          <circle
            cx={item.centroid[0]}
            cy={item.centroid[1]}
            r={2}
            fill={lineColor}
          />
          {/* External label pill */}
          <g>
            {/* Pill background */}
            <rect
              x={gutterX - 55}
              y={labelY}
              width={52}
              height={24}
              rx={4}
              fill={labelBg}
              stroke={labelBorder}
              strokeWidth={0.5}
            />
            {/* State abbreviation */}
            <text
              x={gutterX - 29}
              y={labelY + 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight="500"
              fill={isDark ? '#e2e8f0' : '#1f2937'}
            >
              {item.abbr}
            </text>
            {/* Metric value */}
            <text
              x={gutterX - 29}
              y={labelY + 18}
              textAnchor="middle"
              fontSize="10"
              fill={isDark ? '#cbd5e1' : '#4b5563'}
            >
              {formatCompact(item.metricValue, colorBy)}
            </text>
            {/* Hover tooltip */}
            <title>
              {`${item.abbr}\ngross: ${formatFull(data.get(item.abbr).gross, 'gross')}\nloads: ${data.get(item.abbr).legs}\navg: ${formatFull(data.get(item.abbr).avg, 'avg')}\nRPM: ${formatFull(data.get(item.abbr).rpm, 'rpm')}`}
            </title>
          </g>
        </g>
      )
    })
  })() : null

  // Region labels if needed
  const regionLabels = view === 'region' ? Object.entries(REGIONS).map(([region, stateList]) => {
    const regionStates = stateList
      .map(abbr => topoData.features.find(s => getStateAbbr(s.properties.name) === abbr))
      .filter(Boolean)
      .filter(s => {
        // Exclude AK and HI for centroid calculation
        const abbr = getStateAbbr(s.properties.name)
        return abbr !== 'AK' && abbr !== 'HI'
      })

    if (regionStates.length === 0) return null

    // Calculate region centroid
    const centroids = regionStates.map(s => pathGenerator.centroid(s))
    const avgX = centroids.reduce((sum, c) => sum + c[0], 0) / centroids.length
    const avgY = centroids.reduce((sum, c) => sum + c[1], 0) / centroids.length

    const regionData = data.get(region)
    const metricValue = regionData ? (
      colorBy === 'legs' ? regionData.legs :
      colorBy === 'gross' ? regionData.gross :
      colorBy === 'avg' ? regionData.avg :
      regionData.rpm
    ) : null

    return (
      <g key={`label-${region}`}>
        <text
          x={avgX}
          y={avgY}
          textAnchor="middle"
          fontSize="12"
          fontWeight="600"
          fill={isDark ? '#e2e8f0' : '#1f2937'}
          style={{ paintOrder: 'stroke' }}
          stroke={isDark ? '#0d0d1f' : '#fff'}
          strokeWidth={2.6}
          strokeLinejoin="round"
        >
          {region}
        </text>
        {metricValue != null && (
          <text
            x={avgX}
            y={avgY + 14}
            textAnchor="middle"
            fontSize="11"
            fill={isDark ? '#cbd5e1' : '#4b5563'}
            fontWeight="500"
            style={{ paintOrder: 'stroke' }}
            stroke={isDark ? '#0d0d1f' : '#fff'}
            strokeWidth={2.6}
            strokeLinejoin="round"
          >
            {formatCompact(metricValue, colorBy)}
          </text>
        )}
      </g>
    )
  }).filter(Boolean) : null

  return (
    <svg viewBox={view === 'state' && externalLabels && externalLabels.length > 0 ? "0 0 1040 560" : "0 0 900 560"} className="w-full rounded-lg" style={{ background: isDark ? '#0d0d1f' : '#fafaf8' }}>
      <g>{statePaths}</g>
      {regionLabels && <g>{regionLabels}</g>}
      {externalLabels && <g>{externalLabels}</g>}
    </svg>
  )
}
