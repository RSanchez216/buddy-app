import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import StatusPill from './components/StatusPill'
import UnderlyingLoanCard from './components/UnderlyingLoanCard'
import DocumentsSection from './components/DocumentsSection'
import EventsLog from './components/EventsLog'
import EditDriverModal from './components/EditDriverModal'
import PurchaseFormModal from './components/PurchaseFormModal'
import DeletePurchaseModal from './components/DeletePurchaseModal'
import { logEvent } from './utils/events'
import { fmtDate, fmtMoney, fmtFreq, purchaseTypeLabel } from './utils/format'

export default function DriverPurchaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [summary, setSummary] = useState(null)        // v_driver_purchase_summary row
  const [purchase, setPurchase] = useState(null)      // raw driver_purchases row (for edit form)
  const [driver, setDriver] = useState(null)
  const [coDrivers, setCoDrivers] = useState([])
  const [equipment, setEquipment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [eventsKey, setEventsKey] = useState(0)        // bump to force EventsLog refresh

  const [showEditPurchase, setShowEditPurchase] = useState(false)
  const [showEditDriver,   setShowEditDriver]   = useState(false)
  const [showDelete,       setShowDelete]       = useState(false)

  const [savingNotes, setSavingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [sumRes, pRes] = await Promise.all([
      supabase.from('v_driver_purchase_summary').select('*').eq('id', id).maybeSingle(),
      supabase.from('driver_purchases').select('*').eq('id', id).maybeSingle(),
    ])
    if (!sumRes.data || !pRes.data) { setLoading(false); return }

    const purchaseRow = pRes.data
    const driverPromise = supabase.from('drivers').select('*').eq('id', purchaseRow.driver_id).maybeSingle()
    const equipPromise = purchaseRow.equipment_id
      ? supabase.from('loan_equipment')
          .select('id, unit_number, vin, year, make, model, equipment_type, loan_id')
          .eq('id', purchaseRow.equipment_id).maybeSingle()
      : Promise.resolve({ data: null })
    const coPromise = (purchaseRow.co_driver_ids?.length)
      ? supabase.from('drivers').select('id, full_name, internal_id').in('id', purchaseRow.co_driver_ids)
      : Promise.resolve({ data: [] })

    const [drvRes, eqRes, coRes] = await Promise.all([driverPromise, equipPromise, coPromise])

    setSummary(sumRes.data)
    setPurchase(purchaseRow)
    setDriver(drvRes.data || null)
    setEquipment(eqRes.data || null)
    setCoDrivers(coRes.data || [])
    setNotesDraft(purchaseRow.notes || '')
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function saveNotes() {
    if (!canEdit || !purchase) return
    if ((notesDraft || '') === (purchase.notes || '')) return
    setSavingNotes(true)
    const before = purchase.notes || ''
    const { error } = await supabase
      .from('driver_purchases')
      .update({ notes: notesDraft.trim() || null, updated_by: user?.id || null })
      .eq('id', id)
    setSavingNotes(false)
    if (error) { alert('Save failed: ' + error.message); return }
    await logEvent(id, 'updated', 'Updated notes',
      { fields: { notes: { old: before, new: notesDraft } } }, user?.id)
    setEventsKey(k => k + 1)
    load()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }
  if (!summary) {
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-gray-500 dark:text-slate-400">Driver purchase not found.</p>
        <Link to="/financial-controls/driver-purchases" className="text-orange-600 dark:text-orange-400 text-sm">← Back to Driver Purchases</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <button
            onClick={() => navigate('/financial-controls/driver-purchases')}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-slate-500 hover:text-orange-600 dark:hover:text-orange-400 mb-2 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Financial Controls / Driver Purchases / {summary.driver_name}
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.driver_name}
              {summary.truck_number && <> — Truck {summary.truck_number}</>}
            </h1>
            <StatusPill name={summary.status_name} colorHex={summary.status_color} />
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">
            {summary.entity_name || 'No entity'} · {purchaseTypeLabel(summary.purchase_type)}
            {summary.driver_internal_id && <span className="ml-2 font-mono text-xs">#{summary.driver_internal_id}</span>}
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowEditPurchase(true)} className={S.btnSecondary}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Two-column body: main content (left) + sticky activity feed (right).
          Collapses to single column below lg (1024px). */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        {/* ── Left column ─────────────────────────────────────────────── */}
        <div className="space-y-5 min-w-0">
          {/* Cross-reference card (conditional) */}
          <UnderlyingLoanCard summary={summary} />

          {/* Driver info card */}
          <div className={`${S.card} p-5 space-y-3`}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Driver</h3>
              {canEdit && (
                <button
                  onClick={() => setShowEditDriver(true)}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                  Edit driver
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Fact label="Name" value={driver?.full_name} mono={false} />
              <Fact label="Internal ID" value={driver?.internal_id} mono />
              <Fact label="Phone" value={driver?.phone} mono />
              <Fact label="Email" value={driver?.email} mono={false} />
            </div>
            {driver?.notes && (
              <div className="text-xs text-gray-600 dark:text-slate-400 pt-2 border-t border-gray-100 dark:border-white/5">
                <span className="font-semibold">Notes:</span> {driver.notes}
              </div>
            )}
            {coDrivers.length > 0 && (
              <div className="pt-3 border-t border-gray-100 dark:border-white/5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">Co-drivers</p>
                <ul className="space-y-1 text-sm">
                  {coDrivers.map(co => (
                    <li key={co.id} className="flex items-baseline gap-2">
                      <span className="text-gray-900 dark:text-slate-200">{co.full_name}</span>
                      {co.internal_id && <span className="text-xs text-gray-400 dark:text-slate-500 font-mono">#{co.internal_id}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Contract terms */}
          <div className={`${S.card} p-5 space-y-4`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Contract terms</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Fact label="Entity" value={summary.entity_name} />
              <Fact label="Total value" value={fmtMoney(summary.total_value)} mono />
              <Fact label="Truck number" value={summary.truck_number} mono />
              <Fact label="Downpayment" value={fmtMoney(summary.downpayment)} mono />
              <Fact label="VIN" value={summary.vin} mono />
              <Fact label="Sale price" value={fmtMoney(summary.sale_price)} mono />
              <Fact label="Equipment type" value={summary.equipment_type} />
              <Fact label="Current balance" value={fmtMoney(summary.current_balance)} mono />
              <Fact
                label="Linked equipment"
                value={equipment ? (
                  <Link
                    to={`/financial-controls/debt-schedule/${equipment.loan_id}`}
                    className="text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    {[equipment.year, equipment.make, equipment.model].filter(Boolean).join(' ') || equipment.equipment_type || equipment.unit_number || 'View loan'}
                  </Link>
                ) : null}
              />
              <Fact
                label="Payment"
                value={summary.payment_amount ? `${fmtMoney(summary.payment_amount)} ${fmtFreq(summary.payment_frequency)}` : null}
                mono
              />
              <Fact label="Purchase type" value={purchaseTypeLabel(summary.purchase_type)} />
              <Fact label="Purchase date" value={fmtDateOrDash(summary.purchase_date)} />
              <Fact label="Title transferred" value={<YesNo on={summary.title_transferred} />} />
              <Fact label="Contract signed" value={fmtDateOrDash(summary.contract_signed_date)} />
              <Fact label="Fully paid date" value={fmtDateOrDash(summary.fully_paid_date)} />
            </div>
          </div>

          {/* Notes — moved up so it sits with the contract context */}
          <div className={`${S.card} p-5 space-y-3`}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notes</h3>
              {canEdit && (notesDraft || '') !== (purchase?.notes || '') && (
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline disabled:opacity-60"
                >
                  {savingNotes ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            <textarea
              className={S.textarea}
              rows={4}
              value={notesDraft}
              disabled={!canEdit}
              onChange={e => setNotesDraft(e.target.value)}
              onBlur={saveNotes}
              placeholder="Add a note about this contract…"
            />
          </div>

          {/* Payment history placeholder */}
          <div className={`${S.card} p-5 space-y-3`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Payment history</h3>
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/10 px-4 py-8 text-center">
              <p className="text-sm text-gray-500 dark:text-slate-400">
                Payment recording ships in Phase 3.
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                The reconciliation grid will let you record actual deductions against expected amounts.
              </p>
            </div>
          </div>

          {/* Contract documents — driver_documents subsection removed; the
              schema/table stays so we can re-surface it later if needed. */}
          <DocumentsSection
            kind="contract"
            ownerId={id}
            purchaseId={id}
            canEdit={canEdit}
            title="Contract documents"
          />
        </div>

        {/* ── Right column: sticky activity feed ──────────────────────── */}
        <aside className="lg:sticky lg:top-2 lg:self-start lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
          <EventsLog purchaseId={id} refreshKey={eventsKey} />
        </aside>
      </div>

      {/* Modals */}
      <PurchaseFormModal
        open={showEditPurchase}
        onClose={() => setShowEditPurchase(false)}
        purchase={purchase}
        onSaved={() => { setShowEditPurchase(false); setEventsKey(k => k + 1); load() }}
      />
      <EditDriverModal
        open={showEditDriver}
        onClose={() => setShowEditDriver(false)}
        driver={driver}
        purchaseId={id}
        onSaved={() => { setShowEditDriver(false); setEventsKey(k => k + 1); load() }}
      />
      <DeletePurchaseModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        purchase={purchase}
        onDeleted={() => { setShowDelete(false); navigate('/financial-controls/driver-purchases') }}
      />
    </div>
  )
}

function Fact({ label, value, mono = false }) {
  const display = value === null || value === undefined || value === '' ? '—' : value
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-gray-50 dark:border-white/[0.03]">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} text-sm text-gray-700 dark:text-slate-300 text-right`}>
        {display}
      </span>
    </div>
  )
}

function YesNo({ on }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      on
        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
        : 'bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30'
    }`}>
      {on ? 'Yes' : 'No'}
    </span>
  )
}

function fmtDateOrDash(d) { return d ? fmtDate(d) : null }
