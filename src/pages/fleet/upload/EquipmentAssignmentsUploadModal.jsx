// Upload modal for the TMS Equipment Assignments export. Shared between
// trucks and trailers — the caller passes equipmentType so the modal only
// hydrates the relevant lookup table and shows the right label.
//
// Stages mirror the other Fleet uploads (pick → preview → done) but the
// preview is read-only: there's no per-row classification override, just a
// summary of what'll be inserted / closed / unchanged. The commit upserts
// on the natural key (equipment_type, tms_equipment_id, tms_driver_id,
// start_date) and then calls resolve_current_equipment_drivers() to
// propagate the open assignments to trucks/trailers.driver_id.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import { parseEquipmentAssignmentsWorkbook } from './equipmentAssignmentsParser'
import {
  buildUnitIndex,
  buildDriverByInternalIdIndex,
  buildExistingAssignmentsIndex,
  annotateAllRows,
  summarizeCounts,
} from './equipmentAssignmentsMatcher'
import { commitEquipmentAssignmentRows } from './equipmentAssignmentsCommit'

const MAX_FILE_BYTES = 5 * 1024 * 1024

const ACTION_FILTERS = [
  { key: 'all',                  label: 'All' },
  { key: 'new',                  label: '🆕 New' },
  { key: 'closed',               label: '🔒 Closed' },
  { key: 'updated',              label: '✏️ Updated' },
  { key: 'unchanged',            label: '· Unchanged' },
  { key: 'unmatched_equipment',  label: '⚠️ Unmatched unit' },
  { key: 'unmatched_driver',     label: '⚠️ Unmatched driver' },
]

function fmtDateOrOpen(iso) {
  if (!iso) return <span className="italic text-emerald-600 dark:text-emerald-400">Open</span>
  return iso
}

export default function EquipmentAssignmentsUploadModal({ open, equipmentType, onClose, onCommitted }) {
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const isTrailer = equipmentType === 'trailer'
  const unitNoun = isTrailer ? 'trailer' : 'truck'

  const [stage, setStage] = useState('pick')
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseErrors, setParseErrors] = useState([])
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('all')
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState(null)

  useEffect(() => {
    if (!open) {
      setStage('pick'); setFileName(''); setParseErrors([]); setRows([])
      setFilter('all'); setCommitResult(null); setCommitting(false); setParsing(false)
    }
  }, [open])

  async function handleFile(file) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setParseErrors([`File is larger than 5 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`])
      return
    }
    if (!/\.xlsx?$/i.test(file.name)) {
      setParseErrors([`File must be .xlsx or .xls — got "${file.name}".`])
      return
    }
    setFileName(file.name)
    setParsing(true); setParseErrors([])
    try {
      const buf = await file.arrayBuffer()
      const { rows: parsed, errors } = parseEquipmentAssignmentsWorkbook(buf, equipmentType)

      // Hydrate lookup sets. Existing assignments narrowed to the equipment
      // type so we don't pull the whole table; the natural key has type
      // baked in already but a smaller fetch is cheaper.
      const [{ data: units }, { data: drivers }, { data: existing }] = await Promise.all([
        supabase.from(isTrailer ? 'trailers' : 'trucks').select('id, unit_number'),
        supabase.from('drivers').select('id, internal_id'),
        supabase.from('equipment_assignments')
          .select('id, equipment_type, truck_id, trailer_id, tms_equipment_id, tms_driver_id, driver_id, start_date, end_date')
          .eq('equipment_type', equipmentType),
      ])
      const annotated = annotateAllRows(parsed, {
        unitsByKey: buildUnitIndex(units),
        driversByInternalId: buildDriverByInternalIdIndex(drivers),
        existingByNatKey: buildExistingAssignmentsIndex(existing),
      })
      setRows(annotated)
      setParseErrors(errors)
      setStage('preview')
    } catch (e) {
      console.error('[EquipmentAssignmentsUploadModal] parse failed', e)
      setParseErrors([`Parse failed: ${e.message || e}`])
    } finally {
      setParsing(false)
    }
  }

  function onPickFiles(e) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }
  function onDrop(e) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleFile(f)
  }
  function onDragOver(e) { e.preventDefault() }

  const counts = useMemo(() => summarizeCounts(rows), [rows])

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'unmatched_equipment') return rows.filter(r => !r.truck_id && !r.trailer_id)
    if (filter === 'unmatched_driver')    return rows.filter(r => !r.driver_id && r.tms_driver_id)
    return rows.filter(r => r.action === filter)
  }, [rows, filter])

  async function doCommit() {
    setCommitting(true)
    const result = await commitEquipmentAssignmentRows({ rows, userId: user?.id || null })
    setCommitResult(result)
    setCommitting(false)
    setStage('done')
    onCommitted?.()
  }

  const title = stage === 'done'
    ? '✅ Upload Complete'
    : `Upload ${isTrailer ? 'Trailer' : 'Truck'} Assignments Excel`

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
              className="hidden"
            />
            <div className="text-4xl mb-2">📂</div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
              {parsing ? 'Parsing…' : 'Drop .xlsx file here or click to browse'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-2">
              Expected columns: Equipment ID, Equipment Name, Driver Full Name, Driver ID, Start Date, End Date, Created By
            </p>
          </div>
        )}

        {stage === 'preview' && (
          <>
            <div className={`${S.card} p-4 space-y-3`}>
              <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
                {fileName} <span className="font-normal text-gray-500 dark:text-slate-500">· {counts.total} rows parsed · {unitNoun}</span>
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <SummaryGroup title="Outcome">
                  <SummaryRow icon="🆕" label="New"        value={counts.new} />
                  <SummaryRow icon="🔒" label="Closed"     value={counts.closed} />
                  <SummaryRow icon="✏️" label="Updated"    value={counts.updated} />
                  <SummaryRow icon="·"  label="Unchanged"  value={counts.unchanged} />
                </SummaryGroup>
                <SummaryGroup title="Matching">
                  <SummaryRow icon="⚠️" label={`Unmatched ${unitNoun}`} value={counts.unmatched_equipment} />
                  <SummaryRow icon="⚠️" label="Unmatched driver"        value={counts.unmatched_driver} />
                </SummaryGroup>
                <SummaryGroup title="Validation">
                  <SummaryRow icon={parseErrors.length === 0 ? '✓' : '⚠️'} label="Parse warnings" value={parseErrors.length} />
                </SummaryGroup>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2">
              {ACTION_FILTERS.map(f => {
                const count =
                  f.key === 'all'                  ? counts.total
                  : f.key === 'unmatched_equipment' ? counts.unmatched_equipment
                  : f.key === 'unmatched_driver'    ? counts.unmatched_driver
                  : (counts[f.key] || 0)
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
            </div>

            <div className={`${S.card} overflow-hidden`}>
              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className={`${S.tableHead} sticky top-0 z-10`}>
                    <tr>
                      <th className={S.th}>Unit (raw)</th>
                      <th className={S.th}>Match</th>
                      <th className={S.th}>Driver (raw)</th>
                      <th className={S.th}>Driver match</th>
                      <th className={S.th}>Start</th>
                      <th className={S.th}>End</th>
                      <th className={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 dark:text-slate-600 text-sm">No rows match this filter.</td></tr>
                    ) : filteredRows.map((row, i) => (
                      <tr key={`${row._rowNum}-${i}`} className={S.tableRow}>
                        <td className={`${S.td} font-medium text-gray-900 dark:text-slate-200`}>{row.equipment_name_raw}</td>
                        <td className={`${S.td} text-xs`}>
                          {row.matched_unit
                            ? <span className="text-emerald-700 dark:text-emerald-400" title={row.matched_unit.unit_number}>✓ {row.matched_unit.unit_number}</span>
                            : <span className="text-amber-700 dark:text-amber-400">?</span>}
                        </td>
                        <td className={`${S.td} text-gray-600 dark:text-slate-400 text-xs`}>{row.driver_name_raw || '—'}</td>
                        <td className={`${S.td} text-xs`}>
                          {row.matched_driver
                            ? <span className="text-emerald-700 dark:text-emerald-400">✓ #{row.matched_driver.internal_id}</span>
                            : row.tms_driver_id
                              ? <span className="text-amber-700 dark:text-amber-400">? #{row.tms_driver_id}</span>
                              : <span className="text-gray-400">—</span>}
                        </td>
                        <td className={`${S.td} text-xs whitespace-nowrap`}>{row.start_date}</td>
                        <td className={`${S.td} text-xs whitespace-nowrap`}>{fmtDateOrOpen(row.end_date)}</td>
                        <td className={S.td}><ActionPill action={row.action} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnCancel} disabled={committing}>Cancel</button>
              <button onClick={doCommit} disabled={committing || rows.length === 0} className={S.btnSave}>
                {committing
                  ? 'Committing…'
                  : `Commit ${rows.length} row${rows.length === 1 ? '' : 's'} (${counts.new} new · ${counts.closed} closed)`}
              </button>
            </div>
          </>
        )}

        {stage === 'done' && commitResult && (
          <>
            <div className={`${S.card} p-4 space-y-2`}>
              <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{fileName}</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <span className="text-gray-500 dark:text-slate-400">Upserted</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">{commitResult.upserted}</span>
                <span className="text-gray-500 dark:text-slate-400">New</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">{commitResult.new}</span>
                <span className="text-gray-500 dark:text-slate-400">Closed</span>
                <span className="font-mono text-cyan-700 dark:text-cyan-400">{commitResult.closed}</span>
                <span className="text-gray-500 dark:text-slate-400">Updated</span>
                <span className="font-mono text-cyan-700 dark:text-cyan-400">{commitResult.updated}</span>
                <span className="text-gray-500 dark:text-slate-400">Unchanged</span>
                <span className="font-mono text-gray-700 dark:text-slate-300">{commitResult.unchanged}</span>
                <span className="text-gray-500 dark:text-slate-400">Resolver</span>
                <span className={`font-mono ${commitResult.resolver_ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {commitResult.resolver_ok ? 'ran ✓' : 'skipped'}
                </span>
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
            <div className={S.modalFooter}>
              <button onClick={onClose} className={S.btnSave}>Done</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function ActionPill({ action }) {
  const map = {
    new:       { label: 'New',       cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
    closed:    { label: 'Closed',    cls: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400' },
    updated:   { label: 'Updated',   cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300' },
    unchanged: { label: 'Unchanged', cls: 'bg-gray-100 dark:bg-white/[0.03] text-gray-600 dark:text-slate-400' },
  }
  const meta = map[action] || map.unchanged
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
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
