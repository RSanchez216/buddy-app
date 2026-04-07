/**
 * Build a flat, ordered, indented list of departments for <select> dropdowns.
 * Parents first, children indented with em-dash.
 */
export function buildDeptOptions(departments) {
  const parents = departments.filter(d => !d.parent_id)
  const result = []
  parents.forEach(p => {
    result.push({ id: p.id, label: p.name })
    departments
      .filter(d => d.parent_id === p.id)
      .forEach(c => result.push({ id: c.id, label: `\u2014 ${c.name}` }))
  })
  // orphaned children (parent not in list) at bottom
  const seen = new Set(result.map(r => r.id))
  departments.filter(d => d.parent_id && !seen.has(d.id))
    .forEach(d => result.push({ id: d.id, label: `\u2014 ${d.name}` }))
  return result
}

/** Format a payment method label */
export function pmLabel(pm) {
  if (!pm) return ''
  return pm.account_reference ? `${pm.name} \u2014 ${pm.account_reference}` : pm.name
}
