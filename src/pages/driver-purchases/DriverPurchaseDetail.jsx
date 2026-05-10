import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import StatusPill from './components/StatusPill'
import UnderlyingLoanCard from './components/UnderlyingLoanCard'
import DocumentsSection from './components/DocumentsSection'
import ActivityFeed from './components/ActivityFeed'
import PaymentHistorySection from './components/PaymentHistorySection'
import NotesField from '../../components/NotesField'
import EditDriverModal from './components/EditDriverModal'
import PurchaseFormModal from './components/PurchaseFormModal'
import DeletePurchaseModal from './components/DeletePurchaseModal'
import { logEvent } from './utils/events'
import { fmtDate, fmtMoney, fmtFreq, purchaseTypeLabel } from './utils/format'

// Derive the unit-label noun from equipment_type. Falls back to neutral
// "Unit" when type is null/empty/anything other than truck or trailer
// (covers ClickUp imports that never had equipment_type filled in, and
// any future "other" rows). Returns null if there's no number to label,
// so the H1 can omit the dash entirely.
function formatUnitLabel(equipmentType, unitNumber) {
  if (!unitNumber) return null
  const t = (equipmentType || '').toLowerCase()
  const noun = t === 'truck' ? 'Truck'
             : t === 'trailer' ? 'Trailer'
             : 'Unit'
  return `${noun} ${unitNumber}`
}

export default function DriverPurchaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusCommentId = searchParams.get('comment') || null
  // ?record=1 from the list page's overflow menu opens the Record
  // Payment modal as soon as the contract loads. Single-shot trigger:
  // bumped once on mount via setRecordPaymentSignal below.
  const openRecordOnMount = searchParams.get('record') === '1'
  const { user, profile } = useAuth()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [summary, setSummary] = useState(null)        // v_driver_purchase_summary row
  const [purchase, setPurchase] = useState(null)      // raw driver_purchases row (for edit form)
  const [driver, setDriver] = useState(null)
  const [equipment, setEquipment] = useState(null)
  const [loading, setLoading] = useState(true)
  // ActivityFeed has its own Realtime subscription, so we don't need a
  // refresh-key bump on save. Modals just trigger load() to re-pull the
  // top-level summary/purchase rows.

  const [showEditPurchase, setShowEditPurchase] = useState(false)
  const [showEditDriver,   setShowEditDriver]   = useState(false)
  const [showDelete,       setShowDelete]       = useState(false)

  const [savingNotes, setSavingNotes] = useState(false)
  const [markingTitle, setMarkingTitle] = useState(false)
  // Shared toast for header-level actions (title transfer + quick status
  // change). { kind: 'success'|'error', text: string }.
  const [toast, setToast] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [savingStatus, setSavingStatus] = useState(false)
  // Bumped by the header "+ Record payment" button. PaymentHistorySection
  // watches this counter and opens its existing RecordPaymentModal in
  // new-payment mode on each tick. Avoids lifting the modal up here.
  const [recordPaymentSignal, setRecordPaymentSignal] = useState(0)

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

    const [drvRes, eqRes] = await Promise.all([driverPromise, equipPromise])

    setSummary(sumRes.data)
    setPurchase(purchaseRow)
    setDriver(drvRes.data || null)
    setEquipment(eqRes.data || null)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // ?record=1 → fire the Record Payment modal once the contract data
  // is loaded. Gated on `summary` so we don't try to open against an
  // empty state. Bumped exactly once via the firedRef latch (refresh
  // on the detail page with the same URL shouldn't re-open).
  const recordOnMountFired = useRef(false)
  useEffect(() => {
    if (!openRecordOnMount || !summary || recordOnMountFired.current) return
    recordOnMountFired.current = true
    setRecordPaymentSignal(s => s + 1)
  }, [openRecordOnMount, summary])

  // Status list rarely changes; fetch once on mount and keep around for
  // the header dropdown. Ordered by sort_order so the natural workflow
  // progression (waiting → paying → terminal) reads top-to-bottom.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('driver_purchase_statuses')
      .select('id, name, color_hex, sort_order, is_active_state, is_terminal')
      .order('sort_order', { ascending: true })
      .then(({ data }) => { if (!cancelled) setStatuses(data || []) })
    return () => { cancelled = true }
  }, [])

  // Receives the trimmed next value from NotesField (or null if cleared).
  // Equality check happens inside NotesField, so anything we get here is a
  // real change.
  async function saveNotes(next) {
    if (!canEdit || !purchase) return
    setSavingNotes(true)
    const before = purchase.notes || ''
    const { error } = await supabase
      .from('driver_purchases')
      .update({ notes: next, updated_by: user?.id || null })
      .eq('id', id)
    setSavingNotes(false)
    if (error) { alert('Save failed: ' + error.message); return }
    await logEvent(id, 'updated', 'Updated notes',
      { fields: { notes: { old: before, new: next || '' } } }, user?.id)
    load()
  }

  // Mark title as transferred — optimistic flip + persist + log event.
  // On error: revert local state, surface a toast, do NOT log the event.
  async function markTitleTransferred() {
    if (!canEdit || !purchase || markingTitle) return
    if (purchase.title_transferred) return
    setMarkingTitle(true)
    // Optimistic: keep showing the new state while the request is in
    // flight. summary is the source of truth for read; we just patch
    // the local copy so the UI re-renders immediately.
    setSummary(s => s ? { ...s, title_transferred: true, title_release_pending: false } : s)
    setPurchase(p => p ? { ...p, title_transferred: true } : p)

    const { error } = await supabase
      .from('driver_purchases')
      .update({ title_transferred: true, updated_by: user?.id || null })
      .eq('id', id)

    if (error) {
      // Revert
      setSummary(s => s ? { ...s, title_transferred: false, title_release_pending: true } : s)
      setPurchase(p => p ? { ...p, title_transferred: false } : p)
      setMarkingTitle(false)
      setToast({ kind: 'error', text: 'Could not mark title transferred: ' + error.message })
      setTimeout(() => setToast(null), 4000)
      return
    }

    const userName = profile?.full_name || profile?.email || 'a user'
    await logEvent(id, 'title_released', `Title marked as transferred by ${userName}`, {}, user?.id)
    setMarkingTitle(false)
    setToast({ kind: 'success', text: 'Title marked as transferred' })
    setTimeout(() => setToast(null), 3000)
    load()
  }

  // Header-level "Change to: …" dropdown handler. Mirrors the loan-side
  // quickStatusChange flow + the canonical edit-modal status_changed event
  // shape from PurchaseFormModal: description "Status changed from X to Y"
  // with metadata { old, new }.
  async function quickStatusChange(newStatusId) {
    if (!canEdit || !summary || savingStatus) return
    if (newStatusId === summary.status_id) return
    const newStatus = statuses.find(s => s.id === newStatusId)
    if (!newStatus) return
    const oldStatusId = summary.status_id
    const oldName = summary.status_name
    const oldColor = summary.status_color
    const oldActive = summary.is_active_state
    const oldTerminal = summary.is_terminal

    setSavingStatus(true)
    // Auto-set fully_paid_date when flipping to Fully Paid for the
    // first time — common workflow shortcut. Existing values are
    // preserved (re-flipping later doesn't overwrite the original
    // payoff date).
    const today = new Date().toISOString().slice(0, 10)
    const autoSetPaidDate = newStatus.name === 'Fully Paid' && !summary.fully_paid_date
    setSummary(s => s ? {
      ...s,
      status_id: newStatus.id,
      status_name: newStatus.name,
      status_color: newStatus.color_hex,
      is_active_state: newStatus.is_active_state,
      is_terminal: newStatus.is_terminal,
      ...(autoSetPaidDate ? { fully_paid_date: today } : {}),
    } : s)

    const updatePayload = {
      status_id: newStatus.id,
      updated_by: user?.id || null,
      ...(autoSetPaidDate ? { fully_paid_date: today } : {}),
    }
    const { error } = await supabase
      .from('driver_purchases')
      .update(updatePayload)
      .eq('id', id)

    if (error) {
      setSummary(s => s ? {
        ...s,
        status_id: oldStatusId,
        status_name: oldName,
        status_color: oldColor,
        is_active_state: oldActive,
        is_terminal: oldTerminal,
      } : s)
      setSavingStatus(false)
      setToast({ kind: 'error', text: 'Could not change status: ' + error.message })
      setTimeout(() => setToast(null), 4000)
      return
    }

    await logEvent(id, 'status_changed', `Status changed from ${oldName} to ${newStatus.name}`,
      { old: oldName, new: newStatus.name }, user?.id)
    setSavingStatus(false)
    setToast({ kind: 'success', text: `Status changed to ${newStatus.name}` })
    setTimeout(() => setToast(null), 3000)
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
            onClick={() => {
              // navigate(-1) preserves the list's URL query state
              // (filter + search + sort) — clicking the contract was
              // a push, so the previous history entry IS the filtered
              // list. Falls back to the absolute path on the edge case
              // of arriving via a deep link with no in-app referrer.
              if (window.history.length > 1) navigate(-1)
              else navigate('/financial-controls/driver-purchases')
            }}
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
              {formatUnitLabel(summary.equipment_type, summary.truck_number) && (
                <> — {formatUnitLabel(summary.equipment_type, summary.truck_number)}</>
              )}
            </h1>
            <StatusPill name={summary.status_name} colorHex={summary.status_color} />
            {canEdit && statuses.length > 0 && (
              <QuickStatusDropdown
                statuses={statuses}
                currentStatusId={summary.status_id}
                disabled={savingStatus}
                onChange={quickStatusChange}
              />
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">
            {summary.entity_name || 'No entity'} · {purchaseTypeLabel(summary.purchase_type)}
            {summary.driver_internal_id && <span className="ml-2 font-mono text-xs">#{summary.driver_internal_id}</span>}
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRecordPaymentSignal(s => s + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Record payment
            </button>
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
      {/* Bumped right column min to 320px (per spec) and align-items: start
          so the right column ends at its content. Otherwise CSS Grid's
          default `stretch` alignment makes the activity column match the
          left column's height — that's the empty-white-box problem. */}
      <div className="grid gap-6 items-start lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
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
          </div>

          {/* Contract terms */}
          <div className={`${S.card} p-5 space-y-4`}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Contract terms</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Fact label="Entity" value={summary.entity_name} />
              <Fact label="Sale price" value={fmtMoney(summary.sale_price)} mono />
              <Fact label="Unit number" value={summary.truck_number} mono />
              <Fact label="Downpayment" value={fmtMoney(summary.downpayment)} mono />
              <Fact label="VIN" value={summary.vin} mono />
              <Fact label="Current balance" value={fmtMoney(summary.current_balance)} mono />
              <Fact label="Equipment type" value={summary.equipment_type} />
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
              <Fact
                label="Title transferred"
                value={
                  <span className="flex items-center gap-2 flex-wrap justify-end">
                    <YesNo on={summary.title_transferred} />
                    {canEdit && summary.status_name === 'Fully Paid' && !summary.title_transferred && (
                      <button
                        onClick={markTitleTransferred}
                        disabled={markingTitle}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 text-[11px] font-medium hover:bg-amber-100 dark:hover:bg-amber-500/15 disabled:opacity-60 transition-colors whitespace-nowrap"
                        title="Mark physical title as handed over to the driver"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="7.5" cy="15.5" r="5.5" />
                          <path d="m21 2-9.6 9.6" />
                          <path d="m15.5 7.5 3 3L22 7l-3-3" />
                        </svg>
                        {markingTitle ? 'Saving…' : 'Mark transferred'}
                      </button>
                    )}
                  </span>
                }
              />
              <Fact label="Contract signed" value={fmtDateOrDash(summary.contract_signed_date)} />
              <PayoffDateFact summary={summary} />
            </div>
          </div>

          {/* Notes — read mode renders as plain pre-wrap text inside the
              card (no scrollbar, height grows with content); click to
              edit switches to an auto-sized textarea that also grows
              with input. */}
          <div className={`${S.card} p-5 space-y-3`}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notes</h3>
              {savingNotes && (
                <span className="text-xs text-gray-400 dark:text-slate-500">Saving…</span>
              )}
            </div>
            <NotesField
              value={purchase?.notes || ''}
              onSave={saveNotes}
              canEdit={canEdit}
              saving={savingNotes}
              placeholder="Add a note about this contract…"
            />
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

        {/* ── Right column: activity feed.
            Column itself flows with page height — only the composer
            inside the feed is sticky (top:3.5rem, just below the
            12-tall global header). Lets the right column visually
            match the left column's height instead of stretching as
            one tall empty box. */}
        <aside className="min-w-0">
          <ActivityFeed purchaseId={id} focusCommentId={focusCommentId} />
        </aside>
      </div>

      {/* Payment history — full-width, breaks out below the 2-col grid.
          Phase 3A: real reconciliation table. */}
      <PaymentHistorySection
        purchase={purchase}
        canEdit={canEdit}
        onChange={load}
        openSignal={recordPaymentSignal}
      />

      {/* Modals */}
      <PurchaseFormModal
        open={showEditPurchase}
        onClose={() => setShowEditPurchase(false)}
        purchase={purchase}
        onSaved={() => { setShowEditPurchase(false); load() }}
      />
      <EditDriverModal
        open={showEditDriver}
        onClose={() => setShowEditDriver(false)}
        driver={driver}
        purchaseId={id}
        onSaved={() => { setShowEditDriver(false); load() }}
      />
      <DeletePurchaseModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        purchase={purchase}
        onDeleted={() => { setShowDelete(false); navigate('/financial-controls/driver-purchases') }}
      />

      {/* Header-level toast — used by title-transfer + quick status change */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
          style={{
            borderColor: toast.kind === 'success' ? 'rgb(110 231 183 / 0.4)' : 'rgb(252 165 165 / 0.6)',
          }}
        >
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${toast.kind === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">{toast.text}</div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
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

// Smart payoff-date row in the contract terms grid:
//   • Fully Paid status     → "Fully paid date" + stored fully_paid_date
//   • non-terminal active   → "Projected fully paid date" + view-computed
//   • terminal not-Fully-Paid (Contract Broken / Driver Left / Owner Left)
//                           → entire row hidden (no payoff expected)
//   • active but no projection possible (payment_amount missing)
//                           → "Projected fully paid date" + "—" + hint
function PayoffDateFact({ summary }) {
  const fullyPaid = summary.status_name === 'Fully Paid'
  // Non-Fully-Paid terminal statuses skip the row entirely. is_terminal
  // is exposed by the status lookup join.
  if (!fullyPaid && summary.is_terminal) return null

  if (fullyPaid) {
    return <Fact label="Fully paid date" value={fmtDateOrDash(summary.fully_paid_date)} />
  }

  const projected = summary.projected_fully_paid_date
  return (
    <div className="flex flex-col py-1 border-b border-gray-50 dark:border-white/[0.03]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-slate-400">Projected fully paid date</span>
        <span className="text-sm text-gray-700 dark:text-slate-300 text-right">
          {projected ? fmtDate(projected) : '—'}
        </span>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5 self-end">
        {projected
          ? 'Updates automatically based on balance and payment cadence.'
          : 'Set a payment amount to see the projection.'}
      </p>
    </div>
  )
}

// Header-level "Change to: …" dropdown. Mirrors the loan-side detail
// page's quick-status select, but uses a custom popover so each option
// can lead with a colored dot in status.color_hex (native <option>
// elements can't render rich content reliably). Inserts a divider
// between non-terminal and terminal statuses so end-states feel like
// a separate group without adding a confirm step.
function QuickStatusDropdown({ statuses, currentStatusId, disabled, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = statuses.find(s => s.id === currentStatusId)
  const firstTerminalIdx = statuses.findIndex(s => s.is_terminal)

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Change to: {current?.name || '…'}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute z-30 mt-1 left-0 min-w-[14rem] bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl py-1 overflow-hidden"
        >
          {statuses.map((s, i) => {
            const isCurrent = s.id === currentStatusId
            const showDivider = i === firstTerminalIdx && i > 0
            return (
              <div key={s.id}>
                {showDivider && <div className="my-1 border-t border-gray-100 dark:border-white/5" />}
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => { setOpen(false); if (!isCurrent) onChange(s.id) }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                    isCurrent
                      ? 'bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-slate-500 cursor-default'
                      : 'text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: s.color_hex || '#9ca3af' }}
                  />
                  <span className="flex-1">Change to: {s.name}</span>
                  {isCurrent && (
                    <span className="text-[10px] text-gray-400 dark:text-slate-500">current</span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
