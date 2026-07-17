import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Module-level cache for the expense_categories reference table. The
// shape mirrors useEquipmentTypes — fetch once per page load, share
// across callers, expose an invalidate() to bust after mutations.
// Includes both active and archived rows so old records that point at
// retired categories still resolve to a display label.

let cache = null
let inflight = null

async function fetchExpenseCategories() {
  if (cache) return cache
  if (inflight) return inflight
  inflight = supabase
    .from('expense_categories')
    .select('id, name, display_label, sort_order, is_active, scope')
    .order('sort_order', { ascending: true })
    .order('display_label', { ascending: true })
    .then(({ data, error }) => {
      inflight = null
      if (error) { console.error('[useExpenseCategories] fetch failed:', error); return [] }
      cache = data || []
      return cache
    })
  return inflight
}

// Call after any insert / update / archive on expense_categories so the
// next mount picks up the change. Both surfaces that write (the inline
// "+ Add new category" in the batch modal, and the Settings page) hit
// this.
export function invalidateExpenseCategories() {
  cache = null
}

// Pure formatter for non-React callers. Returns the display_label for a
// name when found in the cache; falls back to a humanized version of the
// raw name so orphaned values still render reasonably.
export function formatExpenseCategoryLabel(name, types = cache) {
  if (!name) return '—'
  const hit = (types || []).find(t => t.name === name)
  if (hit) return hit.display_label
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function useExpenseCategories() {
  const [categories, setCategories] = useState(cache || [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    let cancelled = false
    if (cache) { setCategories(cache); setLoading(false); return }
    fetchExpenseCategories().then(list => {
      if (cancelled) return
      setCategories(list); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const labelByName = useMemo(() => {
    const m = new Map()
    for (const c of categories) m.set(c.name, c.display_label)
    return m
  }, [categories])

  const formatLabel = useMemo(() => (name) => {
    if (!name) return '—'
    return labelByName.get(name) || formatExpenseCategoryLabel(name, categories)
  }, [labelByName, categories])

  // Helpers for the picker UI. Active categories are the live dropdown
  // options; archived are only surfaced for rows that already reference
  // them (the batch modal pins the row's archived category to the top
  // as an italic option so the user can keep or switch).
  const active   = useMemo(() => categories.filter(c => c.is_active),  [categories])
  const archived = useMemo(() => categories.filter(c => !c.is_active), [categories])

  // Scope-filtered active options. A category's scope is one of
  // 'fleet' | 'office' | 'both'; rows without a scope are treated as
  // 'fleet' so existing cash-flow categories keep showing everywhere they
  // did before. Fleet surfaces (Payment Calendar, recurring templates) want
  // fleet+both; the Office Expenses page wants office+both.
  const scopeOf = (c) => c.scope || 'fleet'
  const activeFleet  = useMemo(() => active.filter(c => scopeOf(c) === 'fleet'  || scopeOf(c) === 'both'), [active])
  const activeOffice = useMemo(() => active.filter(c => scopeOf(c) === 'office' || scopeOf(c) === 'both'), [active])

  async function refetch() {
    invalidateExpenseCategories()
    const next = await fetchExpenseCategories()
    setCategories(next)
    return next
  }

  return { categories, active, activeFleet, activeOffice, archived, labelByName, formatLabel, loading, refetch }
}
