import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useEquipmentTypes } from '../../../hooks/useEquipmentTypes'

// Subcomponent that watches a VIN string and surfaces a match against
// loan_equipment when one exists. Parent handles the actual linking by
// passing onLink — VinMatch is only responsible for finding & presenting.
//
// When `linked` is truthy, renders the linked-state pill (with Unlink).
export default function VinMatch({ vin, linked, onLink, onUnlink }) {
  const [match, setMatch] = useState(null)
  const [searching, setSearching] = useState(false)
  const { formatLabel: formatEqLabel } = useEquipmentTypes()

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
        .select('id, vin, year, make, model, equipment_type, unit_number, loan_id, loans!inner(id, loan_id_external, contract_number, entity_id)')
        .ilike('vin', trimmed)
        .limit(1)
      if (cancelled) return
      setSearching(false)
      setMatch(data && data.length ? data[0] : null)
    }, 300)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [vin, linked])

  if (linked) {
    // Two-row layout — see Match-found below for the same shape.
    return (
      <div className="mt-1.5 px-3 py-2 rounded-lg bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 w-full">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>Linked</span>
          </div>
          <button
            onClick={onUnlink}
            className="shrink-0 text-xs font-medium text-cyan-700 dark:text-cyan-300 px-2.5 py-0.5 rounded border border-cyan-300 dark:border-cyan-500/30 hover:bg-cyan-100/60 dark:hover:bg-cyan-500/20 whitespace-nowrap"
          >
            Unlink
          </button>
        </div>
        <div className="text-xs text-cyan-700 dark:text-cyan-300 break-words [overflow-wrap:anywhere]">
          {linked.label}
        </div>
      </div>
    )
  }

  if (searching) {
    return <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Searching for match…</p>
  }

  if (!match) return null

  const desc = [match.year, match.make, match.model].filter(Boolean).join(' ') || (match.equipment_type ? formatEqLabel(match.equipment_type) : null) || match.unit_number || 'Equipment'
  const loanLabel = match.loans?.loan_id_external || match.loans?.contract_number || ''

  // Two-row layout: header (label + Link button) on top, body (equipment +
  // loan reference) below. Long loan references can have no natural break
  // points (e.g. Mteam-FirstBusinessBank-7123) so the loan line gets
  // overflow-wrap:anywhere to prevent overflow at any modal width.
  return (
    <div className="mt-1.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 w-full">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>Match found</span>
        </div>
        <button
          onClick={() => onLink?.({
            equipmentId: match.id,
            loanId: match.loan_id,
            label: desc + (loanLabel ? ` · loan ${loanLabel}` : ''),
            // Carry along derived values so the parent can autofill
            // empty Entity / Equipment Type fields without an extra
            // round-trip.
            entityId: match.loans?.entity_id || null,
            equipmentType: match.equipment_type || null,
          })}
          className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-400 px-2.5 py-0.5 rounded border border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-100/60 dark:hover:bg-emerald-500/20 whitespace-nowrap"
        >
          Link
        </button>
      </div>
      <div className="text-xs text-emerald-700 dark:text-emerald-400 leading-snug">
        <div className="font-medium">{desc}</div>
        {loanLabel && (
          <div className="opacity-85 break-words [overflow-wrap:anywhere]">loan {loanLabel}</div>
        )}
      </div>
    </div>
  )
}
