import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { S } from '../../../lib/styles'
import ComboBox from '../../../components/ComboBox'
import { parseLoadsWorkbook } from './loadsParse'
import { buildPlan } from './loadsPlan'
import { stageBatch, loadPendingBatch, applyBatch, discardBatch, linkKey } from './loadsApply'

// Loads ingest — Phase 2 review/approve screen. Upload the TMS "All Loads"
// export → parse + resolve + diff + stage → review New/Updated/Unchanged,
// link any unmatched drivers/trucks/trailers, approve/skip per updated
// load → Apply writes through to loads/load_legs. A pending batch is
// reloaded on mount so a refresh resumes the review.

function fmtVal(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return v.toLocaleString('en-US')
  return String(v)
}
function fieldLabel(f) {
  return ({
    linehaul: 'Linehaul', status: 'Status', pickup_date: 'Pickup date', delivery_date: 'Delivery date',
    driver: 'Driver', truck: 'Truck', trailer: 'Trailer', total_miles: 'Total miles',
  })[f] || f
}

export default function LoadsImport() {
  const { user, canEdit } = useAuth()
  const toast = useToast()
  const fileRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)          // staging or applying
  const [batch, setBatch] = useState(null)
  const [plan, setPlan] = useState([])
  const [counts, setCounts] = useState({})
  // Per-updated-load approve/skip + per-unmatched-entity link choices.
  const [decisions, setDecisions] = useState(() => new Map())
  const [links, setLinks] = useState(() => new Map())
  const [showNew, setShowNew] = useState(false)
  // Fleet pick-lists for linking unmatched entities.
  const [fleet, setFleet] = useState({ drivers: [], trucks: [], trailers: [] })

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const [{ batch: b, plan: p, counts: c }, dRes, tkRes, trRes] = await Promise.all([
      loadPendingBatch(),
      supabase.from('drivers').select('id, full_name').order('full_name'),
      supabase.from('trucks').select('id, unit_number').order('unit_number'),
      supabase.from('trailers').select('id, unit_number').order('unit_number'),
    ])
    setFleet({ drivers: dRes.data || [], trucks: tkRes.data || [], trailers: trRes.data || [] })
    setBatch(b); setPlan(p || []); setCounts(c || {})
    setDecisions(new Map()); setLinks(new Map())
    setLoading(false)
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (file) await handleUpload(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleUpload(file) {
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const { rows, errors } = parseLoadsWorkbook(buf)
      if (errors.length) { toast.error("Couldn't read the file", errors[0]); return }

      // Reference + existing-load data for resolve/diff.
      const loadNumbers = [...new Set(rows.map(r => r.load_number))]
      const [drv, trk, trl, car, cus, dis, exLoads] = await Promise.all([
        supabase.from('drivers').select('id, full_name'),
        supabase.from('trucks').select('id, unit_number'),
        supabase.from('trailers').select('id, unit_number'),
        supabase.from('carriers').select('id, name'),
        supabase.from('customers').select('id, name'),
        supabase.from('dispatchers').select('id, name'),
        supabase.from('loads').select('id, load_number, status, linehaul, pickup_date, delivery_date').in('load_number', loadNumbers),
      ])
      const existingLoads = exLoads.data || []
      let existingLegs = []
      if (existingLoads.length) {
        const { data: legs } = await supabase.from('load_legs')
          .select('id, load_id, driver_raw, truck_raw, trailer_raw, total_miles')
          .in('load_id', existingLoads.map(l => l.id))
        existingLegs = legs || []
      }

      const { plan: built, counts: builtCounts } = buildPlan({
        rows,
        refs: {
          drivers: drv.data || [], trucks: trk.data || [], trailers: trl.data || [],
          carriers: car.data || [], customers: cus.data || [], dispatchers: dis.data || [],
        },
        existing: { loads: existingLoads, legs: existingLegs },
      })

      const { batchId, error } = await stageBatch({ plan: built, counts: builtCounts, filename: file.name, userId: user?.id })
      if (error) { toast.error("Couldn't stage the import", error); return }
      toast.success(`Staged ${file.name} — review below`)
      // Reload from the staged rows (canonical source for review + apply).
      const reloaded = await loadPendingBatch()
      setBatch(reloaded.batch); setPlan(reloaded.plan); setCounts(reloaded.counts || {})
      setDecisions(new Map()); setLinks(new Map())
      void batchId
    } finally {
      setBusy(false)
    }
  }

  // Distinct unmatched entities across all legs, with the importer's fuzzy
  // suggestion, for the link controls.
  const unmatched = useMemo(() => {
    const seen = new Map()
    for (const p of plan) for (const leg of p.legs) {
      for (const type of ['driver', 'truck', 'trailer']) {
        const r = leg.resolved?.[type]
        if (!r || r.match_status !== 'unmatched') continue
        const key = linkKey(type, r.raw)
        if (!seen.has(key)) seen.set(key, { type, raw: r.raw, suggestion: r.suggestion || null, key })
      }
    }
    return [...seen.values()]
  }, [plan])

  const updatedLoads = useMemo(() => plan.filter(p => p.classification === 'updated'), [plan])
  const newLoads = useMemo(() => plan.filter(p => p.classification === 'new'), [plan])
  const unchangedCount = useMemo(() => plan.filter(p => p.classification === 'unchanged').length, [plan])

  function decisionFor(loadNumber) { return decisions.get(loadNumber) || 'approved' }
  function setDecision(loadNumber, d) {
    setDecisions(prev => { const n = new Map(prev); n.set(loadNumber, d); return n })
  }
  function setLink(key, id) {
    setLinks(prev => { const n = new Map(prev); if (id) n.set(key, id); else n.delete(key); return n })
  }

  async function onApply() {
    if (!batch || busy) return
    setBusy(true)
    try {
      const { appliedLoads, appliedLegs, error } = await applyBatch({
        batchId: batch.id, decisions, linkOverrides: links,
      })
      if (error) { toast.error("Apply failed", error); return }
      toast.success(`Applied — ${appliedLoads} load${appliedLoads === 1 ? '' : 's'}, ${appliedLegs} leg${appliedLegs === 1 ? '' : 's'}`)
      await init()
    } finally {
      setBusy(false)
    }
  }

  async function onDiscard() {
    if (!batch || busy) return
    if (!window.confirm('Discard this import batch? Nothing has been written yet.')) return
    setBusy(true)
    try {
      const { error } = await discardBatch(batch.id)
      if (error) { toast.error("Couldn't discard", error); return }
      toast.success('Batch discarded')
      await init()
    } finally {
      setBusy(false)
    }
  }

  const linkOptionsFor = (type) => {
    const list = type === 'driver' ? fleet.drivers : type === 'truck' ? fleet.trucks : fleet.trailers
    return list.map(x => ({
      id: x.id,
      name: type === 'driver' ? x.full_name : x.unit_number,
      searchText: type === 'driver' ? x.full_name : x.unit_number,
    }))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Loads Import</h1>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
            Upload the daily TMS “All Loads” export. Review changes, then apply — nothing is written until you approve.
          </p>
        </div>
        {canEdit && !batch && (
          <div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className={S.btnPrimary}>
              {busy ? 'Reading…' : 'Upload All Loads file'}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="px-4 py-12 text-center"><div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" /></div>
      ) : !batch ? (
        <div className={`${S.card} p-8 text-center`}>
          <p className="text-sm text-gray-500 dark:text-slate-400">No import in progress.</p>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Upload the “All Loads” .xlsx to stage a review.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <Stat label="New" value={counts.new ?? 0} tone="emerald" />
            <Stat label="Updated" value={counts.updated ?? 0} tone="amber" />
            <Stat label="Unchanged" value={counts.unchanged ?? 0} tone="slate" />
            <Stat label="New legs" value={counts.new_legs ?? 0} tone="cyan" />
            <Stat label="New customers" value={counts.new_customers ?? 0} tone="cyan" />
            <Stat label="New dispatchers" value={counts.new_dispatchers ?? 0} tone="cyan" />
            <Stat label="Unmatched" value={counts.unmatched ?? 0} tone={(counts.unmatched ?? 0) > 0 ? 'red' : 'slate'} />
          </div>

          {(counts.status_flags ?? 0) > 0 && (
            <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/[0.06] px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
              ⚠️ {counts.status_flags} load{counts.status_flags === 1 ? '' : 's'} flipped to <span className="font-semibold">Canceled / TONU</span> — review highlighted below.
            </div>
          )}

          {/* Unmatched entities */}
          {unmatched.length > 0 && (
            <Section title={`Unmatched entities (${unmatched.length})`} subtitle="Link each to an existing fleet record, or leave it to import with the raw text and link later. Never auto-linked.">
              <div className="space-y-2">
                {unmatched.map(u => (
                  <div key={u.key} className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700/40 text-gray-500 dark:text-slate-400 w-16 text-center">{u.type}</span>
                    <span className="font-mono text-sm text-gray-900 dark:text-slate-200 min-w-[140px]">{u.raw}</span>
                    {u.suggestion && (
                      <button
                        type="button"
                        onClick={() => setLink(u.key, u.suggestion.id)}
                        className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline"
                        title="Use the suggested match"
                      >
                        suggest: {u.suggestion.name} →
                      </button>
                    )}
                    <div className="w-64">
                      <ComboBox
                        options={linkOptionsFor(u.type)}
                        value={links.get(u.key) || ''}
                        onChange={id => setLink(u.key, id)}
                        placeholder="— Leave unmatched —"
                        searchPlaceholder={`Search ${u.type}s…`}
                        noResultsLabel="No match"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Updated */}
          {updatedLoads.length > 0 && (
            <Section title={`Updated (${updatedLoads.length})`} subtitle="Watched-field changes vs. what's stored. Approve or skip each — skipped loads aren't written.">
              <div className="space-y-3">
                {updatedLoads.map(p => {
                  const skipped = decisionFor(p.load_number) === 'skipped'
                  const legDiffs = p.legs.flatMap(l => l.diffs.map(d => ({ ...d, leg_seq: l.leg_seq })))
                  return (
                    <div key={p.load_number} className={`rounded-xl border p-3 ${skipped ? 'border-gray-200 dark:border-white/5 opacity-60' : 'border-amber-200 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-500/[0.03]'}`}>
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-gray-900 dark:text-slate-200">{p.load_number}</span>
                          {p.is_status_flag && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300">Canceled/TONU</span>
                          )}
                          {p.header.is_team_load && (
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-400">team · {p.legs.length} legs</span>
                          )}
                        </div>
                        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 text-xs">
                          <button onClick={() => setDecision(p.load_number, 'approved')} className={`px-2.5 py-1 ${!skipped ? 'bg-emerald-500 text-slate-900 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>Approve</button>
                          <button onClick={() => setDecision(p.load_number, 'skipped')} className={`px-2.5 py-1 ${skipped ? 'bg-gray-400 dark:bg-slate-600 text-white font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>Skip</button>
                        </div>
                      </div>
                      <ul className="space-y-1 text-xs">
                        {p.header_diffs.map((d, i) => (
                          <DiffRow key={`h${i}`} scope="header" d={d} />
                        ))}
                        {legDiffs.map((d, i) => (
                          <DiffRow key={`l${i}`} scope={`leg ${d.leg_seq}`} d={d} />
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* New (collapsible) */}
          {newLoads.length > 0 && (
            <Section
              title={`New (${newLoads.length})`}
              subtitle="Brand-new loads — applied as-is."
              action={<button onClick={() => setShowNew(s => !s)} className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 hover:underline">{showNew ? 'Hide' : 'Show'}</button>}
            >
              {showNew && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className={S.tableHead}><tr>
                      <th className={S.th}>Load #</th><th className={S.th}>Customer</th>
                      <th className={S.th}>Status</th><th className={`${S.th} text-right`}>Linehaul</th>
                      <th className={`${S.th} text-right`}>Legs</th>
                    </tr></thead>
                    <tbody>
                      {newLoads.map(p => (
                        <tr key={p.load_number} className={S.tableRow}>
                          <td className={`${S.td} font-mono`}>{p.load_number}</td>
                          <td className={S.td}>{p.resolved.customer?.name || '—'}{p.resolved.customer?.match_status === 'to_create' && <span className="ml-1 text-[10px] text-cyan-600 dark:text-cyan-400">(new)</span>}</td>
                          <td className={S.td}>{p.header.status || '—'}</td>
                          <td className={`${S.td} text-right font-mono`}>{p.header.linehaul == null ? '—' : `$${Number(p.header.linehaul).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}</td>
                          <td className={`${S.td} text-right`}>{p.legs.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {unchangedCount > 0 && (
            <p className="text-xs text-gray-400 dark:text-slate-500">{unchangedCount} unchanged load{unchangedCount === 1 ? '' : 's'} — skipped on apply (no writes).</p>
          )}

          {/* Actions */}
          {canEdit && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={onDiscard} disabled={busy} className={S.btnCancel}>Discard batch</button>
              <button onClick={onApply} disabled={busy} className={S.btnSave}>{busy ? 'Applying…' : 'Apply approved'}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  const toneText = {
    emerald: 'text-emerald-700 dark:text-emerald-400', amber: 'text-amber-700 dark:text-amber-400',
    cyan: 'text-cyan-700 dark:text-cyan-400', red: 'text-red-700 dark:text-red-400',
    slate: 'text-gray-900 dark:text-slate-200',
  }[tone] || 'text-gray-900 dark:text-slate-200'
  return (
    <div className={`${S.card} p-3`}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-mono font-medium ${toneText}`}>{value}</p>
    </div>
  )
}

function Section({ title, subtitle, action, children }) {
  return (
    <div className={`${S.card} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function DiffRow({ scope, d }) {
  const isStatusFlip = d.field === 'status'
  return (
    <li className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500 w-14">{scope}</span>
      <span className="text-gray-500 dark:text-slate-400">{fieldLabel(d.field)}:</span>
      <span className="font-mono text-gray-400 dark:text-slate-500 line-through">{fmtVal(d.old)}</span>
      <span className="text-gray-400">→</span>
      <span className={`font-mono ${isStatusFlip ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-900 dark:text-slate-200'}`}>{fmtVal(d.new)}</span>
    </li>
  )
}
