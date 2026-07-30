import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import Select from '../../components/Select'
import { S } from '../../lib/styles'
import { supabase } from '../../lib/supabase'
import {
  insertInitiative, updateInitiative, addInitiativeLine, removeInitiativeLine,
  addDependency, removeDependency, insertPhase, PRIORITY_LABEL,
} from './roadmapData'

const PRIORITIES = ['critical', 'high', 'medium', 'low']
const FLAGS = [['', 'None'], ['needs_fix', 'Needs a fix'], ['parked', 'Parked']]
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4']

function parseQuarter(q) {
  const m = /^(Q[1-4])\s+(\d{4})$/.exec(String(q || '').trim())
  return m ? { q: m[1], y: m[2] } : { q: '', y: '' }
}

export default function InitiativeModal({ open, onClose, initiative, lines, departments, allInitiatives, onSaved }) {
  const isEdit = !!initiative
  const [name, setName] = useState('')
  const [controls, setControls] = useState('')
  const [outcome, setOutcome] = useState('')
  const [primaryLineId, setPrimaryLineId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [tq, setTq] = useState('')
  const [ty, setTy] = useState('')
  const [priority, setPriority] = useState('medium')
  const [flag, setFlag] = useState('')
  const [extraLines, setExtraLines] = useState(new Set())
  const [deps, setDeps] = useState(new Set())
  const [depSearch, setDepSearch] = useState('')
  const [phase1, setPhase1] = useState('')
  const [extraPhases, setExtraPhases] = useState([]) // [{name}]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    if (initiative) {
      const pq = parseQuarter(initiative.target_quarter)
      setName(initiative.name || ''); setControls(initiative.controls || ''); setOutcome(initiative.outcome || '')
      setPrimaryLineId(initiative.primary_line_id || ''); setDepartmentId(initiative.department_id || '')
      setTq(pq.q); setTy(pq.y); setPriority(initiative.priority || 'medium'); setFlag(initiative.flag || '')
      setExtraLines(new Set(initiative.extra_line_ids || [])); setDeps(new Set(initiative.depends_on || []))
    } else {
      setName(''); setControls(''); setOutcome(''); setPrimaryLineId(lines[0]?.id || ''); setDepartmentId('')
      setTq(''); setTy(''); setPriority('medium'); setFlag(''); setExtraLines(new Set()); setDeps(new Set())
      setPhase1(''); setExtraPhases([])
    }
    setDepSearch(''); setError('')
  }, [open, initiative, lines])

  const extraLineOptions = useMemo(() => lines.filter(l => l.id !== primaryLineId), [lines, primaryLineId])
  const depOptions = useMemo(() => {
    const q = depSearch.trim().toLowerCase()
    return allInitiatives
      .filter(it => it.id !== initiative?.id)
      .filter(it => !q || it.name.toLowerCase().includes(q))
  }, [allInitiatives, depSearch, initiative])

  const targetQuarter = tq && ty ? `${tq} ${ty}` : null
  const primaryLine = lines.find(l => l.id === primaryLineId)

  const toggle = (set, setFn, id) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setFn(n) }

  async function save() {
    if (!name.trim()) { setError('Name is required.'); return }
    if (!primaryLineId) { setError('Pick a line.'); return }
    setSaving(true); setError('')
    // Extra lines may not include the primary line (DB rejects it).
    const cleanExtra = [...extraLines].filter(id => id !== primaryLineId)
    const base = {
      name: name.trim(), controls: controls.trim() || null, outcome: outcome.trim() || null,
      primary_line_id: primaryLineId, department_id: departmentId || null,
      priority, target_quarter: targetQuarter, flag: flag || null,
    }
    try {
      if (isEdit) {
        await updateInitiative(initiative.id, base)
        // reconcile extra lines
        const cur = new Set(initiative.extra_line_ids || [])
        for (const id of cleanExtra) if (!cur.has(id)) await addInitiativeLine(initiative.id, id)
        for (const id of cur) if (!cleanExtra.includes(id)) await removeInitiativeLine(initiative.id, id)
        // reconcile deps (surface cycle errors inline)
        const curD = new Set(initiative.depends_on || [])
        for (const id of deps) if (!curD.has(id)) await addDependency(initiative.id, id)
        for (const id of curD) if (!deps.has(id)) await removeDependency(initiative.id, id)
      } else {
        const { id } = await insertInitiative({ ...base, pos_x: 120 })
        for (const lineId of cleanExtra) await addInitiativeLine(id, lineId)
        for (const depId of deps) await addDependency(id, depId)
        // Trigger created Phase 1 — rename it, then append any extra phases.
        const { data: existing } = await supabase.from('roadmap_phases').select('id, phase_no').eq('initiative_id', id).order('phase_no')
        if (phase1.trim() && existing?.[0]) await supabase.from('roadmap_phases').update({ name: phase1.trim() }).eq('id', existing[0].id)
        let no = (existing?.length || 1)
        for (const p of extraPhases.filter(p => p.name.trim())) { no += 1; await insertPhase({ initiative_id: id, phase_no: no, name: p.name.trim(), status: 'planned' }) }
      }
      onSaved?.()
      onClose()
    } catch (e) {
      const msg = e?.message || 'Save failed'
      setError(/cycle|circular|depend/i.test(msg) ? "That would create a loop — an initiative can't come after something that already comes after it." : msg)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit initiative' : 'Add initiative'} size="lg">
      <div className={`${S.modalBody} space-y-4`}>
        {error && <div className={S.errorBox}>{error}</div>}

        <Field label="Name">
          <input className={S.input} value={name} onChange={e => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="What it controls" hint="in your words">
          <textarea className={S.textarea} rows={2} value={controls} onChange={e => setControls(e.target.value)} />
        </Field>
        <Field label="What we get when it's done">
          <textarea className={S.textarea} rows={2} value={outcome} onChange={e => setOutcome(e.target.value)} />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Line">
            <Select value={primaryLineId} onChange={e => setPrimaryLineId(e.target.value)}>
              {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
              <option value="">—</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Target">
            <div className="flex gap-1.5">
              <Select value={tq} onChange={e => setTq(e.target.value)}><option value="">—</option>{QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}</Select>
              <input className={`${S.input} w-20`} placeholder="YYYY" value={ty} onChange={e => setTy(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
          </Field>
        </div>

        <Field label="Priority">
          <div className="flex gap-1.5">
            {PRIORITIES.map(p => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`flex-1 px-3 py-1.5 rounded-lg border text-sm font-medium capitalize transition-colors ${priority === p ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Flag">
          <div className="flex gap-1.5">
            {FLAGS.map(([v, lbl]) => (
              <button key={v} type="button" onClick={() => setFlag(v)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${flag === v ? 'bg-gray-800 dark:bg-white/10 text-white border-gray-800 dark:border-white/20' : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                {lbl}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Also appears on">
          <div className="flex flex-wrap gap-1.5">
            {extraLineOptions.length === 0 && <span className="text-xs text-gray-400 dark:text-slate-500">No other lines.</span>}
            {extraLineOptions.map(l => (
              <button key={l.id} type="button" onClick={() => toggle(extraLines, setExtraLines, l.id)}
                className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${extraLines.has(l.id) ? 'text-white border-transparent' : 'text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700'}`}
                style={extraLines.has(l.id) ? { background: l.color } : undefined}>
                {l.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Comes after">
          <input className={`${S.input} mb-2`} placeholder="Search initiatives…" value={depSearch} onChange={e => setDepSearch(e.target.value)} />
          <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-white/5">
            {depOptions.length === 0 && <div className="px-3 py-2 text-xs text-gray-400 dark:text-slate-500">No matches.</div>}
            {depOptions.map(it => (
              <label key={it.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5">
                <input type="checkbox" checked={deps.has(it.id)} onChange={() => toggle(deps, setDeps, it.id)} />
                <span className="text-gray-700 dark:text-slate-300">{it.name}</span>
              </label>
            ))}
          </div>
        </Field>

        {!isEdit && (
          <Field label="Phases" hint="Phase 1 is the core; add more if you like">
            <input className={`${S.input} mb-1.5`} placeholder="Phase 1 name (e.g. Ship it)" value={phase1} onChange={e => setPhase1(e.target.value)} />
            {extraPhases.map((p, i) => (
              <div key={i} className="flex gap-1.5 mb-1.5">
                <input className={S.input} placeholder={`Phase ${i + 2} name`} value={p.name} onChange={e => setExtraPhases(a => a.map((x, j) => j === i ? { name: e.target.value } : x))} />
                <button type="button" onClick={() => setExtraPhases(a => a.filter((_, j) => j !== i))} className="px-2 text-gray-400 hover:text-red-500">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setExtraPhases(a => [...a, { name: '' }])} className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">+ Add phase</button>
          </Field>
        )}

        <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-relaxed">
          It will land on <strong className="font-semibold">{primaryLine?.name || 'the selected line'}</strong> as a planned station (starts hollow), and you can drag it left/right on the map to place it.
        </p>

        <div className={S.modalFooter}>
          <button onClick={onClose} className={S.btnCancel}>Cancel</button>
          <button onClick={save} disabled={saving} className={S.btnSave}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add initiative'}</button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-slate-500 mb-1">
        {label}{hint && <span className="ml-1.5 font-normal text-gray-400 dark:text-slate-600">· {hint}</span>}
      </label>
      {children}
    </div>
  )
}
