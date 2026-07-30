import { supabase } from '../../lib/supabase'

// ── layout constants (section 4) ─────────────────────────────────────────────
export const TOP_PAD = 96
export const LANE_GAP = 135
export const PHASE_RADII = [9.5, 15.5, 21.5, 27.5]
export const laneY = (i) => TOP_PAD + i * LANE_GAP

// Ordered lines + all derived geometry. Nothing hardcoded to 5 lines.
export function computeLayout(lines, initiatives) {
  const ordered = [...(lines || [])].sort((a, b) => a.sort_order - b.sort_order)
  const laneYById = {}
  const laneIndexById = {}
  ordered.forEach((l, i) => { laneYById[l.id] = laneY(i); laneIndexById[l.id] = i })
  const n = ordered.length || 1
  const maxX = (initiatives || []).reduce((m, it) => Math.max(m, Number(it.pos_x) || 0), 0)
  const hubX = maxX + 130
  const hubY = (laneY(0) + laneY(n - 1)) / 2
  const vbWidth = hubX + 120
  const vbHeight = laneY(n - 1) + 110
  return { ordered, laneYById, laneIndexById, hubX, hubY, vbWidth, vbHeight }
}

// Horizontal track that dives 45° into the hub (section 4).
export function trackPath(line, y, hubX, hubY) {
  const start = Number(line.track_start_x) || 0
  const dy = hubY - y
  if (dy === 0) return `M ${start} ${y} H ${hubX}`
  return `M ${start} ${y} H ${hubX - Math.abs(dy)} L ${hubX} ${hubY}`
}

// ── status / flag vocab ──────────────────────────────────────────────────────
export const STATUS_LABEL = { planned: 'Planned', building: 'Building', live: 'Live', done: 'Done', open: 'Live' }
export const PHASE_STATUS_LABEL = { planned: 'Planned', building: 'Building', done: 'Done' }
export const PRIORITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

// ── reads ────────────────────────────────────────────────────────────────────
export async function fetchRoadmap() {
  const { data, error } = await supabase.rpc('get_roadmap')
  if (error) throw error
  return data || { lines: [], initiatives: [], progress: {} }
}
export async function fetchDepartments() {
  const { data, error } = await supabase.from('departments').select('id, name').eq('is_active', true).order('name')
  if (error) throw error
  return data || []
}

// ── writes (RLS gates to admins/managers) ────────────────────────────────────
export async function savePositions(positions) {
  const { error } = await supabase.rpc('roadmap_save_positions', { p_positions: positions })
  if (error) throw error
}
export async function recomputeStatuses() {
  const { error } = await supabase.rpc('roadmap_recompute_all_statuses')
  if (error) throw error
}

// Initiatives — status is NEVER written (trigger owns it).
export async function insertInitiative(row) {
  const { data, error } = await supabase.from('roadmap_initiatives').insert(row).select('id').single()
  if (error) throw error
  return data
}
export async function updateInitiative(id, patch) {
  const clean = { ...patch }; delete clean.status
  const { error } = await supabase.from('roadmap_initiatives').update(clean).eq('id', id)
  if (error) throw error
}
export async function archiveInitiative(id) {
  const { error } = await supabase.from('roadmap_initiatives').update({ is_archived: true }).eq('id', id)
  if (error) throw error
}

// Phases
export async function insertPhase(row) {
  const { error } = await supabase.from('roadmap_phases').insert(row)
  if (error) throw error
}
export async function updatePhase(id, patch) {
  const { error } = await supabase.from('roadmap_phases').update(patch).eq('id', id)
  if (error) throw error
}
export async function deletePhase(id) {
  const { error } = await supabase.from('roadmap_phases').delete().eq('id', id)
  if (error) throw error
}

// Extra lines (roadmap_initiative_lines)
export async function addInitiativeLine(initiativeId, lineId) {
  const { error } = await supabase.from('roadmap_initiative_lines').insert({ initiative_id: initiativeId, line_id: lineId })
  if (error) throw error
}
export async function removeInitiativeLine(initiativeId, lineId) {
  const { error } = await supabase.from('roadmap_initiative_lines').delete().eq('initiative_id', initiativeId).eq('line_id', lineId)
  if (error) throw error
}

// Dependencies (roadmap_dependencies) — DB rejects cycles; surface the message.
export async function addDependency(initiativeId, dependsOnId) {
  const { error } = await supabase.from('roadmap_dependencies').insert({ initiative_id: initiativeId, depends_on_id: dependsOnId })
  if (error) throw error
}
export async function removeDependency(initiativeId, dependsOnId) {
  const { error } = await supabase.from('roadmap_dependencies').delete().eq('initiative_id', initiativeId).eq('depends_on_id', dependsOnId)
  if (error) throw error
}

// Lines
// Create goes through the RPC (slug, sort position, colour validation, track_start_x
// default) — never insert into roadmap_lines directly. Returns { id, key, sort_order,
// track_start_x }. Raises readable messages ("A line needs a name", etc.) — surface
// error.message as-is.
export async function createLine({ name, color, description, afterLineId }) {
  const { data, error } = await supabase.rpc('roadmap_create_line', {
    p_name: name,
    p_color: color,
    p_description: description?.trim() || null,
    p_after_line_id: afterLineId || null,
  })
  if (error) throw error
  return data
}
export async function updateLine(id, patch) {
  const { error } = await supabase.from('roadmap_lines').update(patch).eq('id', id)
  if (error) throw error
}
// on delete restrict — a line with stations can't be deleted. The caller turns the
// FK violation into a plain sentence rather than showing the Postgres message.
export async function deleteLine(id) {
  const { error } = await supabase.from('roadmap_lines').delete().eq('id', id)
  if (error) throw error
}
// Bulk-reassign stations to another line (primary_line_id). status is trigger-owned
// and untouched here. A station can already carry the target as an EXTRA line, and
// a trigger rejects an extra line equal to the primary — so clear those extra-line
// rows first, or the move fails with a confusing error (e.g. Lumpers → Operations).
export async function moveStationsToLine(ids, toLineId) {
  if (!ids?.length) return
  const { error: delErr } = await supabase.from('roadmap_initiative_lines')
    .delete().eq('line_id', toLineId).in('initiative_id', ids)
  if (delErr) throw delErr
  const { error } = await supabase.from('roadmap_initiatives').update({ primary_line_id: toLineId }).in('id', ids)
  if (error) throw error
}

// ── Colour separation (CIELAB ΔE76) ──────────────────────────────────────────
// RGB distance doesn't match perception, so custom line colours are checked in
// CIELAB. Red is reserved for "needs a fix" — no line may be red or near-red.
export const RESERVED_RED = '#DC2626'
export const DE_MIN = 25 // reject a custom hex within this ΔE of a line or the red
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function hexToLab(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '')); if (!m) return null
  const r = srgbToLin(parseInt(m[1], 16)), g = srgbToLin(parseInt(m[2], 16)), b = srgbToLin(parseInt(m[3], 16))
  let X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
  let Y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
  let Z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
  X /= 0.95047; Z /= 1.08883
  const f = t => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116))
  const fx = f(X), fy = f(Y), fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
export function deltaE(hex1, hex2) {
  const a = hexToLab(hex1), b = hexToLab(hex2)
  if (!a || !b) return Infinity
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
// Nearest conflicting colour (or null) for a candidate hex, given [{hex,label}].
export function nearestConflict(hex, refs) {
  let best = null
  for (const r of refs) { const d = deltaE(hex, r.hex); if (d < DE_MIN && (!best || d < best.dE)) best = { ...r, dE: d } }
  return best
}

// ── Daily snapshots ("What moved") ───────────────────────────────────────────
export async function fetchSnapshots() {
  const { data, error } = await supabase.from('roadmap_daily_snapshot')
    .select('snapshot_date, stations_open, stations_total, phases_done, phases_total, changes')
    .order('snapshot_date', { ascending: false }).limit(30)
  if (error) throw error
  return data || []
}

// Settings — single row keyed id = true.
export async function updateSettings(patch) {
  const { error } = await supabase.from('roadmap_settings').update(patch).eq('id', true)
  if (error) throw error
}

// Even-spacing tidy respecting dependencies: never place a station left of one
// it depends on. Returns [{ id, pos_x }] for changed initiatives only.
export function autoTidyPositions(lines, initiatives) {
  const byId = new Map(initiatives.map(it => [it.id, it]))
  const START = 120, STEP = 150
  // Topological rank per initiative from dependencies (Kahn-ish; cycle-safe).
  const rank = new Map()
  const rankOf = (id, seen = new Set()) => {
    if (rank.has(id)) return rank.get(id)
    if (seen.has(id)) return 0 // cycle guard
    seen.add(id)
    const it = byId.get(id)
    const deps = (it?.depends_on || []).filter(d => byId.has(d))
    const r = deps.length ? Math.max(...deps.map(d => rankOf(d, seen) + 1)) : 0
    rank.set(id, r)
    return r
  }
  initiatives.forEach(it => rankOf(it.id))
  // Per line, order stations by (rank, current pos_x) and lay out evenly, but
  // never left of the max x of anything it depends on.
  const out = []
  const placed = new Map()
  const linesSorted = [...lines].sort((a, b) => a.sort_order - b.sort_order)
  for (const line of linesSorted) {
    const onLine = initiatives
      .filter(it => it.primary_line_id === line.id || (it.extra_line_ids || []).includes(line.id))
      .sort((a, b) => (rank.get(a.id) - rank.get(b.id)) || (Number(a.pos_x) - Number(b.pos_x)))
    let x = START
    for (const it of onLine) {
      const depMax = (it.depends_on || []).reduce((m, d) => Math.max(m, placed.get(d) ?? 0), 0)
      x = Math.max(x, depMax + STEP)
      const finalX = placed.get(it.id) != null ? Math.max(placed.get(it.id), x) : x
      placed.set(it.id, finalX)
      x = finalX + STEP
    }
  }
  for (const it of initiatives) {
    const nx = placed.get(it.id)
    if (nx != null && Math.round(nx) !== Math.round(Number(it.pos_x))) out.push({ id: it.id, pos_x: Math.round(nx) })
  }
  return out
}
