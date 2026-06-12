import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { S } from '../../../lib/styles'
import { useToast } from '../../../contexts/ToastContext'

export default function Pages() {
  const toast = useToast()
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null) // page_key being updated

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('pages')
        .select('page_key, label, route, nav_group, sort_order, is_shareable')
        .order('nav_group', { ascending: true })
        .order('sort_order', { ascending: true })

      if (error) throw new Error(error.message)
      setPages(data || [])
    } catch (e) {
      toast.error('Failed to load pages', e)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const pagesByGroup = useMemo(() => {
    const groups = {}
    for (const page of pages) {
      const group = page.nav_group || 'Other'
      if (!groups[group]) groups[group] = []
      groups[group].push(page)
    }
    return groups
  }, [pages])

  async function toggleShareable(pageKey, currentValue) {
    setUpdating(pageKey)
    try {
      const { error } = await supabase
        .from('pages')
        .update({ is_shareable: !currentValue })
        .eq('page_key', pageKey)

      if (error) throw new Error(error.message)

      setPages(pages.map(p =>
        p.page_key === pageKey ? { ...p, is_shareable: !p.is_shareable } : p
      ))
      toast.success(`Page ${!currentValue ? 'enabled' : 'disabled'} for sharing`)
    } catch (e) {
      toast.error("Couldn't update page", e)
    } finally {
      setUpdating(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pages</h1>
        <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
          Only shareable pages can be granted to users
        </p>
      </div>

      <div className="space-y-6">
        {Object.entries(pagesByGroup).map(([group, groupPages]) => (
          <div key={group}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-3">
              {group}
            </h2>
            <div className={`${S.card} divide-y divide-gray-100 dark:divide-white/5 overflow-hidden`}>
              {groupPages.map(page => (
                <div key={page.page_key} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-200">{page.label}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 font-mono mt-0.5">{page.route}</p>
                  </div>
                  <div className="ml-3 flex items-center">
                    <button
                      onClick={() => toggleShareable(page.page_key, page.is_shareable)}
                      disabled={updating === page.page_key}
                      className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${
                        page.is_shareable
                          ? 'bg-orange-500'
                          : 'bg-gray-300 dark:bg-slate-600'
                      } ${updating === page.page_key ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                      title={`${page.is_shareable ? 'Disable' : 'Enable'} sharing`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          page.is_shareable ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
