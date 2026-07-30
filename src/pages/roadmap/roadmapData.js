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
// Display labels. The stored status stays 'building' (a join/filter key); "building"
// is never shown to a user. A station that's part-built reads "Part-built"; a phase
// actually being worked reads "In progress".
export const STATUS_LABEL = { planned: 'Planned', building: 'Part-built', live: 'Live', done: 'Done', open: 'Live' }
export const PHASE_STATUS_LABEL = { planned: 'Planned', building: 'In progress', done: 'Done' }
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
// Advance a single phase. 'done' stamps completed_at; moving off 'done' clears it.
// initiatives.status is trigger-owned — never written here.
export async function setPhaseStatus(id, status) {
  const { error } = await supabase.from('roadmap_phases')
    .update({ status, completed_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', id)
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

// ── Auto-tidy ────────────────────────────────────────────────────────────────
export const TIDY_END_X = 1550     // every line aims to end here
export const TIDY_MIN_GAP = 100    // minimum clearance between stations on a line
// The station-key HTML overlay covers roughly x 26–222 on the top two lanes.
// Honouring each line's track_start_x keeps it clear (Intelligence starts at 700),
// so there's no separate collision logic — but warn if a top-lane line is set
// below this.
export const KEY_RESERVED_X = 230
export const KEY_LANES = 2
const STATUS_RANK = { live: 0, done: 0, building: 1, planned: 2 }

// Full tidy per the revision-7 algorithm. Returns a proposal — never mutates.
// { ok, reason, positions: [{id,pos_x}] (changed only), moved, lines: per-line
// summary, xById }. Pass 4 aborts (ok:false) rather than emit a broken layout.
export function computeTidyLayout(lines, initiatives) {
  const activeLines = [...lines].filter(l => l.is_active !== false).sort((a, b) => a.sort_order - b.sort_order)
  const byId = new Map(initiatives.map(it => [it.id, it]))
  const startOf = new Map(activeLines.map(l => [l.id, Number(l.track_start_x) || 0]))
  const X = new Map()

  // Pass 1 — space each primary line across [track_start_x, END_X].
  const perLine = []
  for (const L of activeLines) {
    const start = startOf.get(L.id)
    const S = initiatives.filter(it => it.primary_line_id === L.id)
      .sort((a, b) => (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1) || (Number(a.pos_x) || 0) - (Number(b.pos_x) || 0))
    let step = 0
    if (S.length === 1) X.set(S[0].id, start)
    else if (S.length > 1) {
      step = (TIDY_END_X - start) / (S.length - 1)
      if (step < TIDY_MIN_GAP) step = TIDY_MIN_GAP // crowded line runs past END_X rather than colliding
      S.forEach((it, i) => X.set(it.id, start + i * step))
    }
    perLine.push({ id: L.id, name: L.name, n: S.length, step: Math.round(step), start })
  }

  // Pass 2 — dependencies, in topological order. Nothing sits left of what it waits on.
  const rank = new Map()
  const rankOf = (id, seen = new Set()) => {
    if (rank.has(id)) return rank.get(id)
    if (seen.has(id)) return 0
    seen.add(id)
    const deps = (byId.get(id)?.depends_on || []).filter(d => byId.has(d))
    const r = deps.length ? Math.max(...deps.map(d => rankOf(d, seen) + 1)) : 0
    rank.set(id, r); return r
  }
  initiatives.forEach(it => rankOf(it.id))
  const topo = initiatives.filter(it => X.has(it.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id))
  for (const A of topo) {
    for (const depId of (A.depends_on || [])) {
      if (X.has(depId) && X.get(A.id) <= X.get(depId)) X.set(A.id, X.get(depId) + TIDY_MIN_GAP)
    }
  }

  // Pass 3 — interchanges. A station has one x; open a MIN_GAP gap around it on
  // each other line it appears on by shifting THAT line's own stations.
  for (const I of initiatives) {
    const extra = (I.extra_line_ids || []).filter(id => startOf.has(id))
    if (!extra.length || !X.has(I.id)) continue
    const xi = X.get(I.id)
    for (const E of extra) {
      const others = initiatives.filter(it => it.id !== I.id && it.primary_line_id === E && X.has(it.id))
      let boundary = xi + TIDY_MIN_GAP
      for (const s of others.filter(s => X.get(s.id) >= xi).sort((a, b) => X.get(a.id) - X.get(b.id))) {
        if (X.get(s.id) < boundary) X.set(s.id, boundary)
        boundary = X.get(s.id) + TIDY_MIN_GAP
      }
      let lb = xi - TIDY_MIN_GAP
      for (const s of others.filter(s => X.get(s.id) < xi).sort((a, b) => X.get(b.id) - X.get(a.id))) {
        if (X.get(s.id) > lb) X.set(s.id, lb)
        lb = X.get(s.id) - TIDY_MIN_GAP
      }
    }
  }

  // Pass 4 — validity. Abort (change nothing) rather than write a broken layout.
  for (const L of activeLines) {
    const onL = initiatives.filter(it => (it.primary_line_id === L.id || (it.extra_line_ids || []).includes(L.id)) && X.has(it.id))
      .sort((a, b) => X.get(a.id) - X.get(b.id))
    for (let i = 1; i < onL.length; i++) {
      if (X.get(onL[i].id) - X.get(onL[i - 1].id) < TIDY_MIN_GAP - 0.5) {
        return { ok: false, reason: 'Auto-tidy would leave stations too close together — nothing changed.', positions: [], moved: 0, lines: perLine }
      }
    }
  }
  for (const it of initiatives) {
    if (!X.has(it.id)) continue
    const primStart = startOf.get(it.primary_line_id)
    if (primStart != null && X.get(it.id) < primStart - 0.5) {
      return { ok: false, reason: 'Auto-tidy would place a station before its line starts — nothing changed.', positions: [], moved: 0, lines: perLine }
    }
  }

  const positions = []
  for (const it of initiatives) {
    if (!X.has(it.id)) continue
    const nx = Math.round(X.get(it.id))
    if (nx !== Math.round(Number(it.pos_x) || 0)) positions.push({ id: it.id, pos_x: nx })
  }
  return { ok: true, reason: null, positions, moved: positions.length, lines: perLine, xById: Object.fromEntries([...X].map(([k, v]) => [k, Math.round(v)])) }
}

// ── Layout snapshots (undo / restore) ────────────────────────────────────────
export async function snapshotLayout(label) {
  const { data, error } = await supabase.rpc('roadmap_snapshot_layout', { p_label: label || 'Layout snapshot' })
  if (error) throw error
  return data // uuid
}
export async function restoreLayout(snapshotId = null) {
  const { data, error } = await supabase.rpc('roadmap_restore_layout', { p_snapshot_id: snapshotId })
  if (error) throw error
  return data // rows restored
}
export async function fetchLayoutSnapshots() {
  const { data, error } = await supabase.from('roadmap_layout_snapshot')
    .select('id, label, taken_at').order('taken_at', { ascending: false }).limit(20)
  if (error) throw error
  return data || []
}
