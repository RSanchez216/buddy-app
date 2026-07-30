import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { S } from '../../lib/styles'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import RoadmapMap from './RoadmapMap'
import InitiativeModal from './InitiativeModal'
import PhasesModal from './PhasesModal'
import {
  fetchRoadmap, fetchDepartments, computeLayout, savePositions, autoTidyPositions, recomputeStatuses,
  STATUS_LABEL, PRIORITY_LABEL,
} from './roadmapData'

const STATUS_PILL = {
  live: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
  building: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  planned: 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-white/10',
}
const FLAG_PILL = {
  needs_fix: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20',
  parked: 'bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-white/10',
}
const FLAG_LABEL = { needs_fix: 'Needs a fix', parked: 'Parked' }

export default function Roadmap() {
  const { canEdit } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const displayMode = params.get('display') === '1'

  const [data, setData] = useState(null)
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [deptFilter, setDeptFilter] = useState('')
  const [prioFilter, setPrioFilter] = useState('')
  const [editing, setEditing] = useState(null)   // initiative | 'new' | null
  const [phasesFor, setPhasesFor] = useState(null)
  const [confirmTidy, setConfirmTidy] = useState(false)
  const svgRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [rm, depts] = await Promise.all([fetchRoadmap(), fetchDepartments()])
      setData(rm); setDepartments(depts)
    } catch (e) { setError(e?.message || 'Failed to load the roadmap') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const lines = useMemo(() => data?.lines || [], [data])
  const initiatives = useMemo(() => data?.initiatives || [], [data])
  const progress = data?.progress || {}
  const layout = useMemo(() => computeLayout(lines, initiatives), [lines, initiatives])
  const selected = initiatives.find(it => it.id === selectedId) || null

  const dimmed = useCallback((it) => {
    if (deptFilter && it.department_id !== deptFilter) return true
    if (prioFilter && it.priority !== prioFilter) return true
    return false
  }, [deptFilter, prioFilter])

  // Drag end → optimistic pos_x, persist, roll back on error.
  const onDragEnd = useCallback(async (id, x) => {
    const prev = initiatives
    setData(d => ({ ...d, initiatives: d.initiatives.map(it => it.id === id ? { ...it, pos_x: x } : it) }))
    try { await savePositions([{ id, pos_x: x }]) }
    catch (e) { setData(d => ({ ...d, initiatives: prev })); toast.error("Couldn't save the position", e) }
  }, [initiatives, toast])

  async function runTidy() {
    setConfirmTidy(false)
    const positions = autoTidyPositions(lines, initiatives)
    if (!positions.length) return
    const prev = initiatives
    setData(d => ({ ...d, initiatives: d.initiatives.map(it => { const p = positions.find(q => q.id === it.id); return p ? { ...it, pos_x: p.pos_x } : it }) }))
    try { await savePositions(positions) }
    catch (e) { setData(d => ({ ...d, initiatives: prev })); toast.error("Couldn't tidy the map", e) }
  }

  async function exportPdf() {
    const svg = svgRef.current
    if (!svg) return
    try {
      const { default: jsPDF } = await import('jspdf')
      const clone = svg.cloneNode(true)
      const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*')
      const props = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-weight', 'font-family', 'letter-spacing']
      for (let i = 0; i < src.length; i++) {
        const cs = getComputedStyle(src[i])
        props.forEach(p => { const v = cs.getPropertyValue(p); if (v) dst[i].style.setProperty(p, v) })
      }
      const vb = svg.viewBox.baseVal
      const w = Math.round(vb.width), h = Math.round(vb.height)
      clone.setAttribute('width', w); clone.setAttribute('height', h); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
      const png = await new Promise((res, rej) => {
        const im = new Image()
        im.onload = () => { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.scale(2, 2); x.drawImage(im, 0, 0, w, h); res(c.toDataURL('image/png')) }
        im.onerror = () => rej(new Error('svg render failed')); im.src = url
      })
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight()
      const iw = pw - 48, ih = Math.min(h / w * iw, ph - 80)
      pdf.setFontSize(15); pdf.setTextColor(20); pdf.text('BUDDY Roadmap', 24, 30)
      pdf.addImage(png, 'PNG', 24, 44, iw, ih)
      const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date())
      pdf.setFontSize(8); pdf.setTextColor(150)
      pdf.text(`Exported ${today}  ·  ${progress.stations_open ?? 0}/${progress.stations_total ?? 0} stations open  ·  ${progress.phases_done ?? 0}/${progress.phases_total ?? 0} phases done`, 24, ph - 18)
      pdf.save('BUDDY-Roadmap.pdf')
    } catch (e) { toast.error("Couldn't export the PDF", e) }
  }

  const mapCard = (
    <div className={`${S.card} relative p-2`}>
      {/* Station key (top-left, HTML overlay) */}
      <div className="absolute left-3 top-3 z-10 rounded-lg bg-white/90 dark:bg-[#0d0d1f]/90 backdrop-blur border border-gray-200 dark:border-white/10 px-3 py-2 text-[11px] text-gray-600 dark:text-slate-400 space-y-1">
        <div className="font-semibold text-gray-500 dark:text-slate-500 uppercase tracking-wide text-[10px] mb-1">Station key</div>
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full bg-gray-400" />} label="Planned — hollow" />
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full border-2 border-gray-400" />} label="Building — pale ring" />
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full bg-gray-700 dark:bg-slate-300" />} label="Live — solid" />
        <KeyRow symbol={<span className="inline-flex w-3 h-3 rounded-full bg-red-600 items-center justify-center text-white text-[8px] font-bold">!</span>} label="Needs a fix" />
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full border-2 border-dashed border-gray-400" />} label="Parked" />
      </div>

      {/* Auto-tidy (top-right) */}
      {canEdit && (
        <div className="absolute right-3 top-3 z-10">
          {confirmTidy ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-white dark:bg-[#0d0d1f] border border-gray-200 dark:border-white/10 px-2 py-1.5 text-xs shadow">
              <span className="text-gray-500 dark:text-slate-400">Overwrite placement?</span>
              <button onClick={runTidy} className="font-semibold text-orange-600 dark:text-orange-400">Tidy</button>
              <button onClick={() => setConfirmTidy(false)} className="text-gray-400">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmTidy(true)} className="rounded-lg border border-gray-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5">Auto-tidy</button>
          )}
        </div>
      )}

      <div className="overflow-x-auto pt-1" onClick={() => setSelectedId(null)}>
        <RoadmapMap
          layout={layout} initiatives={initiatives} selectedId={selectedId}
          onSelect={setSelectedId} canEdit={canEdit} dimmed={(deptFilter || prioFilter) ? dimmed : null}
          svgRef={svgRef} onDragEnd={onDragEnd}
        />
      </div>
    </div>
  )

  if (displayMode) {
    return (
      <div className="fixed inset-0 z-[100] bg-white dark:bg-[#0d0d1f] overflow-auto p-6">
        <button onClick={() => setParams(p => { const n = new URLSearchParams(p); n.delete('display'); return n })}
          className="absolute right-4 top-4 z-10 text-sm text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">Exit display ✕</button>
        {!loading && !error && mapCard}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> BUDDY · Vision
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Roadmap</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5 max-w-2xl">Every moving part of the machine — what&apos;s running, what&apos;s building, and what it&apos;s waiting on.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportPdf} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">↓ PDF</button>
          <button onClick={() => setParams(p => { const n = new URLSearchParams(p); n.set('display', '1'); return n })} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">Display mode</button>
          {canEdit && <button onClick={() => setEditing('new')} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-400">+ Add initiative</button>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" /></div>
      ) : error ? (
        <div className={`${S.card} p-10 text-center`}><p className="text-sm text-gray-600 dark:text-slate-400 mb-3">{error}</p><button onClick={load} className={S.btnSecondary}>Retry</button></div>
      ) : (
        <>
          <Meter progress={progress} />

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-gray-700 dark:text-slate-300">
              <option value="">All departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={prioFilter} onChange={e => setPrioFilter(e.target.value)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-gray-700 dark:text-slate-300">
              <option value="">All priorities</option>
              {['critical', 'high', 'medium', 'low'].map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            {(deptFilter || prioFilter) && <button onClick={() => { setDeptFilter(''); setPrioFilter('') }} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">Clear</button>}
          </div>

          {mapCard}

          {/* Inspector */}
          <Inspector selected={selected} lines={lines} departments={departments} initiatives={initiatives} canEdit={canEdit}
            onEdit={() => setEditing(selected)} onManagePhases={() => setPhasesFor(selected)} />
        </>
      )}

      <InitiativeModal open={!!editing} onClose={() => setEditing(null)}
        initiative={editing === 'new' ? null : editing} lines={lines} departments={departments}
        allInitiatives={initiatives} onSaved={async () => { await recomputeSafe(); load() }} />
      <PhasesModal open={!!phasesFor} onClose={() => setPhasesFor(null)} initiative={phasesFor}
        onSaved={async () => { await recomputeSafe(); load() }} />
    </div>
  )
}

async function recomputeSafe() { try { await recomputeStatuses() } catch { /* trigger usually keeps it fresh */ } }

function KeyRow({ symbol, label }) {
  return <div className="flex items-center gap-2">{symbol}<span>{label}</span></div>
}

function Meter({ progress }) {
  const total = progress.stations_total || 0
  const seg = [
    { n: progress.stations_open || 0, cls: 'bg-emerald-500' },
    { n: progress.stations_building || 0, cls: 'bg-amber-500' },
    { n: progress.needs_fix || 0, cls: 'bg-red-500' },
    { n: progress.parked || 0, cls: 'bg-gray-400 dark:bg-slate-600' },
    { n: progress.stations_planned || 0, cls: 'bg-gray-200 dark:bg-white/10' },
  ]
  return (
    <div className={`${S.card} p-4 flex flex-wrap items-center gap-x-8 gap-y-3`}>
      <div>
        <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{progress.stations_open ?? 0}<span className="text-gray-300 dark:text-slate-600">/{total}</span></div>
        <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Stations open</div>
      </div>
      <div className="flex-1 min-w-[240px]">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/5">
          {seg.map((s, i) => total > 0 && s.n > 0 && <div key={i} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />)}
        </div>
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400">
          {progress.stations_building ?? 0} building · {progress.needs_fix ?? 0} need a fix · {progress.stations_planned ?? 0} still on the table
        </div>
      </div>
      <div className="text-sm text-gray-500 dark:text-slate-400">
        <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{progress.phases_done ?? 0}</span> of {progress.phases_total ?? 0} phases done
      </div>
    </div>
  )
}

function Inspector({ selected, lines, departments, initiatives, canEdit, onEdit, onManagePhases }) {
  if (!selected) return <div className={`${S.card} p-5 text-sm text-gray-400 dark:text-slate-500`}>Click a station to see what it controls, what it&apos;s waiting on, and where it&apos;s headed.</div>
  const line = lines.find(l => l.id === selected.primary_line_id)
  const dept = departments.find(d => d.id === selected.department_id)
  const waiting = (selected.depends_on || []).map(id => initiatives.find(it => it.id === id)?.name).filter(Boolean)
  return (
    <div className={`${S.card} p-5`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{selected.name}</h2>
        <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL[selected.status] || STATUS_PILL.planned}`}>{STATUS_LABEL[selected.status] || selected.status}</span>
        {selected.flag && <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${FLAG_PILL[selected.flag]}`}>{FLAG_LABEL[selected.flag]}</span>}
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <button onClick={onEdit} className={`${S.btnSecondary} text-xs`}>Edit</button>
            <button onClick={onManagePhases} className={`${S.btnSecondary} text-xs`}>Manage phases</button>
          </div>
        )}
      </div>
      {selected.controls && <p className="text-sm text-gray-600 dark:text-slate-400 mb-4 max-w-3xl">{selected.controls}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
        <Col label="Line" value={line?.name} swatch={line?.color} />
        <Col label="Department" value={dept?.name || '—'} />
        <Col label="Priority" value={PRIORITY_LABEL[selected.priority] || '—'} />
        <Col label="Waiting on" value={waiting.length ? waiting.join(', ') : 'Nothing — clear to start'} />
        <Col label="Target" value={selected.target_quarter || '—'} />
        <Col label="Owner" value={selected.owner_user_id ? 'Assigned' : 'Unassigned'} />
      </div>
    </div>
  )
}

function Col({ label, value, swatch }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-0.5">{label}</div>
      <div className="flex items-center gap-1.5 text-gray-800 dark:text-slate-200">
        {swatch && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: swatch }} />}
        <span className="truncate">{value}</span>
      </div>
    </div>
  )
}
