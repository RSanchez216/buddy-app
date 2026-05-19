// Validation + dedupe helpers for the inline "+ Add new category" flow.
//
// The canonical category list itself now lives in the expense_categories
// reference table (see migration 20260519000006). The frontend reads it
// via useExpenseCategories(); this file holds only the small pure
// helpers that don't need DB access.

// Validates the inline "+ Add new category" submission. Must start with
// a lowercase letter, then lowercase letters / digits / underscores,
// 1-30 chars total. Spaces and other punctuation are rejected.
export function isValidCategoryName(name) {
  if (typeof name !== 'string') return false
  return /^[a-z][a-z0-9_]{0,29}$/.test(name)
}

// Case-insensitive dedup against an existing list of category names.
// Returns the existing entry when a case-variant already exists,
// otherwise returns the new value as-is. Caller uses the return value
// as the row's category and the list-add target.
export function dedupeCategory(name, existingNames) {
  const lower = String(name).toLowerCase()
  const match = (existingNames || []).find(c => String(c).toLowerCase() === lower)
  return match || name
}

// Turn a lowercase_underscore name into a Display Label for any code
// that needs to compute a label without subscribing to the hook (e.g.
// when seeding a fresh row in the DB via the inline + Add flow). The
// hook's formatLabel is preferred for render paths; this is the
// fallback for write paths.
export function defaultDisplayLabelFor(name) {
  if (!name) return ''
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
