import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Lists active funding accounts that are stale (>=3 days since last
// recorded balance, OR never recorded) AND have at least one pending
// flow scheduled inside the visible window. Wraps the
// accounts_needing_balance_update(date, date) RPC from Slice 2c.
//
// Day mode → startDate === endDate (the focused day).
// Week mode → startDate = monday ISO, endDate = sunday ISO.
//
// Idle stale accounts (no flows in window) and fresh accounts (with
// flows but <3 days stale) don't surface; both would be noisy nudges.
export function useAccountsNeedingBalanceUpdate({ startDate, endDate }) {
  const [accounts, setAccounts] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchOnce = useCallback(async () => {
    if (!startDate || !endDate) return
    setIsLoading(true)
    const { data, error } = await supabase.rpc('accounts_needing_balance_update', {
      p_start_date: startDate,
      p_end_date: endDate,
    })
    if (error) console.warn('accounts_needing_balance_update error:', error.message)
    setAccounts(data || [])
    setIsLoading(false)
  }, [startDate, endDate])

  useEffect(() => { fetchOnce() }, [fetchOnce])

  // Expose stable refetch + a per-id Set so consumers can do O(1)
  // "is this account in the list?" checks without iterating.
  const idSet = new Set(accounts.map(a => a.funding_account_id))
  return { accounts, idSet, refetch: fetchOnce, isLoading }
}
