import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Module-level cache. equipment_types changes rarely (manually via the
// settings page) so we fetch once per page load and share across every
// caller. Includes inactive types — old rows may still reference them and
// must still resolve to a display label. Filter by is_active at the
// dropdown layer if you want to hide retired types from new selections.
let cache = null
let inflight = null

async function fetchEquipmentTypes() {
  if (cache) return cache
  if (inflight) return inflight
  inflight = supabase
    .from('equipment_types')
    .select('id, name, display_label, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('display_label', { ascending: true })
    .then(({ data, error }) => {
      inflight = null
      if (error) { console.error('[useEquipmentTypes] fetch failed:', error); return [] }
      cache = data || []
      return cache
    })
  return inflight
}

// Bust the cache after a mutation (currently only the settings page edits
// equipment_types). Call after add/edit/delete/toggle so other open tabs
// can pick up the change on next mount.
export function invalidateEquipmentTypes() {
  cache = null
}

// Format a single equipment_type name without subscribing — useful for
// non-React callers (e.g. memo helpers building summary strings). Returns
// the cached label if available, otherwise the raw name uppercased.
export function formatEquipmentLabel(name, types = cache) {
  if (!name) return '—'
  const list = types || []
  const hit = list.find(t => t.name === name)
  return hit?.display_label || String(name).toUpperCase()
}

export function useEquipmentTypes() {
  const [types, setTypes] = useState(cache || [])
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    let cancelled = false
    if (cache) { setTypes(cache); setLoading(false); return }
    fetchEquipmentTypes().then(list => {
      if (cancelled) return
      setTypes(list); setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const labelByName = useMemo(() => {
    const m = new Map()
    for (const t of types) m.set(t.name, t.display_label)
    return m
  }, [types])

  const formatLabel = useMemo(() => {
    return (name) => {
      if (!name) return '—'
      return labelByName.get(name) || String(name).toUpperCase()
    }
  }, [labelByName])

  return { types, labelByName, formatLabel, loading }
}
