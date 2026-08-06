import { normName } from './customersParse'

// MC numbers to a canonical digits-only form so "MC 123456", "123456" and
// "123456 " all compare equal — on both sides of the match and on write.
export const normMc = (s) => {
  const d = String(s ?? '').replace(/\D/g, '')
  return d || null
}
// Match each file row to an existing customer, first hit wins: MC → normalised
// name. If the two rules point at DIFFERENT customers it's a conflict — never
// guess; the person resolves it, and the row is applied to nothing. Rows that
// match nothing are created.
//
// tms_code is deliberately NOT a match rule. It's an abbreviation, not an
// identifier, and in an industry where most firms are called something-Logistics
// it collides constantly: one `ML` covers Maco, Manco, Marek, Matson, Melton,
// MGN, Mkita and Moeller. Matching on it resolved FitzMark to Fusion Logistics
// and produced 563 conflicts on 1,000 rows while winning ZERO matches outright —
// every code hit was already found by MC or name. It is still stored on the
// customer and shown on the profile; it just cannot decide identity.
export function buildCustomerPlan({ rows, existing }) {
  const byMc = new Map(), byName = new Map()
  for (const c of existing || []) {
    const mc = normMc(c.mc_number); if (mc && !byMc.has(mc)) byMc.set(mc, c)
    const nm = normName(c.name); if (nm && !byName.has(nm)) byName.set(nm, c)
  }

  const plan = rows.map((r) => {
    const mc = normMc(r.mc_number)
    const nm = normName(r.name)
    const mcHit = mc ? byMc.get(mc) : null
    const nameHit = nm ? byName.get(nm) : null
    const ids = new Set([mcHit, nameHit].filter(Boolean).map(c => c.id))

    let match = null, rule = null, conflict = false
    if (ids.size > 1) {
      conflict = true
    } else if (mcHit) { match = mcHit; rule = 'MC' }
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
      conflictWith: conflict ? [mcHit, nameHit].filter(Boolean).map(c => c.name) : [],
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

  return { plan, counts: countPlan(plan), conflictGroups }
}

// Counts are derived from the plan every time it changes — including after a
// conflict is resolved — so the tiles can never drift from what Apply will do.
export function countPlan(plan) {
  return {
    total: plan.length,
    matched: plan.filter(p => p.match && !p.conflict).length,
    created: plan.filter(p => p.isNew && !p.conflict).length,
    conflicts: plan.filter(p => p.conflict).length,
    mc_filled: plan.filter(p => p.willFillMc).length,
    // Conflicts are excluded everywhere — nothing about them is applied, so
    // counting them under a match rule would overstate what the run will do.
    by_rule: {
      MC: plan.filter(p => p.rule === 'MC' && !p.conflict).length,
      Name: plan.filter(p => p.rule === 'Name' && !p.conflict).length,
    },
    created_names: plan.filter(p => p.isNew && !p.conflict).map(p => p.createName || p.row.name).sort((a, b) => a.localeCompare(b)),
  }
}

// customers has a UNIQUE index on lower(btrim(name)), so "Create new" cannot
// reuse the name that caused the clash — verified: the insert is rejected
// outright. The MC is what actually separates the two companies and is
// searchable, so it goes in the name; city/state is the fallback when a row has
// no MC, and a counter after that.
export function disambiguateName(base, row, taken) {
  const mc = normMc(row.mc_number)
  const place = [row.city, row.state].filter(Boolean).join(', ')
  const candidates = [
    base,
    mc ? `${base} (MC ${mc})` : null,
    place ? `${base} (${place})` : null,
  ].filter(Boolean)
  for (const c of candidates) {
    if (!taken.has(normName(c))) return c
  }
  for (let i = 2; i < 50; i++) {
    const c = `${base} (${i})`
    if (!taken.has(normName(c))) return c
  }
  return `${base} (${Date.now()})`
}

// Fold the human's conflict decisions back into the plan.
//
//   link   — this side updates the existing customer; it becomes an ordinary
//            match. Only ONE side of a group may link, or the duplicate-target
//            abort comes straight back.
//   create — this side becomes a separate customer, with a name that clears the
//            unique index. It creates a customer and NOTHING else: no load is
//            reattributed. Splitting freight between two brokers is a separate
//            decision and must never be a side effect of a customer import.
//
// Undecided sides stay conflicts and are not written.
export function resolveConflicts({ plan, conflictGroups, resolutions, existingNames }) {
  const taken = new Set(existingNames || [])
  // Names this run already claims, so two creates can't collide either.
  for (const p of plan) {
    if (p.isNew && !p.conflict) taken.add(normName(p.row.name))
  }

  const next = plan.map(p => ({ ...p }))
  const byIndex = new Map(next.map(p => [p.row.row_index, p]))

  for (const g of conflictGroups || []) {
    const linked = g.sides.filter(s => resolutions[`${g.key}#${s.row_index}`] === 'link')
    for (const s of g.sides) {
      const choice = resolutions[`${g.key}#${s.row_index}`]
      const p = byIndex.get(s.row_index)
      if (!p || !choice) continue

      // Guard the invariant rather than trusting the UI to hold it.
      if (choice === 'link' && (linked.length > 1 || !g.target_id)) continue

      if (choice === 'link') {
        p.conflict = false
        p.conflictKind = undefined
        p.isNew = false
        p.rule = 'Resolved'
        p.willFillMc = !!normMc(p.row.mc_number) && !normMc(p.match?.mc_number)
      } else if (choice === 'create') {
        const name = disambiguateName(p.row.name, p.row, taken)
        taken.add(normName(name))
        p.conflict = false
        p.conflictKind = undefined
        p.isNew = true
        p.match = null
        p.matchId = null
        p.matchName = null
        p.rule = null
        p.createName = name
        p.willFillMc = !!normMc(p.row.mc_number)
      }
    }
  }
  return { plan: next, counts: countPlan(next) }
}
