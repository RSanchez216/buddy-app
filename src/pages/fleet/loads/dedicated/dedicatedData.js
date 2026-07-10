// Dedicated Lanes — real data layer. One read powers the whole page
// (get_dedicated_lanes); the New-Lane form uses facility_geo + direct inserts.
// Also holds the shared display constants (status/trailer colors, day buckets).
import { supabase } from '../../../../lib/supabase'

// ── display constants ────────────────────────────────────────────────────────
export const LANE_STATUS = {
  profitable: { label: 'Profitable', hex: '#10b981' }, // net positive
  watch:      { label: 'Watch',      hex: '#f59e0b' }, // positive but thin
  underwater: { label: 'Underwater', hex: '#ef4444' }, // below the lane threshold
  inactive:   { label: 'Inactive',   hex: '#6b7280' }, // neutral
}
export const HOME_YARD_HEX = '#6b7280'
// Home Yard is a display-only marker for the true-idle bucket — not a lane.
export const HOME_YARD = { city: 'Aurora', state: 'IL', lat: 41.7606, lng: -88.3201 }

export const TRAILER_TYPE_COLORS = {
  'Dry Van': '#06b6d4',
  'Flatbed': '#ef4444',
  'Reefer': '#10b981',
  'Step Deck': '#f59e0b',
  'Unassigned': '#6b7280',
}
export const TRAILER_TYPES = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck']

// Days-parked grading: < 4d fresh · 4–9d watch · ≥ 10d aging.
export const DAYS_AMBER_AT = 4
export const DAYS_RED_AT = 10
export function daysBucket(days) {
  return days >= DAYS_RED_AT ? 'red' : days >= DAYS_AMBER_AT ? 'amber' : 'green'
}

// ── read ─────────────────────────────────────────────────────────────────────
export async function fetchDedicatedLanes() {
  const { data, error } = await supabase.rpc('get_dedicated_lanes')
  if (error) throw error
  // Normalize the lane key defensively (lane_id is the contract; fall back to id).
  const lanes = (data?.lanes || []).map(l => ({ ...l, lane_id: l.lane_id ?? l.id }))
  return {
    overview: data?.overview || {},
    idle_split: data?.idle_split || {},
    lanes,
  }
}

// ── New-Lane writes (manager/admin — RLS enforces) ──────────────────────────
// Resolve a facility pin from city+state; [] when the gazetteer misses.
export async function facilityGeo(city, state) {
  const { data, error } = await supabase.rpc('facility_geo', { p_city: (city || '').trim(), p_state: (state || '').trim() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : null
  return row && row.lat != null && row.lng != null ? { lat: Number(row.lat), lng: Number(row.lng) } : null
}

export async function fetchUnassignedTrailers() {
  const { data, error } = await supabase
    .from('trailers').select('id, unit_number, trailer_type')
    .is('dedicated_lane_id', null).order('unit_number')
  if (error) throw error
  return data || []
}

export async function createFacility({ name, city, state, lat, lng }) {
  const { data, error } = await supabase
    .from('facilities')
    .insert({ name: name || `${city}, ${state}`, city, state_code: state, lat, lng })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function createDedicatedLane({ name, customer, originFacilityId, destinationFacilityId, underwaterThreshold }) {
  const { data, error } = await supabase
    .from('dedicated_lanes')
    .insert({
      name, customer: customer || null,
      origin_facility_id: originFacilityId,
      destination_facility_id: destinationFacilityId,
      underwater_threshold: Number(underwaterThreshold) || 0,
    })
    .select('id').single()
  if (error) throw error
  return data.id
}

export async function assignTrailersToLane(laneId, trailerIds) {
  if (!trailerIds?.length) return
  const { error } = await supabase.from('trailers').update({ dedicated_lane_id: laneId }).in('id', trailerIds)
  if (error) throw error
}
