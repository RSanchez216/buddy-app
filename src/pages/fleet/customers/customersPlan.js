import { normName } from './customersParse'

// MC numbers to a canonical digits-only form so "MC 123456", "123456" and
// "123456 " all compare equal — on both sides of the match and on write.
export const normMc = (s) => {
  const d = String(s ?? '').replace(/\D/g, '')
  return d || null
}
const normCode = (s) => (s ? String(s).trim().toLowerCase() : null)

// Match each file row to an existing customer, first hit wins: MC → TMS code →
// normalised name. If two rules point at DIFFERENT customers it's a conflict —
// never guess; the person resolves it, and the row is applied to nothing. Rows
// that match nothing are created.
export function buildCustomerPlan({ rows, existing }) {
  const byMc = new Map(), byCode = new Map(), byName = new Map()
  for (const c of existing || []) {
    const mc = normMc(c.mc_number); if (mc && !byMc.has(mc)) byMc.set(mc, c)
    const code = normCode(c.tms_code); if (code && !byCode.has(code)) byCode.set(code, c)
    const nm = normName(c.name); if (nm && !byName.has(nm)) byName.set(nm, c)
  }

  const plan = rows.map((r) => {
    const mc = normMc(r.mc_number)
    const code = normCode(r.tms_code)
    const nm = normName(r.name)
    const mcHit = mc ? byMc.get(mc) : null
    const codeHit = code ? byCode.get(code) : null
    const nameHit = nm ? byName.get(nm) : null
    const ids = new Set([mcHit, codeHit, nameHit].filter(Boolean).map(c => c.id))

    let match = null, rule = null, conflict = false
    if (ids.size > 1) {
      conflict = true
    } else if (mcHit) { match = mcHit; rule = 'MC' }
    else if (codeHit) { match = codeHit; rule = 'TMS code' }
    else if (nameHit) { match = nameHit; rule = 'Name' }

    const isNew = !conflict && !match
    // "MC filled" = a row that supplies an MC the customer didn't have (new
    // customer with an MC, or a match whose MC was blank) — the metric that
    // matters for the risk-matching undercount.
    const willFillMc = !conflict && !!mc && (isNew || !normMc(match?.mc_number))

    return {
      row: r,
      match: match || null,
      matchId: match?.id || null,
      matchName: match?.name || null,
      rule,
      conflict,
      conflictWith: conflict ? [mcHit, codeHit, nameHit].filter(Boolean).map(c => c.name) : [],
      isNew,
      willFillMc,
    }
  })

  // ── Two file rows resolving to ONE customer ────────────────────────────────
  // Four pairs in the export are different companies sharing a name (Edge
  // Logistics, Inland Transport, Nu-Era, Spot Freight). Neither carries a
  // matching MC and the TMS gives both members the same short code, so both fall
  // through to the name rule and land on the same customer. Writing them in one
  // statement is what produced "ON CONFLICT DO UPDATE command cannot affect row
  // a second time" — and a half-applied file.
  //
  // So group by resolved target BEFORE anything is built for the write. Any
  // target claimed twice makes every claimant a conflict; none of them is
  // applied, and the rest of the file goes through untouched.
  const byTarget = new Map()
  for (const p of plan) {
    if (p.conflict || !p.matchId) continue
    if (!byTarget.has(p.matchId)) byTarget.set(p.matchId, [])
    byTarget.get(p.matchId).push(p)
  }
  // Same trap one step earlier: customers has a UNIQUE index on
  // lower(btrim(name)), so two NEW rows sharing a name can't both be inserted
  // either — the second would abort the whole statement.
  const byNewName = new Map()
  for (const p of plan) {
    if (p.conflict || !p.isNew) continue
    const nm = normName(p.row.name)
    if (!nm) continue
    if (!byNewName.has(nm)) byNewName.set(nm, [])
    byNewName.get(nm).push(p)
  }

  const dupGroups = []
  for (const [id, group] of byTarget) {
    if (group.length < 2) continue
    dupGroups.push({ key: `target:${id}`, targetId: id, targetName: group[0].matchName, rows: group })
  }
  for (const [nm, group] of byNewName) {
    if (group.length < 2) continue
    dupGroups.push({ key: `new:${nm}`, targetId: null, targetName: group[0].row.name, rows: group })
  }
  for (const g of dupGroups) {
    for (const p of g.rows) {
      p.conflict = true
      p.conflictKind = 'duplicate_target'
      p.isNew = false
      p.willFillMc = false
      p.conflictGroup = g.key
      // The existing name is what the group is about; keep it for the tile.
      p.conflictWith = g.targetName ? [g.targetName] : []
    }
  }
  // What the tile renders: one entry per clash, each side with the facts that
  // actually tell the two companies apart.
  const conflictGroups = dupGroups.map(g => ({
    key: g.key,
    target_id: g.targetId,
    target_name: g.targetName,
    sides: g.rows.map(p => ({
      row_index: p.row.row_index,
      name: p.row.name,
      mc: normMc(p.row.mc_number),
      city: p.row.city,
      state: p.row.state,
      loads_ytd: p.row.tms_loads_ytd,
    })),
  }))

  const counts = {
    total: plan.length,
    matched: plan.filter(p => p.match && !p.conflict).length,
    created: plan.filter(p => p.isNew).length,
    conflicts: plan.filter(p => p.conflict).length,
    mc_filled: plan.filter(p => p.willFillMc).length,
    // Conflicts are excluded everywhere — nothing about them is applied, so
    // counting them under a match rule would overstate what the run will do.
    by_rule: {
      MC: plan.filter(p => p.rule === 'MC' && !p.conflict).length,
      'TMS code': plan.filter(p => p.rule === 'TMS code' && !p.conflict).length,
      Name: plan.filter(p => p.rule === 'Name' && !p.conflict).length,
    },
    created_names: plan.filter(p => p.isNew).map(p => p.row.name).sort((a, b) => a.localeCompare(b)),
  }
  return { plan, counts, conflictGroups }
}
