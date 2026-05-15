import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { DRIVER_TYPES, DriverTypePill } from '../fleetUtils'
import { parseDriversWorkbook } from './driversParser'
import { commitDriverRows } from './driversCommit'

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
  { key: 'errors',               label: 'Errors' },
]

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
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseErrors, setParseErrors] = useState([])
  const [rows, setRows] = useState([])
  const [possiblyTerminated, setPossiblyTerminated] = useState([])
  const [termActions, setTermActions] = useState({})  // driverId → { action, reason }
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [bulkType, setBulkType] = useState('')

  useEffect(() => {
    if (!open) {
      setStage('pick'); setFileName(''); setParseErrors([]); setRows([])
      setPossiblyTerminated([]); setTermActions({}); setCommitResult(null)
      setFilter('all'); setSearch(''); setSelected(new Set()); setBulkType('')
    }
  }, [open])

  async function handleFile(file) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setParseErrors([`File is larger than 5 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`]); return
    }
    if (!/\.xlsx?$/i.test(file.name)) {
      setParseErrors([`File must be .xlsx or .xls — got "${file.name}".`]); return
    }
    setFileName(file.name); setParsing(true); setParseErrors([])
    try {
      const buf = await file.arrayBuffer()
      const { rows: parsed, errors } = parseDriversWorkbook(buf)

      // Dedup lookup (per row: is this internal_id already in DB?)
      const internalIds = parsed.map(p => p.internal_id).filter(Boolean)
      const { data: existing } = internalIds.length
        ? await supabase.from('drivers').select('internal_id, current_status').in('internal_id', internalIds)
        : { data: [] }
      const existingMap = new Map((existing || []).map(e => [e.internal_id, e]))

      const preview = parsed.map(r => ({
        ...r,
        is_duplicate: existingMap.has(r.internal_id),
        existing_status: existingMap.get(r.internal_id)?.current_status || null,
        skip: false,
      }))
      setRows(preview)
      setParseErrors(errors)

      // Termination detection: currently-active drivers whose internal_id is
      // NOT in the upload. First-ever-upload (no active drivers in DB) → empty.
      const uploadedIdSet = new Set(internalIds)
      const { data: activeInDB } = await supabase
        .from('drivers')
        .select('id, internal_id, full_name, last_seen_in_upload_at, current_status')
        .eq('current_status', 'active')
      const missing = (activeInDB || []).filter(d => d.internal_id && !uploadedIdSet.has(d.internal_id))
      setPossiblyTerminated(missing)
      // Default all to keep_active so nothing is auto-terminated.
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

  function onPick(e) { handleFile(e.target.files?.[0]) }
  function onDrop(e) { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }

  const counts = useMemo(() => {
    const c = { total: rows.length, new: 0, duplicate: 0, errors: 0, by_type: { 'Owner Operator': 0, 'Leased Owner-Op': 0, 'Contract Driver': 0, 'Company Driver': 0, unrecognized: 0 } }
    for (const r of rows) {
      if (r.is_duplicate) c.duplicate++; else c.new++
      if (r.driver_type) c.by_type[r.driver_type] = (c.by_type[r.driver_type] || 0) + 1
      else if (r.driver_type_raw) c.by_type.unrecognized++
      if (r.driver_type_raw && !r.driver_type) c.errors++
      if (r.compensation_raw && !r.compensation_type) c.errors++
    }
    return c
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'errors') {
        if (!(r.compensation_raw && !r.compensation_type) && !(r.driver_type_raw && !r.driver_type)) return false
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
  const willInsert = toCommit.filter(r => !r.is_duplicate).length
  const willUpdate = toCommit.filter(r => r.is_duplicate).length
  const willTerm = Object.values(termActions).filter(t => t.action === 'terminate' || t.action === 'inactive' || t.action === 'on_leave').length

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
    <Modal open={open} onClose={onClose} title={title} size="xl">
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
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={onPick} className="hidden" />
            <div className="text-4xl mb-2">📂</div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
              {parsing ? 'Parsing…' : 'Drop .xlsx file here or click to browse'}
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
                {fileName} <span className="font-normal text-gray-500 dark:text-slate-500">· {counts.total} rows parsed</span>
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <SummaryGroup title="Classification">
                  <SummaryRow icon="🟢" label="Owner Operator" value={counts.by_type['Owner Operator']} />
                  <SummaryRow icon="🔵" label="Leased Owner-Op" value={counts.by_type['Leased Owner-Op']} />
                  <SummaryRow icon="🟡" label="Contract Driver" value={counts.by_type['Contract Driver']} />
                  <SummaryRow icon="🟣" label="Company Driver" value={counts.by_type['Company Driver']} />
                  {counts.by_type.unrecognized > 0 && <SummaryRow icon="⚠️" label="Unrecognized type" value={counts.by_type.unrecognized} />}
                </SummaryGroup>
                <SummaryGroup title="Dedup">
                  <SummaryRow icon="🆕" label="New drivers" value={counts.new} />
                  <SummaryRow icon="🔁" label="Already in DB" value={counts.duplicate} />
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
                      <th className={S.th}>Driver Type</th>
                      <th className={S.th}>Carrier</th>
                      <th className={S.th}>Truck / Trailer</th>
                      <th className={S.th}>Compensation</th>
                      <th className={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No rows match this filter.</td></tr>
                    ) : filteredRows.map(row => {
                      const idx = rows.indexOf(row)
                      const isSel = selected.has(row._rowNum)
                      return (
                        <tr key={row._rowNum} className={`${S.tableRow} ${row.skip ? 'opacity-40' : ''}`}>
                          <td className={S.td}>
                            <input type="checkbox" checked={isSel} onChange={() => toggleSelect(row._rowNum)} className="rounded" />
                          </td>
                          <td className={`${S.td} font-mono text-xs text-gray-500 dark:text-slate-400`}>{row.internal_id}</td>
                          <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{row.full_name}</td>
                          <td className={S.td}>
                            <Select
                              value={row.driver_type || ''}
                              onChange={e => setRowType(idx, e.target.value || null)}
                              className="text-xs"
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
                            {row.skip
                              ? <button onClick={() => setRowSkip(idx, false)} className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline">Include</button>
                              : row.is_duplicate
                                ? <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300">Update</span>
                                : <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">New</span>}
                            {!row.skip && (
                              <button onClick={() => setRowSkip(idx, true)} className="ml-2 text-[11px] text-gray-400 hover:text-red-500" title="Skip this row">×</button>
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
              <div className={`${S.card} p-4`}>
                <div className="mb-3">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">⚠️ Possibly Terminated Drivers</p>
                  <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">
                    These drivers were active in BUDDY but are missing from this upload. Review each — default is "Keep Active" so nothing terminates by accident.
                  </p>
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

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel} disabled={committing}>Cancel</button>
              <button onClick={doCommit} disabled={committing || (toCommit.length === 0 && willTerm === 0)} className={S.btnSave}>
                {committing
                  ? 'Committing…'
                  : `Commit ${willInsert} new + ${willUpdate} update${willTerm > 0 ? ` + ${willTerm} status change${willTerm === 1 ? '' : 's'}` : ''}`}
              </button>
            </div>
          </>
        )}

        {stage === 'done' && commitResult && (
          <>
            <div className={`${S.card} p-4 space-y-2`}>
              <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{fileName}</p>
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
