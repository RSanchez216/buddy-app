// Canonical expense-category list used by the batch detail modal and
// (future) any other surface that picks a category for custom_outflows.
//
// The category column stays a free-text field on custom_outflows — there
// is no reference table. Promoting this list to a managed table is a
// reasonable future PR if governance / display labels become important.

export const CANONICAL_EXPENSE_CATEGORIES = [
  'accounting',
  'bank_fee',
  'factoring_fee',
  'fuel',
  'IFTA',
  'insurance',
  'lease',
  'legal',
  'maintenance',
  'other',
  'owner_draw',
  'payroll',
  'permits',
  'repair',
  'telematics',
  'tolls',
]

// Merge the canonical list with whatever distinct values exist in the
// custom_outflows.category column right now. Data values that aren't in
// the canonical list are preserved (no silent drop). 'other' is pinned
// to the bottom; everything else sorts case-insensitively.
//
// Case-variant historical rows (e.g. 'OTHER' alongside 'other') stay
// distinct here — surface clean-up is out of scope. The inline
// add-new flow has its own case-insensitive dedup against the merged
// list so the user can't introduce new duplicates.
export function mergeCategoriesWithData(dataValues) {
  const all = new Set(CANONICAL_EXPENSE_CATEGORIES)
  for (const v of (dataValues || [])) if (v) all.add(v)
  const sorted = [...all].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const idx = sorted.indexOf('other')
  if (idx >= 0) {
    sorted.splice(idx, 1)
    sorted.push('other')
  }
  return sorted
}

// Validates the inline "+ Add new category" submission. Must start with
// a lowercase letter, then lowercase letters / digits / underscores,
// 1-30 chars total. Spaces and other punctuation are rejected.
export function isValidCategoryName(name) {
  if (typeof name !== 'string') return false
  return /^[a-z][a-z0-9_]{0,29}$/.test(name)
}

// Case-insensitive dedup against an existing merged list. Returns the
// existing entry if a case-variant already exists, otherwise returns
// the new value as-is. Caller uses the return value as the row's
// category and the list-add target.
export function dedupeCategory(name, existingList) {
  const lower = name.toLowerCase()
  const match = (existingList || []).find(c => c.toLowerCase() === lower)
  return match || name
}
