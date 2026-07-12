// Shared "collected from" resolution helpers, used by the payment-history row
// cell and the Record/Edit payment forms so both derive the same driver.

// The assigned driver whose drove-window overlaps [periodStart, periodEnd],
// preferring the one that covers periodStart. Returns the get_contract_drivers
// row (driver_id, full_name, internal_id, …) or null.
export function deriveAssignedDriver(contractDrivers, periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return null
  const assigned = (contractDrivers || []).filter(d => d.is_assigned && d.drove_start)
  const overlaps = assigned.filter(d =>
    d.drove_start <= periodEnd && (d.drove_end == null || d.drove_end >= periodStart))
  if (overlaps.length === 0) return null
  const covering = overlaps.find(d =>
    d.drove_start <= periodStart && (d.drove_end == null || d.drove_end >= periodStart))
  return covering || overlaps[0]
}

export function driverInitials(name) {
  const parts = String(name || '').trim().split(/\s+/)
  return (((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '')).toUpperCase() || '?'
}
