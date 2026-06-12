import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'

export default function PageAccessPanel({ user, onClose }) {
  const toast = useToast()
  const [pages, setPages] = useState([])
  const [userAccess, setUserAccess] = useState({}) // page_key -> access_level
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [user?.id])

  async function load() {
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

      setPages(pagesData || [])
      const accessMap = {}
      for (const row of accessData || []) {
        accessMap[row.page_key] = row.access_level
      }
      setUserAccess(accessMap)
    } catch (e) {
      setError(e?.message || 'Failed to load page access')
      console.error('PageAccessPanel load error:', e)
    } finally {
      setLoading(false)
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
