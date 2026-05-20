import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { S } from '../../lib/styles'
import {
  FC, STATUS_LABELS, LOAN_STATUSES, loanStatusPill,
  fmtDate,
} from './loanUtils'
import OverviewTab from './tabs/OverviewTab'
import EquipmentTab from './tabs/EquipmentTab'
import PaymentScheduleTab from './tabs/PaymentScheduleTab'
import DocumentsTab from './tabs/DocumentsTab'
import EventsTab from './tabs/EventsTab'
import NotesTab from './tabs/NotesTab'
import MergeLoanModal from './components/MergeLoanModal'
import Modal from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'payments', label: 'Payment Schedule' },
  { id: 'documents', label: 'Documents' },
  { id: 'events', label: 'Events' },
  { id: 'notes', label: 'Notes' },
]

// Tab badge — small pill next to tab labels
function TabBadge({ count, tone = 'gray' }) {
  if (count == null || count <= 0) return null
  const tones = {
    gray: 'bg-gray-100 dark:bg-slate-700/50 text-gray-600 dark:text-slate-400',
    red:  'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
  }
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded-full ml-1.5 ${tones[tone]}`}>
      {count}
    </span>
  )
}

function NotesDot() {
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 ml-1.5 align-middle" />
}

export default function LoanDetail() {
  const { loanId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // The Debt Schedule row link passes the originating URL via
  // location.state so back-navigation restores the exact filtered view
  // (and scroll, via the sessionStorage key on the other side). Falls
  // back to a plain /debt-schedule push when state.from is absent —
  // happens on hard refresh of this page or when someone deep-links in.
  const handleBack = () => {
    const from = location.state?.from
    if (typeof from === 'string' && from.startsWith('/')) {
      navigate(from)
    } else {
      navigate('/financial-controls/debt-schedule')
    }
  }
  const { profile, user } = useAuth()
  const toast = useToast()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const [loan, setLoan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [statusSaving, setStatusSaving] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  const [showBulkTitle, setShowBulkTitle] = useState(false)
  const [bulkTitleSaving, setBulkTitleSaving] = useState(false)

  // Tab badge counts — fetched once per loan load
  const [counts, setCounts] = useState({
    equipment: 0,
    paymentsPastDue: 0,
    documents: 0,
    events: 0,
    hasNotes: false,
  })

  useEffect(() => { loadLoan() /* eslint-disable-line */ }, [loanId])

  async function loadLoan() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const { data: loanData, error } = await supabase
      .from('v_loans_summary')
      .select('*')
      .eq('id', loanId)
      .maybeSingle()

    if (error || !loanData) { setLoading(false); return }

    // Fetch all badge counts in parallel
    const [eqRes, pastDueRes, docsRes, evRes] = await Promise.all([
      supabase.from('loan_equipment').select('id', { count: 'exact', head: true }).eq('loan_id', loanId),
      supabase.from('loan_payments').select('id', { count: 'exact', head: true })
        .eq('loan_id', loanId).in('status', ['pending', 'partial']).lt('due_date', today),
      supabase.from('loan_documents').select('id', { count: 'exact', head: true }).eq('loan_id', loanId),
      supabase.from('loan_events').select('id', { count: 'exact', head: true }).eq('loan_id', loanId),
    ])

    setLoan(loanData)
    setCounts({
      equipment: eqRes.count || 0,
      paymentsPastDue: pastDueRes.count || 0,
      documents: docsRes.count || 0,
      events: evRes.count || 0,
      hasNotes: !!(loanData.description?.trim()) || !!loanData.cfo_flag,
    })
    setLoading(false)
  }

  async function quickStatusChange(newStatus) {
    if (!canEdit || newStatus === loan.status) return
    setStatusSaving(true)
    const { error } = await supabase.from('loans').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', loanId)
    setStatusSaving(false)
    if (error) { toast.error("Couldn't change loan status", error); return }
    toast.success(`Loan status — ${STATUS_LABELS[newStatus] || newStatus}`)
    await loadLoan()
  }

  // Bulk-flip every loan_equipment row from has_title=false to true,
  // then write ONE consolidated 'titles_received_bulk' event so the
  // EventsTab doesn't get spammed with N near-duplicate rows.
  async function markAllTitlesReceived() {
    if (!canEdit || bulkTitleSaving) return
    setBulkTitleSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    const { data: pending, error: pendErr } = await supabase
      .from('loan_equipment')
      .select('id, unit_number, vin')
      .eq('loan_id', loanId)
      .eq('has_title', false)
    if (pendErr) { setBulkTitleSaving(false); toast.error("Couldn't read equipment", pendErr); return }
    const ids = (pending || []).map(r => r.id)
    if (ids.length === 0) { setBulkTitleSaving(false); setShowBulkTitle(false); return }
    const { error: updErr } = await supabase
      .from('loan_equipment')
      .update({ has_title: true, updated_at: new Date().toISOString() })
      .in('id', ids)
    if (updErr) { setBulkTitleSaving(false); toast.error("Couldn't mark titles received", updErr); return }
    const summary = (pending || [])
      .map(r => r.unit_number || r.vin || 'equipment')
      .join(', ')
    await supabase.from('loan_events').insert({
      loan_id: loanId,
      event_date: today,
      event_type: 'titles_received_bulk',
      description: `All titles received (${ids.length} item${ids.length === 1 ? '' : 's'}): ${summary}`,
      created_by: user?.id || null,
    })
    setBulkTitleSaving(false)
    setShowBulkTitle(false)
    toast.success(`Titles received — ${ids.length} item${ids.length === 1 ? '' : 's'}`)
    await loadLoan()
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
  }
  if (!loan) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-slate-400">Loan not found.</p>
        <Link to="/financial-controls/debt-schedule" className="text-orange-600 dark:text-orange-400 text-sm mt-2 inline-block">Back to Debt Schedule</Link>
      </div>
    )
  }

  function renderBadge(tabId) {
    switch (tabId) {
      case 'equipment': return <TabBadge count={counts.equipment} tone="gray" />
      case 'payments':  return counts.paymentsPastDue > 0 ? <TabBadge count={counts.paymentsPastDue} tone="red" /> : null
      case 'documents': return <TabBadge count={counts.documents} tone="gray" />
      case 'events':    return <TabBadge count={counts.events} tone="gray" />
      case 'notes':     return counts.hasNotes ? <NotesDot /> : null
      default:          return null
    }
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb + status */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <button onClick={handleBack}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-slate-500 hover:text-orange-600 dark:hover:text-orange-400 mb-2 transition-colors">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Debt Schedule
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{loan.loan_id_external || 'Loan'}</h1>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${loanStatusPill(loan.status)}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
              {STATUS_LABELS[loan.status] || loan.status}
            </span>
            {canEdit && (
              <select
                value={loan.status}
                disabled={statusSaving}
                onChange={e => quickStatusChange(e.target.value)}
                className="text-xs px-2 py-1 rounded-lg bg-white dark:bg-slate-800/80 border border-gray-300 dark:border-slate-700/40 text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
              >
                {LOAN_STATUSES.map(s => <option key={s} value={s}>Change to: {STATUS_LABELS[s]}</option>)}
              </select>
            )}
            {canEdit && (
              <button
                onClick={() => setShowMerge(true)}
                title="Merge this loan with a duplicate"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-slate-700/40 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7l4-4m0 0l4 4m-4-4v18m0 0l-4-4m4 4l4-4" transform="rotate(90 12 12)" />
                </svg>
                Merge…
              </button>
            )}
            {canEdit && loan.title_release_pending && (
              <button
                onClick={() => setShowBulkTitle(true)}
                title="All titles for this loan have been physically received from the lender"
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7.5" cy="15.5" r="5.5" />
                  <path d="m21 2-9.6 9.6" />
                  <path d="m15.5 7.5 3 3L22 7l-3-3" />
                </svg>
                Mark all titles received
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">
            {loan.entity_name || '—'} · {loan.lender_name || '—'}
            {loan.contract_number && <span className="ml-2 font-mono text-xs">#{loan.contract_number}</span>}
          </p>
        </div>
        <div className="text-right text-xs text-gray-400 dark:text-slate-500">
          <div>Maturity: {fmtDate(loan.maturity_date)}</div>
          <div>Next Due: {fmtDate(loan.next_due_date)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-white/5">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap inline-flex items-center ${
                activeTab === t.id
                  ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                  : 'border-transparent text-gray-500 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300'
              }`}>
              {t.label}
              {renderBadge(t.id)}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab loan={loan} canEdit={canEdit} onChange={loadLoan} />}
        {activeTab === 'equipment' && <EquipmentTab loanId={loanId} canEdit={canEdit} onChange={loadLoan} />}
        {activeTab === 'payments' && <PaymentScheduleTab loanId={loanId} loan={loan} canEdit={canEdit} onChange={loadLoan} />}
        {activeTab === 'documents' && <DocumentsTab loanId={loanId} canEdit={canEdit} userRole={profile?.role} onChange={loadLoan} />}
        {activeTab === 'events' && <EventsTab loanId={loanId} canEdit={canEdit} onChange={loadLoan} />}
        {activeTab === 'notes' && <NotesTab loan={loan} canEdit={canEdit} onChange={loadLoan} />}
      </div>

      <MergeLoanModal
        open={showMerge}
        onClose={() => setShowMerge(false)}
        loan={loan}
        onMerged={(survivorId) => {
          setShowMerge(false)
          // If the current loan was the absorbed one, jump to the survivor.
          // Otherwise just refresh in place.
          if (survivorId && survivorId !== loanId) navigate(`/financial-controls/debt-schedule/${survivorId}`)
          else loadLoan()
        }}
      />

      <Modal open={showBulkTitle} onClose={() => !bulkTitleSaving && setShowBulkTitle(false)} title="Mark all titles received" size="sm">
        <div className={S.modalBody}>
          <p className="text-sm text-gray-700 dark:text-slate-300">
            This will mark <span className="font-semibold">{loan.title_pending_count}</span> pending {loan.title_pending_count === 1 ? 'title' : 'titles'} as received from the lender for this loan.
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-500">
            A single audit event will be logged. You can still flip individual titles back via Edit Equipment if needed.
          </p>
          <div className={S.modalFooter}>
            <button onClick={() => setShowBulkTitle(false)} disabled={bulkTitleSaving} className={S.btnCancel}>Cancel</button>
            <button onClick={markAllTitlesReceived} disabled={bulkTitleSaving} className={FC.btnSave}>
              {bulkTitleSaving ? 'Marking…' : 'Confirm'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
