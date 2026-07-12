import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// A driver's driver-purchase contracts + behind status, from
// v_driver_purchase_summary. Guarded: a driver with no purchase returns
// hasContract=false so callers simply render no link/chip.
//
// Link targets:
//   • purchasesHref — the general "Driver Purchases" link: the single contract
//     when there's one, else the Driver Purchases list searched to this driver.
//   • contractHref  — the specific contract to deep-link from a "behind" chip
//     (the behind contract, else the first).

const BEHIND_STATUSES = new Set(['falling_behind', 'holding'])

export function useDriverContracts(driverId) {
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(!!driverId)

  useEffect(() => {
    if (!driverId) { setContracts([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    supabase
      .from('v_driver_purchase_summary')
      .select('id, driver_id, driver_name, status_name, past_due_status, amount_behind, periods_behind, truck_number')
      .eq('driver_id', driverId)
      .then(({ data }) => {
        if (cancelled) return
        setContracts(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [driverId])

  const contractCount = contracts.length
  const hasContract = contractCount > 0
  const behindContracts = contracts.filter(c => BEHIND_STATUSES.has(c.past_due_status))
  const isBehind = behindContracts.length > 0
  const totalPastDue = contracts.reduce((s, c) => s + (Number(c.amount_behind) || 0), 0)
  const primaryContractId = (behindContracts[0] || contracts[0] || null)?.id || null
  const driverName = contracts[0]?.driver_name || ''

  const purchasesHref = !hasContract
    ? null
    : contractCount === 1
      ? `/financial-controls/driver-purchases/${contracts[0].id}`
      : `/financial-controls/driver-purchases?q=${encodeURIComponent(driverName)}`
  const contractHref = primaryContractId ? `/financial-controls/driver-purchases/${primaryContractId}` : null

  return {
    loading,
    hasContract,
    contractCount,
    contracts,
    isBehind,
    totalPastDue,
    primaryContractId,
    purchasesHref,
    contractHref,
  }
}
