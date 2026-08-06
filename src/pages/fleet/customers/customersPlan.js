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

  const counts = {
    total: plan.length,
    matched: plan.filter(p => p.match).length,
    created: plan.filter(p => p.isNew).length,
    conflicts: plan.filter(p => p.conflict).length,
    mc_filled: plan.filter(p => p.willFillMc).length,
    by_rule: {
      MC: plan.filter(p => p.rule === 'MC').length,
      'TMS code': plan.filter(p => p.rule === 'TMS code').length,
      Name: plan.filter(p => p.rule === 'Name').length,
    },
    created_names: plan.filter(p => p.isNew).map(p => p.row.name).sort((a, b) => a.localeCompare(b)),
  }
  return { plan, counts }
}
