import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import { StagePill, STAGE_LABELS, fmtDate, fmtMoney, inspectionTone, trailerTypePillClasses, OperationalStatusPill, OPERATIONAL_STATUS_LABELS } from './fleetUtils'
import TruckTrailerFormModal from './TruckTrailerFormModal'
import { useToast } from '../../contexts/ToastContext'
import Select from '../../components/Select'
import InfoIcon, { COST_PERIOD_TOOLTIP } from '../../components/InfoIcon'

// Shared detail page for trucks AND trailers. `kind` selects the table +
// the trailer-only display block. Three sections:
//   1. Equipment Info (read-only summary + Edit button)
//   2. Linked Debt Schedule Equipment (loan_equipment join via loan_equipment_id)
//   3. Ownership History (equipment_ownership_history entries)

export default function EquipmentDetail({ kind }) {
  const { canEdit, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { id } = useParams()
  const isTrailer = kind === 'trailer'
  const table = isTrailer ? 'trailers' : 'trucks'
  const listPath = isTrailer ? '/fleet/trailers' : '/fleet/trucks'
  // Pages that route here can pass { returnTo, returnLabel } in
  // location.state so the unit page can return to that exact filtered
  // view (e.g. Equipment Cost with the Needs cost filter still
  // applied). Falls back to the list when nothing was passed.
  const returnTo = location.state?.returnTo || listPath
  const returnLabel = location.state?.returnLabel || (isTrailer ? 'Trailers' : 'Trucks')

  const [row, setRow] = useState(null)
  const [history, setHistory] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loanEq, setLoanEq] = useState(null)
  const [lessorVendors, setLessorVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  // Lease editor local state — only initialized when the row loads and
  // applies on Save. Independent of the main edit modal.
  const [leaseDraft, setLeaseDraft] = useState({ lessor_vendor_id: '', lease_cost: '', lease_cost_period: 'monthly', lease_cost_per_mile: '', lease_rate_override: false })
  const [leaseSaving, setLeaseSaving] = useState(false)
  // Vendor rate card for the current lessor — drives the "Inherited"
  // breakdown when the unit's lease_rate_override is off.
  const [rateCard, setRateCard] = useState(null)
  const [rateCardFees, setRateCardFees] = useState([])

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
      .select('id, start_date, end_date, source, driver_name_raw, tms_driver_id, driver:drivers(id, full_name, internal_id)')
      .eq('equipment_type', kind)
      .eq(historyKey, id)
      .order('start_date', { ascending: false })
    setAssignments(assigns || [])

    // Lessor vendor list — only loaded when the row is a leased unit so we
    // don't pull 600+ vendors on every detail open. Equipment Rental
    // category is the convention for lessors.
    if (data?.ownership_stage === 'company_leased') {
      const { data: vendors } = await supabase
        .from('vendors')
        .select('id, name, category')
        .eq('category', 'Equipment Rental')
        .order('name')
      setLessorVendors(vendors || [])
      // Load the lessor's rate card so the inheritance breakdown can
      // render without an extra round-trip when the user toggles
      // Override off. Skipped when the unit has no lessor yet.
      if (data?.lessor_vendor_id) {
        const [{ data: card }, { data: cardFees }] = await Promise.all([
          supabase.from('vendor_lease_rates')
            .select('fixed_charge, period, per_mile_rate')
            .eq('vendor_id', data.lessor_vendor_id).maybeSingle(),
          supabase.from('vendor_lease_fees')
            .select('id, label, amount, sort_order')
            .eq('vendor_id', data.lessor_vendor_id)
            .order('sort_order').order('created_at'),
        ])
        setRateCard(card || null)
        setRateCardFees(cardFees || [])
      } else {
        setRateCard(null); setRateCardFees([])
      }
    }
    setLeaseDraft({
      lessor_vendor_id:    data?.lessor_vendor_id || '',
      lease_cost:          data?.lease_cost ?? '',
      lease_cost_period:   data?.lease_cost_period || 'monthly',
      lease_cost_per_mile: data?.lease_cost_per_mile ?? '',
      lease_rate_override: !!data?.lease_rate_override,
    })

    setLoading(false)
  }

  async function findByVin() {
    if (!row || !row.vin) return
    const vinNorm = String(row.vin).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    // Single best match: prefer active loans, then most-recent.
    const { data: matches, error: matchErr } = await supabase
      .from('loan_equipment')
      .select('id, vin, monthly_payment, loan:loans(id, status, contract_number, loan_id_external)')
      .ilike('vin', `%${vinNorm}%`)
    if (matchErr) { toast.error("Couldn't look up loan equipment", matchErr); return }
    const candidates = (matches || []).filter(m =>
      String(m.vin || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase() === vinNorm
    )
    if (candidates.length === 0) {
      toast.error(`No debt-schedule equipment matches VIN ${row.vin}.`)
      return
    }
    candidates.sort((a, b) => Number(b.loan?.status === 'active') - Number(a.loan?.status === 'active'))
    const best = candidates[0]
    const lbl = best.loan?.contract_number || best.loan?.loan_id_external || best.id.slice(0, 8)
    if (!window.confirm(`Link this ${kind} to "${lbl}" (${best.loan?.status})?`)) return
    const { error } = await supabase.from(table).update({
      loan_equipment_id: best.id, updated_by: user?.id || null,
    }).eq('id', row.id)
    if (error) { toast.error("Couldn't link to loan equipment", error); return }
    toast.success(`Linked to ${lbl}`)
    load()
  }

  async function saveLease() {
    if (!row || leaseSaving) return
    const costNum = leaseDraft.lease_cost === '' ? null : Number(leaseDraft.lease_cost)
    if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) {
      toast.error('Lease cost must be 0 or a positive number.')
      return
    }
    const perMileNum = leaseDraft.lease_cost_per_mile === '' ? null : Number(leaseDraft.lease_cost_per_mile)
    if (perMileNum != null && (!Number.isFinite(perMileNum) || perMileNum < 0)) {
      toast.error('Per-mile rate must be 0 or a positive number.')
      return
    }
    setLeaseSaving(true)
    const payload = {
      lessor_vendor_id:    leaseDraft.lessor_vendor_id || null,
      lease_cost:          costNum,
      lease_cost_period:   leaseDraft.lease_cost_period || 'monthly',
      lease_cost_per_mile: perMileNum,
      lease_rate_override: !!leaseDraft.lease_rate_override,
      updated_by:          user?.id || null,
    }
    const { error } = await supabase.from(table).update(payload).eq('id', row.id)
    setLeaseSaving(false)
    if (error) {
      toast.error("Couldn't save lease cost", error)
      return
    }
    toast.success('Lease cost saved')
    load()
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
        <Link to={returnTo} className="text-sm text-orange-600 hover:underline">← Back to {returnLabel}</Link>
        <p className="text-sm text-gray-500 dark:text-slate-500">{isTrailer ? 'Trailer' : 'Truck'} not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to={returnTo} className="text-xs text-orange-600 hover:underline">← {returnLabel}</Link>
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
            <OperationalStatusPill status={row.operational_status} />
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
          {row.ownership_stage === 'company_leased' && (() => {
            const v = lessorVendors.find(x => x.id === row.lessor_vendor_id)
            return (
              <InfoRow
                label="Lessor (tracked vendor)"
                value={v
                  ? (
                    <Link to="/vendors" className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline" title="Open Vendor Master">
                      <span aria-hidden>✓</span>
                      <span>{v.name}</span>
                    </Link>
                  )
                  : (
                    <span className="text-amber-700 dark:text-amber-400 italic" title="Pick a Lessor in the Lease Cost section below to link this unit to a vendor.">
                      Not linked
                    </span>
                  )}
              />
            )
          })()}
          <InfoRow label="Driver" value={row.driver?.full_name} />
          <InfoRow label="Status" value={OPERATIONAL_STATUS_LABELS[row.operational_status] || row.operational_status || 'Active'} />
          <InfoRow label="TMS Status (imported)" value={row.status} />
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
            {canEdit && (
              <button
                onClick={findByVin}
                title="Search loan_equipment by this unit's VIN and link the best active match"
                className="px-3 py-1.5 text-xs font-medium border border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-500/5 transition-colors"
              >
                Find by VIN
              </button>
            )}
          </div>
        )}
      </Section>

      {/* Section 2b — Lease Cost (lessor + monthly/weekly cost). Only
          shown for company-leased units; this is where the Fleet Cost
          screen's NULL cost values get filled in. Other-cadence number
          derives live as the user types so they can see what the system
          will actually store / display. */}
      {row.ownership_stage === 'company_leased' && (() => {
        const fixed   = Number(rateCard?.fixed_charge) || 0
        const feesTot = (rateCardFees || []).reduce((s, f) => s + (Number(f.amount) || 0), 0)
        const cardTotal = fixed + feesTot
        const cardPeriod = rateCard?.period || 'weekly'
        const overriding = !!leaseDraft.lease_rate_override
        const inheritActive = !overriding && cardTotal > 0
        return (
        <Section title="Lease Cost">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <label className={S.label}>Lessor</label>
              <Select
                value={leaseDraft.lessor_vendor_id || ''}
                onChange={e => setLeaseDraft(d => ({ ...d, lessor_vendor_id: e.target.value }))}
                disabled={!canEdit}
              >
                <option value="">— Select lessor vendor —</option>
                {lessorVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
              {row.equipment_owner_raw && (
                <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
                  From TMS: <span className="font-mono">{row.equipment_owner_raw}</span>
                </p>
              )}
            </div>
            <div>
              <label className={S.label}>Override</label>
              <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-slate-300 cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={overriding}
                  onChange={e => setLeaseDraft(d => ({ ...d, lease_rate_override: e.target.checked }))}
                  disabled={!canEdit}
                  className="mt-0.5 rounded"
                />
                <span>
                  Override vendor rate card
                  <span className="block text-[10px] text-gray-400 dark:text-slate-500 leading-tight mt-0.5">
                    Off — inherit the lessor&apos;s card. On — use the per-unit fields below.
                  </span>
                </span>
              </label>
            </div>
            {inheritActive && (
              <div className="md:col-span-2">
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-500/[0.04] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-1.5">
                    Inherited from {lessorVendors.find(v => v.id === leaseDraft.lessor_vendor_id)?.name || 'vendor'} rate card
                  </p>
                  <div className="text-sm space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-slate-400">Fixed ({cardPeriod})</span>
                      <span className="font-mono text-gray-900 dark:text-slate-200">{fmtMoney(fixed)}</span>
                    </div>
                    {rateCardFees.map(f => (
                      <div key={f.id} className="flex justify-between">
                        <span className="text-gray-600 dark:text-slate-400">{f.label}</span>
                        <span className="font-mono text-gray-900 dark:text-slate-200">{fmtMoney(Number(f.amount))}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-1 mt-1 border-t border-emerald-200/70 dark:border-emerald-500/20">
                      <span className="font-semibold text-gray-700 dark:text-slate-300">Recurring {cardPeriod}</span>
                      <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">{fmtMoney(cardTotal)}</span>
                    </div>
                    {rateCard?.per_mile_rate != null && (
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-500 dark:text-slate-500">Per-mile rate</span>
                        <span className="font-mono text-gray-700 dark:text-slate-300">${Number(rateCard.per_mile_rate).toFixed(4)}/mi</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {!inheritActive && !overriding && leaseDraft.lessor_vendor_id && (
              <div className="md:col-span-2">
                <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/40 dark:bg-amber-500/[0.04] p-3 text-xs text-amber-800 dark:text-amber-300">
                  No rate card set on{' '}
                  <Link to="/vendors" className="font-semibold underline">
                    {lessorVendors.find(v => v.id === leaseDraft.lessor_vendor_id)?.name || 'the vendor'}
                  </Link>
                  {' '}yet. Set the card on the vendor profile, or turn on Override to enter a unit-specific cost.
                </div>
              </div>
            )}
            <div>
              <label className={S.label}>
                Cost period
                <InfoIcon tip={COST_PERIOD_TOOLTIP} />
              </label>
              <Select
                value={leaseDraft.lease_cost_period || 'monthly'}
                onChange={e => setLeaseDraft(d => ({ ...d, lease_cost_period: e.target.value }))}
                disabled={!canEdit || !overriding}
                className={!overriding ? 'opacity-60' : ''}
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </Select>
            </div>
            <div>
              <label className={S.label}>
                Fixed cost ({leaseDraft.lease_cost_period === 'weekly' ? 'per week' : 'per month'})
              </label>
              <input
                type="number" step="0.01" min="0"
                className={`${S.input} ${!overriding ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={leaseDraft.lease_cost}
                placeholder="0.00"
                onChange={e => setLeaseDraft(d => ({ ...d, lease_cost: e.target.value }))}
                disabled={!canEdit || !overriding}
              />
              {overriding && (() => {
                const n = Number(leaseDraft.lease_cost)
                if (!Number.isFinite(n) || n <= 0) return null
                const other = leaseDraft.lease_cost_period === 'weekly'
                  ? { label: 'Monthly equivalent', val: n * 52 / 12 }
                  : { label: 'Weekly equivalent',  val: n * 12 / 52 }
                return (
                  <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">
                    {other.label}: <span className="font-mono font-semibold text-gray-700 dark:text-slate-300">{fmtMoney(other.val)}</span>
                    <InfoIcon tip={COST_PERIOD_TOOLTIP} />
                  </p>
                )
              })()}
            </div>
            <div>
              <label className={S.label}>Per-mile rate (lessor charge)</label>
              <input
                type="number" step="0.0001" min="0"
                className={`${S.input} ${!overriding ? 'opacity-60 cursor-not-allowed' : ''}`}
                value={leaseDraft.lease_cost_per_mile}
                placeholder="0.0000"
                onChange={e => setLeaseDraft(d => ({ ...d, lease_cost_per_mile: e.target.value }))}
                disabled={!canEdit || !overriding}
              />
              <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 leading-tight">
                Vendor side — what the lessor charges MANAS per mile. Dollar total lands once Loads ingest provides mileage.
              </p>
            </div>
            <div className="md:col-span-2 flex items-end justify-end">
              {canEdit && (
                <button onClick={saveLease} disabled={leaseSaving} className={S.btnSave}>
                  {leaseSaving ? 'Saving…' : 'Save lease cost'}
                </button>
              )}
            </div>
          </div>
        </Section>
        )
      })()}

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
                      <td className={`${S.td} whitespace-nowrap text-gray-600 dark:text-slate-400`}>
                        {fmtDate(a.start_date)}
                        {a.source && a.source !== 'tms_upload' && (
                          <span
                            className="ml-2 inline-block px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wide bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400"
                            title={
                              a.source === 'reconciled' ? 'Synthesized during the assignments source-of-truth backfill — start date is approximate.'
                              : a.source === 'manual'   ? 'Created from a manual driver change on the unit edit form.'
                              : a.source === 'trucks_import' || a.source === 'trailers_import'
                                ? 'Created from the trucks/trailers Excel import when the unit named a driver but had no open assignment.'
                                : `Source: ${a.source}`
                            }
                          >
                            {a.source.replace(/_/g, ' ')}
                          </span>
                        )}
                      </td>
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
        // If the user arrived here from a filtered table (Equipment
        // Cost with a returnTo in router state), drop them back on
        // that table after save — the brief's "Save → lands back on
        // /fleet/cost with the filter still applied" flow. When the
        // user entered directly via the Trucks/Trailers list, keep
        // today's behavior of closing the modal and staying on the
        // detail page so they can verify the change in place.
        onSaved={() => {
          setShowEdit(false)
          if (location.state?.returnTo) navigate(location.state.returnTo)
          else load()
        }}
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
