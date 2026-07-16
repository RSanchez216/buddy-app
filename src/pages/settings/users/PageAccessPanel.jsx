import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'

export default function PageAccessPanel({ user }) {
  const toast = useToast()
  const [pages, setPages] = useState([])
  const [userAccess, setUserAccess] = useState({}) // page_key -> access_level
  const [redundant, setRedundant] = useState(new Set()) // page_keys the role also grants (source='both')
  const [roleName, setRoleName] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pruning, setPruning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      // Fetch shareable pages
      const { data: pagesData, error: pagesErr } = await supabase
        .from('pages')
        .select('page_key, label, nav_group, sort_order')
        .eq('is_shareable', true)
        .order('nav_group', { ascending: true })
        .order('sort_order', { ascending: true })

      if (pagesErr) throw new Error(pagesErr.message)

      // Fetch user's current access
      const { data: accessData, error: accessErr } = await supabase
        .from('user_page_access')
        .select('page_key, access_level')
        .eq('user_id', user.id)

      if (accessErr) throw new Error(accessErr.message)

      // Effective access (from the view) — the 'both' rows are individual grants
      // the user's role now also covers, so they're redundant and prunable.
      const { data: effData, error: effErr } = await supabase
        .from('v_user_effective_page_access')
        .select('page_key, source')
        .eq('user_id', user.id)
      if (effErr) throw new Error(effErr.message)

      // Role name for the "covered by {Role}" label / confirm copy.
      let rName = null
      if (user.role_id) {
        const { data: roleRow } = await supabase.from('roles').select('name').eq('id', user.role_id).maybeSingle()
        rName = roleRow?.name || null
      }

      setPages(pagesData || [])
      const accessMap = {}
      for (const row of accessData || []) {
        accessMap[row.page_key] = row.access_level
      }
      setUserAccess(accessMap)
      setRedundant(new Set((effData || []).filter(r => r.source === 'both').map(r => r.page_key)))
      setRoleName(rName)
    } catch (e) {
      setError(e?.message || 'Failed to load page access')
      console.error('PageAccessPanel load error:', e)
    } finally {
      setLoading(false)
    }
  }, [user?.id, user?.role_id])

  useEffect(() => {
    load()
  }, [load])

  async function pruneRedundant() {
    const keys = [...redundant]
    if (keys.length === 0) return
    const who = user.full_name || user.email
    if (!confirm(`These ${keys.length} page${keys.length === 1 ? '' : 's'} are already granted by the ${roleName || 'assigned'} role. Removing the individual grants won't change what ${who} can see.`)) return
    setPruning(true)
    setError('')
    try {
      const { error: delErr } = await supabase
        .from('user_page_access')
        .delete()
        .eq('user_id', user.id)
        .in('page_key', keys)
      if (delErr) throw new Error(delErr.message)
      setUserAccess(prev => { const next = { ...prev }; for (const k of keys) delete next[k]; return next })
      setRedundant(new Set())
      toast.success(`Removed ${keys.length} redundant grant${keys.length === 1 ? '' : 's'}`)
    } catch (e) {
      setError(e?.message || 'Failed to remove redundant grants')
      toast.error("Couldn't remove grants", e)
    } finally {
      setPruning(false)
    }
  }

  const pagesByGroup = useMemo(() => {
    const groups = {}
    for (const page of pages) {
      const group = page.nav_group || 'Other'
      if (!groups[group]) groups[group] = []
      groups[group].push(page)
    }
    return groups
  }, [pages])

  async function updateAccess(pageKey, level) {
    setSaving(true)
    setError('')

    try {
      if (level === 'none') {
        // Delete the access row
        const { error: delErr } = await supabase
          .from('user_page_access')
          .delete()
          .match({ user_id: user.id, page_key: pageKey })
        if (delErr) throw new Error(delErr.message)
        setUserAccess(prev => {
          const next = { ...prev }
          delete next[pageKey]
          return next
        })
      } else {
        // Upsert the access row
        const { error: upsertErr } = await supabase
          .from('user_page_access')
          .upsert({
            user_id: user.id,
            page_key: pageKey,
            access_level: level,
            granted_by: (await supabase.auth.getUser()).data.user?.id,
            granted_at: new Date().toISOString(),
          }, { onConflict: 'user_id,page_key' })
        if (upsertErr) throw new Error(upsertErr.message)
        setUserAccess(prev => ({ ...prev, [pageKey]: level }))
      }
    } catch (e) {
      setError(e?.message || 'Failed to update access')
      toast.error("Couldn't update access", e)
    } finally {
      setSaving(false)
    }
  }

  if (user.role === 'admin') {
    return (
      <div className="p-4 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl text-sm text-blue-700 dark:text-blue-400">
        <div className="font-medium mb-1">Admins have full access</div>
        <p className="text-xs">Admins can view and edit all pages, regardless of these settings.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-500" />
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-xl text-sm text-gray-500 dark:text-slate-400 text-center">
        No shareable pages configured yet
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && <div className={S.errorBox}>{error}</div>}

      {redundant.size > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {redundant.size} individual grant{redundant.size === 1 ? '' : 's'} {redundant.size === 1 ? 'is' : 'are'} already covered by the {roleName || 'assigned'} role.
          </p>
          <button
            onClick={pruneRedundant}
            disabled={pruning}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
          >
            {pruning ? 'Removing…' : `Remove redundant grants (${redundant.size})`}
          </button>
        </div>
      )}

      {Object.entries(pagesByGroup).map(([group, groupPages]) => (
        <div key={group}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-3">
            {group}
          </h4>
          <div className="space-y-2">
            {groupPages.map(page => (
              <div key={page.page_key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-lg">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-200">{page.label}</p>
                  {redundant.has(page.page_key) && (
                    <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">covered by {roleName || 'role'}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <select
                    value={userAccess[page.page_key] || 'none'}
                    onChange={e => updateAccess(page.page_key, e.target.value)}
                    disabled={saving}
                    className={`${S.select} text-xs py-1 px-2 min-w-fit`}
                  >
                    <option value="none">None</option>
                    <option value="view">View</option>
                    <option value="edit">Edit</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
