import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { S } from '../../lib/styles'
import { updateLine } from './roadmapData'

// Rename / recolour / re-describe / reorder the lines. Writes to roadmap_lines.
export default function LinesModal({ open, onClose, lines, onSaved }) {
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setRows([...lines].sort((a, b) => a.sort_order - b.sort_order)
      .map(l => ({ id: l.id, name: l.name || '', color: l.color || '#94a3b8', description: l.description || '' })))
    setError('')
  }, [open, lines])

  const patch = (i, k, v) => setRows(a => a.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const move = (i, dir) => setRows(a => { const j = i + dir; if (j < 0 || j >= a.length) return a; const n = [...a];[n[i], n[j]] = [n[j], n[i]]; return n })

  async function save() {
    setSaving(true); setError('')
    try {
      const orig = new Map(lines.map(l => [l.id, l]))
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], o = orig.get(r.id)
        const p = {}
        if (r.name.trim() !== o.name) p.name = r.name.trim()
        if (r.color !== o.color) p.color = r.color
        if ((r.description || '') !== (o.description || '')) p.description = r.description.trim() || null
        if (o.sort_order !== i + 1) p.sort_order = i + 1
        if (Object.keys(p).length) await updateLine(r.id, p)
      }
      onSaved?.(); onClose()
    } catch (e) { setError(e?.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title="Edit lines" size="lg">
      <div className={`${S.modalBody} space-y-3`}>
        {error && <div className={S.errorBox}>{error}</div>}
        {rows.map((r, i) => (
          <div key={r.id} className={`${S.card} p-3 flex items-start gap-3`}>
            <div className="flex flex-col pt-1">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-30 leading-none">▲</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-30 leading-none">▼</button>
            </div>
            <input type="color" value={r.color} onChange={e => patch(i, 'color', e.target.value)} className="w-9 h-9 rounded cursor-pointer border border-gray-200 dark:border-slate-700 bg-transparent" />
            <div className="flex-1 space-y-1.5">
              <input className={S.input} value={r.name} onChange={e => patch(i, 'name', e.target.value)} placeholder="Line name" />
              <textarea className={S.textarea} rows={2} value={r.description} onChange={e => patch(i, 'description', e.target.value)} placeholder="What this line means…" />
            </div>
          </div>
        ))}
        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>{saving ? 'Saving…' : 'Save lines'}</button>
        </div>
      </div>
    </Modal>
  )
}
