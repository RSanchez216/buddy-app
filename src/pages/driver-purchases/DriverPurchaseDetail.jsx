import { useCallback, useEffect, useState } from 'react'
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

export default function DriverPurchaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusCommentId = searchParams.get('comment') || null
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
  const [titleToast, setTitleToast] = useState(null)

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
      setTitleToast({ kind: 'error', text: 'Could not mark title transferred: ' + error.message })
      setTimeout(() => setTitleToast(null), 4000)
      return
    }

    const userName = profile?.full_name || profile?.email || 'a user'
    await logEvent(id, 'title_released', `Title marked as transferred by ${userName}`, {}, user?.id)
    setMarkingTitle(false)
    setTitleToast({ kind: 'success', text: 'Title marked as transferred' })
    setTimeout(() => setTitleToast(null), 3000)
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
              <Fact label="Fully paid date" value={fmtDateOrDash(summary.fully_paid_date)} />
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

      {/* Title-transfer toast */}
      {titleToast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-[110] max-w-sm bg-white dark:bg-[#0d0d1f] border rounded-2xl shadow-2xl px-4 py-3 flex items-start gap-3"
          style={{
            borderColor: titleToast.kind === 'success' ? 'rgb(110 231 183 / 0.4)' : 'rgb(252 165 165 / 0.6)',
          }}
        >
          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${titleToast.kind === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <div className="flex-1 text-sm text-gray-700 dark:text-slate-300">{titleToast.text}</div>
          <button onClick={() => setTitleToast(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0">
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
