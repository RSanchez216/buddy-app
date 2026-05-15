import { supabase } from '../../../lib/supabase'

// Lessor names we know exist in the TMS exports but aren't in Vendor Master
// yet. Merged with Vendor Master Equipment Rental vendors + their aliases at
// upload time. Case-insensitive substring match against equipment_owner_raw.
//
// Names that correspond to active Loan Entities (Baikozu Inc, M-Team
// Investments) are deliberately NOT in this list — they're caught earlier
// by the loan-entity rule and classified as company_owned.
export const HARDCODED_LESSORS = [
  'NATO Leasing',
  'NATO Rentals',
  'AIM Rentals',
  'Cadence Truck & Trailer Leasing LLC',
  'Cadence Truck & Trailer Leasing',
  'UA Team Inc',
]

// Loosen punctuation/whitespace for fuzzy match: "M-Team Investments" and
// "M Team Investments" should compare equal. Lowercases, replaces hyphens
// with spaces, collapses runs of whitespace.
function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
}

// Reusable fuzzy-include matcher — `equal` OR `haystack contains needle`
// OR `needle contains haystack`. Used by both the loan-entity matcher and
// the lessor matcher so they share identical logic.
function fuzzyIncludes(needleNorm, haystackNorm) {
  if (!needleNorm || !haystackNorm) return false
  return needleNorm === haystackNorm
    || needleNorm.includes(haystackNorm)
    || haystackNorm.includes(needleNorm)
}

// Active Loan Entity names. The classifier matches Equipment Owner against
// these before any other rule; any hit classifies as company_owned.
export async function loadActiveLoanEntities() {
  const { data } = await supabase
    .from('loan_entities')
    .select('name')
    .eq('is_active', true)
  return (data || []).map(e => e.name).filter(Boolean)
}

// Pulls Vendor Master Equipment Rental vendors + their aliases, then merges
// with the hardcoded fallback. Returns a deduped, case-preserved string list.
//
// Defensive: any vendor (or alias) whose name fuzzy-matches an active Loan
// Entity is dropped from the lessor list, since Loan Entities should always
// classify as company_owned — even if someone creates an Equipment Rental
// vendor with the same name by mistake.
export async function loadKnownLessors(loanEntityNames = []) {
  const [vRes, aRes] = await Promise.all([
    supabase
      .from('vendors')
      .select('name')
      .eq('category', 'Equipment Rental')
      .eq('is_active', true),
    supabase
      .from('vendor_aliases')
      .select('alias, vendor:vendors!inner(category, is_active)')
      .eq('vendor.category', 'Equipment Rental')
      .eq('vendor.is_active', true),
  ])
  const vendorNames = (vRes.data || []).map(v => v.name).filter(Boolean)
  const aliasNames = (aRes.data || []).map(a => a.alias).filter(Boolean)
  const entityNorms = (loanEntityNames || []).map(normalizeForMatch).filter(Boolean)

  function clashesWithEntity(name) {
    const n = normalizeForMatch(name)
    return entityNorms.some(e => fuzzyIncludes(n, e))
  }

  const merged = [...vendorNames, ...aliasNames, ...HARDCODED_LESSORS]
    .filter(name => !clashesWithEntity(name))

  // Dedupe case-insensitively but preserve original casing
  const seen = new Set()
  const out = []
  for (const name of merged) {
    const k = name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(name)
  }
  return out
}

const COMPANY_PATTERNS = ['manas express', 'manas corp']
const LESSOR_KEYWORDS  = ['leasing', 'rentals', 'investment', 'rental llc', 'lease']

// classifyOwnership(equipmentOwnerRaw, driverIdResolved, knownLessors, allDrivers, loanEntities)
// Returns { stage, reason, confidence }
//   stage      ∈ unclassified | company_owned | company_leased | driver_owned
//   confidence ∈ low | medium | high
// driver_purchase_in_progress is intentionally not assigned by auto-class —
// that transition is a manual decision (PR 4).
export function classifyOwnership(equipmentOwnerRaw, driverIdResolved, knownLessors, allDrivers, loanEntities = []) {
  const raw = (equipmentOwnerRaw || '').trim()
  const lower = raw.toLowerCase()
  const ownerNorm = normalizeForMatch(raw)

  if (!raw) {
    return { stage: 'unclassified', reason: 'No equipment owner specified', confidence: 'low' }
  }

  // Rule 1 — Active Loan Entity match → company_owned (top priority).
  // Catches Baikozu Inc, M-Team Investments, Manas Express, TMS Transport
  // Solutions, etc. — the entities the company actually owns equipment
  // through, even when they incidentally look like rentals.
  const entityMatch = (loanEntities || []).find(name =>
    fuzzyIncludes(ownerNorm, normalizeForMatch(name))
  )
  if (entityMatch) {
    return { stage: 'company_owned', reason: `Matched Loan Entity: ${entityMatch}`, confidence: 'high' }
  }

  // Rule 2 — Manas Express prose fallback. Loan-entity rule typically
  // catches this first; kept as a safety net if Manas Express is ever
  // removed from loan_entities.
  for (const pat of COMPANY_PATTERNS) {
    if (lower.includes(pat)) {
      return { stage: 'company_owned', reason: 'Matched Manas Express pattern', confidence: 'high' }
    }
  }

  // Rule 3 — known lessor (Vendor Master + aliases + hardcoded), using the
  // same fuzzy-include logic as the loan-entity matcher.
  const lessorMatch = (knownLessors || []).find(lessor =>
    fuzzyIncludes(ownerNorm, normalizeForMatch(lessor))
  )
  if (lessorMatch) {
    return { stage: 'company_leased', reason: `Matched known lessor: "${lessorMatch}"`, confidence: 'high' }
  }

  // Rule 3 — lessor keyword heuristic
  const kw = LESSOR_KEYWORDS.find(k => lower.includes(k))
  if (kw) {
    return { stage: 'company_leased', reason: `Contains lessor keyword "${kw}" — review`, confidence: 'medium' }
  }

  // Rule 4a — assigned driver's name appears in equipment_owner
  if (driverIdResolved) {
    const driver = (allDrivers || []).find(d => d.id === driverIdResolved)
    if (driver?.full_name) {
      const parts = driver.full_name.split(/\s+/).filter(Boolean)
      const firstName = (parts[0] || '').toLowerCase()
      const lastName  = (parts[parts.length - 1] || '').toLowerCase()
      if ((lastName && lower.includes(lastName)) || (firstName && lower.includes(firstName))) {
        return { stage: 'driver_owned', reason: `Equipment owner matches driver name (${driver.full_name})`, confidence: 'high' }
      }
    }
  }

  // Rule 4b — any driver last name (>3 chars to avoid false positives)
  const driverMatch = (allDrivers || []).find(d => {
    if (!d.full_name) return false
    const last = d.full_name.split(/\s+/).pop().toLowerCase()
    return last.length > 3 && lower.includes(last)
  })
  if (driverMatch) {
    return { stage: 'driver_owned', reason: `Equipment owner contains driver last name: ${driverMatch.full_name}`, confidence: 'medium' }
  }

  // Rule 5 — fall through
  return { stage: 'unclassified', reason: 'No classification rule matched — needs review', confidence: 'low' }
}
