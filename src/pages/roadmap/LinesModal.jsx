import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { S } from '../../lib/styles'
import { updateLine, createLine, deleteLine, moveStationsToLine } from './roadmapData'

// Curated palette for a NEW line — distinguishable from each other and the
// current five, legible in dark mode. In-use swatches grey out; a validated
// custom hex is the fallback.
const PALETTE = [
  { hex: '#0D9488', name: 'Teal' }, { hex: '#BE123C', name: 'Crimson' },
  { hex: '#B45309', name: 'Bronze' }, { hex: '#4F46E5', name: 'Indigo' },
  { hex: '#0891B2', name: 'Cyan' }, { hex: '#A21CAF', name: 'Magenta' },
  { hex: '#65A30D', name: 'Olive' }, { hex: '#475569', name: 'Slate' },
]
const HEX_RE = /^#[0-9A-Fa-f]{6}$/

// Rename / recolour / re-describe / reorder existing lines (batched), plus create
// a new line, move its stations, hide, or delete. Structural actions (create /
// hide / delete / move) apply immediately and refetch; the row edits batch on Save.
export default function LinesModal({ open, onClose, lines, initiatives, onSaved }) {
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [moveFor, setMoveFor] = useState(null) // line id whose move panel is open

  useEffect(() => {
    if (!open) return
    setRows([...lines].sort((a, b) => a.sort_order - b.sort_order)
      .map(l => ({ id: l.id, name: l.name || '', color: l.color || '#94a3b8', description: l.description || '' })))
    setError(''); setAdding(false); setMoveFor(null)
  }, [open, lines])

  const ordered = [...lines].sort((a, b) => a.sort_order - b.sort_order)
  const countFor = (id) => (initiatives || []).filter(it => it.primary_line_id === id).length

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

  // Structural actions — immediate, refetch on success, surface the reason on fail.
  async function hide(line) {
    setError('')
    try { await updateLine(line.id, { is_active: false }); onSaved?.() } // trigger blocks if stations remain
    catch (e) { setError(e?.message || 'Could not hide the line') }      // trigger message, verbatim
  }
  async function del(line) {
    setError('')
    try { await deleteLine(line.id); onSaved?.() }
    catch (e) {
      const raw = e?.message || ''
      setError(/foreign key|violates|constraint|restrict/i.test(raw)
        ? 'This line still has stations — move or archive them first.'
        : (raw || 'Could not delete the line.'))
    }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title="Edit lines" size="lg">
      <div className={`${S.modalBody} space-y-3`}>
        {error && <div className={S.errorBox}>{error}</div>}

        {rows.map((r, i) => {
          const count = countFor(r.id)
          const lockMsg = count > 0 ? `${count} station${count === 1 ? '' : 's'} still on this line — move them first` : ''
          return (
            <div key={r.id} className={`${S.card} p-3`}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col pt-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-30 leading-none">▲</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="px-1 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 disabled:opacity-30 leading-none">▼</button>
                </div>
                <input type="color" value={r.color} onChange={e => patch(i, 'color', e.target.value)} className="w-9 h-9 rounded cursor-pointer border border-gray-200 dark:border-slate-700 bg-transparent" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <input className={S.input} value={r.name} onChange={e => patch(i, 'name', e.target.value)} placeholder="Line name" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400 shrink-0" title="Stations on this line">{count}</span>
                  </div>
                  <textarea className={S.textarea} rows={2} value={r.description} onChange={e => patch(i, 'description', e.target.value)} placeholder="What this line means…" />
                  <div className="flex items-center gap-1.5">
                    <RowBtn onClick={() => setMoveFor(moveFor === r.id ? null : r.id)} disabled={count === 0} title={count === 0 ? 'No stations to move' : 'Move stations to another line'}>Move stations</RowBtn>
                    <RowBtn onClick={() => hide(ordered.find(l => l.id === r.id))} disabled={count > 0} title={count > 0 ? lockMsg : 'Hide this line'}>Hide</RowBtn>
                    <RowBtn onClick={() => del(ordered.find(l => l.id === r.id))} disabled={count > 0} title={count > 0 ? lockMsg : 'Delete this line'} danger>Delete</RowBtn>
                  </div>
                </div>
              </div>
              {moveFor === r.id && (
                <MovePanel line={ordered.find(l => l.id === r.id)} lines={ordered} initiatives={initiatives}
                  onCancel={() => setMoveFor(null)}
                  onDone={() => { setMoveFor(null); onSaved?.() }}
                  onError={setError} />
              )}
            </div>
          )
        })}

        {adding ? (
          <CreateLineForm lines={ordered} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); onSaved?.() }} onError={setError} />
        ) : (
          <button onClick={() => { setError(''); setAdding(true) }} className="w-full rounded-xl border border-dashed border-gray-300 dark:border-slate-600 py-2.5 text-sm font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-500/5 transition-colors">
            ＋ Add line
          </button>
        )}

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>{saving ? 'Saving…' : 'Save lines'}</button>
        </div>
      </div>
    </Modal>
  )
}

function RowBtn({ children, onClick, disabled, title, danger }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        danger
          ? 'border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5'
      }`}>
      {children}
    </button>
  )
}

// A new line uses the curated palette (or a validated custom hex) and a position.
function CreateLineForm({ lines, onCancel, onDone, onError }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('')
  const [description, setDescription] = useState('')
  const [afterLineId, setAfterLineId] = useState('')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const inUse = new Set(lines.map(l => (l.color || '').toUpperCase()))

  async function submit() {
    setErr('')
    if (!name.trim()) { setErr('A line needs a name'); return }
    const chosen = HEX_RE.test(color) ? color : (HEX_RE.test(custom.trim()) ? custom.trim().toUpperCase() : color)
    if (!HEX_RE.test(chosen)) { setErr('Colour must be a hex value like #0D9488'); return }
    setBusy(true)
    try {
      await createLine({ name: name.trim(), color: chosen, description, afterLineId: afterLineId || null })
      onDone()
    } catch (e) { setErr(e?.message || 'Could not create the line'); onError?.(e?.message || 'Could not create the line') }
    finally { setBusy(false) }
  }

  return (
    <div className={`${S.card} p-3 space-y-3 border-orange-200 dark:border-orange-500/30`}>
      <p className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400">New line</p>
      {err && <div className={S.errorBox}>{err}</div>}

      <div>
        <label className={S.label}>Name</label>
        <input autoFocus className={S.input} value={name} onChange={e => setName(e.target.value)} placeholder="Safety & Compliance" />
      </div>

      <div>
        <label className={S.label}>Colour</label>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map(p => {
            const taken = inUse.has(p.hex.toUpperCase())
            const selected = color === p.hex.toUpperCase()
            return (
              <button key={p.hex} type="button" disabled={taken} title={taken ? `${p.name} — already in use` : p.name}
                onClick={() => { setColor(p.hex.toUpperCase()); setErr('') }}
                className={`w-7 h-7 rounded-full border-2 transition-all disabled:opacity-25 disabled:cursor-not-allowed ${selected ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-slate-400 ring-offset-white dark:ring-offset-[#0d0d1f] border-white dark:border-[#0d0d1f]' : 'border-white/70 dark:border-white/20'}`}
                style={{ background: p.hex }} />
            )
          })}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <input className={`${S.input} w-32 font-mono text-xs`} value={custom} onChange={e => setCustom(e.target.value)} placeholder="#0D9488" />
          <span className="text-[11px] text-gray-400 dark:text-slate-500">custom hex (optional)</span>
        </div>
      </div>

      <div>
        <label className={S.label}>Description <span className="font-normal normal-case text-gray-400">(shows in the legend)</span></label>
        <input className={S.input} value={description} onChange={e => setDescription(e.target.value)} placeholder="Keeping us legal and insurable." />
      </div>

      <div>
        <label className={S.label}>Position</label>
        <select className={`${S.input} appearance-none`} value={afterLineId} onChange={e => setAfterLineId(e.target.value)}>
          <option value="">At the bottom</option>
          {lines.filter(l => l.is_active !== false).map(l => <option key={l.id} value={l.id}>Below {l.name}</option>)}
        </select>
      </div>

      <div>
        <label className={S.label}>Preview</label>
        <div className="flex items-center gap-2.5 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-white/[0.03] p-2.5">
          <span className="h-1.5 w-10 rounded-full shrink-0" style={{ background: HEX_RE.test(color || '') ? color : '#94a3b8' }} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name || 'New line'}</p>
            {description && <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{description}</p>}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className={S.btnCancel}>Cancel</button>
        <button onClick={submit} disabled={busy} className="px-4 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Creating…' : 'Create line'}</button>
      </div>
    </div>
  )
}

function MovePanel({ line, lines, initiatives, onCancel, onDone, onError }) {
  const stations = (initiatives || []).filter(it => it.primary_line_id === line.id)
  const [sel, setSel] = useState(() => new Set())
  const [toLine, setToLine] = useState('')
  const [busy, setBusy] = useState(false)
  const targets = lines.filter(l => l.id !== line.id)

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function move() {
    if (!sel.size || !toLine) return
    setBusy(true)
    try { await moveStationsToLine([...sel], toLine); onDone() }
    catch (e) { onError?.(e?.message || 'Could not move the stations') }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5 space-y-2">
      <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/5">
        {stations.map(it => (
          <label key={it.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5">
            <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} className="w-3.5 h-3.5 accent-orange-500" />
            <span className="text-gray-700 dark:text-slate-300 truncate">{it.name}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <select className={`${S.input} appearance-none flex-1 text-sm`} value={toLine} onChange={e => setToLine(e.target.value)}>
          <option value="">Move to →</option>
          {targets.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button onClick={onCancel} disabled={busy} className={S.btnCancel}>Cancel</button>
        <button onClick={move} disabled={busy || !sel.size || !toLine} className="px-3 py-2 text-sm font-semibold bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white rounded-xl transition-colors">{busy ? 'Moving…' : 'Move'}</button>
      </div>
    </div>
  )
}
