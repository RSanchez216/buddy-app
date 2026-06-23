import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { DRIVER_TYPES, DriverTypePill } from '../fleetUtils'
import { parseDriversWorkbook, driversHeaderSignature } from './driversParser'
import { commitDriverRows } from './driversCommit'
import { matchExistingDriver } from './driversMatcher'

// Three stages: pick → preview → done.
// Preview computes possibly-terminated drivers (active in DB but missing from
// the upload's internal_id set). Each gets a per-row action: terminate /
// inactive / on_leave / keep_active. Defaults to keep_active so nobody is
// terminated by accident on the first upload run.

const TYPE_FILTERS = [
  { key: 'all',                  label: 'All' },
  { key: 'Owner Operator',       label: 'Owner Op' },
  { key: 'Leased Owner-Op',      label: 'Leased OO' },
  { key: 'Contract Driver',      label: 'Contract' },
  { key: 'Company Driver',       label: 'Company' },
  { key: 'needs_resolution',     label: '⚠️ Needs Resolution' },
  { key: 'errors',               label: 'Errors' },
]

// Match-method visual treatment (pill + label).
const MATCH_PILLS = {
  id_match:           { label: '🔁 Update by ID',          cls: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20' },
  name_backfill:      { label: '🆔 Update + Backfill ID',  cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20' },
  new:                { label: '🆕 New',                   cls: 'bg-gray-100 dark:bg-slate-700/40 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-600/30' },
  possible_duplicate: { label: '⚠️ Possible Duplicate',    cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30' },
  name_ambiguous:     { label: '⚠️ Multiple Name Matches', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30' },
}

const TERM_ACTIONS = [
  { value: 'keep_active', label: 'Keep Active (false +)' },
  { value: 'terminate',   label: 'Confirm Terminated' },
  { value: 'inactive',    label: 'Mark Inactive' },
  { value: 'on_leave',    label: 'Mark On Leave' },
]

const MAX_FILE_BYTES = 5 * 1024 * 1024

export default function DriversUploadModal({ open, onClose, onCommitted }) {
  const { user } = useAuth()
  const fileInputRef = useRef(null)

  const [stage, setStage] = useState('pick')
  const [fileNames, setFileNames] = useState([]) // one or more selected files
  const [parsing, setParsing] = useState(false)
  const [parseErrors, setParseErrors] = useState([])
  const [rows, setRows] = useState([])
  const [possiblyTerminated, setPossiblyTerminated] = useState([])
  const [termActions, setTermActions] = useState({})  // driverId → { action, reason }
  // Bulk-action bar state for the Possibly Terminated section.
  const [bulkAction, setBulkAction] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const [pendingBulkConfirm, setPendingBulkConfirm] = useState(false)
  const [bulkToast, setBulkToast] = useState('')  // ephemeral confirmation
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [bulkType, setBulkType] = useState('')
  const [terminationPanelOpen, setTerminationPanelOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setStage('pick'); setFileNames([]); setParseErrors([]); setRows([])
      setPossiblyTerminated([]); setTermActions({}); setCommitResult(null)
      setFilter('all'); setSearch(''); setSelected(new Set()); setBulkType('')
      setBulkAction(''); setBulkReason(''); setPendingBulkConfirm(false); setBulkToast('')
      setTerminationPanelOpen(false)
    }
  }, [open])

  async function handleFiles(files) {
    if (!files || files.length === 0) return
    const fileArray = Array.from(files)

    // Validate size + extension for every selected file up front.
    const fileErrors = []
    for (const f of fileArray) {
      if (f.size > MAX_FILE_BYTES) {
        fileErrors.push(`${f.name}: larger than 5 MB (${(f.size / 1024 / 1024).toFixed(1)} MB).`)
      }
      if (!/\.xlsx?$/i.test(f.name)) {
        fileErrors.push(`${f.name}: must be .xlsx or .xls.`)
      }
    }
    if (fileErrors.length > 0) { setParseErrors(fileErrors); return }

    setFileNames(fileArray.map(f => f.name)); setParsing(true); setParseErrors([])
    try {
      // Buffer each file and require identical headers across the batch
      // (normalized for case/whitespace/order). A mismatch names the
      // offending file and aborts — never a partial import.
      const buffers = []
      let firstSig = null
      const headerMismatches = []
      for (const f of fileArray) {
        const buf = await f.arrayBuffer()
        const sig = driversHeaderSignature(buf)
        if (!sig) {
          headerMismatches.push(`${f.name}: couldn't read a header row.`)
          continue
        }
        if (firstSig === null) {
          firstSig = sig
        } else if (sig !== firstSig) {
          headerMismatches.push(`${f.name}: header columns don't match "${fileArray[0].name}" — not imported.`)
          continue
        }
        buffers.push({ name: f.name, buf })
      }
      if (headerMismatches.length > 0) {
        setParseErrors(headerMismatches); setFileNames([]); setParsing(false); return
      }

      // Parse each file and concatenate the data rows into one dataset.
      // _rowNum is per-file in the parser, so re-key it uniquely across the
      // merged set (it's the row's selection/React key).
      const parsed = []
      const errors = []
      const multi = fileArray.length > 1
      for (const { name, buf } of buffers) {
        const { rows: fileRows, errors: fileErrs } = parseDriversWorkbook(buf)
        parsed.push(...fileRows.map(r => ({ ...r, _sourceFile: name })))
        errors.push(...(multi ? fileErrs.map(e => `${name}: ${e}`) : fileErrs))
      }
      parsed.forEach((r, i) => { r._rowNum = i + 2 })

      // Load the FULL drivers roster once so the matcher can run all four
      // tiers (id, name-backfill, possible-duplicate, ambiguous). We need
      // the full set, not just the in-upload internal_ids, because Tier-2
      // name-match candidates have internal_id IS NULL.
      const { data: allDrivers } = await supabase
        .from('drivers')
        .select('id, internal_id, full_name, current_status, last_seen_in_upload_at')

      const preview = parsed.map(r => {
        const match = matchExistingDriver(r, allDrivers || [])
        return {
          ...r,
          match,                                       // { method, existing, confidence, candidates? }
          resolution: null,                            // user-set for possible_duplicate / name_ambiguous
          existing_status: match.existing?.current_status || null,
          skip: false,
        }
      })
      setRows(preview)
      setParseErrors(errors)

      // Termination detection: currently-active drivers whose internal_id is
      // present in DB but NOT in the upload's id set. Rows matched only by
      // name (Tier 2 backfill) don't count as "missing" — we still saw the
      // person on this run, just by name. So we union the upload's ids with
      // the existing.internal_id of every matched row, then diff.
      const uploadedIds = new Set()
      for (const r of preview) {
        if (r.internal_id) uploadedIds.add(r.internal_id)
        if (r.match?.existing?.internal_id) uploadedIds.add(r.match.existing.internal_id)
      }
      const missing = (allDrivers || []).filter(d =>
        d.current_status === 'active' && d.internal_id && !uploadedIds.has(d.internal_id)
      )
      setPossiblyTerminated(missing)
      const defaults = {}
      for (const d of missing) defaults[d.id] = { action: 'keep_active', reason: '' }
      setTermActions(defaults)

      setStage('preview')
    } catch (e) {
      setParseErrors([`Failed to parse workbook: ${e.message || e}`])
    } finally {
      setParsing(false)
    }
  }

  function onPick(e) { handleFiles(e.target.files) }
  function onDrop(e) { e.preventDefault(); handleFiles(e.dataTransfer.files) }

  const counts = useMemo(() => {
    const c = {
      total: rows.length,
      errors: 0,
      by_type: { 'Owner Operator': 0, 'Leased Owner-Op': 0, 'Contract Driver': 0, 'Company Driver': 0, unrecognized: 0 },
      by_method: { id_match: 0, name_backfill: 0, new: 0, possible_duplicate: 0, name_ambiguous: 0 },
      unresolved: 0,
    }
    for (const r of rows) {
      if (r.driver_type) c.by_type[r.driver_type] = (c.by_type[r.driver_type] || 0) + 1
      else if (r.driver_type_raw) c.by_type.unrecognized++
      if (r.driver_type_raw && !r.driver_type) c.errors++
      if (r.compensation_raw && !r.compensation_type) c.errors++
      const m = r.match?.method
      if (m && c.by_method[m] !== undefined) c.by_method[m]++
      if ((m === 'possible_duplicate' || m === 'name_ambiguous') && !r.resolution) c.unresolved++
    }
    return c
  }, [rows])

  function setRowResolution(idx, resolution) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, resolution } : r))
  }

  // Default reason when bulk-applying "Confirm Terminated" with a blank
  // reason field. Chicago-tz today for consistency with the rest of BUDDY.
  const defaultTerminationReason = useMemo(() => {
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric',
    })
    return `Not in TMS active roster as of ${today}`
  }, [])

  const bulkActionLabel = TERM_ACTIONS.find(a => a.value === bulkAction)?.label || ''
  const bulkEffectiveReason = bulkAction === 'terminate' && !bulkReason.trim()
    ? defaultTerminationReason
    : bulkReason.trim()

  function applyBulkTerminations() {
    if (!bulkAction || possiblyTerminated.length === 0) return
    const reason = bulkEffectiveReason
    const next = { ...termActions }
    for (const d of possiblyTerminated) {
      next[d.id] = { action: bulkAction, reason }
    }
    setTermActions(next)
    setPendingBulkConfirm(false)
    setBulkToast(`${possiblyTerminated.length} drivers marked as ${bulkActionLabel}`)
    setTimeout(() => setBulkToast(''), 3000)
    // Reset bar so a stray click doesn't re-apply.
    setBulkAction(''); setBulkReason('')
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'errors') {
        if (!(r.compensation_raw && !r.compensation_type) && !(r.driver_type_raw && !r.driver_type)) return false
      } else if (filter === 'needs_resolution') {
        const m = r.match?.method
        const needs = (m === 'possible_duplicate' || m === 'name_ambiguous') && !r.resolution
        if (!needs) return false
      } else if (filter !== 'all' && r.driver_type !== filter) return false
      if (!q) return true
      return (r.internal_id || '').toLowerCase().includes(q)
        || (r.full_name || '').toLowerCase().includes(q)
        || (r.carrier || '').toLowerCase().includes(q)
        || (r.truck_assignment_raw || '').toLowerCase().includes(q)
        || (r.trailer_assignment_raw || '').toLowerCase().includes(q)
    })
  }, [rows, filter, search])

  function setRowType(idx, type) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, driver_type: type } : r))
  }
  function setRowSkip(idx, skip) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, skip } : r))
  }
  function toggleSelectAll(checked) {
    if (!checked) { setSelected(new Set()); return }
    setSelected(new Set(filteredRows.map(r => r._rowNum)))
  }
  function toggleSelect(rowNum) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(rowNum) ? next.delete(rowNum) : next.add(rowNum)
      return next
    })
  }
  function applyBulkType() {
    if (!bulkType || selected.size === 0) return
    setRows(prev => prev.map(r => selected.has(r._rowNum) ? { ...r, driver_type: bulkType } : r))
    setSelected(new Set()); setBulkType('')
  }
  function applyBulkSkip(skip) {
    if (selected.size === 0) return
    setRows(prev => prev.map(r => selected.has(r._rowNum) ? { ...r, skip } : r))
    setSelected(new Set())
  }

  const toCommit = rows.filter(r => !r.skip)
  // Project each committable row to its effective action so the commit
  // button label matches what driversCommit.decideRowAction() will do.
  function effectiveKind(r) {
    const m = r.match?.method
    if (m === 'id_match' || m === 'name_backfill') return 'update'
    if (m === 'new') return 'insert'
    if (m === 'possible_duplicate' || m === 'name_ambiguous') {
      const a = r.resolution?.action
      if (a === 'merge_into' && r.resolution?.target_id) return 'update'
      if (a === 'keep_separate') return 'insert'
      return 'pending'
    }
    return 'insert'
  }
  const willInsert = toCommit.filter(r => effectiveKind(r) === 'insert').length
  const willUpdate = toCommit.filter(r => effectiveKind(r) === 'update').length
  const willBackfill = toCommit.filter(r => r.match?.method === 'name_backfill').length
  // Split status changes so the Commit button can label them precisely when
  // the bulk action was Terminate vs the mixed case.
  const termValues = Object.values(termActions)
  const willTerminate = termValues.filter(t => t.action === 'terminate').length
  const willOtherStatus = termValues.filter(t => t.action === 'inactive' || t.action === 'on_leave').length
  const willTerm = willTerminate + willOtherStatus
  // Pick the noun: "terminations" when all status changes are terminate,
  // "status changes" for the mixed case.
  const statusChangeSuffix = willTerm === 0
    ? ''
    : willTerminate > 0 && willOtherStatus === 0
      ? ` + ${willTerminate} termination${willTerminate === 1 ? '' : 's'}`
      : ` + ${willTerm} status change${willTerm === 1 ? '' : 's'}`
  // Block commit while any visible (non-skipped) row still requires user resolution.
  const hasUnresolved = toCommit.some(r => effectiveKind(r) === 'pending')

  async function doCommit() {
    setCommitting(true)
    const terms = Object.entries(termActions).map(([driverId, { action, reason }]) => ({ driverId, action, reason }))
    const result = await commitDriverRows({ rows: toCommit, terminations: terms, userId: user?.id })
    setCommitResult(result)
    setCommitting(false)
    setStage('done')
    onCommitted?.()
  }

  const title = stage === 'done' ? '✅ Upload Complete' : 'Upload Drivers Excel'

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title={title} size="3xl">
      <div className={S.modalBody}>
        {parseErrors.length > 0 && stage !== 'done' && (
          <div className={S.errorBox}>
            <p className="font-semibold mb-1">{parseErrors.length} parse warning{parseErrors.length === 1 ? '' : 's'}</p>
            <ul className="list-disc ml-5 text-xs">
              {parseErrors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              {parseErrors.length > 8 && <li>… and {parseErrors.length - 8} more</li>}
            </ul>
          </div>
        )}

        {stage === 'pick' && (
          <div
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            className="border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-2xl p-12 text-center cursor-pointer hover:border-orange-400 dark:hover:border-orange-500/40 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={onPick} multiple className="hidden" />
            <div className="text-4xl mb-2">📂</div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
              {parsing ? 'Parsing…' : 'Drop .xlsx file(s) here or click to browse'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-1">
              Select multiple files with matching columns to import them together.
            </p>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-2">
              Expected columns: Driver ID, Status, Full name, Truck, Carrier, Trailer, Driver type, Phone number, Email, Missing OP, Referred by, Created at, Temporary License, Compensation
            </p>
          </div>
        )}

        {stage === 'preview' && (
          <>
            <div className={`${S.card} p-4 space-y-3`}>
              <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                {fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`} <span className="font-normal text-gray-500 dark:text-slate-500">· {counts.total} rows parsed</span>
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <SummaryGroup title="Classification">
                  <SummaryRow icon="🟢" label="Owner Operator" value={counts.by_type['Owner Operator']} />
                  <SummaryRow icon="🔵" label="Leased Owner-Op" value={counts.by_type['Leased Owner-Op']} />
                  <SummaryRow icon="🟡" label="Contract Driver" value={counts.by_type['Contract Driver']} />
                  <SummaryRow icon="🟣" label="Company Driver" value={counts.by_type['Company Driver']} />
                  {counts.by_type.unrecognized > 0 && <SummaryRow icon="⚠️" label="Unrecognized type" value={counts.by_type.unrecognized} />}
                </SummaryGroup>
                <SummaryGroup title="Match Breakdown">
                  <SummaryRow icon="🔁" label="Update by ID"         value={counts.by_method.id_match} />
                  <SummaryRow icon="🆔" label="Update + Backfill ID" value={counts.by_method.name_backfill} />
                  <SummaryRow icon="🆕" label="New driver"            value={counts.by_method.new} />
                  {(counts.by_method.possible_duplicate + counts.by_method.name_ambiguous) > 0 && (
                    <SummaryRow icon="⚠️" label="Needs resolution"   value={counts.by_method.possible_duplicate + counts.by_method.name_ambiguous} />
                  )}
                </SummaryGroup>
                <SummaryGroup title="Termination Detection">
                  <SummaryRow icon="📋" label="In this upload" value={counts.total} />
                  <SummaryRow icon="⚠️" label="Possibly terminated" value={possiblyTerminated.length} />
                </SummaryGroup>
                <SummaryGroup title="Validation">
                  <SummaryRow icon={parseErrors.length === 0 ? '✓' : '⚠️'} label="Parse warnings" value={parseErrors.length} />
                  <SummaryRow icon={counts.errors === 0 ? '✓' : '⚠️'} label="Row errors" value={counts.errors} />
                </SummaryGroup>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2">
              {TYPE_FILTERS.map(f => {
                const count = f.key === 'all' ? counts.total
                  : f.key === 'errors' ? counts.errors
                  : f.key === 'needs_resolution' ? counts.unresolved
                  : (counts.by_type[f.key] || 0)
                const active = filter === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      active
                        ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-300 dark:border-orange-500/30 text-orange-700 dark:text-orange-400'
                        : 'border-gray-200 dark:border-slate-700/50 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                  >
                    {f.label} <span className="ml-1 opacity-70">{count}</span>
                  </button>
                )
              })}
              <input
                className={`${S.input} max-w-xs ml-auto`}
                placeholder="Search ID, name, carrier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {selected.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 text-xs">
                <span className="font-medium text-cyan-700 dark:text-cyan-400">{selected.size} selected</span>
                <span className="text-cyan-600 dark:text-cyan-400/70">Reclassify as:</span>
                <Select value={bulkType} onChange={e => setBulkType(e.target.value)} className="text-xs">
                  <option value="">—</option>
                  {DRIVER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <button onClick={applyBulkType} disabled={!bulkType} className="px-2 py-1 text-xs font-medium text-cyan-700 dark:text-cyan-400 hover:underline disabled:opacity-50">Apply</button>
                <span className="text-cyan-300 dark:text-cyan-600">·</span>
                <button onClick={() => applyBulkSkip(true)} className="px-2 py-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">Skip</button>
                <button onClick={() => applyBulkSkip(false)} className="px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline">Include</button>
                <button onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs text-gray-500 hover:underline ml-auto">Clear</button>
              </div>
            )}

            <div className={`${S.card} overflow-hidden`}>
              <div className="overflow-x-auto max-h-[360px]">
                <table className="w-full text-sm">
                  <thead className={`${S.tableHead} sticky top-0 z-10`}>
                    <tr>
                      <th className={S.th}>
                        <input
                          type="checkbox"
                          checked={filteredRows.length > 0 && filteredRows.every(r => selected.has(r._rowNum))}
                          onChange={e => toggleSelectAll(e.target.checked)}
                          className="rounded"
                        />
                      </th>
                      <th className={S.th}>ID#</th>
                      <th className={S.th}>Full Name</th>
                      <th
                        className={S.th}
                        title="Manually reclassify this driver's type, overriding the auto-classification. Leave as-is to accept the parsed value."
                      >
                        Driver Type
                      </th>
                      <th className={S.th}>Carrier</th>
                      <th className={S.th}>Truck / Trailer</th>
                      <th className={S.th}>Compensation</th>
                      <th className={S.th}>Match</th>
                      <th className={`${S.th} hidden sm:table-cell w-12`} title="Skip / Include rows from commit">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No rows match this filter.</td></tr>
                    ) : filteredRows.map(row => {
                      const idx = rows.indexOf(row)
                      const isSel = selected.has(row._rowNum)
                      return (
                        <tr
                          key={row._rowNum}
                          className={`${S.tableRow} ${
                            row.skip
                              ? 'opacity-60 bg-gray-100/50 dark:bg-white/[0.02] [&>td]:line-through'
                              : ''
                          }`}
                        >
                          <td className={S.td}>
                            <input type="checkbox" checked={isSel} onChange={() => toggleSelect(row._rowNum)} className="rounded" />
                          </td>
                          <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>{row.internal_id}</td>
                          <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{row.full_name}</td>
                          <td className={S.td}>
                            <Select
                              value={row.driver_type || ''}
                              onChange={e => setRowType(idx, e.target.value || null)}
                              className="text-xs min-w-[180px]"
                            >
                              <option value="">— Unrecognized —</option>
                              {DRIVER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </Select>
                            {row.driver_type_raw && !row.driver_type && (
                              <span className="block text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">⚠️ "{row.driver_type_raw}"</span>
                            )}
                          </td>
                          <td className={`${S.td} text-xs text-gray-600 dark:text-slate-400`}>{row.carrier || '—'}</td>
                          <td className={`${S.td} text-xs text-gray-600 dark:text-slate-400 font-mono`}>
                            {row.truck_assignment_raw || '—'} / {row.trailer_assignment_raw || '—'}
                          </td>
                          <td className={S.td}>
                            <div className="text-xs text-gray-700 dark:text-slate-300">{row.compensation_raw || '—'}</div>
                            {row.compensation_type
                              ? <div className="text-[10px] text-gray-400 dark:text-slate-500">({row.compensation_type} = {row.compensation_value})</div>
                              : row.compensation_raw
                                ? <div className="text-[10px] text-amber-700 dark:text-amber-400">⚠️ format not recognized</div>
                                : null}
                          </td>
                          <td className={S.td}>
                            <MatchCell row={row} idx={idx} onResolve={setRowResolution} />
                          </td>
                          <td className={`${S.td} hidden sm:table-cell text-center [text-decoration:none]`}>
                            {row.skip ? (
                              <button
                                onClick={() => setRowSkip(idx, false)}
                                title="Include this row in the commit"
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l-4-4m0 0l4-4m-4 4h11a4 4 0 014 4v4" />
                                </svg>
                                Include
                              </button>
                            ) : (
                              <button
                                onClick={() => setRowSkip(idx, true)}
                                title="Skip this row from commit"
                                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                                  <circle cx="12" cy="12" r="9" />
                                  <line x1="6" y1="18" x2="18" y2="6" strokeLinecap="round" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {possiblyTerminated.length > 0 && (
              <div className={`${S.card}`}>
                {/* Collapsible header — always visible */}
                <button
                  onClick={() => setTerminationPanelOpen(!terminationPanelOpen)}
                  aria-expanded={terminationPanelOpen}
                  className="w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                          ⚠️ Possibly Terminated Drivers ({possiblyTerminated.length})
                        </p>
                        <svg
                          className={`w-4 h-4 text-gray-600 dark:text-slate-400 flex-shrink-0 transition-transform ${
                            terminationPanelOpen ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-slate-400 mb-1">
                        These were active in BUDDY but aren't in this file. Default is "Keep Active" — nothing changes unless you act.
                      </p>
                      {rows.length > 0 && rows.length < possiblyTerminated.length && (
                        <p className="text-xs text-gray-500 dark:text-slate-500">
                          Partial upload — only {rows.length} of {rows.length + possiblyTerminated.length} active drivers are in this file. The other {possiblyTerminated.length} are listed here for review only and stay active by default.
                        </p>
                      )}
                    </div>
                  </div>
                </button>

                {/* Expanded content */}
                {terminationPanelOpen && (
                  <div className="border-t border-gray-200 dark:border-white/5 p-4 space-y-3">
                    {/* Bulk action bar — set every row in one click, with per-row override after. */}
                    <div className="rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 p-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">Bulk Action</p>
                      {!pendingBulkConfirm ? (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Select
                              value={bulkAction}
                              onChange={e => setBulkAction(e.target.value)}
                              className="text-xs"
                            >
                              <option value="">— Apply to all {possiblyTerminated.length}: —</option>
                              {TERM_ACTIONS.filter(a => a.value !== 'keep_active').map(a => (
                                <option key={a.value} value={a.value}>{a.label}</option>
                              ))}
                              <option value="keep_active">Reset all to Keep Active</option>
                            </Select>
                            <input
                              className={`${S.input} text-xs flex-1 min-w-[260px]`}
                              placeholder={
                                bulkAction === 'terminate' ? defaultTerminationReason : 'Reason (optional)'
                              }
                              value={bulkReason}
                              onChange={e => setBulkReason(e.target.value)}
                              disabled={bulkAction === 'keep_active' || bulkAction === ''}
                            />
                            <button
                              onClick={() => setPendingBulkConfirm(true)}
                              disabled={!bulkAction}
                              className={S.btnSave}
                            >
                              Apply to All {possiblyTerminated.length}
                            </button>
                          </div>
                          {bulkToast && (
                            <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                              <span>✓</span><span>{bulkToast}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        // Inline confirmation step (avoids nesting a Modal inside a Modal).
                        <div className="space-y-2 text-sm">
                          <p className="font-semibold text-gray-700 dark:text-slate-300">
                            Apply "{bulkActionLabel}" to all {possiblyTerminated.length} drivers?
                          </p>
                          {bulkAction === 'terminate' && (
                            <p className="text-xs text-gray-600 dark:text-slate-400">
                              Reason: <span className="italic">"{bulkEffectiveReason}"</span>
                            </p>
                          )}
                          <p className="text-[11px] text-gray-500 dark:text-slate-500">
                            Applied to all rows below. You can still override individual rows afterward.
                          </p>
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setPendingBulkConfirm(false)} className={S.btnCancel}>Cancel</button>
                            <button onClick={applyBulkTerminations} className={S.btnSave}>
                              Apply to All {possiblyTerminated.length}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className={S.tableHead}>
                          <tr>
                            <th className={S.th}>ID#</th>
                            <th className={S.th}>Name</th>
                            <th className={S.th}>Last Seen</th>
                            <th className={S.th}>Action</th>
                            <th className={S.th}>Reason (if terminating)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {possiblyTerminated.map(d => {
                            const t = termActions[d.id] || { action: 'keep_active', reason: '' }
                            return (
                              <tr key={d.id} className={S.tableRow}>
                                <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>{d.internal_id || '—'}</td>
                                <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{d.full_name}</td>
                                <td className={`${S.td} text-xs text-gray-500 dark:text-slate-400`}>
                                  {d.last_seen_in_upload_at ? new Date(d.last_seen_in_upload_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}
                                </td>
                                <td className={S.td}>
                                  <Select
                                    value={t.action}
                                    onChange={e => setTermActions(prev => ({ ...prev, [d.id]: { ...t, action: e.target.value } }))}
                                    className="text-xs"
                                  >
                                    {TERM_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                                  </Select>
                                </td>
                                <td className={S.td}>
                                  {t.action === 'terminate' && (
                                    <input
                                      className={`${S.input} text-xs`}
                                      placeholder="e.g. Left the company"
                                      value={t.reason}
                                      onChange={e => setTermActions(prev => ({ ...prev, [d.id]: { ...t, reason: e.target.value } }))}
                                    />
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className={S.modalFooter}>
              {hasUnresolved && (
                <span className="text-[11px] text-amber-700 dark:text-amber-400 mr-auto self-center">
                  ⚠️ {counts.unresolved} row{counts.unresolved === 1 ? '' : 's'} need resolution before commit
                </span>
              )}
              <button onClick={onClose} className={S.btnCancel} disabled={committing}>Cancel</button>
              <button
                onClick={doCommit}
                disabled={committing || hasUnresolved || (toCommit.length === 0 && willTerm === 0)}
                className={S.btnSave}
                title={hasUnresolved ? 'Resolve ambiguous rows before committing' : ''}
              >
                {committing
                  ? 'Committing…'
                  : `Commit ${willInsert} new + ${willUpdate} update${willBackfill > 0 ? ` (${willBackfill} ID backfill)` : ''}${statusChangeSuffix}`}
              </button>
            </div>
          </>
        )}

        {stage === 'done' && commitResult && (
          <>
            <div className={`${S.card} p-4 space-y-2`}>
              <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`}</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <span className="text-gray-500 dark:text-slate-400">New drivers added</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">{commitResult.inserted}</span>
                <span className="text-gray-500 dark:text-slate-400">Existing drivers updated</span>
                <span className="font-mono text-cyan-700 dark:text-cyan-400">{commitResult.updated}</span>
                {commitResult.reactivated > 0 && (
                  <>
                    <span className="text-gray-500 dark:text-slate-400">Re-activated</span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">{commitResult.reactivated}</span>
                  </>
                )}
                {commitResult.terminated > 0 && (
                  <>
                    <span className="text-gray-500 dark:text-slate-400">Terminations processed</span>
                    <span className="font-mono text-red-700 dark:text-red-400">{commitResult.terminated}</span>
                  </>
                )}
                {commitResult.kept_active > 0 && (
                  <>
                    <span className="text-gray-500 dark:text-slate-400">Kept active (false +)</span>
                    <span className="font-mono text-gray-700 dark:text-slate-300">{commitResult.kept_active}</span>
                  </>
                )}
                {commitResult.errors.length > 0 && (
                  <>
                    <span className="text-gray-500 dark:text-slate-400">Errors</span>
                    <span className="font-mono text-red-700 dark:text-red-400">{commitResult.errors.length}</span>
                  </>
                )}
              </div>
              {commitResult.errors.length > 0 && (
                <ul className="mt-2 list-disc ml-5 text-xs text-red-700 dark:text-red-400">
                  {commitResult.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
                  {commitResult.errors.length > 6 && <li>… and {commitResult.errors.length - 6} more</li>}
                </ul>
              )}
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5 text-xs text-gray-500 dark:text-slate-500">
                Next step suggested: re-upload trucks/trailers so driver_id links refresh against the newly imported drivers.
              </div>
            </div>
            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnSave}>Done</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// Renders the match-method pill plus a resolve dropdown for needs-resolution
// rows. Two sub-pills:
//   1. The match-method tag (always visible).
//   2. For id_match / name_backfill — the existing row's name + id so the
//      user can verify the merge target at a glance.
//   3. For possible_duplicate / name_ambiguous — a candidate selector that
//      lets the user pick "Merge into <candidate>" / "Keep separate" / "Skip".
function MatchCell({ row, idx, onResolve }) {
  const m = row.match
  if (!m) return <span className="text-[11px] text-gray-400">—</span>
  const meta = MATCH_PILLS[m.method] || { label: m.method, cls: 'bg-gray-100 text-gray-600' }
  const pill = (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${meta.cls}`}>
      {meta.label}
    </span>
  )

  if (m.method === 'id_match' || m.method === 'name_backfill') {
    return (
      <div className="space-y-0.5">
        {pill}
        <div className="text-[10px] text-gray-500 dark:text-slate-500">
          → {m.existing?.full_name}
          {m.method === 'name_backfill' && row.internal_id && (
            <span className="ml-1 text-emerald-700 dark:text-emerald-400">+ ID {row.internal_id}</span>
          )}
        </div>
      </div>
    )
  }

  if (m.method === 'new') {
    return pill
  }

  // possible_duplicate / name_ambiguous → resolve UI
  const action = row.resolution?.action || ''
  const targetId = row.resolution?.target_id || ''
  return (
    <div className="space-y-1">
      {pill}
      <select
        value={action ? `${action}:${targetId}` : ''}
        onChange={e => {
          const v = e.target.value
          if (!v) { onResolve(idx, null); return }
          if (v === 'keep_separate') { onResolve(idx, { action: 'keep_separate' }); return }
          if (v === 'skip') { onResolve(idx, { action: 'skip' }); return }
          if (v.startsWith('merge_into:')) {
            const id = v.slice('merge_into:'.length)
            onResolve(idx, { action: 'merge_into', target_id: id })
          }
        }}
        className="text-[11px] px-1.5 py-0.5 bg-white dark:bg-slate-800/80 border border-amber-200 dark:border-amber-500/30 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500/40"
      >
        <option value="">— Resolve —</option>
        {(m.candidates || []).map(c => (
          <option key={c.id} value={`merge_into:${c.id}`}>
            Merge → {c.full_name}{c.internal_id ? ` (#${c.internal_id})` : ''}
          </option>
        ))}
        <option value="keep_separate">Keep separate (INSERT new)</option>
        <option value="skip">Skip this row</option>
      </select>
    </div>
  )
}

function SummaryGroup({ title, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function SummaryRow({ icon, label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-600 dark:text-slate-400">{icon} {label}</span>
      <span className="font-mono font-semibold text-gray-900 dark:text-slate-200">{value}</span>
    </div>
  )
}
