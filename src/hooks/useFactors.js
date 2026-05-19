import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Module-cached fetch for the factors reference table. Mirrors the
// useExpenseCategories / useEquipmentTypes shape — fetch once per page
// load, share across callers, expose invalidate() for mutation flows.
// Includes archived factors so existing inflow rows referencing a
// retired factor still resolve to a name and fee rate at render time.

let cache = null
let inflight = null

async function fetchFactors() {
  if (cache) return cache
  if (inflight) return inflight
  inflight = supabase
    .from('factors')
    .select('id, name, fee_rate, default_deposit_account_id, notes, is_active')
    .order('is_active', { ascending: false })
    .order('name', { ascending: true })
    .then(({ data, error }) => {
      inflight = null
      if (error) { console.error('[useFactors] fetch failed:', error); return [] }
      cache = data || []
      return cache
    })
  return inflight
}

export function invalidateFactors() {
  cache = null
}

// Decimal -> percent string with two decimals.
//   formatFeeRate(0.02) -> "2.00%"
export function formatFeeRate(rate) {
  if (rate == null) return '—'
  const n = Number(rate)
  if (Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(2)}%`
}

// User types "2" or "2.0" or "2.50" → decimal 0.025 max two cents of
// precision. Returns null when input is unparseable.
export function parseFeeRatePercent(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (Number.isNaN(n)) return null
  if (n < 0 || n > 100) return null
  return Math.round(n * 100) / 10000  // n % -> decimal, 4-decimal precision
}

export function useFactors() {
  const [factors, setFactors] = useState(cache || [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    let cancelled = false
    if (cache) { setFactors(cache); setLoading(false); return }
    fetchFactors().then(list => {
      if (cancelled) return
      setFactors(list); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const byId = useMemo(() => {
    const m = new Map()
    for (const f of factors) m.set(f.id, f)
    return m
  }, [factors])

  const active   = useMemo(() => factors.filter(f => f.is_active),  [factors])
  const archived = useMemo(() => factors.filter(f => !f.is_active), [factors])

  async function refetch() {
    invalidateFactors()
    const next = await fetchFactors()
    setFactors(next)
    return next
  }

  return { factors, active, archived, byId, loading, refetch }
}
