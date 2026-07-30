import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { S } from '../../lib/styles'
import { insertPhase, updatePhase, deletePhase } from './roadmapData'

const STATUSES = [['planned', 'Planned'], ['building', 'Building'], ['done', 'Done']]
const QUARTERS = ['', 'Q1', 'Q2', 'Q3', 'Q4']

// Local draft rows: { id?, name, description, status, target_quarter, _orig }
export default function PhasesModal({ open, onClose, initiative, onSaved }) {
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !initiative) return
    const sorted = [...(initiative.phases || [])].sort((a, b) => a.phase_no - b.phase_no)
    setRows(sorted.map(p => ({ id: p.id, name: p.name || '', description: p.description || '', status: p.status || 'planned', target_quarter: p.target_quarter || '' })))
    setError('')
  }, [open, initiative])

  const patch = (i, k, v) => setRows(a => a.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const move = (i, dir) => setRows(a => {
    const j = i + dir
    if (j < 0 || j >= a.length) return a
    const n = [...a];[n[i], n[j]] = [n[j], n[i]]; return n
  })
  const addRow = () => setRows(a => [...a, { name: '', description: '', status: 'planned', target_quarter: '' }])
  const removeRow = (i) => { if (i === 0) return; setRows(a => a.filter((_, j) => j !== i)) }

  async function save() {
    if (rows.length === 0 || !rows[0]) { setError('Every station needs a core phase.'); return }
    setSaving(true); setError('')
    try {
      const orig = [...(initiative.phases || [])].sort((a, b) => a.phase_no - b.phase_no)
      const keptIds = new Set(rows.filter(r => r.id).map(r => r.id))
      const existing = rows.filter(r => r.id)
      // 1. park existing phases at temp phase_no to avoid unique collisions.
      for (let k = 0; k < existing.length; k++) await updatePhase(existing[k].id, { phase_no: 9000 + k })
      // 2. delete removed phases.
      for (const p of orig) if (!keptIds.has(p.id)) await deletePhase(p.id)
      // 3. write final order/fields for existing; insert new rows.
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const fields = { phase_no: i + 1, name: r.name.trim() || `Phase ${i + 1}`, description: r.description.trim() || null, status: r.status, target_quarter: r.target_quarter || null }
        if (r.id) await updatePhase(r.id, fields)
        else await insertPhase({ initiative_id: initiative.id, ...fields })
      }
      // Status is recomputed by trigger; refetch reflects it.
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e?.message || 'Save failed')
      // parked temp phase_no may linger; a refetch + recompute happens on close/refetch
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title={`Manage phases · ${initiative?.name || ''}`} size="lg">
      <div className={`${S.modalBody} space-y-3`}>
        {error && <div className={S.errorBox}>{error}</div>}
        <p className="text-[11px] text-gray-500 dark:text-slate-400">The station's status follows its phases — you never set it directly. Phase 1 is the core and can't be removed.</p>

        {rows.map((r, i) => (
          <div key={r.id || `new-${i}`} className={`${S.card} p-3 space-y-2`}>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10 text-xs font-semibold text-gray-600 dark:text-slate-300">{i + 1}</span>
              <input className={S.input} placeholder="Phase name" value={r.name} onChange={e => patch(i, 'name', e.target.value)} />
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-30 leading-none">▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-30 leading-none">▼</button>
              </div>
              <button type="button" onClick={() => removeRow(i)} disabled={i === 0} title={i === 0 ? "The core phase can't be removed" : 'Remove'} className="px-2 text-gray-400 hover:text-red-500 disabled:opacity-30">✕</button>
            </div>
            <input className={S.input} placeholder="Description (optional)" value={r.description} onChange={e => patch(i, 'description', e.target.value)} />
            <div className="flex gap-2">
              <Select value={r.status} onChange={e => patch(i, 'status', e.target.value)}>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select value={r.target_quarter?.slice(0, 2) || ''} onChange={e => patch(i, 'target_quarter', e.target.value ? `${e.target.value} ${new Date().getFullYear()}` : '')}>
                {QUARTERS.map(q => <option key={q} value={q}>{q || 'No target'}</option>)}
              </Select>
            </div>
          </div>
        ))}

        <button type="button" onClick={addRow} className="text-sm font-medium text-orange-600 dark:text-orange-400 hover:underline">+ Add phase</button>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>{saving ? 'Saving…' : 'Save phases'}</button>
        </div>
      </div>
    </Modal>
  )
}
