import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import Select from '../../../components/Select'
import { OWNERSHIP_STAGES, STAGE_LABELS, StagePill } from '../fleetUtils'
import { parseFleetWorkbook } from './fleetParser'
import { classifyOwnership, loadKnownLessors, loadActiveLoanEntities } from './fleetClassifier'
import { commitFleetRows } from './fleetCommit'

// Three stages:
//   1. 'pick'    — drag-drop or click-to-browse
//   2. 'preview' — parsed rows with classification + per-row override
//   3. 'done'    — success summary

const STAGE_FILTERS = [
  { key: 'all',                          label: 'All' },
  { key: 'company_owned',                label: '🏢 Owned' },
  { key: 'company_leased',               label: '🔄 Leased' },
  { key: 'driver_owned',                 label: '👤 Driver' },
  { key: 'unclassified',                 label: '⚠️ Unclassified' },
  { key: 'duplicates',                   label: '🔁 Duplicates' },
  { key: 'unit_conflicts',               label: '⚠️ Unit ID conflicts' },
]

const MAX_FILE_BYTES = 5 * 1024 * 1024

export default function FleetUploadModal({ kind, open, onClose, onCommitted }) {
  const { user } = useAuth()
  const isTrailer = kind === 'trailer'
  const fileInputRef = useRef(null)

  const [stage, setStage] = useState('pick') // pick | preview | done
  const [fileNames, setFileNames] = useState([]) // array of file names
  const [parsing, setParsing] = useState(false)
  const [parseErrors, setParseErrors] = useState([])
  const [rows, setRows] = useState([])
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [bulkStage, setBulkStage] = useState('')

  useEffect(() => {
    if (!open) {
      setStage('pick'); setFileNames([]); setParseErrors([]); setRows([]); setCommitResult(null)
      setFilter('all'); setSearch(''); setSelected(new Set()); setBulkStage('')
    }
  }, [open])

  // Extract header keys from a parsed workbook, normalized for comparison
  function getHeaderSignature(arrayBuffer) {
    try {
      const XLSX = require('xlsx')
      const wb = XLSX.read(arrayBuffer, { type: 'array' })
      const sheetName = wb.SheetNames[0]
      const sheet = wb.Sheets[sheetName]
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
      if (raw.length === 0) return null
      const headerKeys = Object.keys(raw[0])
        .map(k => k.trim().toLowerCase())
        .sort()
      return headerKeys.join('|')
    } catch (e) {
      return null
    }
  }

  async function handleFiles(files) {
    if (!files || files.length === 0) return

    // Validate all files first
    const fileArray = Array.from(files)
    const fileErrors = []
    for (const file of fileArray) {
      if (file.size > MAX_FILE_BYTES) {
        fileErrors.push(`${file.name}: File is larger than 5 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`)
      }
      if (!/\.xlsx?$/i.test(file.name)) {
        fileErrors.push(`${file.name}: File must be .xlsx or .xls.`)
      }
    }
    if (fileErrors.length > 0) {
      setParseErrors(fileErrors)
      return
    }

    setFileNames(fileArray.map(f => f.name))
    setParsing(true)
    setParseErrors([])

    try {
      // Load shared data once
      const loanEntities = await loadActiveLoanEntities()
      const [{ data: driversData }, knownLessors] = await Promise.all([
        supabase.from('drivers').select('id, internal_id, full_name'),
        loadKnownLessors(loanEntities),
      ])
      const allDrivers = driversData || []

      // Parse all files and validate headers match
      const parseResults = []
      let firstSignature = null
      const headerMismatches = []

      for (const file of fileArray) {
        const buf = await file.arrayBuffer()
        const sig = getHeaderSignature(buf)
        if (!sig) {
          headerMismatches.push(`${file.name}: Could not extract headers.`)
          continue
        }
        if (firstSignature === null) {
          firstSignature = sig
        } else if (sig !== firstSignature) {
          headerMismatches.push(`${file.name}: Header columns don't match the first file.`)
          continue
        }
        const { rows: parsed, errors } = parseFleetWorkbook(buf, kind, allDrivers)
        parseResults.push({
          fileName: file.name,
          rows: parsed.map(r => ({ ...r, _sourceFile: file.name })),
          errors,
        })
      }

      // If any files had header mismatches, surface them and stop
      if (headerMismatches.length > 0) {
        setParseErrors(headerMismatches)
        setFileNames([])
        setParsing(false)
        return
      }

      // Combine all rows from all files
      const allErrors = []
      const allRows = []
      for (const result of parseResults) {
        allRows.push(...result.rows)
        allErrors.push(...result.errors.map(e => `${result.fileName}: ${e}`))
      }

      // Dedupe by Unit ID# within the combined set, tagging conflicts
      const seenByUnitId = new Map() // unit_number → { rows, conflict }
      for (const row of allRows) {
        const key = row.unit_number
        if (!seenByUnitId.has(key)) {
          seenByUnitId.set(key, { rows: [], conflict: false })
        }
        seenByUnitId.get(key).rows.push(row)
      }

      // Mark duplicates as conflicts (needs resolution)
      for (const { rows: unitRows, conflict } of seenByUnitId.values()) {
        if (unitRows.length > 1) {
          for (const row of unitRows) {
            row._unitIdConflict = true
            row._conflictFiles = unitRows.map(r => r._sourceFile)
          }
        }
      }

      // VIN dedup lookup against the live table (for all rows combined)
      const vins = allRows.map(p => p.vin).filter(Boolean)
      const { data: existing } = vins.length
        ? await supabase
            .from(isTrailer ? 'trailers' : 'trucks')
            .select('vin, ownership_stage')
            .in('vin', vins)
        : { data: [] }
      const existingMap = new Map((existing || []).map(e => [e.vin, e]))

      const classified = allRows.map(row => {
        const cls = classifyOwnership(row.equipment_owner_raw, row.driver_id, knownLessors, allDrivers, loanEntities)
        const dupOf = existingMap.get(row.vin) || null
        return {
          ...row,
          ownership_stage: cls.stage,
          classification_reason: cls.reason,
          classification_confidence: cls.confidence,
          overrode_stage: false,
          existing_stage: dupOf?.ownership_stage || null,
          is_duplicate: !!dupOf,
          skip: false,
        }
      })

      setRows(classified)
      setParseErrors(allErrors)
      setStage('preview')
    } catch (e) {
      setParseErrors([`Failed to parse workbooks: ${e.message || e}`])
      setFileNames([])
    } finally {
      setParsing(false)
    }
  }

  function onPickFiles(e) { handleFiles(e.target.files) }
  function onDrop(e) { e.preventDefault(); handleFiles(e.dataTransfer.files) }
  function onDragOver(e) { e.preventDefault() }

  // ── Preview derived state ─────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { total: rows.length, new: 0, duplicate: 0, driver_linked: 0, unit_conflicts: 0, by_stage: { company_owned: 0, company_leased: 0, driver_owned: 0, unclassified: 0 } }
    for (const r of rows) {
      if (r.is_duplicate) c.duplicate++; else c.new++
      if (r.driver_id) c.driver_linked++
      if (r._unitIdConflict) c.unit_conflicts++
      c.by_stage[r.ownership_stage] = (c.by_stage[r.ownership_stage] || 0) + 1
    }
    return c
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'duplicates' && !r.is_duplicate) return false
      if (filter === 'unit_conflicts' && !r._unitIdConflict) return false
      if (filter !== 'all' && filter !== 'duplicates' && filter !== 'unit_conflicts' && r.ownership_stage !== filter) return false
      if (!q) return true
      return (r.unit_number || '').toLowerCase().includes(q)
        || (r.vin || '').toLowerCase().includes(q)
        || (r.equipment_owner_raw || '').toLowerCase().includes(q)
        || (r.driver_assignment_raw || '').toLowerCase().includes(q)
    })
  }, [rows, filter, search])

  function setRowStage(idx, stageValue) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ownership_stage: stageValue, overrode_stage: true } : r))
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

  function applyBulkReclassify() {
    if (!bulkStage || selected.size === 0) return
    setRows(prev => prev.map(r =>
      selected.has(r._rowNum) ? { ...r, ownership_stage: bulkStage, overrode_stage: true } : r
    ))
    setSelected(new Set())
    setBulkStage('')
  }

  function applyBulkSkip(skip) {
    if (selected.size === 0) return
    setRows(prev => prev.map(r => selected.has(r._rowNum) ? { ...r, skip } : r))
    setSelected(new Set())
  }

  const toCommit = rows.filter(r => !r.skip)
  const willInsert = toCommit.filter(r => !r.is_duplicate).length
  const willUpdate = toCommit.filter(r => r.is_duplicate).length

  async function doCommit() {
    setCommitting(true)
    const result = await commitFleetRows({ kind, rows: toCommit, userId: user?.id })
    setCommitResult(result)
    setCommitting(false)
    setStage('done')
    onCommitted?.()
  }

  // ── Render ────────────────────────────────────────────────────────
  const title = stage === 'done'
    ? '✅ Upload Complete'
    : `Upload ${isTrailer ? 'Trailers' : 'Trucks'} Excel`

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
            onDragOver={onDragOver}
            className="border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-2xl p-12 text-center cursor-pointer hover:border-orange-400 dark:hover:border-orange-500/40 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={onPickFiles}
              multiple
              className="hidden"
            />
            <div className="text-4xl mb-2">📂</div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
              {parsing ? 'Parsing…' : `Drop .xlsx files here or click to browse`}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-2">
              {isTrailer
                ? 'Expected columns: Unit ID, Vin, Status, Equipment Owner, Driver, Make, Year, Trailer Type, License Plate, Annual Inspection Expiration Date'
                : 'Expected columns: Unit ID#, Vin, Status, Equipment Owner, Driver, Year, Make, Model, License plate (State), Transponder'}
            </p>
          </div>
        )}

        {stage === 'preview' && (
          <>
            {/* Summary header */}
            <div className={`${S.card} p-4 space-y-3`}>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                  {fileNames.length === 1 ? (
                    <>
                      {fileNames[0]} <span className="font-normal text-gray-500 dark:text-slate-500">· {counts.total} rows parsed</span>
                    </>
                  ) : (
                    <>
                      {fileNames.map(f => `${isTrailer ? 'Trailer' : 'Truck'} file`).join(', ')} ({fileNames.length} files) <span className="font-normal text-gray-500 dark:text-slate-500">· {counts.total} rows parsed</span>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <SummaryGroup title="Classification">
                  <SummaryRow icon="🏢" label="Company Owned" value={counts.by_stage.company_owned || 0} />
                  <SummaryRow icon="🔄" label="Company Leased" value={counts.by_stage.company_leased || 0} />
                  <SummaryRow icon="👤" label="Driver Owned" value={counts.by_stage.driver_owned || 0} />
                  <SummaryRow icon="⚠️" label="Unclassified" value={counts.by_stage.unclassified || 0} />
                </SummaryGroup>
                <SummaryGroup title="Dedup">
                  <SummaryRow icon="🆕" label="New records" value={counts.new} />
                  <SummaryRow icon="🔁" label="VIN already exists" value={counts.duplicate} />
                </SummaryGroup>
                <SummaryGroup title="Driver Matching">
                  <SummaryRow icon="✅" label="Linked to driver" value={counts.driver_linked} />
                  <SummaryRow icon="❓" label="No driver match" value={counts.total - counts.driver_linked} />
                </SummaryGroup>
                <SummaryGroup title="Validation">
                  <SummaryRow icon={parseErrors.length === 0 ? '✓' : '⚠️'} label="Parse warnings" value={parseErrors.length} />
                </SummaryGroup>
              </div>
            </div>

            {/* Filter + search + bulk action */}
            <div className="flex items-center flex-wrap gap-2">
              {STAGE_FILTERS.map(f => {
                const count = f.key === 'all' ? counts.total
                  : f.key === 'duplicates' ? counts.duplicate
                  : f.key === 'unit_conflicts' ? counts.unit_conflicts
                  : (counts.by_stage[f.key] || 0)
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
                placeholder="Search unit, VIN, owner, driver…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {selected.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 text-xs">
                <span className="font-medium text-cyan-700 dark:text-cyan-400">{selected.size} selected</span>
                <span className="text-cyan-600 dark:text-cyan-400/70">Reclassify as:</span>
                <Select value={bulkStage} onChange={e => setBulkStage(e.target.value)} className="text-xs">
                  <option value="">—</option>
                  {OWNERSHIP_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
                <button onClick={applyBulkReclassify} disabled={!bulkStage} className="px-2 py-1 text-xs font-medium text-cyan-700 dark:text-cyan-400 hover:underline disabled:opacity-50">Apply</button>
                <span className="text-cyan-300 dark:text-cyan-600">·</span>
                <button onClick={() => applyBulkSkip(true)} className="px-2 py-1 text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">Skip selected</button>
                <button onClick={() => applyBulkSkip(false)} className="px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline">Include selected</button>
                <button onClick={() => setSelected(new Set())} className="px-2 py-1 text-xs text-gray-500 hover:underline ml-auto">Clear</button>
              </div>
            )}

            {/* Table */}
            <div className={`${S.card} overflow-hidden`}>
              <div className="overflow-x-auto max-h-[420px]">
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
                      <th className={S.th}>Unit #</th>
                      <th className={S.th}>VIN</th>
                      <th className={S.th}>Owner (raw)</th>
                      <th className={S.th}>Auto-Class · Why</th>
                      <th
                        className={S.th}
                        title="Manually reclassify this row's ownership stage, overriding the auto-classification. Leave as-is to accept the AUTO-CLASS decision."
                      >
                        Override
                      </th>
                      <th className={S.th}>Driver</th>
                      <th className={S.th}>Status</th>
                      {fileNames.length > 1 && <th className={S.th} title="Source file">File</th>}
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
                          <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{row.unit_number}</td>
                          <td className={`${S.td} font-mono text-xs`}>
                            {row.is_duplicate
                              ? <span className="inline-block px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300" title="VIN already exists — will update">{row.vin}</span>
                              : <span className="text-gray-500 dark:text-slate-400">{row.vin}</span>}
                          </td>
                          <td className={`${S.td} text-xs text-gray-600 dark:text-slate-400 max-w-[200px] truncate`} title={row.equipment_owner_raw || ''}>
                            {row.equipment_owner_raw || <span className="italic text-gray-400">—</span>}
                          </td>
                          <td className={S.td}>
                            <div className="flex flex-col gap-0.5">
                              <StagePill stage={row.ownership_stage} />
                              <span className="text-[10px] text-gray-500 dark:text-slate-500" title={row.classification_reason}>
                                {row.classification_reason}
                              </span>
                            </div>
                          </td>
                          <td className={S.td}>
                            <Select
                              value={row.ownership_stage}
                              onChange={e => setRowStage(idx, e.target.value)}
                              className="text-xs min-w-[240px]"
                            >
                              {OWNERSHIP_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </Select>
                          </td>
                          <td className={`${S.td} text-xs text-gray-600 dark:text-slate-400`}>
                            {row.driver_assignment_raw
                              ? (row.driver_id
                                  ? <span className="text-emerald-700 dark:text-emerald-400" title={`Matched by ${row.driver_match_kind}`}>✓ {row.driver_assignment_raw}</span>
                                  : <span className="text-amber-700 dark:text-amber-400" title="No driver match — raw value preserved">? {row.driver_assignment_raw}</span>)
                              : <span className="text-gray-400">—</span>}
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
                          {fileNames.length > 1 && (
                            <td className={`${S.td} text-xs text-gray-600 dark:text-slate-400`} title={row._sourceFile}>
                              {row._sourceFile ? row._sourceFile.replace(/\.xlsx?$/i, '') : '—'}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel} disabled={committing}>Cancel</button>
              <button onClick={doCommit} disabled={committing || toCommit.length === 0} className={S.btnSave}>
                {committing
                  ? 'Committing…'
                  : `Commit ${toCommit.length} row${toCommit.length === 1 ? '' : 's'} (${willInsert} new · ${willUpdate} update)`}
              </button>
            </div>
          </>
        )}

        {stage === 'done' && commitResult && (
          <>
            <div className={`${S.card} p-4 space-y-2`}>
              <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
                {fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`}
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <span className="text-gray-500 dark:text-slate-400">Inserted</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">{commitResult.inserted}</span>
                <span className="text-gray-500 dark:text-slate-400">Updated</span>
                <span className="font-mono text-cyan-700 dark:text-cyan-400">{commitResult.updated}</span>
                <span className="text-gray-500 dark:text-slate-400">Skipped</span>
                <span className="font-mono text-gray-700 dark:text-slate-300">{rows.filter(r => r.skip).length}</span>
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
            </div>
            {counts.by_stage.unclassified > 0 && (
              <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-sm text-amber-800 dark:text-amber-300">
                ⚠️ {counts.by_stage.unclassified} {isTrailer ? 'trailer' : 'truck'}{counts.by_stage.unclassified === 1 ? '' : 's'} need classification review.
              </div>
            )}
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
