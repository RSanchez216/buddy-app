import { supabase } from '../../../lib/supabase'

// Lessor names we know exist in the TMS exports but aren't in Vendor Master
// yet. Merged with Vendor Master Equipment Rental vendors + their aliases at
// upload time. Case-insensitive substring match against equipment_owner_raw.
export const HARDCODED_LESSORS = [
  'NATO Leasing',
  'NATO Rentals',
  'AIM Rentals',
  'M Team Investment LLC',
  'M Team Investments',
  'Cadence Truck & Trailer Leasing LLC',
  'Cadence Truck & Trailer Leasing',
  'UA Team Inc',
  'BAIKOZU INC',
  'BAIKOZU',
]

// Pulls Vendor Master Equipment Rental vendors + their aliases, then merges
// with the hardcoded fallback. Returns a deduped, case-preserved string list.
export async function loadKnownLessors() {
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
  const merged = [...vendorNames, ...aliasNames, ...HARDCODED_LESSORS]
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

// classifyOwnership(equipmentOwnerRaw, driverIdResolved, knownLessors, allDrivers)
// Returns { stage, reason, confidence }
//   stage      ∈ unclassified | company_owned | company_leased | driver_owned
//   confidence ∈ low | medium | high
// driver_purchase_in_progress is intentionally not assigned by auto-class —
// that transition is a manual decision (PR 4).
export function classifyOwnership(equipmentOwnerRaw, driverIdResolved, knownLessors, allDrivers) {
  const raw = (equipmentOwnerRaw || '').trim()
  const lower = raw.toLowerCase()

  if (!raw) {
    return { stage: 'unclassified', reason: 'No equipment owner specified', confidence: 'low' }
  }

  // Rule 1 — Manas Express variants → company_owned
  for (const pat of COMPANY_PATTERNS) {
    if (lower.includes(pat)) {
      return { stage: 'company_owned', reason: 'Matched Manas Express pattern', confidence: 'high' }
    }
  }

  // Rule 2 — known lessor (Vendor Master + aliases + hardcoded)
  const lessorMatch = (knownLessors || []).find(lessor => {
    const ll = lessor.toLowerCase()
    if (!ll) return false
    return lower === ll || lower.includes(ll) || ll.includes(lower)
  })
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
