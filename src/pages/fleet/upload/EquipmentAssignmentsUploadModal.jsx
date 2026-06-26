// Upload modal for the TMS Equipment Assignments export. Shared between
// trucks and trailers — the caller passes equipmentType so the modal shows
// the right label and the preview/apply route through the correct unit type.
//
// Review-before-apply flow (mirrors Loads Import): parse → preview (read-only)
// → approve per item → apply only the approved changes. NOTHING is written
// during preview. The two backing RPCs are already deployed:
//   - preview_assignment_import(p_rows)   → categorized diff, writes nothing
//   - apply_assignment_import(p_decisions) → writes approved items (source
//     'tms_upload' via set_unit_current_driver), returns { applied }
//
// TMS is the default truth (new/reassignment default to apply), but a current
// driver set by a *manual* fix is protected (conflict_manual defaults to keep
// system; the user must explicitly choose "Take TMS").

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import Modal from '../../../components/Modal'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { parseEquipmentAssignmentsWorkbook } from './equipmentAssignmentsParser'

const MAX_FILE_BYTES = 5 * 1024 * 1024

// Parsed file rows → normalized preview input. We send EVERY row (open and
// closed): the preview RPC reads end_date and categorizes each row — closed
// rows surface as `ended` (current assignment closes) or `end_date_fix` (a
// past spell's end date is corrected). end_date is YYYY-MM-DD, '' when blank
// (the RPC treats blank as open).
function buildPreviewRows(parsed) {
  return parsed.map(r => ({
    equipment_type: r.equipment_type,
    unit: r.equipment_name_raw,
    driver_code: r.tms_driver_id || null,   // TMS "Driver ID" = drivers.internal_id
    driver_name: r.driver_name_raw || null, // fallback match
    start_date: r.start_date || null,
    end_date: r.end_date || '',
  }))
}

// Driver-setting categories (apply via set_unit_current_driver through
// apply_assignment_import). End-date categories apply via apply_assignment_end.
const ACTIONABLE = new Set(['new', 'reassignment', 'conflict_manual'])
const END_ACTIONS = new Set(['ended', 'end_date_fix'])

export default function EquipmentAssignmentsUploadModal({ open, equipmentType, onClose, onCommitted }) {
  const fileInputRef = useRef(null)
  const isTrailer = equipmentType === 'trailer'
  const unitNoun = isTrailer ? 'trailer' : 'truck'

  const [stage, setStage] = useState('pick') // pick | review | done
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseErrors, setParseErrors] = useState([])
  const [previewError, setPreviewError] = useState('')
  const [preview, setPreview] = useState([])           // rows from preview RPC
  const [approved, setApproved] = useState(() => new Set()) // approved row_index set
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null) // { applied }

  useEffect(() => {
    if (!open) {
      setStage('pick'); setFileName(''); setParsing(false)
      setParseErrors([]); setPreviewError(''); setPreview([])
      setApproved(new Set()); setApplying(false); setApplyResult(null)
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
    setFileName(file.name)
    setParsing(true); setParseErrors([]); setPreviewError('')
    try {
      const buf = await file.arrayBuffer()
      const { rows: parsed, errors } = parseEquipmentAssignmentsWorkbook(buf, equipmentType)
      setParseErrors(errors)

      const pRows = buildPreviewRows(parsed)
      // Read-only preview — writes nothing.
      const { data, error } = await supabase.rpc('preview_assignment_import', { p_rows: pRows })
      if (error) throw error
      const rows = data || []
      setPreview(rows)
      // Default approvals: TMS wins for new + reassignment, and the end-date
      // categories (ended / end_date_fix) default on too; manual conflicts
      // start OFF (keep the system value) until explicitly chosen.
      setApproved(new Set(rows.filter(r => r.category === 'new' || r.category === 'reassignment' || END_ACTIONS.has(r.category)).map(r => r.row_index)))
      setStage('review')
    } catch (e) {
      console.error('[EquipmentAssignmentsUploadModal] preview failed', e)
      setPreviewError(e.message || String(e))
    } finally {
      setParsing(false)
    }
  }

  function onPickFiles(e) { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }
  function onDrop(e) { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }
  function onDragOver(e) { e.preventDefault() }

  const groups = useMemo(() => {
    const g = { new: [], reassignment: [], conflict_manual: [], ended: [], end_date_fix: [], unresolved: [], no_change: 0 }
    for (const r of preview) {
      if (r.category === 'no_change') g.no_change++
      else if (g[r.category]) g[r.category].push(r)
      else if (r.category === 'unresolved') g.unresolved.push(r)
    }
    return g
  }, [preview])

  function toggle(rowIndex) {
    setApproved(prev => {
      const next = new Set(prev)
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex)
      return next
    })
  }

  // Driver-set decisions = approved actionable rows that resolved to a unit +
  // driver (unresolved never reach here). driver_id is the TMS-matched uuid.
  const decisions = useMemo(() => preview
    .filter(r => ACTIONABLE.has(r.category) && approved.has(r.row_index) && r.unit_id && r.tms_driver_id)
    .map(r => ({
      action: 'apply',
      equipment_type: r.equipment_type,
      unit_id: r.unit_id,
      driver_id: r.tms_driver_id,
      effective: r.start_date,
    })), [preview, approved])

  // End-date decisions = approved ended / end_date_fix rows that carry a target
  // assignment + a date. Applied one-by-one via apply_assignment_end.
  const endDecisions = useMemo(() => preview
    .filter(r => END_ACTIONS.has(r.category) && approved.has(r.row_index) && r.target_assignment_id && r.end_date)
    .map(r => ({ target_assignment_id: r.target_assignment_id, end_date: r.end_date })), [preview, approved])

  const selectedCount = decisions.length + endDecisions.length

  async function doApply() {
    setApplying(true)
    try {
      let applied = 0
      if (decisions.length) {
        const { data, error } = await supabase.rpc('apply_assignment_import', { p_decisions: decisions })
        if (error) throw error
        applied += data?.applied ?? decisions.length
      }
      for (const d of endDecisions) {
        const { error } = await supabase.rpc('apply_assignment_end', { p_assignment_id: d.target_assignment_id, p_end_date: d.end_date })
        if (error) throw error
        applied += 1
      }
      setApplyResult({ applied })
      setStage('done')
      onCommitted?.()
    } catch (e) {
      console.error('[EquipmentAssignmentsUploadModal] apply failed', e)
      setPreviewError(e.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  const title = stage === 'done'
    ? '✅ Assignments Applied'
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
        {previewError && stage !== 'done' && (
          <div className={S.errorBox}>{previewError}</div>
        )}

        {stage === 'pick' && (
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-2xl p-12 text-center cursor-pointer hover:border-orange-400 dark:hover:border-orange-500/40 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={onPickFiles} className="hidden" />
            <div className="text-4xl mb-2">📂</div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
              {parsing ? 'Reading & previewing…' : 'Drop .xlsx file here or click to browse'}
            </p>
            <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-2">
              Nothing is written until you review the changes and approve. Expected columns:
              Equipment ID, Equipment Name, Driver Full Name, Driver ID, Start Date, End Date, Created By
            </p>
          </div>
        )}

        {stage === 'review' && (
          <ErrorBoundary label="the assignment review">
            <ReviewScreen
              fileName={fileName}
              unitNoun={unitNoun}
              groups={groups}
              totalRows={preview.length}
              approved={approved}
              onToggle={toggle}
              decisionCount={selectedCount}
              applying={applying}
              onApply={doApply}
              onCancel={onClose}
            />
          </ErrorBoundary>
        )}

        {stage === 'done' && (
          <>
            <div className={`${S.card} p-4 space-y-2`}>
              <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{fileName}</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <span className="text-gray-500 dark:text-slate-400">Changes applied</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">{applyResult?.applied ?? 0}</span>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">
                Written with source <span className="font-mono">tms_upload</span> — visible in the assignment import log.
              </p>
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

function ReviewScreen({ fileName, unitNoun, groups, totalRows, approved, onToggle, decisionCount, applying, onApply, onCancel }) {
  const actionableTotal = groups.new.length + groups.reassignment.length + groups.conflict_manual.length + groups.ended.length + groups.end_date_fix.length
  return (
    <>
      <div className={`${S.card} p-4 space-y-3`}>
        <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">
          {fileName} <span className="font-normal text-gray-500 dark:text-slate-500">· {unitNoun} assignments · nothing written until you Apply</span>
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
          <Stat label="New" value={groups.new.length} />
          <Stat label="Reassignment" value={groups.reassignment.length} />
          <Stat label="Manual conflict" value={groups.conflict_manual.length} tone="amber" />
          <Stat label="Ended" value={groups.ended.length} />
          <Stat label="End-date fix" value={groups.end_date_fix.length} muted={!groups.end_date_fix.length} />
          <Stat label="Unchanged" value={groups.no_change} muted />
          <Stat label="Unresolved" value={groups.unresolved.length} tone={groups.unresolved.length ? 'amber' : undefined} muted={!groups.unresolved.length} />
        </div>
      </div>

      {actionableTotal === 0 && groups.unresolved.length === 0 && (
        <div className={`${S.card} p-6 text-center text-sm text-gray-500 dark:text-slate-400`}>
          {totalRows === 0
            ? 'No assignment rows found in the file.'
            : `All ${totalRows} row${totalRows === 1 ? '' : 's'} already match — nothing to apply.`}
        </div>
      )}

      {groups.new.length > 0 && (
        <Section title={`New assignments (${groups.new.length})`} subtitle="Unit had no driver — TMS assigns one. Default: apply.">
          {groups.new.map(r => (
            <ItemRow key={r.row_index} on={approved.has(r.row_index)} onToggle={() => onToggle(r.row_index)}
              unit={r.unit} label={<>→ <strong>{r.tms_driver_name}</strong>{r.tms_driver_code ? <span className="text-gray-400 dark:text-slate-500"> · #{r.tms_driver_code}</span> : null}</>} />
          ))}
        </Section>
      )}

      {groups.reassignment.length > 0 && (
        <Section title={`Reassignments (${groups.reassignment.length})`} subtitle="Current came from a prior import; TMS differs. Default: apply (TMS wins).">
          {groups.reassignment.map(r => (
            <ItemRow key={r.row_index} on={approved.has(r.row_index)} onToggle={() => onToggle(r.row_index)}
              unit={r.unit} label={<>was <span className="text-gray-500 dark:text-slate-400">{r.current_driver_name || '—'}</span> → TMS <strong>{r.tms_driver_name}</strong></>} />
          ))}
        </Section>
      )}

      {groups.conflict_manual.length > 0 && (
        <Section
          title={`Conflicts with a manual fix (${groups.conflict_manual.length})`}
          subtitle="Current driver was set manually. Default: keep the system value — tick “Take TMS” to override."
          tone="amber"
        >
          {groups.conflict_manual.map(r => (
            <ItemRow key={r.row_index} on={approved.has(r.row_index)} onToggle={() => onToggle(r.row_index)}
              tone="amber" toggleLabel="Take TMS"
              unit={r.unit}
              label={<>System <span className="text-[10px] uppercase tracking-wide px-1 py-0.5 rounded bg-gray-200/70 dark:bg-white/10 text-gray-600 dark:text-slate-300">manual</span>: <span className="text-gray-700 dark:text-slate-300">{r.current_driver_name || '—'}</span> · TMS: <strong>{r.tms_driver_name}</strong></>} />
          ))}
        </Section>
      )}

      {groups.ended.length > 0 && (
        <Section title={`Ended (${groups.ended.length})`} subtitle="File closes the current assignment — unit becomes unassigned. Default: apply.">
          {groups.ended.map(r => (
            <ItemRow key={r.row_index} on={approved.has(r.row_index)} onToggle={() => onToggle(r.row_index)}
              unit={r.unit}
              label={<>{(r.current_driver_name || r.tms_driver_name) ? <span className="text-gray-500 dark:text-slate-400">{r.current_driver_name || r.tms_driver_name} · </span> : null}{r.note || 'Current assignment ended'}</>} />
          ))}
        </Section>
      )}

      {groups.end_date_fix.length > 0 && (
        <Section title={`End-date fixes (${groups.end_date_fix.length})`} subtitle="A past, already-closed spell has a different end date — minor correction. Default: apply." tone="muted">
          {groups.end_date_fix.map(r => (
            <ItemRow key={r.row_index} on={approved.has(r.row_index)} onToggle={() => onToggle(r.row_index)}
              unit={r.unit}
              label={<span className="text-gray-500 dark:text-slate-400">{(r.tms_driver_name || r.current_driver_name) ? `${r.tms_driver_name || r.current_driver_name} · ` : ''}{r.note || 'End date corrected'}</span>} />
          ))}
        </Section>
      )}

      {groups.unresolved.length > 0 && (
        <Section title={`Unresolved (${groups.unresolved.length})`} subtitle="Couldn’t match the unit or driver — advisory only, can’t be applied." tone="muted">
          {groups.unresolved.map(r => (
            <div key={r.row_index} className="flex items-start justify-between gap-3 px-3 py-2 text-xs border-b border-gray-50 dark:border-white/[0.03] last:border-0">
              <span className="font-medium text-gray-700 dark:text-slate-300">{r.unit || '(blank)'}</span>
              <span className="text-amber-700 dark:text-amber-400 text-right">{r.note || 'Unresolved'}</span>
            </div>
          ))}
        </Section>
      )}

      <div className={S.modalFooter}>
        <span className="text-[11px] text-gray-500 dark:text-slate-400 mr-auto self-center">
          {decisionCount} change{decisionCount === 1 ? '' : 's'} selected
        </span>
        <button onClick={onCancel} className={S.btnCancel} disabled={applying}>Cancel</button>
        <button onClick={onApply} disabled={applying || decisionCount === 0} className={S.btnSave}>
          {applying ? 'Applying…' : `Apply ${decisionCount} change${decisionCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </>
  )
}

function ItemRow({ on, onToggle, unit, label, tone, toggleLabel }) {
  return (
    <label className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer border-b border-gray-50 dark:border-white/[0.03] last:border-0 ${
      tone === 'amber' && on ? 'bg-amber-50/60 dark:bg-amber-500/[0.06]' : ''
    }`}>
      <input type="checkbox" checked={on} onChange={onToggle} className="rounded shrink-0" />
      <span className="font-medium text-gray-900 dark:text-slate-200 w-24 shrink-0">{unit}</span>
      <span className="text-gray-600 dark:text-slate-400 flex-1 min-w-0">{label}</span>
      {toggleLabel && (
        <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${on ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400 dark:text-slate-500'}`}>
          {toggleLabel}
        </span>
      )}
    </label>
  )
}

function Section({ title, subtitle, tone, children }) {
  const ring = tone === 'amber'
    ? 'border-amber-200 dark:border-amber-500/30'
    : 'border-gray-200 dark:border-white/10'
  return (
    <div className={`rounded-2xl border ${ring} overflow-hidden`}>
      <div className={`px-4 py-2.5 ${tone === 'amber' ? 'bg-amber-50/60 dark:bg-amber-500/[0.06]' : 'bg-gray-50 dark:bg-white/[0.02]'}`}>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
        {subtitle && <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="max-h-[280px] overflow-y-auto">{children}</div>
    </div>
  )
}

function Stat({ label, value, tone, muted }) {
  const valCls = tone === 'amber'
    ? 'text-amber-700 dark:text-amber-400'
    : muted ? 'text-gray-500 dark:text-slate-400' : 'text-gray-900 dark:text-slate-200'
  return (
    <div className={`${S.card} p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">{label}</p>
      <p className={`text-xl font-mono font-medium ${valCls}`}>{value}</p>
    </div>
  )
}
