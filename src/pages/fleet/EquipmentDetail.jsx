import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import { StagePill, STAGE_LABELS, fmtDate, fmtMoney, inspectionTone, trailerTypePillClasses } from './fleetUtils'
import TruckTrailerFormModal from './TruckTrailerFormModal'

// Shared detail page for trucks AND trailers. `kind` selects the table +
// the trailer-only display block. Three sections:
//   1. Equipment Info (read-only summary + Edit button)
//   2. Linked Debt Schedule Equipment (loan_equipment join via loan_equipment_id)
//   3. Ownership History (equipment_ownership_history entries)

export default function EquipmentDetail({ kind }) {
  const { canEdit } = useAuth()
  const navigate = useNavigate()
  const { id } = useParams()
  const isTrailer = kind === 'trailer'
  const table = isTrailer ? 'trailers' : 'trucks'
  const listPath = isTrailer ? '/fleet/trailers' : '/fleet/trucks'

  const [row, setRow] = useState(null)
  const [history, setHistory] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loanEq, setLoanEq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => { if (id) load() /* eslint-disable-line */ }, [id])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from(table)
      .select('*, driver:drivers(id, full_name)')
      .eq('id', id)
      .maybeSingle()
    setRow(data || null)

    if (data?.loan_equipment_id) {
      const { data: eq } = await supabase
        .from('loan_equipment')
        .select('id, unit_number, vin, equipment_type, make, model, year, purchase_date, purchase_price, monthly_payment, monthly_payment_override, loan:loans(id, contract_number, loan_id_external)')
        .eq('id', data.loan_equipment_id)
        .maybeSingle()
      setLoanEq(eq || null)
    } else {
      setLoanEq(null)
    }

    const historyKey = isTrailer ? 'trailer_id' : 'truck_id'
    const { data: hist } = await supabase
      .from('equipment_ownership_history')
      .select('*, driver:drivers(full_name), creator:users!equipment_ownership_history_created_by_fkey(full_name, email)')
      .eq(historyKey, id)
      .order('occurred_at', { ascending: false })
    setHistory(hist || [])

    // Assignment history (one row per (driver, start_date) event). Newest
    // first. Open assignments — end_date IS NULL — render with a "Current"
    // badge in the section below.
    const { data: assigns } = await supabase
      .from('equipment_assignments')
      .select('id, start_date, end_date, driver_name_raw, tms_driver_id, driver:drivers(id, full_name, internal_id)')
      .eq('equipment_type', kind)
      .eq(historyKey, id)
      .order('start_date', { ascending: false })
    setAssignments(assigns || [])

    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    )
  }

  if (!row) {
    return (
      <div className="space-y-4">
        <Link to={listPath} className="text-sm text-orange-600 hover:underline">← Back to {isTrailer ? 'Trailers' : 'Trucks'}</Link>
        <p className="text-sm text-gray-500 dark:text-slate-500">{isTrailer ? 'Trailer' : 'Truck'} not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to={listPath} className="text-xs text-orange-600 hover:underline">← {isTrailer ? 'Trailers' : 'Trucks'}</Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {row.unit_number || '—'}
            {row.year || row.make || row.model ? (
              <span className="text-base font-normal text-gray-500 dark:text-slate-500 ml-3">
                {[row.year, row.make, row.model].filter(Boolean).join(' ')}
              </span>
            ) : null}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <StagePill stage={row.ownership_stage} />
            {isTrailer && row.trailer_type && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${trailerTypePillClasses(row.trailer_type)}`}>
                {row.trailer_type}
              </span>
            )}
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setShowEdit(true)} className={S.btnPrimary}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Edit
          </button>
        )}
      </div>

      {/* Section 1 — Equipment Info */}
      <Section title="Equipment Info">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <InfoRow label="Unit #" value={row.unit_number} />
          <InfoRow label="VIN" value={row.vin} mono />
          <InfoRow label="Year / Make / Model" value={[row.year, row.make, row.model].filter(Boolean).join(' ') || '—'} />
          <InfoRow label="License Plate" value={row.license_plate ? `${row.license_plate}${row.license_state ? ` (${row.license_state})` : ''}` : '—'} />
          <InfoRow label="Transponder" value={row.transponder} />
          <InfoRow label="Carrier" value={row.carrier} />
          <InfoRow label="Equipment Owner (raw)" value={row.equipment_owner_raw} />
          <InfoRow label="Driver" value={row.driver?.full_name} />
          <InfoRow label="Status (TMS)" value={row.status} />
          <InfoRow label="Lessee" value={row.lessee} />
          {isTrailer && <InfoRow label="Trailer Type" value={row.trailer_type} />}
          {isTrailer && (
            <InfoRow
              label="Annual Inspection Exp."
              value={row.annual_inspection_expiration_date
                ? (() => {
                    const t = inspectionTone(row.annual_inspection_expiration_date)
                    return <span className={t.text}>{fmtDate(row.annual_inspection_expiration_date)} · {t.label}</span>
                  })()
                : '—'}
            />
          )}
          <InfoRow label="Ownership Stage" value={STAGE_LABELS[row.ownership_stage] || row.ownership_stage} />
          <InfoRow label="Stage Started" value={fmtDate(row.ownership_stage_started_at?.slice(0, 10))} />
        </div>
        {row.notes && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/5">
            <p className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{row.notes}</p>
          </div>
        )}
      </Section>

      {/* Section 2 — Linked Debt Schedule Equipment */}
      <Section title="Linked Debt Schedule Equipment">
        {loanEq ? (
          <div className="space-y-2 text-sm">
            <InfoRow label="Contract #" value={
              <Link to={`/financial-controls/debt-schedule/${loanEq.loan?.id}`} className="text-orange-600 hover:underline">
                {loanEq.loan?.contract_number || loanEq.loan?.loan_id_external || '—'}
              </Link>
            } />
            <InfoRow label="Loan Equipment Unit" value={loanEq.unit_number} />
            <InfoRow label="VIN on Loan" value={loanEq.vin} mono />
            <InfoRow label="Purchase Date" value={fmtDate(loanEq.purchase_date)} />
            <InfoRow label="Purchase Price" value={fmtMoney(loanEq.purchase_price)} />
            <InfoRow label="Monthly Payment" value={
              <span>
                {fmtMoney(loanEq.monthly_payment)}
                {loanEq.monthly_payment_override && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20">
                    ✋ Manual
                  </span>
                )}
              </span>
            } />
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-slate-400 flex items-center justify-between gap-3">
            <span>No debt schedule record linked.</span>
            <button
              disabled
              title="VIN matching arrives in PR 3"
              className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500 rounded-lg cursor-not-allowed"
            >
              Find by VIN (PR 3)
            </button>
          </div>
        )}
      </Section>

      {/* Section 3 — Assignment History (driver assignments per TMS upload) */}
      <Section title="Assignment History">
        {assignments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 italic">
            No assignment history. Upload the TMS {isTrailer ? 'Trailer' : 'Truck'} Assignments
            export from the {isTrailer ? 'Trailers' : 'Trucks'} list to populate this.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={S.th}>Driver</th>
                  <th className={S.th}>Start</th>
                  <th className={S.th}>End</th>
                  <th className={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {assignments.map(a => {
                  const isCurrent = a.end_date == null
                  const driverLabel = a.driver?.full_name
                    || a.driver_name_raw
                    || (a.tms_driver_id ? `#${a.tms_driver_id}` : '—')
                  const driverDisplay = a.driver?.id
                    ? (
                      <Link to={`/fleet/drivers/${a.driver.id}`} className="text-orange-600 hover:underline">
                        {driverLabel}
                      </Link>
                    )
                    : (
                      <span className="text-gray-600 dark:text-slate-400" title="Driver no longer in BUDDY">
                        {driverLabel}
                      </span>
                    )
                  return (
                    <tr key={a.id} className={S.tableRow}>
                      <td className={S.td}>{driverDisplay}</td>
                      <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>{fmtDate(a.start_date)}</td>
                      <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>
                        {a.end_date ? fmtDate(a.end_date) : <span className="italic text-emerald-600 dark:text-emerald-400">Open</span>}
                      </td>
                      <td className={`${S.td} whitespace-nowrap`}>
                        {isCurrent && (
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                            Current
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Section 4 — Ownership History */}
      <Section title="Ownership History">
        {history.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-slate-500 italic">No ownership transitions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={S.tableHead}>
                <tr>
                  <th className={S.th}>Date</th>
                  <th className={S.th}>Transition</th>
                  <th className={S.th}>Reason</th>
                  <th className={S.th}>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className={S.tableRow}>
                    <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>{fmtDate(h.occurred_at?.slice(0, 10))}</td>
                    <td className={S.td}>
                      <span className="text-xs text-gray-500 dark:text-slate-500">{STAGE_LABELS[h.from_stage] || h.from_stage || '—'}</span>
                      <span className="mx-2 text-gray-400 dark:text-slate-600">→</span>
                      <span className="text-xs font-medium text-gray-900 dark:text-slate-200">{STAGE_LABELS[h.to_stage] || h.to_stage}</span>
                    </td>
                    <td className={`${S.td} text-gray-600 dark:text-slate-400`}>{h.reason || '—'}</td>
                    <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400`}>{h.creator?.full_name || h.creator?.email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <TruckTrailerFormModal
        kind={kind}
        open={showEdit}
        editItem={row}
        onClose={() => setShowEdit(false)}
        onSaved={() => { setShowEdit(false); load() }}
      />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className={`${S.card} p-5`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-4">{title}</h2>
      {children}
    </section>
  )
}

function InfoRow({ label, value, mono }) {
  const display = value === null || value === undefined || value === ''
    ? <span className="text-gray-400 dark:text-slate-600">—</span>
    : value
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{label}</span>
      <span className={`text-sm text-gray-700 dark:text-slate-300 text-right ${mono ? 'font-mono text-xs' : ''}`}>{display}</span>
    </div>
  )
}
