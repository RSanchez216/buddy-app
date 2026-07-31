import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import SearchSelect from './SearchSelect'
import ActivityTrail from './ActivityTrail'
import {
  loadLookup, addCategory, setLumperStatus, statusMeta, money, todayChicago, fmtChicagoTs,
  DOC_BUCKET, CHARGE_TO, CHARGE_TO_DESC, STATUS_OPTIONS,
} from './lumperData'

const ORANGE_BTN = 'px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:bg-gray-200 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-slate-500 text-white rounded-xl transition-all'
const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest'
// null for empty/partial/non-finite so a half-typed money string ("128.", ".")
// never coerces to NaN and reaches the DB or the total.
const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
// Money text field held as a raw STRING while editing (so a trailing '.' isn't
// stripped). Normalise a comma decimal to a dot, drop anything non-numeric, and
// keep at most one dot — so `,` and `.` both work on any keyboard layout.
const normalizeMoneyInput = (s) => String(s)
  .replace(',', '.')
  .replace(/[^0-9.]/g, '')
  .replace(/(\..*)\./g, '$1')
// On blur: coerce to a 2dp string, or '' when it isn't a finite number.
const formatMoneyBlur = (s) => {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}
const sanitizeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_').slice(-80)

export default function LumperDrawer({ open, mode, row, categories, refLists, onCategoriesChange, onClose, onSaved }) {
  const { profile: me, canEdit } = useAuth() // canEdit = is_admin_or_manager
  const toast = useToast()
  const isEdit = mode === 'edit'

  // Step 1 — load
  const [loadNumber, setLoadNumber] = useState('')
  const [datePaid, setDatePaid] = useState(todayChicago())
  const [lookup, setLookup] = useState({ status: 'idle', drivers: [] }) // idle|loading|found|notfound
  const [loadId, setLoadId] = useState(null)
  const [carrierId, setCarrierId] = useState(null)
  const [customerId, setCustomerId] = useState(null)
  const [broker, setBroker] = useState('')
  const [dispatcherId, setDispatcherId] = useState(null)
  const [dispatcherName, setDispatcherName] = useState('')
  const [driverId, setDriverId] = useState(null)
  const [driverName, setDriverName] = useState('')

  // Step 2 — payment (+ receipt / revised rate con / dock notes, moved here)
  const [efsCode, setEfsCode] = useState('')
  const [amount, setAmount] = useState('')
  const [efsFee, setEfsFee] = useState('2.00')
  const [categoryId, setCategoryId] = useState(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [addingCat, setAddingCat] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [revisedRcNumber, setRevisedRcNumber] = useState('')
  const [notes, setNotes] = useState('') // dock note

  // Step 3 — accounting (status/charge/accounting note via RPC)
  const [status, setStatus] = useState('open')
  const [chargeTo, setChargeTo] = useState(null)
  const [accountingNotes, setAccountingNotes] = useState('')

  // Docs + recorder
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptPath, setReceiptPath] = useState(null)
  const [receiptInOctopus, setReceiptInOctopus] = useState(false)
  const [rcFile, setRcFile] = useState(null)
  const [rcPath, setRcPath] = useState(null)
  const [rcInOctopus, setRcInOctopus] = useState(false)
  const [recorderId, setRecorderId] = useState(null)

  // The live row — starts as the `row` prop (edit) or null (create), and gets
  // replaced after each save so the trail + accounting metadata stay current
  // without closing the modal. activityTick forces the trail to re-fetch.
  const [rowLive, setRowLive] = useState(null)
  const [activityTick, setActivityTick] = useState(0)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)
  const modalRef = useRef(null)
  const loadInputRef = useRef(null)
  const rcNumberRef = useRef(null)
  const receiptBlockRef = useRef(null)
  const previouslyFocused = useRef(null)

  const usersOptions = useMemo(() => (refLists.users || []).map(u => ({ id: u.id, name: u.full_name })), [refLists.users])
  const usersById = useMemo(() => new Map((refLists.users || []).map(u => [u.id, u])), [refLists.users])

  // Populate on open (reset for create, hydrate for edit).
  useEffect(() => {
    if (!open) return
    setError(''); setSaving(false); setAddingCat(false); setNewCat('')
    setReceiptFile(null); setRcFile(null)
    setRowLive(isEdit && row ? row : null); setActivityTick(0)
    if (isEdit && row) {
      setLoadNumber(row.load_number || '')
      setDatePaid(row.event_date || todayChicago())
      setLookup({ status: 'idle', drivers: [] })
      setLoadId(row.load_id || null)
      setCarrierId(row.carrier_id || null)
      setCustomerId(row.customer_id || null)
      setBroker(row.broker_name || '')
      setDispatcherId(row.dispatcher_id || null)
      setDispatcherName(row.dispatcher_name || row.dispatcher?.name || '')
      setDriverId(row.driver_id || null)
      setDriverName(row.driver_name || row.driver?.full_name || '')
      setEfsCode(row.efs_code || '')
      setAmount(row.amount != null ? String(row.amount) : '')
      setEfsFee(row.efs_fee != null ? String(row.efs_fee) : '2.00')
      setCategoryId(row.category_id || null)
      setInvoiceNumber(row.invoice_number || '')
      setRevisedRcNumber(row.revised_rc_number || '')
      setNotes(row.notes || '')
      setStatus(row.status || 'open')
      setChargeTo(row.charge_to || null)
      setAccountingNotes(row.accounting_notes || '')
      setReceiptPath(row.receipt_path || null)
      setRcPath(row.revised_rc_path || null)
      setReceiptInOctopus(!!row.receipt_in_octopus)
      setRcInOctopus(!!row.revised_rc_in_octopus)
      setRecorderId(row.recorded_by || me?.id || null)
    } else {
      setLoadNumber(''); setDatePaid(todayChicago()); setLookup({ status: 'idle', drivers: [] })
      setLoadId(null); setCarrierId(null); setCustomerId(null); setBroker('')
      setDispatcherId(null); setDispatcherName(''); setDriverId(null); setDriverName('')
      setEfsCode(''); setAmount(''); setEfsFee('2.00'); setCategoryId(null); setInvoiceNumber('')
      setRevisedRcNumber(''); setNotes('')
      setStatus('open'); setChargeTo(null); setAccountingNotes('')
      setReceiptPath(null); setRcPath(null); setReceiptInOctopus(false); setRcInOctopus(false); setRecorderId(me?.id || null)
    }
  }, [open, isEdit, row, me?.id])

  // On open: lock background scroll, remember the trigger, focus the Octopus load
  // number field; on close: restore scroll + return focus to the trigger.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => loadInputRef.current?.focus(), 30)
    return () => {
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus()
    }
  }, [open])

  // Esc closes; Tab / Shift+Tab cycle within the modal (focus trap).
  function onModalKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
    if (e.key !== 'Tab' || !modalRef.current) return
    const nodes = modalRef.current.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    const list = Array.from(nodes).filter(el => el.offsetParent !== null)
    if (!list.length) return
    const first = list[0], last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const totalDisplay = (num(amount) || 0) + (num(efsFee) || 0)
  const totalForPanel = rowLive?.total_amount ?? totalDisplay
  const nowLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date()) + ' CT'
  const hasRc = !!(revisedRcNumber.trim() || rcPath || rcFile)

  async function runLookup(rawNum) {
    const n = rawNum.trim()
    if (!n) { setLookup({ status: 'idle', drivers: [] }); return }
    setLookup({ status: 'loading', drivers: [] })
    try {
      const res = await loadLookup(n)
      if (res?.found) {
        setLoadId(res.load_id || null)
        setCarrierId(res.carrier_id || null)
        setCustomerId(res.customer_id || null)
        setBroker(res.broker_name || '')
        setDispatcherId(res.dispatcher_id || null)
        setDispatcherName(res.dispatcher_name || '')
        const drivers = res.drivers || []
        if (drivers.length === 1) { setDriverId(drivers[0].id); setDriverName(drivers[0].name) }
        else { setDriverId(null); setDriverName('') }
        setLookup({ status: 'found', drivers })
      } else {
        setLookup({ status: 'notfound', drivers: [] })
      }
    } catch {
      setLookup({ status: 'notfound', drivers: [] })
    }
  }

  function onLoadNumberChange(v) {
    setLoadNumber(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runLookup(v), 600)
  }

  function onStatusChange(v) {
    setStatus(v)
    if (v !== 'unpaid') setChargeTo(null) // clear when leaving Unpaid
  }

  // Jump the accounting mirror to the section-2 revised-rate-con field.
  function jumpToReceipt() {
    receiptBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  function jumpToRc() {
    rcNumberRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => rcNumberRef.current?.focus(), 300)
  }

  async function submitAddCategory() {
    const name = newCat.trim()
    if (!name) return
    try {
      const cat = await addCategory(name)
      onCategoriesChange?.([...categories, cat].sort((a, b) => a.sort_order - b.sort_order))
      setCategoryId(cat.id)
      setAddingCat(false); setNewCat('')
    } catch (e) {
      toast.error("Couldn't add category", e)
    }
  }

  async function viewDoc(path) {
    try {
      // Private bucket → signed URL only, never getPublicUrl.
      const { data, error: e } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(path, 3600)
      if (e) throw e
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch (e) {
      toast.error("Couldn't open the document", e)
    }
  }

  async function uploadDoc(eventId, kind, file) {
    const path = `${eventId}/${kind}-${sanitizeName(file.name)}`
    const { error: e } = await supabase.storage.from(DOC_BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (e) throw e
    return path
  }

  async function save() {
    setError('')
    if (!(num(amount) > 0)) { setError('Enter the amount paid.'); return }
    if (!datePaid) { setError('Pick the date paid.'); return }
    if (!categoryId) { setError('Pick a category.'); return }
    // An unpaid lumper must land on somebody (the DB rejects it too).
    if (canEdit && status === 'unpaid' && !chargeTo) {
      setError('Pick who covers this before saving.'); return
    }

    setSaving(true)
    try {
      const recorder = recorderId ? usersById.get(recorderId) : null
      // Sections 1 & 2 only. status / charge_to / rc_status / resolved_at /
      // total_amount are NEVER written here — defaults, the RPC, and triggers
      // own them.
      const payload = {
        event_date: datePaid,
        load_id: loadId || null,
        load_number: loadNumber.trim() || null,
        carrier_id: carrierId || null,
        customer_id: customerId || null,
        broker_name: broker.trim() || null,
        dispatcher_id: dispatcherId || null,
        dispatcher_name: dispatcherName.trim() || null,
        driver_id: driverId || null,
        driver_name: driverName.trim() || null,
        category_id: categoryId || null,
        amount: num(amount),
        efs_fee: num(efsFee) ?? 0, // empty/partial -> 0 (fee column is non-null)
        efs_code: efsCode.trim() || null,
        invoice_number: invoiceNumber.trim() || null,
        revised_rc_number: revisedRcNumber.trim() || null,
        notes: notes.trim() || null,
        paid_by_user_id: recorderId || null,
        paid_from_department_id: recorder?.department_id || null,
        recorded_by: recorderId || null,
        recorded_by_name: recorder?.full_name || null,
        // Only the two booleans — the trigger stamps who/when and clears them on
        // undo, and flips rc_status to 'received' when the rate con is marked.
        receipt_in_octopus: receiptInOctopus,
        revised_rc_in_octopus: rcInOctopus,
      }

      // Update when we already have an id (edit, or a create that was already
      // saved once in this open session); insert only on the very first save.
      let eventId = rowLive?.id || row?.id
      if (eventId) {
        const { error: e } = await supabase.from('lumper_events').update(payload).eq('id', eventId)
        if (e) throw e
      } else {
        const { data, error: e } = await supabase.from('lumper_events')
          .insert({ ...payload, created_by: me?.id || null }).select('id').single()
        if (e) throw e
        eventId = data.id
      }

      // Uploads after we have an id (path is {id}/{kind}-{filename}).
      const patch = {}
      if (receiptFile) patch.receipt_path = await uploadDoc(eventId, 'receipt', receiptFile)
      if (rcFile) patch.revised_rc_path = await uploadDoc(eventId, 'revised_rc', rcFile)
      if (Object.keys(patch).length) {
        const { error: e2 } = await supabase.from('lumper_events').update(patch).eq('id', eventId)
        if (e2) throw e2
      }

      // Accounting section: status / charge_to / accounting note go through the
      // permission-gated RPC, and only when something actually changed.
      if (canEdit) {
        const origStatus = rowLive?.status || 'open'
        const origCharge = rowLive?.charge_to || null
        const origAcct = rowLive?.accounting_notes || ''
        const acctChanged = (accountingNotes || '') !== origAcct
        const statusChanged = status !== origStatus
        const chargeChanged = (chargeTo || null) !== origCharge
        if (statusChanged || chargeChanged || acctChanged) {
          // null note leaves the existing one untouched; send the value only when it changed.
          await setLumperStatus(eventId, status, status === 'unpaid' ? chargeTo : null, acctChanged ? (accountingNotes || '') : null)
        }
      }

      // Refresh the list + summary FIRST (awaited, so the board behind is current
      // the instant the modal closes), then close — on this form a close reads as
      // "the payment saved", so it must only ever happen on success. The write
      // already landed, so a transient refresh hiccup shouldn't block the close.
      try { await onSaved?.() } catch { /* the board catches up on the next load */ }
      onClose?.()
      toast.success(isEdit ? 'Lumper saved' : 'Lumper added')
    } catch (e) {
      setError(e?.message || 'Save failed.')
      toast.error("Couldn't save the lumper", e)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const dockRecorderName = usersById.get(recorderId)?.full_name || rowLive?.recorded_by_name || 'Unknown'
  const dockTs = rowLive?.created_at ? fmtChicagoTs(rowLive.created_at) : nowLabel
  const statusSetByName = rowLive?.status_set_by ? (usersById.get(rowLive.status_set_by)?.full_name || 'someone') : null
  const chargeDesc = chargeTo ? (CHARGE_TO_DESC[chargeTo] || '').replace('{total}', money(totalForPanel)) : ''

  // Octopus-mark attribution (trigger-stamped by/at on the persisted row). Before
  // a save persists a fresh tick, show it optimistically as "you · just now".
  const myName = usersById.get(me?.id)?.full_name || 'you'
  const octoBy = (persistedBy, flag) => (persistedBy ? (usersById.get(persistedBy)?.full_name || 'someone') : (flag ? myName : null))
  const octoAt = (persistedAt, flag) => (persistedAt ? fmtChicagoTs(persistedAt) : (flag ? 'just now' : null))
  const receiptOctopusBy = octoBy(rowLive?.receipt_octopus_by, receiptInOctopus)
  const receiptOctopusAt = octoAt(rowLive?.receipt_octopus_at, receiptInOctopus)
  const rcOctopusBy = octoBy(rowLive?.revised_rc_octopus_by, rcInOctopus)
  const rcOctopusAt = octoAt(rowLive?.revised_rc_octopus_at, rcInOctopus)

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={modalRef}
        role="dialog" aria-modal="true" aria-labelledby="lumper-modal-title"
        onKeyDown={onModalKeyDown}
        className="relative flex flex-col w-[calc(100vw-64px)] max-w-[1308px] max-h-[calc(100vh-64px)] rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0B1120] shadow-2xl overflow-hidden max-[639px]:w-screen max-[639px]:h-screen max-[639px]:max-w-none max-[639px]:max-h-none max-[639px]:rounded-none max-[639px]:border-0"
      >
        {/* Header (full width) */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/5 shrink-0">
          <div>
            <h3 id="lumper-modal-title" className="text-lg font-bold text-gray-900 dark:text-white">{isEdit ? 'Edit lumper' : 'Add lumper'}</h3>
            <p className="text-xs text-gray-500 dark:text-slate-500">Advance paid at the dock — record it and track recovery.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body — two columns ≥1100px, single column below (scrolls only here) */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {error && <div className="px-5 pt-4"><div className={S.errorBox}>{error}</div></div>}

          <div className="grid min-[1100px]:grid-cols-[1fr_452px]">
            {/* Left column — Steps 1 & 2 (whoever paid, after hours) */}
            <div className="p-5 space-y-5">
              <p className={`${EYEBROW} text-gray-400 dark:text-slate-500`}>Filled in by whoever paid · after hours</p>

              {/* Step 1 — tinted lookup panel */}
              <div className="rounded-xl border border-orange-200 dark:border-orange-500/30 bg-orange-50/40 dark:bg-orange-500/[0.05] p-4">
                <Step n={1} title="Start with the load">
                  <div className="grid grid-cols-[1.2fr_1fr_168px] gap-3">
                    <div>
                      <label className={S.label}>Octopus load number</label>
                      <input ref={loadInputRef} className={S.input} value={loadNumber} placeholder="2607-1306"
                        onChange={e => onLoadNumberChange(e.target.value)}
                        onBlur={() => { if (debounceRef.current) clearTimeout(debounceRef.current); runLookup(loadNumber) }} />
                    </div>
                    <div>
                      <label className={S.label}>Broker load number</label>
                      <input className={S.input} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="Broker's load number" />
                    </div>
                    <div>
                      <label className={S.label}>Date paid</label>
                      <input type="date" className={S.input} value={datePaid} max={todayChicago()} onChange={e => setDatePaid(e.target.value || datePaid)} />
                    </div>
                  </div>

                  {lookup.status === 'loading' && <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">Looking up load…</p>}
                  {lookup.status === 'found' && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 inline-flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Load found — details auto-filled below. Adjust anything that doesn&apos;t match.
                    </p>
                  )}
                  {lookup.status === 'notfound' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">No load found with that number. You can still record the lumper and link it later.</p>
                  )}

                  {lookup.status === 'found' && lookup.drivers.length > 1 && (
                    <div className="mt-3 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                      <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 mb-1.5">Multiple drivers on this load — pick who paid:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {lookup.drivers.map(d => (
                          <button key={d.id} type="button" onClick={() => { setDriverId(d.id); setDriverName(d.name) }}
                            className={`px-2.5 py-1 rounded-full text-xs border ${driverId === d.id ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-white dark:hover:bg-white/5'}`}>
                            {d.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Auto cards — 2×2 so long names (Sean Bektur Uzonaliev) fit */}
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <AutoField label="Carrier" auto={lookup.status === 'found'}>
                      <SearchSelect options={refLists.carriers} value={carrierId} onChange={id => setCarrierId(id)} placeholder="Search carriers…" />
                    </AutoField>
                    <AutoField label="Driver" auto={lookup.status === 'found' && !!driverId}>
                      <SearchSelect options={refLists.drivers} value={driverId} onChange={(id, o) => { setDriverId(id); setDriverName(o?.name || '') }} placeholder="Search drivers…" />
                    </AutoField>
                    <AutoField label="Dispatcher" auto={lookup.status === 'found'}>
                      <SearchSelect options={refLists.dispatchers} value={dispatcherId} onChange={(id, o) => { setDispatcherId(id); setDispatcherName(o?.name || '') }} placeholder="Search dispatchers…" />
                    </AutoField>
                    <AutoField label="Broker" auto={lookup.status === 'found'}>
                      <input className={S.input} value={broker} onChange={e => setBroker(e.target.value)} placeholder="Broker name" />
                    </AutoField>
                  </div>
                </Step>
              </div>

              <div className="border-t border-gray-200 dark:border-white/10" />

              {/* Step 2 — the payment (+ receipt / revised rate con / notes) */}
              <Step n={2} title="The payment">
                <div className="grid grid-cols-[1.15fr_1fr_0.9fr_1fr] gap-3">
                  <div>
                    <label className={S.label}>EFS code</label>
                    <input className={S.input} value={efsCode} onChange={e => setEfsCode(e.target.value)} />
                  </div>
                  <div>
                    <label className={S.label}>Amount paid *</label>
                    <input type="text" inputMode="decimal" className={S.input} value={amount}
                      onChange={e => setAmount(normalizeMoneyInput(e.target.value))}
                      onBlur={() => setAmount(formatMoneyBlur(amount))} placeholder="0.00" />
                  </div>
                  <div>
                    <label className={S.label}>EFS check fee</label>
                    <input type="text" inputMode="decimal" className={S.input} value={efsFee}
                      onChange={e => setEfsFee(normalizeMoneyInput(e.target.value))}
                      onBlur={() => setEfsFee(formatMoneyBlur(efsFee))} />
                  </div>
                  <div>
                    <label className={S.label}>Total <span className="text-gray-400 dark:text-slate-500 font-normal normal-case">· calculated</span></label>
                    <div className={`${S.input} bg-gray-50 dark:bg-white/5 flex items-center font-mono tabular-nums font-semibold`}>{money(totalDisplay)}</div>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1.5">Default — change only if EFS charged something else.</p>

                <div className="mt-3">
                  <label className={S.label}>Category *</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {categories.map(c => (
                      <button key={c.id} type="button" onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${categoryId === c.id ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                        {c.name}
                      </button>
                    ))}
                    {canEdit && !addingCat && (
                      <button type="button" onClick={() => setAddingCat(true)} title="Add a category"
                        className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-dashed border-gray-300 dark:border-slate-600 text-gray-400 hover:text-orange-500 hover:border-orange-400">
                        +
                      </button>
                    )}
                    {canEdit && addingCat && (
                      <span className="inline-flex items-center gap-1">
                        <input autoFocus value={newCat} onChange={e => setNewCat(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitAddCategory(); if (e.key === 'Escape') { e.stopPropagation(); setAddingCat(false); setNewCat('') } }}
                          placeholder="New category" className={`${S.input} !py-1 !w-36 text-xs`} />
                        <button type="button" onClick={submitAddCategory} className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">Add</button>
                        <button type="button" onClick={() => { setAddingCat(false); setNewCat('') }} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="border-t border-dashed border-gray-300 dark:border-white/10 my-4" />

                {/* Receipt */}
                <div ref={receiptBlockRef}>
                  <label className={S.label}>Receipt</label>
                  <DocTarget label="Receipt" noun="Receipt" file={receiptFile} path={receiptPath} inOctopus={receiptInOctopus}
                    onFile={setReceiptFile} onView={viewDoc} onClear={() => setReceiptFile(null)} onToggleOctopus={setReceiptInOctopus}
                    canEdit={canEdit} uploadedBy={dockRecorderName} uploadedAt={dockTs} octopusBy={receiptOctopusBy} octopusAt={receiptOctopusAt} />
                </div>

                {/* Revised rate con — number + upload */}
                <div className="mt-4">
                  <label className={S.label}>Revised rate con <span className="text-gray-400 dark:text-slate-500 font-normal normal-case">· ask the broker before you leave the dock</span></label>
                  <input ref={rcNumberRef} className={S.input} value={revisedRcNumber} onChange={e => setRevisedRcNumber(e.target.value)}
                    placeholder="Updated Rate Confirmation File - Leave blank if the broker wouldn't issue one" />
                  <div className="mt-2">
                    <DocTarget label="PDF file" noun="The revised rate con" file={rcFile} path={rcPath} inOctopus={rcInOctopus}
                      onFile={setRcFile} onView={viewDoc} onClear={() => setRcFile(null)} onToggleOctopus={setRcInOctopus}
                      canEdit={canEdit} uploadedBy={dockRecorderName} uploadedAt={dockTs} octopusBy={rcOctopusBy} octopusAt={rcOctopusAt} />
                  </div>
                </div>

                {/* Dock notes */}
                <div className="mt-4">
                  <label className={S.label}>Notes <span className="text-gray-400 dark:text-slate-500 font-normal normal-case">· what the morning team needs to know</span></label>
                  <textarea rows={2} className={`${S.textarea} min-h-[74px]`} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything the morning team needs to know…" />
                </div>
              </Step>
            </div>

            {/* Right column — Step 3 (accounting) */}
            <div className="p-5 space-y-4 min-[1100px]:border-l max-[1099px]:border-t border-gray-200 dark:border-white/10 min-[1100px]:bg-gray-50/60 min-[1100px]:dark:bg-[#0E1626]">
              <p className={`${EYEBROW} text-orange-600 dark:text-orange-400`}>Accounting</p>
              {!canEdit && <p className="text-[11px] text-gray-400 dark:text-slate-500">Accounting updates this section.</p>}

              <Step n={3} title="Getting it back">
                {/* STATUS */}
                <div>
                  <label className={S.label}>Status</label>
                  {canEdit
                    ? <StatusSelect value={status} onChange={onStatusChange} dropUp={false} />
                    : <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusMeta(status).pill}`}><span className="w-2 h-2 rounded-full" style={{ background: statusMeta(status).dot }} />{statusMeta(status).label}</span>}

                  {status === 'open' && (
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1.5">The broker is expected to pay. Nothing is charged to anyone until accounting says otherwise.</p>
                  )}
                  {status === 'paid' && (
                    <div className="mt-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                      <p className="text-xs text-emerald-800 dark:text-emerald-300"><span className="font-bold">Closed.</span> Broker reimbursed {money(totalForPanel)} in full. Nothing charged to the driver, dispatcher or company.</p>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1.5">Factoring buying the invoice is not payment — leave it on Pending until the broker actually settles.</p>
                    </div>
                  )}

                  {/* Signpost for whoever is about to chase the broker: the receipt
                      isn't in BUDDY but it's in Octopus — pull it from there. */}
                  {status === 'pending' && !receiptPath && !receiptFile && receiptInOctopus && (
                    <div className="mt-2 p-3 rounded-lg border border-[#CBCEF7] bg-[#F7F7FE] dark:border-indigo-500/30 dark:bg-indigo-500/[0.06]">
                      <p className="text-xs text-[#4338CA] dark:text-indigo-300">
                        <span className="font-bold text-[#3730A3] dark:text-indigo-200">The receipt is in Octopus.</span>{' '}
                        {receiptOctopusBy ? `Marked by ${receiptOctopusBy}` : 'Marked'}{receiptOctopusAt ? ` on ${receiptOctopusAt}` : ''} — pull it from there before emailing {broker.trim() || 'the broker'}.{' '}
                        <button type="button" onClick={jumpToReceipt} className="font-medium text-[#4F46E5] dark:text-indigo-300 hover:underline">Upload a copy here</button>
                      </p>
                    </div>
                  )}
                </div>

                {/* PAID BY — only on Other Payment Method (stored status 'unpaid') */}
                {status === 'unpaid' && (
                  <div className="mt-3">
                    <label className={S.label}>Paid by *</label>
                    {canEdit ? (
                      <>
                        <select className={`${S.input} appearance-none`} value={chargeTo || ''} onChange={e => setChargeTo(e.target.value || null)}>
                          <option value="">Pick who covers it</option>
                          {CHARGE_TO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        {chargeTo
                          ? <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1.5">{chargeDesc}</p>
                          : <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">Required. Pick who covers this before saving.</p>}
                      </>
                    ) : (
                      <p className="text-sm text-gray-700 dark:text-slate-300">{CHARGE_TO.find(c => c[0] === chargeTo)?.[1] || '—'}</p>
                    )}
                  </div>
                )}

                {/* REVISED RATE CON mirror (entered in step 2) */}
                <div className="mt-3">
                  <label className={S.label}>Revised rate con <span className="text-gray-400 dark:text-slate-500 font-normal normal-case">· entered in step 2</span></label>
                  {hasRc ? (
                    <div className="text-xs flex items-center gap-2">
                      <span className="text-gray-700 dark:text-slate-300 truncate">
                        {revisedRcNumber.trim() && (rcPath || rcFile) ? `${revisedRcNumber.trim()} · PDF attached` : (rcPath || rcFile) ? 'PDF attached' : revisedRcNumber.trim()}
                      </span>
                      <button type="button" onClick={jumpToRc} className="ml-auto text-orange-600 dark:text-orange-400 font-medium hover:underline shrink-0">Replace</button>
                    </div>
                  ) : (
                    <div className="text-xs flex items-center gap-2">
                      <span className="text-gray-400 dark:text-slate-500 italic">Nothing attached — after hours couldn&apos;t get one</span>
                      <button type="button" onClick={jumpToRc} className="ml-auto text-orange-600 dark:text-orange-400 font-medium hover:underline shrink-0">Add it</button>
                    </div>
                  )}
                </div>

                <div className="border-t border-dashed border-gray-300 dark:border-white/10 my-4" />

                {/* NOTE FROM THE DOCK — read-only */}
                {notes.trim() && (
                  <div>
                    <label className={S.label}>Note from the dock <span className="text-gray-400 dark:text-slate-500 font-normal normal-case">· read only</span></label>
                    <div className="rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 p-3">
                      <p className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{notes}</p>
                      <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1.5">{dockRecorderName} · {dockTs}</p>
                    </div>
                  </div>
                )}

                {/* ACCOUNTING NOTE */}
                <div className={notes.trim() ? 'mt-3' : ''}>
                  <label className={S.label}>Accounting note</label>
                  {canEdit
                    ? <textarea rows={2} className={`${S.textarea} min-h-[64px]`} value={accountingNotes} onChange={e => setAccountingNotes(e.target.value)} placeholder="Recovery, disputes, who was told what…" />
                    : <p className="text-xs text-gray-600 dark:text-slate-400 whitespace-pre-wrap">{accountingNotes.trim() || <span className="italic text-gray-400 dark:text-slate-500">No accounting note yet.</span>}</p>}
                </div>

                {statusSetByName && rowLive?.status_set_at && (
                  <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-3">Status set by {statusSetByName} · {fmtChicagoTs(rowLive.status_set_at)}</p>
                )}

                {/* Activity trail — read-only; edit-only / after the first save */}
                <ActivityTrail lumperId={rowLive?.id || null} refetchTick={activityTick} />
              </Step>
            </div>
          </div>
        </div>

        {/* Footer (full width) */}
        <div className="shrink-0 border-t border-gray-100 dark:border-white/5 px-5 py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500 shrink-0">Recorded by</span>
              <div className="w-48">
                <SearchSelect options={usersOptions} value={recorderId} onChange={id => setRecorderId(id)} placeholder="Recorder…" dropUp />
              </div>
              {recorderId === me?.id && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">YOU</span>}
              <span className="text-[11px] text-gray-400 dark:text-slate-500 tabular-nums ml-3 whitespace-nowrap">{nowLabel}</span>
            </div>
            <div className="flex items-center justify-end gap-2 ml-auto">
              <button onClick={onClose} className={S.btnCancel}>Cancel</button>
              <button onClick={save} disabled={saving} className={ORANGE_BTN}>{saving ? 'Saving…' : 'Save lumper'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function Step({ n, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 inline-flex items-center justify-center text-xs font-bold">{n}</span>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
      </div>
      {children}
    </div>
  )
}

function AutoField({ label, auto, children }) {
  return (
    <div>
      <label className={`${S.label} flex items-center gap-1.5`}>
        {label}
        {auto && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 tracking-normal">AUTO</span>}
      </label>
      {children}
    </div>
  )
}

// Status dropdown — dot + label + description per option; 8px dots.
function StatusSelect({ value, onChange, dropUp }) {
  const [open, setOpen] = useState(false)
  const cur = STATUS_OPTIONS.find(o => o.value === value) || STATUS_OPTIONS[0]
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${S.input} flex items-center gap-2 text-left`}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cur.dot }} />
        <span className="text-gray-900 dark:text-slate-100">{cur.label}</span>
        {value === 'open' && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-slate-400 tracking-normal">DEFAULT</span>}
        <svg className="ml-auto w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className={`absolute z-50 w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#12132e] shadow-lg overflow-hidden ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {STATUS_OPTIONS.map(o => (
            <button key={o.value} type="button" onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 ${o.value === value ? 'bg-gray-50 dark:bg-white/5' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: o.dot }} />
                <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{o.label}</span>
                {o.value === 'open' && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-slate-400 tracking-normal">DEFAULT</span>}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 ml-4">{o.desc}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Display precedence: file present → green (IN BUDDY); else in-Octopus → purple
// (IN OCTOPUS, a full peer of green); else grey (Missing).
function OctopusCheck({ inOctopus, onToggle }) {
  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 cursor-pointer">
      <input type="checkbox" checked={inOctopus} onChange={e => onToggle(e.target.checked)} className="accent-[#6366F1]" />
      Already uploaded to Octopus
    </label>
  )
}
function FileInput({ children, onFile, className }) {
  return (
    <label className={`cursor-pointer ${className}`}>
      {children}
      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  )
}
function DocTarget({ label, noun, file, path, inOctopus, onFile, onView, onClear, onToggleOctopus, canEdit, uploadedBy, uploadedAt, octopusBy, octopusAt }) {
  const hasFile = !!(file || path)
  const filename = file?.name || (path ? String(path).split('/').pop().replace(/^(receipt|revised_rc)-/, '') : '')

  if (hasFile) {
    return (
      <div className="rounded-xl border p-3 border-[#C9E7D3] bg-[#F5FCF7] dark:border-emerald-500/30 dark:bg-emerald-500/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#E3F6E9] text-[#157A3B] dark:bg-emerald-500/15 dark:text-emerald-400">IN BUDDY</span>
          {file
            ? (canEdit && <button type="button" onClick={onClear} className="ml-auto text-gray-400 hover:text-red-500 text-xs shrink-0" aria-label="Remove">✕</button>)
            : (
              <div className="ml-auto flex items-center gap-3 text-xs shrink-0">
                <button type="button" onClick={() => onView(path)} className="text-orange-600 dark:text-orange-400 font-medium hover:underline">View current</button>
                {canEdit && <FileInput onFile={onFile} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">Replace</FileInput>}
              </div>
            )}
        </div>
        <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 truncate" title={filename}>
          {filename}{uploadedBy ? ` · uploaded by ${uploadedBy}` : ''}{uploadedAt ? `, ${uploadedAt}` : ''}
        </p>
        {canEdit && <OctopusCheck inOctopus={inOctopus} onToggle={onToggleOctopus} />}
      </div>
    )
  }

  if (inOctopus) {
    return (
      <div className="rounded-xl border p-3 border-[#CBCEF7] bg-[#F7F7FE] dark:border-indigo-500/30 dark:bg-indigo-500/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#E8EAFD] text-[#4338CA] dark:bg-indigo-500/15 dark:text-indigo-300">IN OCTOPUS</span>
          {canEdit && (
            <div className="ml-auto flex items-center gap-3 text-xs shrink-0">
              <FileInput onFile={onFile} className="text-orange-600 dark:text-orange-400 font-medium hover:underline">Upload a copy anyway</FileInput>
              <button type="button" onClick={() => onToggleOctopus(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">Undo</button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-[#4338CA] dark:text-indigo-300 mt-1">
          {noun} is in Octopus.{octopusBy ? ` Marked by ${octopusBy}` : ''}{octopusAt ? `, ${octopusAt}.` : (octopusBy ? '.' : '')}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dashed border-[#DDE1E6] dark:border-slate-600 bg-white dark:bg-transparent p-3">
      <p className="text-xs font-medium text-gray-700 dark:text-slate-300 mb-1.5">{label}</p>
      {canEdit ? (
        <FileInput onFile={onFile} className="flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 dark:text-slate-500 hover:text-orange-500">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
          Upload image or PDF
        </FileInput>
      ) : (
        <p className="py-2 text-xs text-gray-400 dark:text-slate-500 text-center">None</p>
      )}
      {canEdit && <OctopusCheck inOctopus={inOctopus} onToggle={onToggleOctopus} />}
    </div>
  )
}
