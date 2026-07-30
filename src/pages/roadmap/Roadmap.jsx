import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { S } from '../../lib/styles'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import RoadmapMap from './RoadmapMap'
import InitiativeModal from './InitiativeModal'
import PhasesModal from './PhasesModal'
import HubModal from './HubModal'
import LinesModal from './LinesModal'
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
  const [hubOpen, setHubOpen] = useState(false)
  const [linesOpen, setLinesOpen] = useState(false)
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
  const settings = data?.settings || {}
  const layout = useMemo(() => computeLayout(lines, initiatives), [lines, initiatives])
  const selected = initiatives.find(it => it.id === selectedId) || null

  // Clicking a station selects it (fills the inspector); for editors it also
  // opens the edit modal, prefilled. Read-only users only get the selection.
  const onStationSelect = useCallback((id) => {
    setSelectedId(id)
    if (canEdit) setEditing(initiatives.find(it => it.id === id) || null)
  }, [canEdit, initiatives])

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
        <div className="font-semibold text-gray-500 dark:text-slate-500 uppercase tracking-wide text-[10px] mb-1">Station key · rings = phases</div>
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full bg-gray-700 dark:bg-slate-300" />} label="Solid centre — phase 1 built" />
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full border-2 border-gray-400" />} label="Pale ring — a phase not built yet" />
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full border-2 border-gray-500 bg-gray-300 dark:bg-slate-500" />} label="Rings fill inside-out as phases ship" />
        <KeyRow symbol={<span className="inline-flex w-3 h-3 rounded-full bg-red-600 items-center justify-center text-white text-[8px] font-bold">!</span>} label="Red badge — needs a fix" />
        <KeyRow symbol={<span className="inline-block w-3 h-3 rounded-full border-2 border-dashed border-gray-400" />} label="Dashed — parked" />
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
          onSelect={onStationSelect} canEdit={canEdit} dimmed={(deptFilter || prioFilter) ? dimmed : null}
          svgRef={svgRef} onDragEnd={onDragEnd}
          hubTitle={settings.hub_title || 'THE FULL PICTURE'} hubSubtitle={settings.hub_subtitle || ''}
          onHubClick={canEdit ? () => setHubOpen(true) : undefined}
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
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5 max-w-2xl">{settings.page_subtitle || "Every moving part of the machine — what's running, what's building, and what it's waiting on."}</p>
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
          <Meter progress={progress} initiatives={initiatives} />

          <LineLegend lines={layout.ordered} canEdit={canEdit} onEdit={() => setLinesOpen(true)} />

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
        allInitiatives={initiatives} onSaved={async () => { await recomputeSafe(); load() }}
        onManagePhases={(it) => setPhasesFor(it)} />
      <PhasesModal open={!!phasesFor} onClose={() => setPhasesFor(null)} initiative={phasesFor}
        onSaved={async () => { await recomputeSafe(); load() }} />
      <HubModal open={hubOpen} onClose={() => setHubOpen(false)} settings={settings} onSaved={load} />
      <LinesModal open={linesOpen} onClose={() => setLinesOpen(false)} lines={lines} initiatives={initiatives} onSaved={load} />
    </div>
  )
}

async function recomputeSafe() { try { await recomputeStatuses() } catch { /* trigger usually keeps it fresh */ } }

function KeyRow({ symbol, label }) {
  return <div className="flex items-center gap-2">{symbol}<span>{label}</span></div>
}

// Tooltip helper: sorted names, 2 columns if >8, capped at 14 with "…and N more".
function TipList({ items }) {
  const sorted = [...items].sort((a, b) => a.localeCompare(b))
  const cap = 14
  const shown = sorted.slice(0, cap)
  const more = sorted.length - shown.length
  const cols = sorted.length > 8
  return (
    <div className="pointer-events-none absolute z-30 left-0 top-full mt-1.5 w-max max-w-md rounded-lg bg-gray-900 dark:bg-black text-white shadow-2xl px-3 py-2 text-[11px]">
      {shown.length === 0 ? <div className="text-slate-400">None</div> : (
        <div className={cols ? 'grid grid-cols-2 gap-x-4 gap-y-0.5' : 'space-y-0.5'}>
          {shown.map((n, i) => <div key={i} className="whitespace-nowrap">{n}</div>)}
        </div>
      )}
      {more > 0 && <div className="mt-1 text-slate-400">…and {more} more</div>}
    </div>
  )
}

// A hoverable/focusable meter segment or chip that reveals its member names.
function Hoverable({ children, items, className = '', style }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`relative ${className}`} tabIndex={0} style={{ cursor: 'pointer', outline: 'none', ...style }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      {open && <TipList items={items} />}
    </span>
  )
}

function Meter({ progress, initiatives }) {
  const total = progress.stations_total || 0
  const phTotal = progress.phases_total || 0

  // Member lists computed client-side (no extra queries).
  const namesByStatus = (s) => initiatives.filter(it => it.status === s).map(it => it.name)
  const namesByFlag = (f) => initiatives.filter(it => it.flag === f).map(it => it.name)
  const phaseNames = (s) => initiatives
    .map(it => { const c = (it.phases || []).filter(p => p.status === s).length; return c ? `${it.name} (${c} ${s})` : null })
    .filter(Boolean)

  const bar = [
    { n: progress.stations_open || 0, cls: 'bg-emerald-500', items: namesByStatus('live') },
    { n: progress.stations_building || 0, cls: 'bg-amber-500', items: namesByStatus('building') },
    { n: progress.stations_planned || 0, cls: 'bg-gray-200 dark:bg-white/10', items: namesByStatus('planned') },
  ]
  const ph = [
    { n: progress.phases_done || 0, cls: 'bg-emerald-500', items: phaseNames('done') },
    { n: progress.phases_building || 0, cls: 'bg-amber-500', items: phaseNames('building') },
    { n: progress.phases_planned || 0, cls: 'bg-gray-200 dark:bg-white/10', items: phaseNames('planned') },
  ]

  return (
    <div className={`${S.card} p-4 space-y-4`}>
      {/* Stations — progress axis (3 segments summing to total) */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{progress.stations_open ?? 0}<span className="text-gray-300 dark:text-slate-600">/{total}</span></div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">Stations open</div>
        </div>
        <div className="flex-1 min-w-[240px]">
          <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-1">{progress.stations_open ?? 0} of {total} stations open</div>
          <div className="flex h-2.5 w-full rounded-full bg-gray-100 dark:bg-white/5">
            {bar.map((s, i) => total > 0 && s.n > 0 && (
              <Hoverable key={i} items={s.items} className="h-full" style={{ width: `${(s.n / total) * 100}%` }}>
                <span className={`block w-full h-full ${s.cls}`} />
              </Hoverable>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
            <span>{progress.stations_building ?? 0} building · {progress.stations_planned ?? 0} still on the table</span>
          </div>
          {/* Flags — condition axis, visually separated */}
          <div className="mt-2 flex items-center gap-3 flex-wrap border-t border-gray-100 dark:border-white/5 pt-2">
            <Hoverable items={namesByFlag('needs_fix')}>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-slate-400"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />{progress.needs_fix ?? 0} need a fix</span>
            </Hoverable>
            <Hoverable items={namesByFlag('parked')}>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-slate-400"><span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-gray-400" />{progress.parked ?? 0} parked</span>
            </Hoverable>
            <span className="text-[10px] italic text-gray-400 dark:text-slate-500">Flags sit on top of the counts above — a station that needs a fix is still open.</span>
          </div>
        </div>
      </div>

      {/* Phases — a third unit, its own bar */}
      <div className="border-t border-gray-100 dark:border-white/5 pt-3">
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-1">
          <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{progress.phases_done ?? 0}</span> of {phTotal} phases done
        </div>
        <div className="flex h-1.5 w-full max-w-[420px] rounded-full bg-gray-100 dark:bg-white/5">
          {ph.map((s, i) => phTotal > 0 && s.n > 0 && (
            <Hoverable key={i} items={s.items} className="h-full" style={{ width: `${(s.n / phTotal) * 100}%` }}>
              <span className={`block w-full h-full ${s.cls}`} />
            </Hoverable>
          ))}
        </div>
        <div className="mt-1 text-[10px] italic text-gray-400 dark:text-slate-500">A station with five phases counts once above, but five times here.</div>
      </div>
    </div>
  )
}

function LineLegend({ lines, canEdit, onEdit }) {
  return (
    <div className={`${S.card} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-slate-500">The lines</h2>
        {canEdit && <button onClick={onEdit} className="text-xs font-medium text-orange-600 dark:text-orange-400 hover:underline">Edit lines</button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {lines.map(l => (
          <div key={l.id} className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="inline-block w-6 h-1.5 rounded-full shrink-0" style={{ background: l.color }} />
              <span className="font-semibold text-sm text-gray-900 dark:text-slate-200 truncate">{l.name}</span>
            </div>
            {l.description && <p className="text-xs text-gray-500 dark:text-slate-400 leading-snug">{l.description}</p>}
          </div>
        ))}
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
