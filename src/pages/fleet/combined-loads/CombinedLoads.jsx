import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { fmtMoney, fmtNum, fmtRpm } from '../loads/spotlight/spotlightShared'

const PRESET_LABEL = { week: 'This week', month: 'This month' }

const DISMISS_REASONS = [
  'Separate trips',
  'One load cancelled',
  'Coincidental overlap',
  'Different truck/trailer',
  'Data / import error',
  'Team load',
  'Other'
]

// Format date range compactly (e.g., "Jun 12 → Jun 16")
function formatDateRange(pickupDate, deliveryDate) {
  const formatDate = (d) => {
    if (!d) return null
    const date = typeof d === 'string' ? new Date(d) : d
    if (isNaN(date.getTime())) return null
    return date
  }

  const pickup = formatDate(pickupDate)
  const delivery = formatDate(deliveryDate)

  if (!pickup && !delivery) return null
  if (!pickup) return `— → ${delivery.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: pickup?.getFullYear() !== delivery?.getFullYear() ? 'numeric' : undefined })}`
  if (!delivery) return `${pickup.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → —`

  const pickupYear = pickup.getFullYear()
  const deliveryYear = delivery.getFullYear()
  const sameYear = pickupYear === deliveryYear

  const pickupStr = pickup.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const deliveryStr = delivery.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric'
  })

  return `${pickupStr} → ${deliveryStr}`
}

function CombinedLoads() {
  const [preset, setPreset] = useState('month')
  const [candidates, setCandidates] = useState(null)
  const [dismissed, setDismissed] = useState(null)
  const [groups, setGroups] = useState(null)
  const [unmappedCities, setUnmappedCities] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const days = preset === 'week' ? 7 : 30

  useEffect(() => {
    loadData()
  }, [days])

  async function loadData() {
    let stale = false
    setLoading(true)
    setError(null)

    try {
      // Load candidates
      const { data: candData, error: candErr } = await supabase.rpc('detect_combined_load_candidates', { p_days: days })
      if (candErr) throw candErr

      // Load existing groups with member loads
      const { data: groupsData, error: groupsErr } = await supabase
        .from('load_combine_groups')
        .select('*')
        .order('created_at', { ascending: false })
      if (groupsErr) throw groupsErr

      // For each group, fetch member loads
      const groupsWithLoads = await Promise.all((groupsData || []).map(async (group) => {
        const { data: loads, error: loadErr } = await supabase
          .from('loads')
          .select('id, load_number, leg_id, origin, destination')
          .eq('combine_group_id', group.id)
        if (loadErr) throw loadErr
        return { ...group, loads: loads || [] }
      }))

      // Load unmapped cities
      const { data: unmappedData, error: unmappedErr } = await supabase.rpc('detect_unmapped_cities', { p_days: days })
      if (unmappedErr) throw unmappedErr

      // Load dismissed pairs
      const { data: dismissedData, error: dismissedErr } = await supabase
        .from('load_combine_dismissals')
        .select('*')
        .order('dismissed_at', { ascending: false })
      if (dismissedErr) throw dismissedErr

      if (!stale) {
        setCandidates(candData || [])
        setDismissed(dismissedData || [])
        setGroups(groupsWithLoads)
        setUnmappedCities(unmappedData || [])
      }
    } catch (err) {
      if (!stale) {
        console.error('Failed to load combined loads data:', err)
        setError(err.message || 'Failed to load data')
      }
    } finally {
      if (!stale) setLoading(false)
    }

    return () => { stale = true }
  }

  if (error) {
    return (
      <div className={`${S.card} p-4 text-center text-sm text-red-600 dark:text-red-400`}>
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Fleet
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Combined Loads</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
          Tag loads traveling the same corridor to correct their RPM with true combined mileage.
        </p>
      </div>

      {/* Preset toggle */}
      <div className="flex items-center gap-2">
        {['week', 'month'].map(p => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
              preset === p
                ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400'
                : 'border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-white/5'
            }`}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>

      {/* Section 1: Candidates */}
      {loading ? (
        <div className={`${S.card} h-64 flex items-center justify-center`}>
          <div className="text-sm text-gray-400 dark:text-slate-500">Loading…</div>
        </div>
      ) : (
        <>
          <CandidatesSection candidates={candidates || []} onRefresh={loadData} />

          {/* Section 2: Dismissed */}
          <DismissedSection dismissed={dismissed || []} onRefresh={loadData} />

          {/* Section 3: Existing groups */}
          <ExistingGroupsSection groups={groups || []} onRefresh={loadData} />

          {/* Section 4: Unmapped cities */}
          <UnmappedCitiesSection cities={unmappedCities || []} />
        </>
      )}
    </div>
  )
}

function CandidatesSection({ candidates, onRefresh }) {
  const [showForm, setShowForm] = useState(false)
  const [showDismiss, setShowDismiss] = useState(false)
  const [selectedPair, setSelectedPair] = useState(null)

  const activeCandidates = candidates.filter(c => !c.already_grouped)

  const handleCombine = (pair) => {
    setSelectedPair(pair)
    setShowForm(true)
  }

  const handleDismissClick = (pair) => {
    setSelectedPair(pair)
    setShowDismiss(true)
  }

  const handleSave = async () => {
    setShowForm(false)
    setSelectedPair(null)
    onRefresh()
  }

  const handleDismissClose = () => {
    setShowDismiss(false)
    setSelectedPair(null)
  }

  const handleDismissSave = async () => {
    handleDismissClose()
    onRefresh()
  }

  return (
    <>
      <div className={`${S.card}`}>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Candidates to review</h2>
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">{activeCandidates.length} pairs ready to combine</p>
        </div>

        {activeCandidates.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
            No combined load candidates in the selected period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={`${S.tableHead} bg-white dark:bg-[#0d0d1f]`}>
                <tr>
                  <th className={`${S.th} !px-4`}>Driver</th>
                  <th className={`${S.th} !px-3`}>Load A</th>
                  <th className={`${S.th} !px-3`}>Load B</th>
                  <th className={`${S.th} !px-3 text-right`}>Overlap</th>
                  <th className={`${S.th} !px-3`}>Same Trailer</th>
                  <th className={`${S.th} !px-3 text-right`}>Combined Linehaul</th>
                  <th className={`${S.th} !px-3 text-right`}>Naive RPM</th>
                  <th className={`${S.th} !px-3`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeCandidates.map((pair, idx) => (
                  <tr key={idx} className={S.tableRow}>
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-slate-200">{pair.driver_name}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                      <div>{pair.load_a}</div>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500">{pair.lane_a}</div>
                      {formatDateRange(pair.pickup_a, pair.delivery_a) && (
                        <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{formatDateRange(pair.pickup_a, pair.delivery_a)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                      <div>{pair.load_b}</div>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500">{pair.lane_b}</div>
                      {formatDateRange(pair.pickup_b, pair.delivery_b) && (
                        <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{formatDateRange(pair.pickup_b, pair.delivery_b)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-400">{pair.overlap_days}d</td>
                    <td className="px-3 py-2 text-center">{pair.same_trailer ? '✓' : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900 dark:text-slate-200">${pair.combined_linehaul.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-600 dark:text-amber-400">{fmtRpm(pair.naive_rpm)}</td>
                    <td className="px-3 py-2 flex gap-1.5">
                      <button
                        onClick={() => handleCombine(pair)}
                        className="px-2.5 py-1 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
                      >
                        Combine
                      </button>
                      <button
                        onClick={() => handleDismissClick(pair)}
                        className="px-2.5 py-1 text-xs font-medium border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                      >
                        Not combined
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && selectedPair && (
        <CreateGroupForm pair={selectedPair} onClose={() => setShowForm(false)} onSave={handleSave} />
      )}

      {showDismiss && selectedPair && (
        <DismissModal pair={selectedPair} onClose={handleDismissClose} onSave={handleDismissSave} />
      )}
    </>
  )
}

function CreateGroupForm({ pair, onClose, onSave }) {
  const [loads, setLoads] = useState([pair.load_a, pair.load_b])
  const [loadInput, setLoadInput] = useState('')
  const [trueMiles, setTrueMiles] = useState('')
  const [label, setLabel] = useState(`${pair.driver_name} · ${pair.lane_a} + ${pair.lane_b}`)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const combinedLinehaul = pair.combined_linehaul
  const displayMiles = trueMiles ? Number(trueMiles) : pair.summed_miles
  const correctedRpm = displayMiles > 0 ? combinedLinehaul / displayMiles : null

  const handleAddLoad = async () => {
    if (!loadInput.trim()) return

    // Search for the load by load_number
    const { data, error } = await supabase
      .from('loads')
      .select('load_number')
      .ilike('load_number', `%${loadInput.trim()}%`)
      .limit(1)

    if (error || !data?.length) {
      alert('Load not found')
      return
    }

    const loadNumber = data[0].load_number
    if (!loads.includes(loadNumber)) {
      setLoads([...loads, loadNumber])
    }
    setLoadInput('')
  }

  const handleRemoveLoad = (load) => {
    if (loads.length > 1) {
      setLoads(loads.filter(l => l !== load))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data: currentUser } = await supabase.auth.getUser()
      if (!currentUser?.user?.id) throw new Error('Not authenticated')

      // Create group
      const { data: groupData, error: groupErr } = await supabase
        .from('load_combine_groups')
        .insert([{
          label,
          notes,
          true_combined_miles: trueMiles ? Number(trueMiles) : null,
          created_by: currentUser.user.id,
        }])
        .select()

      if (groupErr) throw groupErr
      const groupId = groupData[0].id

      // Update loads to reference this group
      const { error: updateErr } = await supabase
        .from('loads')
        .update({ combine_group_id: groupId })
        .in('load_number', loads)

      if (updateErr) throw updateErr

      onSave()
    } catch (err) {
      console.error('Failed to create group:', err)
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`${S.card} w-full max-w-md max-h-screen overflow-y-auto`}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Combine loads</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {/* Member loads */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Member loads</label>
            <div className="space-y-2 mb-3">
              {loads.map(load => (
                <div key={load} className="flex items-center justify-between bg-gray-50 dark:bg-white/5 px-3 py-2 rounded text-sm">
                  <span className="text-gray-900 dark:text-white">{load}</span>
                  {loads.length > 1 && (
                    <button onClick={() => handleRemoveLoad(load)} className="text-red-600 dark:text-red-400 hover:text-red-700">−</button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={loadInput}
                onChange={e => setLoadInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleAddLoad()}
                placeholder="Search load number…"
                className={`${S.input} flex-1 text-sm`}
              />
              <button onClick={handleAddLoad} className="px-3 py-2 bg-orange-500 text-white text-sm rounded font-medium hover:bg-orange-600 whitespace-nowrap">Add</button>
            </div>
          </div>

          {/* True combined miles */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">True combined miles</label>
            <input
              type="number"
              value={trueMiles}
              onChange={e => setTrueMiles(e.target.value)}
              placeholder={`${pair.summed_miles} (default)`}
              className={`${S.input} w-full text-sm`}
            />
            <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">From TMS. If blank, uses combined leg miles ({pair.summed_miles}).</p>
          </div>

          {/* Label */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              className={`${S.input} w-full text-sm`}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className={`${S.input} w-full text-sm h-20 resize-none`}
            />
          </div>

          {/* Live preview */}
          <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded p-3 text-sm">
            <div className="text-blue-900 dark:text-blue-300">
              <div className="font-semibold">Corrected RPM</div>
              <div className="text-lg font-mono mt-1">
                {correctedRpm ? `${fmtRpm(correctedRpm)}/mi` : '—'} {correctedRpm && <span className="text-[10px] ml-2">(was {fmtRpm(pair.naive_rpm)}/mi)</span>}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 dark:border-slate-700 rounded font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || loads.length < 2} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DismissModal({ pair, onClose, onSave }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const { data: currentUser } = await supabase.auth.getUser()
      if (!currentUser?.user?.id) throw new Error('Not authenticated')

      const pairLabel = `${pair.driver_name} · ${pair.lane_a} + ${pair.lane_b}`

      const { error } = await supabase
        .from('load_combine_dismissals')
        .insert([{
          load_a_number: pair.load_a,
          load_b_number: pair.load_b,
          pair_label: pairLabel,
          reason: reason || null,
          note: note || null,
          dismissed_by: currentUser.user.id,
        }])

      if (error) throw error
      onSave()
    } catch (err) {
      console.error('Failed to dismiss pair:', err)
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`${S.card} w-full max-w-md`}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Not a combined load</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-sm text-gray-600 dark:text-slate-400">
            <div className="font-mono text-xs text-gray-500 dark:text-slate-500 mb-1">Pair: {pair.load_a} / {pair.load_b}</div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Reason (optional)</label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              className={`${S.input} w-full text-sm`}
            >
              <option value="">— Select a reason —</option>
              {DISMISS_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add context if helpful…"
              className={`${S.input} w-full text-sm h-16 resize-none`}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 dark:border-slate-700 rounded font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Dismiss'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DismissedSection({ dismissed, onRefresh }) {
  const handleRestore = async (dismissalId, loadA, loadB) => {
    if (!confirm(`Restore ${loadA} / ${loadB}?`)) return

    try {
      const { error } = await supabase
        .from('load_combine_dismissals')
        .delete()
        .eq('id', dismissalId)

      if (error) throw error
      onRefresh()
    } catch (err) {
      console.error('Failed to restore pair:', err)
      alert('Error: ' + err.message)
    }
  }

  return (
    <div className={`${S.card}`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Dismissed ({dismissed.length})</h2>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Reviewed pairs you've excluded from combining</p>
      </div>

      {dismissed.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
          No dismissed pairs yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/5">
          {dismissed.map((d) => (
            <div key={d.id} className="px-4 py-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{d.pair_label || `${d.load_a_number} / ${d.load_b_number}`}</p>
                  {d.reason && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">Reason: {d.reason}</p>}
                  {d.note && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">Note: {d.note}</p>}
                  <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-2">
                    Dismissed {new Date(d.dismissed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(d.id, d.load_a_number, d.load_b_number)}
                  className="px-2.5 py-1 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors whitespace-nowrap ml-4"
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExistingGroupsSection({ groups, onRefresh }) {
  const [editingId, setEditingId] = useState(null)
  const [editingMiles, setEditingMiles] = useState('')

  const handleEditSave = async (groupId) => {
    try {
      const miles = editingMiles ? Number(editingMiles) : null
      const { error } = await supabase
        .from('load_combine_groups')
        .update({ true_combined_miles: miles, updated_at: new Date() })
        .eq('id', groupId)

      if (error) throw error
      setEditingId(null)
      onRefresh()
    } catch (err) {
      console.error('Failed to update group:', err)
      alert('Error: ' + err.message)
    }
  }

  const handleDelete = async (groupId) => {
    if (!confirm('Delete this combined load group?')) return

    try {
      const { error } = await supabase
        .from('load_combine_groups')
        .delete()
        .eq('id', groupId)

      if (error) throw error
      onRefresh()
    } catch (err) {
      console.error('Failed to delete group:', err)
      alert('Error: ' + err.message)
    }
  }

  return (
    <div className={`${S.card}`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Existing groups</h2>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">{groups.length} active groups</p>
      </div>

      {groups.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
          No combined load groups yet.
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/5">
          {groups.map(group => {
            const combinedRevenue = (group.loads || []).reduce((sum, l) => sum + (Number(l.revenue) || 0), 0)
            const combinedMiles = group.true_combined_miles || (group.loads || []).reduce((sum, l) => sum + (Number(l.miles) || 0), 0)
            const correctedRpm = combinedMiles > 0 ? combinedRevenue / combinedMiles : null

            return (
              <div key={group.id} className="px-4 py-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{group.label}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-500">{group.loads?.length || 0} loads · {fmtRpm(correctedRpm)}/mi</p>
                  </div>
                  <button onClick={() => handleDelete(group.id)} className="px-2.5 py-1 text-xs font-semibold bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">Delete</button>
                </div>
                {group.notes && <p className="text-xs text-gray-600 dark:text-slate-400 mb-2">{group.notes}</p>}
                <div className="text-xs text-gray-600 dark:text-slate-400 space-y-1">
                  <div>Loads: {(group.loads || []).map(l => l.load_number).join(', ')}</div>
                  <div>
                    True miles:{' '}
                    {editingId === group.id ? (
                      <div className="inline-flex gap-1">
                        <input
                          type="number"
                          value={editingMiles}
                          onChange={e => setEditingMiles(e.target.value)}
                          className={`${S.input} w-20 text-xs px-2 py-1`}
                        />
                        <button onClick={() => handleEditSave(group.id)} className="text-xs text-orange-600 dark:text-orange-400 hover:underline">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                      </div>
                    ) : (
                      <span>
                        {group.true_combined_miles ? fmtNum(group.true_combined_miles) : 'Not set'}{' '}
                        <button onClick={() => { setEditingId(group.id); setEditingMiles(group.true_combined_miles || ''); }} className="text-orange-600 dark:text-orange-400 hover:underline">[edit]</button>
                      </span>
                    )}
                  </div>
                  <div>Revenue: {fmtMoney(combinedRevenue)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function UnmappedCitiesSection({ cities }) {
  return (
    <div className={`${S.card}`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Unmapped cities</h2>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">{cities.length} cities with no coordinates</p>
      </div>

      {cities.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
          All cities are mapped.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className={`${S.tableHead} bg-white dark:bg-[#0d0d1f]`}>
              <tr>
                <th className={`${S.th} !px-4`}>City</th>
                <th className={`${S.th} !px-3`}>Role</th>
                <th className={`${S.th} !px-3 text-right`}>Occurrences</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((city, idx) => (
                <tr key={idx} className={S.tableRow}>
                  <td className="px-4 py-2 text-gray-900 dark:text-slate-200">{city.place}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{city.role}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-400">{city.occurrences}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default CombinedLoads
