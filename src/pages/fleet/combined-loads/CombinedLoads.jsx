import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { withTimeout } from '../../../lib/withTimeout'
import { ErrorRetry, TableSkeleton } from '../../../components/Loading'
import { S } from '../../../lib/styles'
import CopyButton from '../../../components/CopyButton'
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

// Extract a member load's lane from its pu_info/del_info. These are plain TMS
// text strings ("City, ST, US (TZ) date time …"), not JSON — so we take the
// "City, ST" prefix before ", US", the same way v_load_leg_profit and the
// loads importer resolve origin/destination. (The old JSON.parse always threw,
// which is why every member row read "Unknown lane".)
// Miles with two decimals and thousands separators, e.g. 4,971.70.
const fmtMiles = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function extractLanes(puInfo, delInfo) {
  const cityLabel = (info) => String(info || '').split(/,\s*US\b/i)[0].trim()
  const origin = cityLabel(puInfo)
  const destination = cityLabel(delInfo)
  return origin && destination ? `${origin} → ${destination}` : 'Unknown lane'
}

// Parse a date-only value WITHOUT a timezone shift. `new Date('2026-07-06')`
// parses as UTC midnight and renders a day early in a negative-offset zone
// (CT = UTC−6); building from the Y-M-D parts constructs local midnight, so the
// calendar day is preserved. Already-a-Date and other formats pass through.
function parseYmdLocal(d) {
  if (!d) return null
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? null : dt
}

// Format date range compactly (e.g., "Jun 12 → Jun 16")
function formatDateRange(pickupDate, deliveryDate) {
  const formatDate = parseYmdLocal

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

// Compact date parts for a pickup→delivery line: pickup shows month/day,
// delivery adds the year only when it differs. '—' for a missing end; null when
// neither date is present. Splits formatDateRange so candidate rows can
// interleave clock times per side.
function dateRangeParts(pickupDate, deliveryDate) {
  const toDate = parseYmdLocal
  const pickup = toDate(pickupDate), delivery = toDate(deliveryDate)
  if (!pickup && !delivery) return null
  const diffYear = pickup && delivery && pickup.getFullYear() !== delivery.getFullYear()
  const pStr = pickup ? pickup.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
  const dStr = delivery
    ? delivery.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffYear ? 'numeric' : undefined })
    : '—'
  return { pStr, dStr }
}

// Muted 24h appointment time appended to a date, e.g. "…, 12:00". Renders
// nothing when the time is null/empty so there's no stray comma.
function TimeSuffix({ time }) {
  if (!time) return null
  return <span className="text-gray-500 dark:text-slate-400">, {time}</span>
}

// Candidate-row pickup→delivery line with each date's clock time appended
// (muted, secondary). Renders nothing when there are no dates.
function LoadSchedule({ pickupDate, pickupTime, deliveryDate, deliveryTime }) {
  const parts = dateRangeParts(pickupDate, deliveryDate)
  if (!parts) return null
  return (
    <div className="text-[10px] text-gray-600 dark:text-slate-300 mt-0.5">
      {parts.pStr}<TimeSuffix time={pickupTime} /> → {parts.dStr}<TimeSuffix time={deliveryTime} />
    </div>
  )
}

// Default number of rows a capped list shows before "Show all (N)".
const LIST_CAP = 5

// In-memory truncation for client-loaded lists: show the first LIST_CAP
// items, expandable to the full list. Order is preserved (caller passes the
// list already sorted newest-first).
function useCappedList(items, cap = LIST_CAP) {
  const [expanded, setExpanded] = useState(false)
  const total = items.length
  const visible = expanded ? items : items.slice(0, cap)
  return { visible, expanded, toggle: () => setExpanded(e => !e), total, hasMore: total > cap }
}

// "Show all (N)" / "Show fewer" control. Renders nothing when the list fits
// within the cap.
function ShowMoreToggle({ expanded, total, hasMore, onToggle }) {
  if (!hasMore) return null
  return (
    <div className="px-4 py-3 border-t border-gray-100 dark:border-white/5">
      <button
        onClick={onToggle}
        className="text-xs font-semibold text-orange-600 dark:text-orange-400 hover:underline"
      >
        {expanded ? 'Show fewer' : `Show all (${total})`}
      </button>
    </div>
  )
}

function CombinedLoads() {
  const [preset, setPreset] = useState('month')
  const [candidates, setCandidates] = useState(null)
  const [dismissed, setDismissed] = useState(null)
  const [groups, setGroups] = useState(null)
  const [unmappedCities, setUnmappedCities] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const days = preset === 'week' ? 7 : 30

  useEffect(() => {
    loadData()
  }, [days])

  async function loadData() {
    let stale = false
    setLoading(true)
    setError(false)

    try {
      // Load candidates
      const { data: candData, error: candErr } = await withTimeout(signal => supabase.rpc('detect_combined_load_candidates', { p_days: days }).abortSignal(signal))
      if (candErr) throw candErr

      // Load dismissed pairs
      const { data: dismissedData, error: dismissedErr } = await withTimeout(signal => supabase
        .from('load_combine_dismissals')
        .select('*')
        .order('dismissed_at', { ascending: false })
        .abortSignal(signal))
      if (dismissedErr) throw dismissedErr

      // Load unmapped cities
      const { data: unmappedData, error: unmappedErr } = await withTimeout(signal => supabase.rpc('detect_unmapped_cities', { p_days: days }).abortSignal(signal))
      if (unmappedErr) throw unmappedErr

      // Load existing groups with member loads (graceful degradation on error)
      let groupsWithLoads = []
      try {
        const { data: groupsData, error: groupsErr } = await withTimeout(signal => supabase
          .from('load_combine_groups')
          .select('*')
          .order('created_at', { ascending: false })
          .abortSignal(signal))
        if (groupsErr) throw groupsErr

        // For each group, fetch member loads and calculate corrected metrics
        groupsWithLoads = await Promise.all((groupsData || []).map(async (group) => {
          const { data: loads, error: loadErr } = await withTimeout(signal => supabase
            .from('loads')
            .select('id, load_number, pu_info, del_info, pickup_date, delivery_date, linehaul, combine_group_id')
            .eq('combine_group_id', group.id)
            .abortSignal(signal))
          if (loadErr) throw loadErr

          // Fetch profit data for the group's loads to calculate corrected RPM
          const { data: profitData, error: profitErr } = await withTimeout(signal => supabase
            .from('v_load_leg_profit')
            .select('leg_revenue, leg_total_miles, load_number')
            .in('load_number', (loads || []).map(l => l.load_number))
            .abortSignal(signal))
          if (profitErr) throw profitErr

          // Calculate group metrics from profit view
          const totalRevenue = (profitData || []).reduce((sum, p) => sum + Number(p.leg_revenue || 0), 0)
          const totalMiles = (profitData || []).reduce((sum, p) => sum + Number(p.leg_total_miles || 0), 0)
          const correctedRpm = totalMiles > 0 ? totalRevenue / totalMiles : null

          return {
            ...group,
            loads: (loads || []).map(l => ({
              ...l,
              lanes: extractLanes(l.pu_info, l.del_info)
            })),
            totalRevenue,
            totalMiles,
            correctedRpm
          }
        }))
      } catch (groupErr) {
        console.error('Failed to load groups:', groupErr)
        // Keep the rest of the page functional; just skip groups
        groupsWithLoads = []
      }

      if (!stale) {
        setCandidates(candData || [])
        setDismissed(dismissedData || [])
        setGroups(groupsWithLoads)
        setUnmappedCities(unmappedData || [])
      }
    } catch (err) {
      if (!stale) {
        // Never leak the exception to the UI — log it, flag the error state.
        console.error('Failed to load combined loads data:', err)
        setError(true)
      }
    } finally {
      if (!stale) setLoading(false)
    }

    return () => { stale = true }
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
      {error ? (
        <ErrorRetry message="Couldn't load combined loads." onRetry={loadData} />
      ) : loading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : (
        <>
          <CandidatesSection candidates={candidates || []} groups={groups || []} onRefresh={loadData} />

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

function CandidatesSection({ candidates, groups, onRefresh }) {
  const [showForm, setShowForm] = useState(false)
  const [showDismiss, setShowDismiss] = useState(false)
  const [selectedPair, setSelectedPair] = useState(null)
  const [viewGroup, setViewGroup] = useState(null) // existing group opened via "View group"

  // Don't filter out already-grouped pairs — the overlap is real and adding a
  // third load to an existing group is a legitimate action. They get a warning
  // instead. (This filter used to be a no-op because the detector always
  // returned already_grouped=false; now that it works, filtering would hide
  // the only route to those rows.)
  const flaggedCount = candidates.filter(c => c.already_grouped).length
  const { visible: visibleCandidates, expanded, toggle, total, hasMore } = useCappedList(candidates)

  // "View group" opens the EXISTING group (its members), not the candidate pair.
  // Prefer the fully-hydrated group from the page's groups list; fall back to
  // the members string the detector returned if it isn't loaded.
  const openGroup = (groupId, membersStr) => {
    const g = groups.find(x => x.id === groupId)
    setViewGroup(g || {
      id: groupId,
      label: membersStr || '',
      loads: String(membersStr || '').split('+').map(s => ({ load_number: s.trim() })).filter(l => l.load_number),
      true_combined_miles: null, totalMiles: 0, totalRevenue: 0, correctedRpm: null,
    })
  }

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
          <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">
            {candidates.length} pairs ready to combine
            {flaggedCount > 0 && ` · ${flaggedCount} involve a load you've already combined`}
          </p>
        </div>

        {candidates.length === 0 ? (
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
                {visibleCandidates.map((pair, idx) => {
                  const flagged = !!pair.already_grouped
                  return (
                  <tr key={idx} className={`${S.tableRow} ${flagged ? 'bg-[#FFFDF7] dark:bg-amber-500/[0.06]' : ''}`}>
                    <td className={`px-4 py-2 font-medium text-gray-900 dark:text-slate-200 ${flagged ? 'shadow-[inset_3px_0_0_0_#F59E0B]' : ''}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {pair.driver_name}
                        {pair.driver_name && <CopyButton value={pair.driver_name} label="Copy driver name" />}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 align-top">
                      <div>{pair.load_a}</div>
                      <div className="text-[10px] text-gray-600 dark:text-slate-400">{pair.lane_a}</div>
                      <LoadSchedule pickupDate={pair.pickup_a} pickupTime={pair.pickup_time_a} deliveryDate={pair.delivery_a} deliveryTime={pair.delivery_time_a} />
                      {flagged && pair.a_group_members && (
                        <AlreadyGroupedNote members={pair.a_group_members} onView={() => openGroup(pair.a_group_id, pair.a_group_members)} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 align-top">
                      <div>{pair.load_b}</div>
                      <div className="text-[10px] text-gray-600 dark:text-slate-400">{pair.lane_b}</div>
                      <LoadSchedule pickupDate={pair.pickup_b} pickupTime={pair.pickup_time_b} deliveryDate={pair.delivery_b} deliveryTime={pair.delivery_time_b} />
                      {flagged && pair.b_group_members && (
                        <AlreadyGroupedNote members={pair.b_group_members} onView={() => openGroup(pair.b_group_id, pair.b_group_members)} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-400 align-top">{pair.overlap_days}d</td>
                    <td className="px-3 py-2 text-center align-top">{pair.same_trailer ? '✓' : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-900 dark:text-slate-200 align-top">${pair.combined_linehaul.toFixed(0)}</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-600 dark:text-amber-400 align-top">{fmtRpm(pair.naive_rpm)}</td>
                    <td className="px-3 py-2 flex gap-1.5 align-top">
                      <button
                        onClick={() => handleCombine(pair)}
                        className={flagged
                          ? 'px-2.5 py-1 text-xs font-semibold bg-white dark:bg-white/5 border border-[#E3E6EA] dark:border-slate-600 text-[#6B7280] dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-white/10 transition-colors'
                          : 'px-2.5 py-1 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors'}
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
                  )
                })}
              </tbody>
            </table>
            <ShowMoreToggle expanded={expanded} total={total} hasMore={hasMore} onToggle={toggle} />
          </div>
        )}
      </div>

      {showForm && selectedPair && (
        <CreateGroupForm pair={selectedPair} onClose={() => setShowForm(false)} onSave={handleSave} />
      )}

      {viewGroup && (
        <CreateGroupForm group={viewGroup} onClose={() => setViewGroup(null)} onSave={() => { setViewGroup(null); onRefresh() }} />
      )}

      {showDismiss && selectedPair && (
        <DismissModal pair={selectedPair} onClose={handleDismissClose} onSave={handleDismissSave} />
      )}
    </>
  )
}

// Amber inline note under a load cell whose load is already in a combine group.
// Fixed light-mode palette per spec; dark variants keep it readable on a dark row.
function AlreadyGroupedNote({ members, onView }) {
  return (
    <div className="mt-1 inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-[7px] px-2 py-1 text-[11.3px] leading-tight bg-[#FEF6E7] dark:bg-amber-500/10 border border-[#FBE3B4] dark:border-amber-500/25 text-[#92610A] dark:text-amber-300">
      <span>Already combined as <span className="font-semibold text-[#7C4A06] dark:text-amber-200">{members}</span></span>
      <span aria-hidden className="text-[#D6B25E] dark:text-amber-500/50">·</span>
      <button type="button" onClick={onView} className="font-semibold text-[#EA6A0A] dark:text-orange-400 hover:underline">
        View group
      </button>
    </div>
  )
}

// Serves two modes: creating a group from a candidate `pair`, or opening an
// existing `group` (the "View group" action). In group mode it seeds from the
// group and updates it on save, so adding a third load attaches to the existing
// group rather than spawning a duplicate.
function CreateGroupForm({ pair, group, onClose, onSave }) {
  const isGroup = !!group
  const [loads, setLoads] = useState(
    isGroup ? (group.loads || []).map(l => l.load_number) : [pair.load_a, pair.load_b]
  )
  const [loadInput, setLoadInput] = useState('')
  const [addError, setAddError] = useState('')
  const [trueMiles, setTrueMiles] = useState(
    isGroup && group.true_combined_miles != null ? String(group.true_combined_miles) : ''
  )
  const [editedLabel, setEditedLabel] = useState(isGroup ? (group.label || '') : '')
  const [labelTouched, setLabelTouched] = useState(isGroup) // keep an existing group's label
  const [notes, setNotes] = useState(isGroup ? (group.notes || '') : '')
  const [memberData, setMemberData] = useState({}) // load_number → { linehaul, total_miles, pickup_date, origin, destination }
  const [saving, setSaving] = useState(false)

  // Everything below the member list derives from the CURRENT members. Fetch each
  // member's linehaul + leg miles whenever the list changes, so add/remove
  // recomputes the RPM instead of freezing the candidate pair the modal opened on.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!loads.length) { if (!cancelled) setMemberData({}); return }
      const cityOf = (info) => String(info || '').split(/,\s*US\b/i)[0].trim()
      const [{ data: ldRows }, { data: pfRows }] = await Promise.all([
        supabase.from('loads').select('load_number, linehaul, pickup_date, pu_info, del_info').in('load_number', loads),
        supabase.from('v_load_leg_profit').select('load_number, leg_total_miles').in('load_number', loads),
      ])
      if (cancelled) return
      const milesByLn = new Map((pfRows || []).map(p => [p.load_number, Number(p.leg_total_miles || 0)]))
      const map = {}
      for (const l of (ldRows || [])) {
        map[l.load_number] = {
          linehaul: Number(l.linehaul || 0),
          total_miles: milesByLn.get(l.load_number) || 0,
          pickup_date: l.pickup_date,
          origin: cityOf(l.pu_info),
          destination: cityOf(l.del_info),
        }
      }
      setMemberData(map)
    })()
    return () => { cancelled = true }
  }, [loads])

  const orderedMembers = useMemo(() =>
    loads.map(ln => ({ load_number: ln, ...(memberData[ln] || {}) }))
      .sort((a, b) => String(a.pickup_date || '').localeCompare(String(b.pickup_date || ''))),
    [loads, memberData])

  const memberRevenue = orderedMembers.reduce((s, m) => s + (m.linehaul || 0), 0)
  const summedLegMiles = orderedMembers.reduce((s, m) => s + (m.total_miles || 0), 0)
  const effectiveMiles = trueMiles.trim() ? Number(trueMiles) : summedLegMiles
  const correctedRpm = effectiveMiles > 0 ? memberRevenue / effectiveMiles : null
  const naiveRpm = summedLegMiles > 0 ? memberRevenue / summedLegMiles : null
  const noCorrection = !trueMiles.trim()

  // Label follows the members (driver · first origin → last destination, ordered
  // by pickup) until the user edits it.
  const autoLabel = useMemo(() => {
    const driver = pair?.driver_name || ''
    const first = orderedMembers[0]?.origin
    const last = orderedMembers[orderedMembers.length - 1]?.destination
    const lane = first && last ? `${first} → ${last}` : ''
    return [driver, lane].filter(Boolean).join(' · ')
  }, [orderedMembers, pair])
  const label = labelTouched ? editedLabel : (autoLabel || editedLabel)

  const handleAddLoad = async () => {
    const q = loadInput.trim()
    if (!q) return

    // Search for the load by load_number; also read status to exclude the TMS's
    // own combined load ("Dont Factor"), which would double-count the revenue.
    const { data, error } = await supabase
      .from('loads')
      .select('load_number, status')
      .ilike('load_number', `%${q}%`)
      .limit(1)

    if (error || !data?.length) { setAddError('Load not found.'); return }

    const row = data[0]
    if (String(row.status || '') === 'Dont Factor') {
      setAddError(`${row.load_number} is the TMS's own combined load for this trip. Adding it here would count the same revenue twice.`)
      return
    }
    if (!loads.includes(row.load_number)) setLoads([...loads, row.load_number])
    setLoadInput('')
    setAddError('')
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

      // Group mode: update the existing group and (re)attach its members — so a
      // newly added third load joins THIS group instead of creating a new one.
      const groupId = isGroup
        ? group.id
        : (await (async () => {
            const { data: groupData, error: groupErr } = await supabase
              .from('load_combine_groups')
              .insert([{ label, notes, true_combined_miles: trueMiles ? Number(trueMiles) : null, created_by: currentUser.user.id }])
              .select()
            if (groupErr) throw groupErr
            return groupData[0].id
          })())

      if (isGroup) {
        const { error: updGroupErr } = await supabase
          .from('load_combine_groups')
          .update({ label, notes, true_combined_miles: trueMiles ? Number(trueMiles) : null, updated_at: new Date() })
          .eq('id', groupId)
        if (updGroupErr) throw updGroupErr
      }

      // Point member loads at the group.
      const { error: updateErr } = await supabase
        .from('loads')
        .update({ combine_group_id: groupId })
        .in('load_number', loads)

      if (updateErr) throw updateErr

      onSave()
    } catch (err) {
      console.error(isGroup ? 'Failed to update group:' : 'Failed to create group:', err)
      alert('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`${S.card} w-full max-w-md max-h-screen overflow-y-auto`}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{isGroup ? 'Combined group' : 'Combine loads'}</h3>
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
                onChange={e => { setLoadInput(e.target.value); if (addError) setAddError('') }}
                onKeyPress={e => e.key === 'Enter' && handleAddLoad()}
                placeholder="Search load number…"
                className={`${S.input} flex-1 text-sm`}
              />
              <button onClick={handleAddLoad} className="px-3 py-2 bg-orange-500 text-white text-sm rounded font-medium hover:bg-orange-600 whitespace-nowrap">Add</button>
            </div>
            {addError && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 rounded px-2 py-1.5">{addError}</p>
            )}
          </div>

          {/* Running summary — so the arithmetic behind the RPM is visible */}
          <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded px-3 py-2 text-sm font-mono text-gray-700 dark:text-slate-300 tabular-nums">
            {orderedMembers.length} load{orderedMembers.length === 1 ? '' : 's'} · {fmtMoney(memberRevenue)} · {fmtMiles(summedLegMiles)} leg miles
          </div>

          {/* True combined miles */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">True combined miles</label>
            <input
              type="number"
              value={trueMiles}
              onChange={e => setTrueMiles(e.target.value)}
              placeholder={`${fmtMiles(summedLegMiles)} (default)`}
              className={`${S.input} w-full text-sm`}
            />
            {noCorrection ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                From TMS. If blank, uses combined leg miles ({fmtMiles(summedLegMiles)}). Leave this blank and nothing is corrected — the summed leg miles overstate a real multi-stop trip.
              </p>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">From TMS. If blank, uses combined leg miles ({fmtMiles(summedLegMiles)}).</p>
            )}
          </div>

          {/* Label */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={e => { setEditedLabel(e.target.value); setLabelTouched(true) }}
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

          {/* Live preview — recomputed from the current members */}
          <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded p-3 text-sm">
            <div className="text-blue-900 dark:text-blue-300">
              <div className="font-semibold">Corrected RPM</div>
              <div className="text-lg font-mono mt-1">
                {correctedRpm ? `${fmtRpm(correctedRpm)}/mi` : '—'} {correctedRpm && naiveRpm && <span className="text-[10px] ml-2">(was {fmtRpm(naiveRpm)}/mi)</span>}
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
  const [confirmRestore, setConfirmRestore] = useState(null)
  const { visible: visibleDismissed, expanded, toggle, total, hasMore } = useCappedList(dismissed)

  const handleRestoreClick = (dismissalId, loadA, loadB) => {
    setConfirmRestore({ dismissalId, loadA, loadB })
  }

  const handleRestoreConfirm = async () => {
    const { dismissalId } = confirmRestore
    setConfirmRestore(null)

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

  const handleRestoreCancel = () => {
    setConfirmRestore(null)
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
          {visibleDismissed.map((d) => (
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
                  onClick={() => handleRestoreClick(d.id, d.load_a_number, d.load_b_number)}
                  className="px-2.5 py-1 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors whitespace-nowrap ml-4"
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
          <ShowMoreToggle expanded={expanded} total={total} hasMore={hasMore} onToggle={toggle} />
        </div>
      )}

      {confirmRestore && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${S.card} w-full max-w-sm`}>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Restore dismissed pair?</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Restore <span className="font-mono font-semibold">{confirmRestore.loadA} / {confirmRestore.loadB}</span> to the candidates list.
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleRestoreCancel}
                  className="flex-1 px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-lg font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRestoreConfirm}
                  className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors"
                >
                  Restore
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ExistingGroupsSection({ groups, onRefresh }) {
  const [editingId, setEditingId] = useState(null)
  const [editingMiles, setEditingMiles] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const { visible: visibleGroups, expanded, toggle, total, hasMore } = useCappedList(groups)

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

  const handleDeleteClick = (groupId) => {
    setConfirmDelete(groupId)
  }

  const handleDeleteConfirm = async () => {
    const groupId = confirmDelete
    setConfirmDelete(null)

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

  const handleDeleteCancel = () => {
    setConfirmDelete(null)
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
          {visibleGroups.map(group => {
            const displayMiles = group.true_combined_miles || group.totalMiles
            const displayRpm = group.correctedRpm

            return (
              <div key={group.id} className="px-4 py-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{group.label}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-500">{group.loads?.length || 0} loads · {fmtRpm(displayRpm)}/mi</p>
                  </div>
                  <button onClick={() => handleDeleteClick(group.id)} className="px-2.5 py-1 text-xs font-semibold bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">Ungroup</button>
                </div>
                {group.notes && <p className="text-xs text-gray-600 dark:text-slate-400 mb-2">{group.notes}</p>}
                <div className="text-xs text-gray-600 dark:text-slate-400 space-y-1">
                  {(group.loads || []).map((l, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span>
                        {l.load_number} · {l.lanes}
                        {formatDateRange(l.pickup_date, l.delivery_date) && <span className="text-gray-500 ml-2">{formatDateRange(l.pickup_date, l.delivery_date)}</span>}
                      </span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 dark:border-white/10 pt-1 mt-1">
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
                          {displayMiles ? fmtNum(displayMiles) : 'Not set'}{' '}
                          <button onClick={() => { setEditingId(group.id); setEditingMiles(group.true_combined_miles || ''); }} className="text-orange-600 dark:text-orange-400 hover:underline">[edit]</button>
                        </span>
                      )}
                    </div>
                    <div>Revenue: {fmtMoney(group.totalRevenue)}</div>
                  </div>
                </div>
              </div>
            )
          })}
          <ShowMoreToggle expanded={expanded} total={total} hasMore={hasMore} onToggle={toggle} />
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${S.card} w-full max-w-sm`}>
            <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Delete combined load group?</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-slate-400">
                This will ungroup the loads. The loads themselves are not deleted.
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleDeleteCancel}
                  className="flex-1 px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-lg font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// A row is "mappable" when its place string carries a real city + state
// (i.e. contains a comma, e.g. "Blue Mound, TX"). "State-only" rows are bare
// 2-letter state codes with no city (e.g. "FL") — the load itself is missing a
// city, so they can't be fixed by adding coordinates here.
function isMappablePlace(place) {
  return typeof place === 'string' && place.includes(',')
}

function UnmappedCitiesSection({ cities }) {
  // Sort mappable rows first, then state-only; alphabetical by place within each.
  const sorted = useMemo(() => {
    return [...cities].sort((a, b) => {
      const am = isMappablePlace(a.place)
      const bm = isMappablePlace(b.place)
      if (am !== bm) return am ? -1 : 1
      return (a.place || '').localeCompare(b.place || '')
    })
  }, [cities])

  const mappableCount = useMemo(() => sorted.filter(c => isMappablePlace(c.place)).length, [sorted])
  const stateOnlyCount = sorted.length - mappableCount

  const { visible, expanded, toggle, total, hasMore } = useCappedList(sorted, 8)

  return (
    <div className={`${S.card}`}>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Unmapped cities</h2>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">
          {cities.length} with no coordinates · {mappableCount} mappable · {stateOnlyCount} state-only
        </p>
      </div>

      {cities.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">
          All cities are mapped.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={`${S.tableHead} bg-white dark:bg-[#0d0d1f]`}>
                <tr>
                  <th className={`${S.th} !px-4`}>City</th>
                  <th className={`${S.th} !px-3`}>Role</th>
                  <th className={`${S.th} !px-3 text-right`}>Occurrences</th>
                  <th className={`${S.th} !px-3`}>Loads</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((city, idx) => {
                  const mappable = isMappablePlace(city.place)
                  return (
                    <tr
                      key={idx}
                      className={S.tableRow}
                      title={mappable ? undefined : 'Load has no city — fix at the source'}
                    >
                      <td className={`px-4 py-2 ${mappable ? 'text-gray-900 dark:text-slate-200' : 'text-gray-400 dark:text-slate-500'}`}>
                        {city.place}
                        {!mappable && (
                          <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-slate-500">
                            state-only
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2 ${mappable ? 'text-gray-600 dark:text-slate-400' : 'text-gray-400 dark:text-slate-600'}`}>{city.role}</td>
                      <td className={`px-3 py-2 text-right ${mappable ? 'text-gray-600 dark:text-slate-400' : 'text-gray-400 dark:text-slate-600'}`}>{city.occurrences}</td>
                      <td className={`px-3 py-2 font-mono ${mappable ? 'text-gray-600 dark:text-slate-400' : 'text-gray-400 dark:text-slate-600'}`}>
                        {(city.load_numbers || []).join(', ') || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <ShowMoreToggle expanded={expanded} total={total} hasMore={hasMore} onToggle={toggle} />
        </>
      )}
    </div>
  )
}

export default CombinedLoads
