import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// Subcomponent that watches a VIN string and surfaces a match against
// loan_equipment when one exists. Parent handles the actual linking by
// passing onLink — VinMatch is only responsible for finding & presenting.
//
// When `linked` is truthy, renders the linked-state pill (with Unlink).
export default function VinMatch({ vin, linked, onLink, onUnlink }) {
  const [match, setMatch] = useState(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    setMatch(null)
    if (linked) return
    const trimmed = (vin || '').trim()
    if (trimmed.length < 11) return

    let cancelled = false
    const handle = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from('loan_equipment')
        .select('id, vin, year, make, model, equipment_type, unit_number, loan_id, loans!inner(id, loan_id_external, contract_number)')
        .ilike('vin', trimmed)
        .limit(1)
      if (cancelled) return
      setSearching(false)
      setMatch(data && data.length ? data[0] : null)
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [vin, linked])

  if (linked) {
    return (
      <div className="flex items-center justify-between gap-2 mt-1.5 px-3 py-2 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20">
        <div className="text-xs text-cyan-700 dark:text-cyan-300 min-w-0">
          <span className="font-semibold">Linked: </span>
          <span className="truncate">{linked.label}</span>
        </div>
        <button
          onClick={onUnlink}
          className="text-xs font-medium text-cyan-700 dark:text-cyan-300 hover:underline whitespace-nowrap"
        >
          Unlink
        </button>
      </div>
    )
  }

  if (searching) {
    return <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Searching for match…</p>
  }

  if (!match) return null

  const desc = [match.year, match.make, match.model].filter(Boolean).join(' ') || match.equipment_type || match.unit_number || 'Equipment'
  const loanLabel = match.loans?.loan_id_external || match.loans?.contract_number || ''

  return (
    <div className="flex items-center justify-between gap-2 mt-1.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
      <div className="text-xs text-emerald-700 dark:text-emerald-400 min-w-0">
        <span className="font-semibold">Match found: </span>
        <span className="truncate">{desc}{loanLabel ? ` · loan ${loanLabel}` : ''}</span>
      </div>
      <button
        onClick={() => onLink?.({
          equipmentId: match.id,
          loanId: match.loan_id,
          label: desc,
        })}
        className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap"
      >
        Link
      </button>
    </div>
  )
}
